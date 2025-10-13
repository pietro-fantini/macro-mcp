import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

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

// Build the MCP handler using the same server definition as the Vercel function
const handler = createMcpHandler(
  (server) => {
    server.tool(
      'get_nutrition',
      'Get nutritional information (calories and macronutrients) for a food item per 100 grams. Returns calories, protein, total fat, and carbohydrates.',
      {
        food: z.string().describe('The name of the food item (e.g., "lamb", "chicken breast", "apple")'),
      },
      async ({ food }) => {
        const logMsg = `[TOOL CALL] get_nutrition called with food: ${food}`;
        process.stderr.write(logMsg + '\n');
        try {
          const result = await getNutritionData(food);

          if (result.error) {
            process.stderr.write(`[TOOL RESULT] Error: ${result.message}\n`);
            return {
              content: [
                {
                  type: "text",
                  text: result.message,
                },
              ],
            };
          }

          process.stderr.write(`[TOOL RESULT] Success for ${food}\n`);
          return {
            content: [
              {
                type: "text",
                text: result.data,
              },
            ],
          };
        } catch (error) {
          process.stderr.write(`[TOOL ERROR] ${error.message}\n`);
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
    );

    server.tool(
      'save_meal_macros',
      'Save meal macros to Supabase fact_meal_macros table. Records a meal with its nutritional information and items.',
      {
        user_id: z.string().describe('The ID of the user recording this meal'),
        meal: z.enum(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra'])
          .describe('The type of meal being recorded'),
        meal_day: z.string().describe('The date when the meal was consumed in YYYY-MM-DD format (e.g., "2025-10-13"). This can be different from when the meal is recorded.'),
        calories: z.number().int().describe('Total calories of the meal (integer)'),
        macros: z.record(z.number()).describe('Macronutrients as key-value pairs (e.g., {"protein": 25.5, "carbs": 30.2, "fat": 10.5, "sodium_mg": 150})'),
        meal_items: z.record(z.number()).describe('Meal items with quantities (e.g., {"chicken breast": 150, "rice": 100})'),
      },
      async ({ user_id, meal, meal_day, calories, macros, meal_items }) => {
        process.stderr.write(`[TOOL CALL] save_meal_macros called for user: ${user_id}, meal: ${meal}, meal_day: ${meal_day}\n`);
        try {
          if (!supabase) {
            throw new Error("Supabase is not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.");
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

          process.stderr.write(`[TOOL RESULT] Meal saved with ID: ${id}\n`);
          
          return {
            content: [
              {
                type: "text",
                text: `✅ Meal saved successfully!\n\nMeal ID: ${id}\nUser: ${user_id}\nMeal Type: ${meal}\nMeal Day: ${meal_day}\nCalories: ${calories}\nRecorded at: ${created_at}\n\nMacros: ${JSON.stringify(macros, null, 2)}\nItems: ${JSON.stringify(meal_items, null, 2)}`,
              },
            ],
          };
        } catch (error) {
          process.stderr.write(`[TOOL ERROR] ${error.message}\n`);
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
    );

    server.tool(
      'query_meal_data',
      'Query meal data from Supabase. Execute SQL queries to retrieve meal history, aggregations, or specific records from fact_meal_macros table. Available columns: id, created_at (timestamp when recorded), user_id, meal, meal_day (date when consumed), calories, macros (jsonb), meal_items (jsonb).',
      {
        query: z.string().describe('SQL query to execute (e.g., "SELECT * FROM fact_meal_macros WHERE user_id = \'123\' AND meal_day = \'2025-10-13\' ORDER BY created_at DESC")'),
      },
      async ({ query }) => {
        process.stderr.write(`[TOOL CALL] query_meal_data called with query: ${query.substring(0, 100)}...\n`);
        try {
          if (!pgPool) {
            throw new Error("PostgreSQL connection is not configured. Please set SUPABASE_DB_URL environment variable.");
          }

          // Execute the SQL query using PostgreSQL pool
          const result = await pgPool.query(query);

          process.stderr.write(`[TOOL RESULT] Query executed successfully, returned ${result.rows?.length || 0} rows\n`);
          
          // Format the results nicely
          const resultText = result.rows && result.rows.length > 0
            ? `Query Results (${result.rows.length} rows):\n\n${JSON.stringify(result.rows, null, 2)}`
            : 'Query executed successfully. No results returned.';
          
          return {
            content: [
              {
                type: "text",
                text: resultText,
              },
            ],
          };
        } catch (error) {
          process.stderr.write(`[TOOL ERROR] ${error.message}\n`);
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
    );
  },
  {
    name: "macro-mcp",
    version: "1.0.0",
  },
  {
    // Set explicit endpoints for mcp-use deployment
    streamableHttpEndpoint: "/mcp",
    sseEndpoint: "/sse",
    sseMessageEndpoint: "/message",
    verboseLogs: true,
    // Event callback for detailed MCP event logging
    onEvent: (event) => {
      const timestamp = new Date(event.timestamp).toISOString();
      process.stderr.write(`[MCP EVENT ${timestamp}] ${event.type} - Session: ${event.sessionId}, Request: ${event.requestId}\n`);
    },
  }
);

const PORT = process.env.PORT || 3000;

function nodeHeadersToWebHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  }
  return headers;
}

const server = createServer(async (req, res) => {
  const requestStart = Date.now();
  const method = req.method || 'GET';
  const path = req.url || '/';
  
  process.stderr.write(`[HTTP REQUEST] ${method} ${path}\n`);
  
  try {
    const url = `http://localhost:${PORT}${path}`;
    const headers = nodeHeadersToWebHeaders(req.headers);

    const init = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') {
      // Stream request body to fetch Request
      init.body = Readable.toWeb(req);
      // @ts-ignore - Node fetch requires duplex for streaming request bodies
      init.duplex = 'half';
    }

    const webRequest = new Request(url, init);
    const response = await handler(webRequest);

    // Write status and headers
    const resHeaders = {};
    for (const [k, v] of response.headers.entries()) {
      resHeaders[k] = v;
    }
    res.writeHead(response.status, resHeaders);

    process.stderr.write(`[HTTP RESPONSE] ${response.status} for ${method} ${path}\n`);

    if (response.body) {
      // Stream response body (supports SSE and streaming HTTP)
      const stream = Readable.fromWeb(response.body);
      stream.pipe(res);
      
      stream.on('end', () => {
        const duration = Date.now() - requestStart;
        process.stderr.write(`[HTTP COMPLETE] ${method} ${path} - ${duration}ms\n`);
      });
    } else {
      const text = await response.text();
      res.end(text);
      const duration = Date.now() - requestStart;
      process.stderr.write(`[HTTP COMPLETE] ${method} ${path} - ${duration}ms\n`);
    }
  } catch (err) {
    process.stderr.write(`[HTTP ERROR] ${method} ${path}: ${err}\n`);
    res.statusCode = 500;
    res.end(`Internal Server Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 MCP server running on port ${PORT}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\n📡 HTTP endpoints:`);
  console.log(`  - Streamable HTTP: http://localhost:${PORT}/mcp`);
  console.log(`  - SSE: http://localhost:${PORT}/sse`);
  console.log(`  - SSE message: http://localhost:${PORT}/message`);
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
});


