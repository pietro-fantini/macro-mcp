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

// Log all OAuth requests for debugging
router.use((req, res, next) => {
  logger.info('OAuth endpoint accessed', {
    path: req.path,
    method: req.method,
    query: req.query,
    headers: {
      authorization: req.get('authorization') ? 'Present' : 'None',
      referer: req.get('referer'),
      origin: req.get('origin'),
      userAgent: req.get('user-agent')
    }
  });
  next();
});

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
 * Supports both standard OAuth params and MCP client-specific flows
 */
router.get('/oauth/authorize', (req, res) => {
  // Extract params from query (some MCP clients may use different sources)
  let {
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
    state,
    scope,
    code_challenge: code_challenge?.substring(0, 10) + '...',
    code_challenge_method,
    full_query: req.query,
    headers: {
      referer: req.get('referer'),
      origin: req.get('origin'),
      userAgent: req.get('user-agent')
    }
  });

  // Handle MCP clients that may not provide all standard OAuth params
  // Generate defaults for missing params to support simplified MCP configurations
  if (!redirect_uri) {
    // Use a default redirect URI for MCP clients
    redirect_uri = 'http://localhost:3000/oauth/callback';
    logger.info('Using default redirect_uri for MCP client', { redirect_uri });
  }

  if (!response_type) {
    response_type = 'code';
    logger.info('Using default response_type: code');
  }

  if (!state) {
    // Generate a state parameter if not provided
    state = crypto.randomBytes(16).toString('base64url');
    logger.info('Generated state parameter for MCP client', { state: state.substring(0, 10) + '...' });
  }

  // Validate response_type
  if (response_type !== 'code') {
    return res.status(400).json({
      error: 'unsupported_response_type',
      error_description: 'Only "code" response type is supported'
    });
  }

  // PKCE: Handle missing code_challenge (some MCP clients may not support PKCE)
  if (!code_challenge) {
    // Generate a code challenge for clients that don't support PKCE
    code_challenge = crypto.randomBytes(32).toString('base64url');
    code_challenge_method = 'plain'; // Use plain method as fallback
    logger.info('Generated code_challenge for MCP client without PKCE support');
  } else if (code_challenge_method !== 'S256' && code_challenge_method !== 'plain') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code_challenge_method must be S256 or plain'
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

  logger.info('Redirecting directly to signin/signup page');

  // Redirect directly to the modern signin/signup page with OAuth state
  const signupUrl = `${config.baseUrl}/oauth/signup.html?state=${encodedState}`;
  res.redirect(signupUrl);
});

/**
 * POST /oauth/callback
 * Step 2b: Receive tokens from intermediate callback page
 */
router.post('/oauth/callback', async (req, res) => {
  const { access_token, refresh_token, state: encodedState } = req.body;

  logger.info('OAuth callback POST received', {
    has_access_token: !!access_token,
    has_refresh_token: !!refresh_token,
    has_state: !!encodedState
  });

  if (!encodedState || !access_token) {
    logger.error('Missing state or access token in callback');
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing state or access_token'
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

    // Get user info from Supabase using the access token
    const supabase = createClient(config.supabase.url, config.supabase.anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      }
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      logger.error('Failed to get user from Supabase', { error: userError });
      throw new Error('Failed to get user information');
    }

    logger.info('User info obtained', {
      user_id: user.id,
      email: user.email
    });

    // Generate authorization code for MCP client
    const authCode = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + (config.oauth.codeExpirySeconds * 1000);

    // Store auth code with Supabase tokens
    authCodes.set(authCode, {
      accessToken: access_token,
      refreshToken: refresh_token,
      codeChallenge: oauthState.codeChallenge,
      codeChallengeMethod: oauthState.codeChallengeMethod,
      redirectUri: oauthState.redirectUri,
      clientId: oauthState.clientId,
      scope: oauthState.scope,
      expiresAt,
      userId: user.id,
      email: user.email
    });

    logger.info('Authorization code generated', { code: authCode.substring(0, 10) + '...' });

    // Return redirect URL for the client
    const redirectUrl = new URL(oauthState.redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    redirectUrl.searchParams.set('state', oauthState.clientState);

    logger.info('Returning redirect to intermediate page', { redirect_uri: oauthState.redirectUri });

    res.json({
      redirect_url: redirectUrl.toString(),
      user_email: user.email
    });

  } catch (error) {
    logger.error('OAuth callback error', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'server_error',
      error_description: error.message
    });
  }
});

/**
 * GET /oauth/callback
 * Step 2a: Legacy GET handler for backward compatibility
 */
