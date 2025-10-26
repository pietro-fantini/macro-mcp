/**
 * OAuth Protected Resource Metadata Endpoint
 * 
 * This endpoint tells MCP clients (like Claude) that OAuth is required
 * and where to authenticate (your Supabase project).
 * 
 * According to MCP OAuth spec, this should be served at:
 * /.well-known/oauth-protected-resource
 */

const SUPABASE_URL = process.env.SUPABASE_URL;

export default async function handler(req, res) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL) {
    console.error('[OAuth Metadata] SUPABASE_URL environment variable is not set');
    return res.status(500).json({ 
      error: 'Server configuration error: SUPABASE_URL not configured' 
    });
  }

  // Set CORS headers for MCP clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  console.log('[OAuth Metadata] Serving OAuth configuration:', { authorization_servers: [SUPABASE_URL] });

  // Return OAuth metadata as per MCP spec
  return res.status(200).json({
    authorization_servers: [SUPABASE_URL]
  });
}

