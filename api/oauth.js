/**
 * OAuth Protected Resource Metadata Endpoint
 * 
 * This endpoint tells MCP clients (like Claude) where to find
 * the OAuth authorization and token endpoints.
 * 
 * According to RFC 8414, this should return the OAuth server metadata.
 */

export default async function handler(req, res) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Build the base URL from the request
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const baseUrl = `${protocol}://${host}`;

  console.log('[OAuth Metadata] Serving OAuth configuration for:', baseUrl);

  // Set CORS headers for MCP clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  // Return OAuth Authorization Server metadata
  // This tells Claude where to find our OAuth endpoints
  return res.status(200).json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['openid']
  });
}