router.get('/oauth/callback', async (req, res) => {
  const { state: encodedState, code: supabaseCode, error: authError } = req.query;

  logger.info('OAuth callback received', {
    has_state: !!encodedState,
    has_code: !!supabaseCode,
    error: authError,
    full_query: req.query,
    full_url: req.url
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

    // Show success page before redirecting to MCP client
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
            color: #10b981;
          }
          .close-message {
            background: #f3f4f6;
            padding: 1rem;
            border-radius: 0.5rem;
            margin-top: 1.5rem;
            font-size: 0.875rem;
            color: #10b981;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="check">✓</div>
          <h1>Authorization Successful!</h1>
          <p>You've successfully signed in as <strong>${sessionData.user.email}</strong></p>
          <div class="close-message">
            Completing authentication...
          </div>
        </div>
        <script>
          // Redirect to MCP client after brief delay (OAuth requires this redirect)
          setTimeout(() => {
            window.location.href = '${redirectUrl.toString()}';
          }, 1500);
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
  let computedChallenge;
  if (codeData.codeChallengeMethod === 'S256') {
    computedChallenge = crypto
      .createHash('sha256')
      .update(code_verifier)
      .digest('base64url');
  } else if (codeData.codeChallengeMethod === 'plain') {
    // For plain method, the verifier should match the challenge directly
    computedChallenge = code_verifier;
  } else {
    logger.error('Unsupported code_challenge_method', { method: codeData.codeChallengeMethod });
    authCodes.delete(code);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Unsupported code_challenge_method'
    });
  }

  if (computedChallenge !== codeData.codeChallenge) {
    logger.error('PKCE verification failed', {
      expected: codeData.codeChallenge,
      computed: computedChallenge,
      method: codeData.codeChallengeMethod
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
    grant_types,
    token_endpoint_auth_method,
    full_body: req.body
  });

  // Validate required fields
  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    logger.error('Registration failed: invalid redirect_uris', { redirect_uris });
    return res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'redirect_uris is required and must be a non-empty array'
    });
  }

  // Validate grant types - allow both authorization_code and refresh_token
  const allowedGrantTypes = ['authorization_code', 'refresh_token'];
  const requestedGrantTypes = grant_types || ['authorization_code'];
  const invalidGrantTypes = requestedGrantTypes.filter(gt => !allowedGrantTypes.includes(gt));

  if (invalidGrantTypes.length > 0) {
    logger.error('Registration failed: invalid grant_types', {
      requested: requestedGrantTypes,
      invalid: invalidGrantTypes,
      allowed: allowedGrantTypes
    });
    return res.status(400).json({
      error: 'invalid_grant_type',
      error_description: `Unsupported grant types: ${invalidGrantTypes.join(', ')}. Supported: ${allowedGrantTypes.join(', ')}`
    });
  }

  // Validate auth method - support both 'none' (PKCE) and 'client_secret_post'
  const allowedAuthMethods = ['none', 'client_secret_post', 'client_secret_basic'];
  const requestedAuthMethod = token_endpoint_auth_method || 'none';

  if (!allowedAuthMethods.includes(requestedAuthMethod)) {
    logger.error('Registration failed: invalid auth method', {
      token_endpoint_auth_method: requestedAuthMethod,
      allowed: allowedAuthMethods
    });
    return res.status(400).json({
      error: 'invalid_client_metadata',
      error_description: `Unsupported token_endpoint_auth_method. Supported: ${allowedAuthMethods.join(', ')}`
    });
  }

  // Generate client ID (in production, you might want to store this in a database)
  const clientId = `mcp_${crypto.randomBytes(16).toString('hex')}`;

  // Build registration response
  const registrationResponse = {
    client_id: clientId,
    client_name: client_name || 'MCP Client',
    redirect_uris,
    grant_types: requestedGrantTypes,
    token_endpoint_auth_method: requestedAuthMethod,
    client_id_issued_at: Math.floor(Date.now() / 1000)
  };

  // Generate client_secret if using client_secret_post or client_secret_basic
  if (requestedAuthMethod === 'client_secret_post' || requestedAuthMethod === 'client_secret_basic') {
    const clientSecret = crypto.randomBytes(32).toString('base64url');
    registrationResponse.client_secret = clientSecret;

    logger.info('Generated client secret for confidential client', {
      client_id: clientId,
      auth_method: requestedAuthMethod
    });
  }

  logger.info('Client registered successfully', {
    client_id: clientId,
    client_name: registrationResponse.client_name
  });

  res.status(201).json(registrationResponse);
});

/**
 * GET /oauth/signup.html
 * Serve signup page with Supabase config injected
 */
router.get('/oauth/signup.html', async (req, res) => {
  const fs = await import('fs/promises');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const signupPath = path.join(__dirname, '../../public/oauth/signup.html');
  
  try {
    const html = await fs.readFile(signupPath, 'utf-8');
    
    // Inject Supabase configuration
    const htmlWithConfig = html.replace(
      "const supabaseUrl = window.SUPABASE_URL || 'YOUR_SUPABASE_URL';",
      `const supabaseUrl = '${config.supabase.url}';`
    ).replace(
      "const supabaseAnonKey = window.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';",
      `const supabaseAnonKey = '${config.supabase.anonKey}';`
    );
    
    res.setHeader('Content-Type', 'text/html');
    res.send(htmlWithConfig);
  } catch (error) {
    logger.error('Failed to serve signup page', { error: error.message });
    res.status(500).send('Internal server error');
  }
});

/**
 * GET /oauth/test-callback
 * Test callback endpoint for manual OAuth testing
 */
router.get('/oauth/test-callback', (req, res) => {
  res.redirect(`/oauth/test.html?${req.url.split('?')[1] || ''}`);
});

/**
 * Setup OAuth routes on Express app
 */
export function setupOAuthRoutes(app) {
  app.use(router);
  logger.info('OAuth routes configured');
}
