/**
 * OAuth Token Endpoint
 * 
 * Claude exchanges the authorization code for an access token.
 * We return the Supabase token that can be used for MCP requests.
 */

import crypto from 'crypto';

// Shared storage
const codeStore = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse form data or JSON
  let body;
  if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
    // Parse URL-encoded body
    const bodyText = await getRawBody(req);
    body = Object.fromEntries(new URLSearchParams(bodyText));
  } else {
    body = req.body;
  }

  const { 
    grant_type, 
    code, 
    redirect_uri,
    client_id,
    code_verifier 
  } = body;

  console.log('[OAuth Token] Token request:', { grant_type, code: code?.substring(0, 10) + '...', redirect_uri });

  // Validate grant type
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ 
      error: 'unsupported_grant_type',
      error_description: 'Only authorization_code grant type is supported' 
    });
  }

  if (!code) {
    return res.status(400).json({ 
      error: 'invalid_request',
      error_description: 'Missing authorization code' 
    });
  }

  // Retrieve the code data
  const codeData = codeStore.get(code);
  if (!codeData) {
    console.error('[OAuth Token] Code not found or expired:', code.substring(0, 10) + '...');
    return res.status(400).json({ 
      error: 'invalid_grant',
      error_description: 'Authorization code is invalid or expired' 
    });
  }

  // Verify PKCE if code_challenge was provided
  if (codeData.codeChallenge) {
    if (!code_verifier) {
      return res.status(400).json({ 
        error: 'invalid_request',
        error_description: 'code_verifier required for PKCE flow' 
      });
    }

    const hash = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (hash !== codeData.codeChallenge) {
      console.error('[OAuth Token] PKCE verification failed');
      return res.status(400).json({ 
        error: 'invalid_grant',
        error_description: 'PKCE verification failed' 
      });
    }
  }

  // Verify redirect_uri matches
  if (codeData.redirectUri !== redirect_uri) {
    return res.status(400).json({ 
      error: 'invalid_grant',
      error_description: 'redirect_uri does not match' 
    });
  }

  // Clean up the code (one-time use)
  codeStore.delete(code);

  console.log('[OAuth Token] Issuing access token');

  // Return the Supabase access token
  res.status(200).json({
    access_token: codeData.accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: codeData.refreshToken,
    scope: codeData.scope || 'openid'
  });
}

// Helper to read raw body for URL-encoded data
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

