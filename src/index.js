import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { setupOAuthRoutes } from './routes/oauth.js';
import { setupMcpRoutes } from './routes/mcp.js';
import { logger } from './utils/logger.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// Only parse JSON for non-MCP routes
// The MCP transport needs to read the raw stream
app.use((req, res, next) => {
  if (req.path === '/mcp') {
    // Skip body parsing for MCP endpoint
    next();
  } else {
    express.json()(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('user-agent')
    });
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'macro-mcp',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// Setup routes BEFORE static files so custom routes take precedence
setupOAuthRoutes(app);
setupMcpRoutes(app);

// Serve static files from public directory (after routes)
app.use(express.static('public'));

// OAuth discovery endpoints for MCP clients
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  logger.info('OAuth protected resource endpoint accessed');

  res.json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [`${baseUrl}`]
  });
});

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  logger.info('OAuth authorization server metadata endpoint accessed');

  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic']
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Create HTTP server
const server = createServer(app);

// Start server
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Macro MCP Server started`);
  logger.info(`📍 Port: ${PORT}`);
  logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
  logger.info(`🔐 OAuth discovery: http://localhost:${PORT}/.well-known/oauth-protected-resource`);
  logger.info(`🛠️  MCP endpoint: http://localhost:${PORT}/mcp`);
  logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down gracefully...');

  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
