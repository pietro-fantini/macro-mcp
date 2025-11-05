/**
 * MCP Server Implementation
 * Uses official @modelcontextprotocol/sdk with Streamable HTTP transport
 */

import { Router } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getMealTools } from '../tools/meals.js';

// AsyncLocalStorage for request-scoped auth info
const authStorage = new AsyncLocalStorage();

const router = Router();

// Get all available tools once
const mealTools = getMealTools();
const allTools = [...mealTools];

// Create a single MCP server instance
const mcpServer = new Server(
  {
    name: 'macro-mcp',
    version: '2.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Register tools/list handler
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }))
  };
});

// Register tools/call handler
mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};

  logger.info('Tool call', { tool: toolName, args });

  // Find the tool
  const tool = allTools.find(t => t.name === toolName);

  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  // Get auth info from AsyncLocalStorage (set during request authentication)
  const authInfo = authStorage.getStore();

  logger.info('Tool auth check', { tool: toolName, hasAuthInfo: !!authInfo, userId: authInfo?.userId });

  // Check if tool requires auth
  if (tool.requiresAuth) {
    if (!authInfo) {
      return {
        content: [{
          type: 'text',
          text: '🔐 Authentication required. Please connect your account to use this tool.'
        }],
        isError: true
      };
    }

    // Pass auth info to handler
    return await tool.handler(args, authInfo);
  }

  // No auth required
  return await tool.handler(args);
});

logger.info('MCP server created with tools registered');

/**
 * Verify Supabase JWT token and return user info
 */
async function verifySupabaseToken(bearerToken) {
  if (!bearerToken) {
    return null;
  }

  try {
    const supabase = createClient(config.supabase.url, config.supabase.anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${bearerToken}`
        }
      }
    });

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      logger.warn('Token verification failed', { error: error?.message });
      return null;
    }

    logger.info('Token verified', { user_id: user.id, email: user.email });

    return {
      userId: user.id,
      email: user.email,
      token: bearerToken
    };
  } catch (error) {
    logger.error('Token verification error', { error: error.message });
    return null;
  }
}

// Create a single transport instance
const transport = new StreamableHTTPServerTransport({
  sessionIdHeader: 'x-mcp-session-id'
});

// Connect server to transport once
await mcpServer.connect(transport);
logger.info('MCP server connected to transport');

/**
 * Handle MCP requests (both POST and GET for SSE)
 * Requires OAuth authentication per MCP Authorization spec
 */
async function handleMcpRequest(req, res) {
  logger.info('MCP request received', {
    userAgent: req.get('user-agent'),
    origin: req.get('origin'),
    method: req.method,
    hasAuth: !!req.headers.authorization
  });

  // Extract auth token if present
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;

  // Per MCP spec: If no auth token provided, return 401 with WWW-Authenticate header
  // This signals to the client that OAuth is required
  if (!bearerToken) {
    logger.info('No authorization token provided, returning 401');

    const baseUrl = config.baseUrl || 'http://localhost:3000';
    const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;

    // Set WWW-Authenticate header BEFORE sending response (per RFC 6750 and RFC 9728)
    res.setHeader(
      'WWW-Authenticate',
      `Bearer error="invalid_request", ` +
      `error_description="No access token was provided in this request", ` +
      `resource_metadata="${resourceMetadataUrl}"`
    );

    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized: Authentication required',
        data: {
          error: 'invalid_request',
          error_description: 'No access token was provided in this request',
          resource_metadata: resourceMetadataUrl
        }
      },
      id: null
    });

    return;
  }

  // Verify the token
  const authInfo = await verifySupabaseToken(bearerToken);

  if (!authInfo) {
    logger.warn('Invalid or expired token');

    const baseUrl = config.baseUrl || 'http://localhost:3000';
    const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;

    // Set WWW-Authenticate header BEFORE sending response
    res.setHeader(
      'WWW-Authenticate',
      `Bearer error="invalid_token", ` +
      `error_description="The access token is invalid or expired", ` +
      `resource_metadata="${resourceMetadataUrl}"`
    );

    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized: Invalid or expired token',
        data: {
          error: 'invalid_token',
          error_description: 'The access token is invalid or expired',
          resource_metadata: resourceMetadataUrl
        }
      },
      id: null
    });

    return;
  }

  logger.info('Request authenticated', { user_id: authInfo.userId });

  // Handle the request/response within AsyncLocalStorage context
  // This makes authInfo available to all async operations in the request
  try {
    await authStorage.run(authInfo, async () => {
      // Transport.handleRequest only accepts (req, res)
      // AuthInfo is retrieved from authStorage.getStore() in the tool handler
      await transport.handleRequest(req, res);
    });
  } catch (error) {
    logger.error('MCP request error', { error: error.message, stack: error.stack });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

// Register both POST and GET handlers for MCP endpoint
router.post('/mcp', handleMcpRequest);
router.get('/mcp', handleMcpRequest);

/**
 * Setup MCP routes on Express app
 */
export function setupMcpRoutes(app) {
  app.use(router);
  logger.info('MCP routes configured');
}
