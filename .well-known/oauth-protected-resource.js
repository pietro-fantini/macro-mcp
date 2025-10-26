import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from 'mcp-handler';

const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL) {
  throw new Error('SUPABASE_URL environment variable is required');
}

// Handler that tells MCP clients (like Claude) where to authenticate
const handler = protectedResourceHandler({
  // Your Supabase project is the OAuth authorization server
  authServerUrls: [SUPABASE_URL],
});

// CORS handler for browser-based clients
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };

