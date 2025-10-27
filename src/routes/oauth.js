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

  // Redirect to Supabase for authentication
  const supabaseAuthUrl = new URL(`${config.supabase.url}/auth/v1/authorize`);

  // Use Google as default provider (you can make this configurable)
  supabaseAuthUrl.searchParams.set('provider', 'google');

  // Request offline_access for refresh token
  supabaseAuthUrl.searchParams.set('scopes', 'openid email offline_access');

  // Redirect back to our callback endpoint
  const callbackUrl = `${config.baseUrl}/oauth/callback?state=${encodedState}`;
  supabaseAuthUrl.searchParams.set('redirect_to', callbackUrl);

  logger.info('Redirecting to Supabase for authentication');

  res.redirect(302, supabaseAuthUrl.toString());
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

    res.redirect(302, redirectUrl.toString());

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
 * Setup OAuth routes on Express app
 */
export function setupOAuthRoutes(app) {
  app.use(router);
  logger.info('OAuth routes configured');
}
