/**
 * MCP Server Implementation
 * Uses official @modelcontextprotocol/sdk with Streamable HTTP transport
 */

import { Router } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getNutritionTools } from '../tools/nutrition.js';
import { getMealTools } from '../tools/meals.js';

const router = Router();

// Get all available tools once
const nutritionTools = getNutritionTools();
const mealTools = getMealTools();
const allTools = [...nutritionTools, ...mealTools];

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

  // Get auth info from the request extra data
  const authInfo = extra?.authInfo;

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
 * POST /mcp
 * Streamable HTTP endpoint for MCP protocol
 */
router.post('/mcp', async (req, res) => {
  logger.info('MCP request received', {
    userAgent: req.get('user-agent'),
    origin: req.get('origin'),
    method: req.method
  });

  // Extract auth token if present
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;

  let authInfo = null;
  if (bearerToken) {
    authInfo = await verifySupabaseToken(bearerToken);
    if (authInfo) {
      logger.info('Request authenticated', { user_id: authInfo.userId });
    }
  }

  // Store auth info in req so it's available in the extra parameter
  req.auth = authInfo;

  // Handle the request/response
  try {
    // The transport will parse the body itself
    await transport.handleRequest(req, res, undefined);
  } catch (error) {
    logger.error('MCP request error', { error: error.message, stack: error.stack });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * Setup MCP routes on Express app
 */
export function setupMcpRoutes(app) {
  app.use(router);
  logger.info('MCP routes configured');
}
