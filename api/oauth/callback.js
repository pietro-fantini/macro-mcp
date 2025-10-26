/**
 * OAuth Callback Endpoint
 * 
 * Supabase redirects here after user authenticates.
 * We exchange the Supabase token for our own authorization code,
 * then redirect back to Claude.
 */

import crypto from 'crypto';

// Shared storage (same as authorize.js)
// In production, use Redis or a database
const stateStore = new Map();
const codeStore = new Map();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { state, access_token, refresh_token, error, error_description } = req.query;

  if (error) {
    console.error('[OAuth Callback] Error from Supabase:', error, error_description);
    return res.status(400).send(`
      <html>
        <head><title>Authentication Error</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>❌ Authentication Failed</h1>
          <p>${error_description || error}</p>
          <p><a href="/">Go back</a></p>
        </body>
      </html>
    `);
  }

  if (!state || !access_token) {
    return res.status(400).json({ 
      error: 'invalid_request',
      error_description: 'Missing state or token from Supabase' 
    });
  }

  // Retrieve the original OAuth request
  const oauthRequest = stateStore.get(state);
  if (!oauthRequest) {
    console.error('[OAuth Callback] State not found:', state);
    return res.status(400).json({ 
      error: 'invalid_state',
      error_description: 'State parameter not found or expired' 
    });
  }

  console.log('[OAuth Callback] Received tokens from Supabase, generating authorization code');

  // Clean up the state
  stateStore.delete(state);

  // Generate authorization code for Claude
  const authCode = crypto.randomBytes(32).toString('hex');
  
  // Store the code with the Supabase tokens
  codeStore.set(authCode, {
    accessToken: access_token,
    refreshToken: refresh_token,
    redirectUri: oauthRequest.redirectUri,
    clientId: oauthRequest.clientId,
    scope: oauthRequest.scope,
    codeChallenge: oauthRequest.codeChallenge,
    codeChallengeMethod: oauthRequest.codeChallengeMethod,
    timestamp: Date.now(),
    expiresAt: Date.now() + (10 * 60 * 1000) // 10 minutes
  });

  // Redirect back to Claude with the authorization code
  const redirectUrl = new URL(oauthRequest.redirectUri);
  redirectUrl.searchParams.set('code', authCode);
  redirectUrl.searchParams.set('state', oauthRequest.clientState);

  console.log('[OAuth Callback] Redirecting to client:', redirectUrl.toString().substring(0, 100) + '...');

  res.redirect(302, redirectUrl.toString());
}

