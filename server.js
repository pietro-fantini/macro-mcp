import { createMCPServer } from 'mcp-use/server';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

const { Pool } = pg;

const API_URL = "https://trackapi.nutritionix.com/v2/natural/nutrients";
const API_KEY = process.env.NUTRITIONIX_API_KEY;
const API_ID = process.env.NUTRITIONIX_API_ID;

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL; // Direct Postgres connection string

// Initialize Supabase client (for inserts using the JS client)
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

// Initialize PostgreSQL pool (for raw SQL queries)
let pgPool = null;
if (SUPABASE_DB_URL) {
  pgPool = new Pool({
    connectionString: SUPABASE_DB_URL,
  });
}

async function getNutritionData(food) {
  if (!API_KEY || !API_ID) {
    throw new Error("NUTRITIONIX_API_KEY and NUTRITIONIX_API_ID environment variables are required");
  }

  const query = `${food} 100 grams`;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-app-key": API_KEY,
      "x-app-id": API_ID,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.foods || data.foods.length === 0) {
    return {
      error: true,
      message: `No nutritional information found for "${food}". Please try a different food name.`
    };
  }

  const foodData = data.foods[0];

  const nutrition = {
    food_name: foodData.food_name,
    serving_size: `${foodData.serving_qty} ${foodData.serving_unit}`,
    calories: foodData.nf_calories,
    protein: foodData.nf_protein,
    total_fat: foodData.nf_total_fat,
    saturated_fat: foodData.nf_saturated_fat,
    carbohydrates: foodData.nf_total_carbohydrate,
    fiber: foodData.nf_dietary_fiber,
    sugars: foodData.nf_sugars,
    cholesterol: foodData.nf_cholesterol,
    sodium: foodData.nf_sodium,
    potassium: foodData.nf_potassium,
  };

  const formattedText = `
Nutritional Information for ${nutrition.food_name} (per 100g):

Calories: ${nutrition.calories} kcal

Macronutrients:
  • Protein: ${nutrition.protein}g
  • Total Fat: ${nutrition.total_fat}g
    - Saturated Fat: ${nutrition.saturated_fat}g
  • Carbohydrates: ${nutrition.carbohydrates}g
    - Fiber: ${nutrition.fiber}g
    - Sugars: ${nutrition.sugars}g

Other:
  • Cholesterol: ${nutrition.cholesterol}mg
  • Sodium: ${nutrition.sodium}mg
  • Potassium: ${nutrition.potassium}mg
`.trim();

  return {
    error: false,
    data: formattedText
  };
}

// OAuth state management (in-memory storage for simplicity)
const oauthClients = new Map(); // clientId -> { clientId, clientSecret, redirectUris }
const authorizationCodes = new Map(); // code -> { clientId, userId, codeChallenge, redirectUri, expiresAt, accessToken }
const pendingAuthorizations = new Map(); // state -> { clientId, redirectUri, codeChallenge, codeChallengeMethod }

// Clean up expired codes periodically
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of authorizationCodes.entries()) {
    if (data.expiresAt < now) {
      authorizationCodes.delete(code);
    }
  }
}, 60000); // Clean up every minute

// Create the MCP server using mcp-use
const server = createMCPServer('macro-mcp', {
  version: '1.0.0',
  description: 'MCP server for nutritional information and meal tracking using Nutritionix API and Supabase',
});

// Simple helper to scope SELECT queries to the authenticated user
function scopeQueryToUser(query, userId) {
  try {
    if (!query || typeof query !== 'string') return query;
    const trimmed = query.trim();
    // Only attempt to scope simple SELECTs that reference our table
    if (!/^select\b/i.test(trimmed)) return query;
    if (!/fact_meal_macros/i.test(trimmed)) return query;
    if (/\buser_id\b/i.test(trimmed)) return query; // already scoped
    return `SELECT * FROM (${trimmed}) AS __q WHERE __q.user_id = '${userId}'`;
  } catch {
    return query;
  }
}

// ============================================================================
// OAuth 2.1 Endpoints (MCP OAuth Support)
// ============================================================================

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const OAUTH_PROVIDER = process.env.OAUTH_PROVIDER || 'google'; // google, github, azure, etc.

// Log BASE_URL to verify it's set correctly in deployed environment
console.error(`[CONFIG] BASE_URL: ${BASE_URL}`);
console.error(`[CONFIG] PORT: ${PORT}`);
console.error(`[CONFIG] OAUTH_PROVIDER: ${OAUTH_PROVIDER}`);

// Warn if BASE_URL looks like localhost but we're in production
if (BASE_URL.includes('localhost') && process.env.NODE_ENV === 'production') {
  console.error(`[WARNING] BASE_URL is set to localhost but NODE_ENV is production!`);
  console.error(`[WARNING] OAuth callbacks will fail. Set BASE_URL to your production URL.`);
}

// OAuth Discovery Endpoint
// https://spec.modelcontextprotocol.io/specification/draft/basic/authorization/
server.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    registration_endpoint: `${BASE_URL}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], // Public client with PKCE
  });
});

// Dynamic Client Registration Endpoint
// https://datatracker.ietf.org/doc/html/rfc7591
server.post('/oauth/register', (req, res) => {
  try {
    const { client_name, redirect_uris } = req.body;

    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uris required' });
    }

    const clientId = crypto.randomUUID();
    const registration = {
      clientId,
      clientSecret: null, // Public client
      redirectUris: redirect_uris,
      clientName: client_name || 'MCP Client',
      createdAt: Date.now(),
    };

    oauthClients.set(clientId, registration);

    res.json({
      client_id: clientId,
      client_name: registration.clientName,
      redirect_uris: registration.redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  } catch (error) {
    console.error('[OAuth Register Error]', error);
    res.status(500).json({ error: 'server_error', error_description: 'Registration failed' });
  }
});

// Authorization Endpoint - Redirects to Supabase Auth
server.get('/oauth/authorize', async (req, res) => {
  try {
    const {
      client_id,
      redirect_uri,
      response_type,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query;

    // Validate parameters
    if (response_type !== 'code') {
      return res.status(400).send('Only authorization code flow is supported');
    }

    if (!client_id || !redirect_uri) {
      return res.status(400).send('Missing required parameters');
    }

    if (!code_challenge || code_challenge_method !== 'S256') {
      return res.status(400).send('PKCE with S256 is required');
    }

    // Verify client and redirect URI
    const client = oauthClients.get(client_id);
    if (!client) {
      return res.status(400).send('Invalid client_id');
    }

    if (!client.redirectUris.includes(redirect_uri)) {
      return res.status(400).send('Invalid redirect_uri');
    }

    // Store authorization request state (keyed by MCP state for retrieval after callback)
    const internalState = crypto.randomUUID();
    pendingAuthorizations.set(internalState, {
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      mcpState: state, // Store MCP client's state to return later
      createdAt: Date.now(),
    });

    // Redirect to Supabase Auth with our callback
    // Note: We pass our internal state in the redirect_to URL, not as a state param
    // Supabase manages its own state parameter for CSRF protection
    const supabaseAuthUrl = `${SUPABASE_URL}/auth/v1/authorize`;
    const callbackUrl = `${BASE_URL}/oauth/callback?state=${internalState}`;
    
    const params = new URLSearchParams({
      provider: OAUTH_PROVIDER,
      redirect_to: callbackUrl,
    });

    const finalUrl = `${supabaseAuthUrl}?${params.toString()}`;
    console.log('[OAuth Authorize] Redirecting to Supabase:', finalUrl);
    console.log('[OAuth Authorize] Callback URL:', callbackUrl);

    res.redirect(finalUrl);
  } catch (error) {
    console.error('[OAuth Authorize Error]', error);
    res.status(500).send('Authorization failed');
  }
});

// OAuth Callback - Receives Supabase auth result
server.get('/oauth/callback', async (req, res) => {
  try {
    console.log('[OAuth Callback] Received callback with query params:', req.query);
    const { code: supabaseCode, state: internalState, error: authError, error_description } = req.query;

    if (authError) {
      console.error('[OAuth Callback Error]', authError, error_description);
      return res.status(400).send(`Authentication failed: ${authError} - ${error_description || ''}`);
    }

    if (!supabaseCode) {
      return res.status(400).send('Missing authorization code from Supabase');
    }

    if (!internalState) {
      return res.status(400).send('Missing state parameter');
    }

    // Retrieve the pending authorization using our internal state
    const pending = pendingAuthorizations.get(internalState);
    if (!pending) {
      return res.status(400).send('Invalid or expired authorization request');
    }

    pendingAuthorizations.delete(internalState);

    // Exchange Supabase code for session
    const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(supabaseCode);
    
    if (sessionError || !sessionData?.session) {
      console.error('[OAuth Callback Error]', sessionError);
      return res.status(500).send('Failed to exchange code for session');
    }

    const { access_token, user } = sessionData.session;

    // Generate authorization code for MCP client
    const authorizationCode = crypto.randomUUID();
    authorizationCodes.set(authorizationCode, {
      clientId: pending.clientId,
      userId: user.id,
      codeChallenge: pending.codeChallenge,
      redirectUri: pending.redirectUri,
      accessToken: access_token, // Store Supabase access token
      expiresAt: Date.now() + 60000, // 1 minute expiry
    });

    // Redirect back to MCP client with authorization code
    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set('code', authorizationCode);
    if (pending.mcpState) {
      redirectUrl.searchParams.set('state', pending.mcpState);
    }

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('[OAuth Callback Error]', error);
    res.status(500).send('Callback processing failed');
  }
});

// Token Endpoint - Exchanges authorization code for access token
server.post('/oauth/token', async (req, res) => {
  try {
    const {
      grant_type,
      code,
      redirect_uri,
      client_id,
      code_verifier,
    } = req.body;

    if (grant_type !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }

    if (!code || !redirect_uri || !client_id || !code_verifier) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });
    }

    // Retrieve authorization code
    const authCode = authorizationCodes.get(code);
    if (!authCode) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired code' });
    }

    // Verify code hasn't expired
    if (authCode.expiresAt < Date.now()) {
      authorizationCodes.delete(code);
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired' });
    }

    // Verify client and redirect URI
    if (authCode.clientId !== client_id || authCode.redirectUri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Client or redirect URI mismatch' });
    }

    // Verify PKCE challenge
    const hash = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (hash !== authCode.codeChallenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }

    // Code is valid, delete it (single use)
    authorizationCodes.delete(code);

    // Return the Supabase access token
    res.json({
      access_token: authCode.accessToken,
      token_type: 'Bearer',
      expires_in: 3600, // Supabase default
    });
  } catch (error) {
    console.error('[OAuth Token Error]', error);
    res.status(500).json({ error: 'server_error', error_description: 'Token exchange failed' });
  }
});

// ============================================================================
// End OAuth Endpoints
// ============================================================================

// Supabase OAuth middleware: verifies Bearer token and injects user_id into tool calls
server.use(async (req, res, next) => {
  try {
    // Allow OAuth endpoints and discovery to pass through without auth
    if (req.path && (
      req.path.startsWith('/oauth') || 
      req.path.startsWith('/.well-known')
    )) {
      return next();
    }

    // Only enforce auth for MCP endpoints
    if (!req.path || !req.path.startsWith('/mcp')) return next();

    // Allow preflight
    if (req.method === 'OPTIONS') return next();

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured on server' });
    }

    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });
    }

    const accessToken = authHeader.slice(7).trim();
    if (!accessToken) {
      return res.status(401).json({ error: 'Invalid Authorization header' });
    }

    // Verify token with Supabase Auth and extract the user
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const userId = data.user.id;
    // Attach auth info for downstream handlers (also visible to MCP transport)
    req.auth = { token: accessToken, user: data.user, userId };

    // For POST /mcp, mutate JSON-RPC call arguments to inject user_id and scope queries
    if (req.method === 'POST' && req.is('application/json') && req.body) {
      const injectAuthIntoMessage = (message) => {
        try {
          if (!message || typeof message !== 'object') return;
          if (message.method !== 'tools/call') return;
          const params = message.params || {};
          const toolName = params.name;
          if (!toolName) return;
          params.arguments = params.arguments || {};

          if (toolName === 'save_meal_macros') {
            if (!params.arguments.user_id) {
              params.arguments.user_id = userId;
            }
          }

          if (toolName === 'query_meal_data') {
            const q = params.arguments.query;
            if (typeof q === 'string') {
              params.arguments.query = scopeQueryToUser(q, userId);
            }
          }

          message.params = params;
        } catch {
          // no-op on injection errors; MCP handler will proceed
        }
      };

      if (Array.isArray(req.body)) {
        req.body.forEach(injectAuthIntoMessage);
      } else {
        injectAuthIntoMessage(req.body);
      }
    }

    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Authentication failure' });
  }
});

// Tool 1: get_nutrition
server.tool({
  name: 'get_nutrition',
  description: 'Get nutritional information (calories and macronutrients) for a food item per 100 grams. Returns calories, protein, total fat, and carbohydrates.',
  inputs: [
    {
      name: 'food',
      type: 'string',
      description: 'The name of the food item (e.g., "lamb", "chicken breast", "apple")',
      required: true
    }
  ],
  cb: async ({ food }) => {
    const logMsg = `[TOOL CALL] get_nutrition called with food: ${food}`;
    console.error(logMsg);
    
    try {
      const result = await getNutritionData(food);

      if (result.error) {
        console.error(`[TOOL RESULT] Error: ${result.message}`);
        return {
          content: [
            {
              type: "text",
              text: result.message,
            },
          ],
          isError: true,
        };
      }

      console.error(`[TOOL RESULT] Success for ${food}`);
      return {
        content: [
          {
            type: "text",
            text: result.data,
          },
        ],
      };
    } catch (error) {
      console.error(`[TOOL ERROR] ${error.message}`);
      return {
        content: [
          {
            type: "text",
            text: `Error fetching nutritional information: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
});

// Tool 2: save_meal_macros
server.tool({
  name: 'save_meal_macros',
  description: 'Save meal macros to Supabase fact_meal_macros table. Records a meal with its nutritional information and items.',
  inputs: [
    {
      name: 'meal',
      type: 'string',
      description: 'The type of meal being recorded: breakfast, morning_snack, lunch, afternoon_snack, dinner, or extra',
      required: true
    },
    {
      name: 'meal_day',
      type: 'string',
      description: 'The date when the meal was consumed in YYYY-MM-DD format (e.g., "2025-10-13")',
      required: true
    },
    {
      name: 'calories',
      type: 'number',
      description: 'Total calories of the meal (integer)',
      required: true
    },
    {
      name: 'macros',
      type: 'object',
      description: 'Macronutrients as key-value pairs (e.g., {"protein": 25.5, "carbs": 30.2, "fat": 10.5})',
      required: true
    },
    {
      name: 'meal_items',
      type: 'object',
      description: 'Meal items with quantities (e.g., {"chicken breast": 150, "rice": 100})',
      required: true
    }
  ],
  cb: async ({ user_id, meal, meal_day, calories, macros, meal_items }) => {
    console.error(`[TOOL CALL] save_meal_macros called for user: ${user_id}, meal: ${meal}, meal_day: ${meal_day}`);
    
    try {
      if (!supabase) {
        throw new Error("Supabase is not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.");
      }

      if (!user_id) {
        throw new Error('Not authenticated: missing user context');
      }

      // Validate meal type
      const validMealTypes = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra'];
      if (!validMealTypes.includes(meal)) {
        throw new Error(`Invalid meal type. Must be one of: ${validMealTypes.join(', ')}`);
      }

      // Generate UUID for the meal ID
      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();

      // Insert into Supabase
      const { data, error } = await supabase
        .from('fact_meal_macros')
        .insert({
          id,
          created_at,
          user_id,
          meal,
          meal_day,
          calories,
          macros,
          meal_items
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      console.error(`[TOOL RESULT] Meal saved with ID: ${id}`);
      
      return {
        content: [
          {
            type: "text",
            text: `✅ Meal saved successfully!

Meal ID: ${id}
User: ${user_id}
Meal Type: ${meal}
Meal Day: ${meal_day}
Calories: ${calories}
Recorded at: ${created_at}

Macros: ${JSON.stringify(macros, null, 2)}
Items: ${JSON.stringify(meal_items, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      console.error(`[TOOL ERROR] ${error.message}`);
      return {
        content: [
          {
            type: "text",
            text: `Error saving meal macros: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
});

// Tool 3: query_meal_data
server.tool({
  name: 'query_meal_data',
  description: 'Query meal data from Supabase. Execute SQL queries to retrieve meal history, aggregations, or specific records from fact_meal_macros table.',
  inputs: [
    {
      name: 'query',
      type: 'string',
      description: 'SQL query to execute (e.g., "SELECT * FROM fact_meal_macros WHERE user_id = \'123\' ORDER BY created_at DESC")',
      required: true
    }
  ],
  cb: async ({ query }) => {
    console.error(`[TOOL CALL] query_meal_data called with query: ${query.substring(0, 100)}...`);
    
    try {
      if (!pgPool) {
        throw new Error("PostgreSQL connection is not configured. Please set SUPABASE_DB_URL environment variable.");
      }

      // Execute the SQL query using PostgreSQL pool
      const result = await pgPool.query(query);

      console.error(`[TOOL RESULT] Query executed successfully, returned ${result.rows?.length || 0} rows`);
      
      // Format the results nicely
      let resultText;
      if (result.rows && result.rows.length > 0) {
        resultText = `Query Results (${result.rows.length} rows):

${JSON.stringify(result.rows, null, 2)}`;
      } else {
        resultText = 'Query executed successfully. No results returned.';
      }
      
      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error) {
      console.error(`[TOOL ERROR] ${error.message}`);
      return {
        content: [
          {
            type: "text",
            text: `Error executing query: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
});

// Start the server
server.listen(PORT);

console.log(`\n${'='.repeat(60)}`);
console.log(`🚀 MCP server running on port ${PORT}`);
console.log(`${'='.repeat(60)}`);
console.log(`\n📡 Endpoints:`);
console.log(`  - MCP endpoint: ${BASE_URL}/mcp`);
console.log(`  - Inspector: ${BASE_URL}/inspector`);
console.log(`  - OAuth Discovery: ${BASE_URL}/.well-known/oauth-authorization-server`);
console.log(`  - OAuth Authorize: ${BASE_URL}/oauth/authorize`);
console.log(`  - OAuth Token: ${BASE_URL}/oauth/token`);
console.log(`  - OAuth Register: ${BASE_URL}/oauth/register`);
console.log(`\n🔑 Environment:`);
console.log(`  - NUTRITIONIX_API_ID: ${API_ID ? '✓ Set' : '✗ Missing'}`);
console.log(`  - NUTRITIONIX_API_KEY: ${API_KEY ? '✓ Set' : '✗ Missing'}`);
console.log(`  - SUPABASE_URL: ${SUPABASE_URL ? '✓ Set' : '✗ Missing'}`);
console.log(`  - SUPABASE_ANON_KEY: ${SUPABASE_KEY ? '✓ Set' : '✗ Missing'}`);
console.log(`  - SUPABASE_DB_URL: ${SUPABASE_DB_URL ? '✓ Set' : '✗ Missing'}`);
console.log(`  - OAUTH_PROVIDER: ${OAUTH_PROVIDER}`);
console.log(`\n🛠️  Available tools:`);
console.log(`  1. get_nutrition: Get nutritional info for food items (per 100g)`);
console.log(`  2. save_meal_macros: Save meal data to Supabase fact_meal_macros table`);
console.log(`  3. query_meal_data: Query meal data from Supabase with raw SQL`);
console.log(`\n📊 Database Integration:`);
console.log(`  - Supabase Client: ${supabase ? '✓ Connected' : '✗ Not configured'} (for inserts)`);
console.log(`  - PostgreSQL Pool: ${pgPool ? '✓ Connected' : '✗ Not configured'} (for queries)`);
console.log(`  - Table: fact_meal_macros`);
console.log(`  - Features: Save meals, query history, track macros`);
console.log(`\n🔐 OAuth 2.1 Authentication:`);
console.log(`  - Status: ✓ Enabled`);
console.log(`  - Flow: Authorization Code with PKCE`);
console.log(`  - Provider: Supabase Auth → ${OAUTH_PROVIDER.toUpperCase()}`);
console.log(`  - Client Registration: Dynamic (no pre-configuration needed)`);
console.log(`\n💡 Setup Instructions:`);
console.log(`  1. Enable '${OAUTH_PROVIDER}' provider in Supabase Dashboard (Authentication → Providers)`);
console.log(`  2. Configure OAuth credentials for ${OAUTH_PROVIDER} provider`);
console.log(`  3. IMPORTANT: Add redirect URL in Supabase (Authentication → URL Configuration):`);
console.log(`     Redirect URLs: ${BASE_URL}/oauth/callback`);
console.log(`  4. In Claude, add MCP server URL: ${BASE_URL}`);
console.log(`  5. Leave OAuth Client ID/Secret empty (uses dynamic registration)`);
console.log(`\n${'='.repeat(60)}\n`);
