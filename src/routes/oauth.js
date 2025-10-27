/**
 * OAuth 2.0 Authorization Server Implementation
 * Implements RFC 6749 (OAuth 2.0) with PKCE (RFC 7636)
 */

import { Router } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const router = Router();

// In-memory store for auth codes (for production, use Redis or similar)
// Structure: { code: { accessToken, refreshToken, codeChallenge, redirectUri, expiresAt, clientId, scope } }
const authCodes = new Map();

// Cleanup expired codes every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of authCodes.entries()) {
    if (data.expiresAt < now) {
      authCodes.delete(code);
      logger.debug('Deleted expired auth code');
    }
  }
}, 5 * 60 * 1000);

/**
 * GET /oauth/authorize
 * Step 1: Client initiates OAuth flow
 */
router.get('/oauth/authorize', (req, res) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    state,
    scope,
    code_challenge,
    code_challenge_method
  } = req.query;

  logger.info('OAuth authorization request', {
    client_id,
    redirect_uri,
    response_type,
    has_code_challenge: !!code_challenge
  });

  // Validate required parameters
  if (!redirect_uri || !response_type || !state) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required OAuth parameters (redirect_uri, response_type, state)'
    });
  }

  if (response_type !== 'code') {
    return res.status(400).json({
      error: 'unsupported_response_type',
      error_description: 'Only "code" response type is supported'
    });
  }

  // PKCE: Require code_challenge
  if (!code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'PKCE is required. Must include code_challenge with S256 method'
    });
  }

  // Store OAuth state to pass through Supabase auth flow
  const oauthState = {
    clientState: state,
    redirectUri: redirect_uri,
    clientId: client_id || 'mcp-client',
    scope: scope || 'openid',
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method,
    timestamp: Date.now()
  };

  // Encode state as base64url for URL safety
  const encodedState = Buffer.from(JSON.stringify(oauthState)).toString('base64url');

  // Build Supabase auth URL
  const supabaseAuthUrl = new URL(`${config.supabase.url}/auth/v1/authorize`);
  supabaseAuthUrl.searchParams.set('provider', 'google');
  supabaseAuthUrl.searchParams.set('scopes', 'openid email offline_access');

  const callbackUrl = `${config.baseUrl}/oauth/callback?state=${encodedState}`;
  supabaseAuthUrl.searchParams.set('redirect_to', callbackUrl);

  logger.info('Showing authorization page');

  // Show authorization consent page with auto-redirect
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Authorize Macro MCP</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          background: white;
          padding: 3rem;
          border-radius: 1rem;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
          max-width: 400px;
        }
        h1 {
          color: #333;
          margin-bottom: 1rem;
          font-size: 1.75rem;
        }
        p {
          color: #666;
          line-height: 1.6;
          margin-bottom: 2rem;
        }
        .btn {
          background: #667eea;
          color: white;
          border: none;
          padding: 1rem 2rem;
          border-radius: 0.5rem;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
          transition: background 0.3s;
        }
        .btn:hover {
          background: #5568d3;
        }
        .spinner {
          border: 3px solid #f3f3f3;
          border-top: 3px solid #667eea;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 2rem auto;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .auto-redirect {
          font-size: 0.875rem;
          color: #999;
          margin-top: 1rem;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔐 Authorize Macro MCP</h1>
        <p>You'll be redirected to Google to sign in and authorize access to your macro tracking data.</p>
        <div class="spinner"></div>
        <p class="auto-redirect">Redirecting automatically in 2 seconds...</p>
        <a href="${supabaseAuthUrl.toString()}" class="btn">Continue to Google Sign-In</a>
      </div>
      <script>
        // Auto-redirect after 2 seconds
        setTimeout(() => {
          window.location.href = '${supabaseAuthUrl.toString()}';
        }, 2000);
      </script>
    </body>
    </html>
  `);
});

/**
 * GET /oauth/callback
 * Step 2: Supabase redirects back after authentication
 */
router.get('/oauth/callback', async (req, res) => {
  const { state: encodedState, code: supabaseCode, error: authError } = req.query;

  logger.info('OAuth callback received', {
    has_state: !!encodedState,
    has_code: !!supabaseCode,
    error: authError
  });

  // Handle Supabase auth errors
  if (authError) {
    logger.error('Supabase authentication error', { error: authError });
    return res.status(400).send(`
      <html>
        <body>
          <h1>Authentication Failed</h1>
          <p>Error: ${authError}</p>
          <p>Please try again.</p>
        </body>
      </html>
    `);
  }

  if (!encodedState || !supabaseCode) {
    logger.error('Missing state or code in callback');
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing state or code parameter'
    });
  }

  try {
    // Decode OAuth state
    const stateJson = Buffer.from(encodedState, 'base64url').toString('utf-8');
    const oauthState = JSON.parse(stateJson);

    // Verify state timestamp (prevent replay attacks)
    const stateAge = Date.now() - oauthState.timestamp;
    if (stateAge > 10 * 60 * 1000) { // 10 minutes
      throw new Error('OAuth state expired');
    }

    logger.info('OAuth state decoded successfully');

    // Exchange Supabase code for tokens
    const supabase = createClient(config.supabase.url, config.supabase.anonKey);
    const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(supabaseCode);

    if (sessionError || !sessionData?.session) {
      logger.error('Failed to exchange Supabase code for session', { error: sessionError });
      throw new Error('Failed to authenticate with Supabase');
    }

    const { access_token: supabaseAccessToken, refresh_token: supabaseRefreshToken } = sessionData.session;

    logger.info('Supabase session obtained', {
      user_id: sessionData.user?.id,
      email: sessionData.user?.email
    });

    // Generate authorization code for MCP client
    const authCode = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + (config.oauth.codeExpirySeconds * 1000);

    // Store auth code with Supabase tokens
    authCodes.set(authCode, {
      accessToken: supabaseAccessToken,
      refreshToken: supabaseRefreshToken,
      codeChallenge: oauthState.codeChallenge,
      codeChallengeMethod: oauthState.codeChallengeMethod,
      redirectUri: oauthState.redirectUri,
      clientId: oauthState.clientId,
      scope: oauthState.scope,
      expiresAt,
      userId: sessionData.user.id,
      email: sessionData.user.email
    });

    logger.info('Authorization code generated', { code: authCode.substring(0, 10) + '...' });

    // Redirect back to MCP client with authorization code
    const redirectUrl = new URL(oauthState.redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    redirectUrl.searchParams.set('state', oauthState.clientState);

    logger.info('Redirecting to client', { redirect_uri: oauthState.redirectUri });

    // Show success page before redirecting back to client
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Authorization Successful</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 1rem;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 400px;
          }
          h1 {
            color: #10b981;
            margin-bottom: 1rem;
            font-size: 1.75rem;
          }
          p {
            color: #666;
            line-height: 1.6;
            margin-bottom: 1rem;
          }
          .check {
            font-size: 4rem;
            margin-bottom: 1rem;
          }
          .info {
            background: #f3f4f6;
            padding: 1rem;
            border-radius: 0.5rem;
            margin-top: 1.5rem;
            font-size: 0.875rem;
            color: #6b7280;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="check">✓</div>
          <h1>Authorization Successful!</h1>
          <p>You've successfully signed in as <strong>${sessionData.user.email}</strong></p>
          <p>Completing authentication...</p>
          <div class="info">
            You can close this window and return to Claude.
          </div>
        </div>
        <script>
          // Redirect back to the MCP client
          setTimeout(() => {
            window.location.href = '${redirectUrl.toString()}';
          }, 2000);
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    logger.error('OAuth callback error', { error: error.message, stack: error.stack });

    res.status(500).send(`
      <html>
        <body>
          <h1>Authentication Error</h1>
          <p>An error occurred during authentication: ${error.message}</p>
          <p>Please try again.</p>
        </body>
      </html>
    `);
  }
});

/**
 * POST /oauth/token
 * Step 3: Client exchanges authorization code for access token
 */
router.post('/oauth/token', async (req, res) => {
  const {
    grant_type,
    code,
    redirect_uri,
    code_verifier,
    client_id
  } = req.body;

  logger.info('Token exchange request', {
    grant_type,
    client_id,
    has_code: !!code,
    has_verifier: !!code_verifier
  });

  // Validate grant type
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only authorization_code grant type is supported'
    });
  }

  // Validate required parameters
  if (!code) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing authorization code'
    });
  }

  // Retrieve auth code data
  const codeData = authCodes.get(code);
  if (!codeData) {
    logger.error('Invalid or expired authorization code');
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code is invalid or expired'
    });
  }

  // Verify code hasn't expired
  if (codeData.expiresAt < Date.now()) {
    authCodes.delete(code);
    logger.error('Authorization code expired');
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code expired'
    });
  }

  // Verify PKCE code_verifier
  if (!code_verifier) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code_verifier is required for PKCE'
    });
  }

  // Verify code_challenge matches code_verifier
  const computedChallenge = crypto
    .createHash('sha256')
    .update(code_verifier)
    .digest('base64url');

  if (computedChallenge !== codeData.codeChallenge) {
    logger.error('PKCE verification failed', {
      expected: codeData.codeChallenge,
      computed: computedChallenge
    });

    authCodes.delete(code);

    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'PKCE verification failed'
    });
  }

  // Verify redirect_uri matches
  if (redirect_uri !== codeData.redirectUri) {
    logger.error('Redirect URI mismatch');
    authCodes.delete(code);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'redirect_uri does not match'
    });
  }

  // Code is single-use - delete it now
  authCodes.delete(code);

  logger.info('Token exchange successful', {
    user_id: codeData.userId,
    email: codeData.email
  });

  // Return Supabase access token to MCP client
  res.json({
    access_token: codeData.accessToken,
    token_type: 'Bearer',
    expires_in: config.oauth.tokenExpirySeconds,
    refresh_token: codeData.refreshToken,
    scope: codeData.scope
  });
});

/**
 * POST /oauth/register
 * Dynamic Client Registration (RFC 7591)
 * Allows MCP clients to automatically register themselves
 */
router.post('/oauth/register', async (req, res) => {
  const { client_name, redirect_uris, grant_types, token_endpoint_auth_method } = req.body;

  logger.info('Client registration request', {
    client_name,
    redirect_uris,
    grant_types
  });

  // Validate required fields
  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'redirect_uris is required and must be a non-empty array'
    });
  }

  // Validate grant types
  const allowedGrantTypes = ['authorization_code'];
  const requestedGrantTypes = grant_types || ['authorization_code'];
  const invalidGrantTypes = requestedGrantTypes.filter(gt => !allowedGrantTypes.includes(gt));

  if (invalidGrantTypes.length > 0) {
    return res.status(400).json({
      error: 'invalid_grant_type',
      error_description: `Unsupported grant types: ${invalidGrantTypes.join(', ')}`
    });
  }

  // Validate auth method (we only support 'none' for public clients with PKCE)
  if (token_endpoint_auth_method && token_endpoint_auth_method !== 'none') {
    return res.status(400).json({
      error: 'invalid_client_metadata',
      error_description: 'Only token_endpoint_auth_method "none" is supported (PKCE required)'
    });
  }

  // Generate client ID (in production, you might want to store this in a database)
  const clientId = `mcp_${crypto.randomBytes(16).toString('hex')}`;

  // For public clients (PKCE), we don't issue a client_secret
  const registrationResponse = {
    client_id: clientId,
    client_name: client_name || 'MCP Client',
    redirect_uris,
    grant_types: requestedGrantTypes,
    token_endpoint_auth_method: 'none',
    client_id_issued_at: Math.floor(Date.now() / 1000)
  };

  logger.info('Client registered successfully', {
    client_id: clientId,
    client_name: registrationResponse.client_name
  });

  res.status(201).json(registrationResponse);
});

/**
 * Setup OAuth routes on Express app
 */
export function setupOAuthRoutes(app) {
  app.use(router);
  logger.info('OAuth routes configured');
}
