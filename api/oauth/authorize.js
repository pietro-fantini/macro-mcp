/**
 * OAuth Authorization Endpoint
 * 
 * This endpoint starts the OAuth flow. When Claude requests authorization,
 * we redirect to Supabase for authentication, then redirect back to Claude.
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// In-memory storage for OAuth state and code (in production, use Redis)
const stateStore = new Map();
const codeStore = new Map();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    client_id, 
    redirect_uri, 
    response_type, 
    state, 
    scope,
    code_challenge,
    code_challenge_method 
  } = req.query;

  // Validate OAuth parameters
  if (!redirect_uri || !response_type || !state) {
    return res.status(400).json({ 
      error: 'invalid_request',
      error_description: 'Missing required OAuth parameters' 
    });
  }

  if (response_type !== 'code') {
    return res.status(400).json({ 
      error: 'unsupported_response_type',
      error_description: 'Only "code" response type is supported' 
    });
  }

  console.log('[OAuth Authorize] Starting flow:', { 
    redirect_uri, 
    state: state.substring(0, 10) + '...',
    code_challenge: code_challenge ? 'present' : 'absent'
  });

  // Store the OAuth request parameters for later
  const authState = crypto.randomBytes(32).toString('hex');
  stateStore.set(authState, {
    clientState: state,
    redirectUri: redirect_uri,
    clientId: client_id,
    scope,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method,
    timestamp: Date.now()
  });

  // Redirect to Supabase for authentication
  const supabaseAuthUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  supabaseAuthUrl.searchParams.set('provider', 'google');
  supabaseAuthUrl.searchParams.set('redirect_to', 
    `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/oauth/callback?state=${authState}`
  );

  console.log('[OAuth Authorize] Redirecting to Supabase:', supabaseAuthUrl.toString().substring(0, 100) + '...');

  res.redirect(302, supabaseAuthUrl.toString());
}

