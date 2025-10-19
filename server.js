import { createMCPServer } from 'mcp-use/server';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import dotenv from 'dotenv';
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

// Supabase OAuth middleware: verifies Bearer token and injects user_id into tool calls
server.use(async (req, res, next) => {
  try {
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

const PORT = process.env.PORT || 3000;

// Start the server
server.listen(PORT);

console.log(`\n${'='.repeat(60)}`);
console.log(`🚀 MCP server running on port ${PORT}`);
console.log(`${'='.repeat(60)}`);
console.log(`\n📡 Endpoints:`);
console.log(`  - MCP endpoint: http://localhost:${PORT}/mcp`);
console.log(`  - Inspector: http://localhost:${PORT}/inspector`);
console.log(`\n🔑 Environment:`);
console.log(`  - NUTRITIONIX_API_ID: ${API_ID ? '✓ Set' : '✗ Missing'}`);
console.log(`  - NUTRITIONIX_API_KEY: ${API_KEY ? '✓ Set' : '✗ Missing'}`);
console.log(`  - SUPABASE_URL: ${SUPABASE_URL ? '✓ Set' : '✗ Missing'}`);
console.log(`  - SUPABASE_ANON_KEY: ${SUPABASE_KEY ? '✓ Set' : '✗ Missing'}`);
console.log(`  - SUPABASE_DB_URL: ${SUPABASE_DB_URL ? '✓ Set' : '✗ Missing'}`);
console.log(`\n🛠️  Available tools:`);
console.log(`  1. get_nutrition: Get nutritional info for food items (per 100g)`);
console.log(`  2. save_meal_macros: Save meal data to Supabase fact_meal_macros table`);
console.log(`  3. query_meal_data: Query meal data from Supabase with raw SQL`);
console.log(`\n📊 Database Integration:`);
console.log(`  - Supabase Client: ${supabase ? '✓ Connected' : '✗ Not configured'} (for inserts)`);
console.log(`  - PostgreSQL Pool: ${pgPool ? '✓ Connected' : '✗ Not configured'} (for queries)`);
console.log(`  - Table: fact_meal_macros`);
console.log(`  - Features: Save meals, query history, track macros`);
console.log(`\n${'='.repeat(60)}\n`);
