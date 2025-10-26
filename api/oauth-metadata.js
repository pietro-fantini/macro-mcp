/**
 * OAuth Protected Resource Metadata Endpoint
 * 
 * This endpoint tells MCP clients (like Claude) that OAuth is required
 * and where to authenticate (your Supabase project).
 * 
 * Required by MCP OAuth specification:
 * https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
 * 
 * When Claude Desktop connects to your MCP server, it will:
 * 1. Fetch this endpoint: GET /.well-known/oauth-protected-resource
 * 2. Discover the authorization_servers array
 * 3. Prompt the user to authenticate via your Supabase OAuth
 */

export default async function handler(req, res) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;

  if (!SUPABASE_URL) {
    console.error('SUPABASE_URL environment variable is not set');
    return res.status(500).json({ 
      error: 'Server configuration error: SUPABASE_URL not configured' 
    });
  }

  // Return OAuth metadata as per MCP spec
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS for MCP clients
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  return res.status(200).json({
    // Tell MCP clients to use this Supabase instance for OAuth
    authorization_servers: [SUPABASE_URL]
  });
}

