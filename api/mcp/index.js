import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import crypto from 'crypto';

const API_URL = "https://trackapi.nutritionix.com/v2/natural/nutrients";
const API_KEY = process.env.NUTRITIONIX_API_KEY;
const API_ID = process.env.NUTRITIONIX_API_ID;

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const pgPool = SUPABASE_DB_URL
  ? new pg.Pool({ connectionString: SUPABASE_DB_URL })
  : null;

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

  // Extract key nutritional information
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

  // Format the response
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

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'get_nutrition',
      'Get nutritional information (calories and macronutrients) for a food item per 100 grams. Returns calories, protein, total fat, and carbohydrates.',
      {
        food: z.string().describe('The name of the food item (e.g., "lamb", "chicken breast", "apple")'),
      },
      async ({ food }) => {
        try {
          const result = await getNutritionData(food);

          if (result.error) {
            return {
              content: [
                {
                  type: "text",
                  text: result.message,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: result.data,
              },
            ],
          };
        } catch (error) {
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
      'save_meal',
      'Save meal macros to Supabase fact_meal_macros table. Records a meal with its nutritional information and items.',
      {
        user_id: z.string().describe('The ID of the user recording this meal'),
        meal: z.enum(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra'])
          .describe('The type of meal being recorded'),
        meal_day: z.string().describe('The date of the meal in YYYY-MM-DD format (e.g., "2025-10-21")'),
        calories: z.number().int().describe('Total calories of the meal (integer)'),
        macros: z.record(z.number()).describe('Macronutrients as key-value pairs (e.g., {"protein": 25.5, "carbs": 30.2, "fat": 10.5, "sodium_mg": 150})'),
        meal_items: z.record(z.number()).describe('Meal items with quantities (e.g., {"chicken breast": 150, "rice": 100})'),
      },
      async ({ user_id, meal, meal_day, calories, macros, meal_items }) => {
        process.stderr.write(`[TOOL CALL] save_meal called for user: ${user_id}, meal: ${meal}, day: ${meal_day}\n`);
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
                text: `✅ Meal saved successfully!\n\nMeal ID: ${id}\nUser: ${user_id}\nMeal Type: ${meal}\nMeal Day: ${meal_day}\nCalories: ${calories}\nCreated_at: ${created_at}\n\nMacros: ${JSON.stringify(macros, null, 2)}\nItems: ${JSON.stringify(meal_items, null, 2)}`,
              },
            ],
          };
        } catch (error) {
          process.stderr.write(`[TOOL ERROR] ${error.message}\n`);
          return {
            content: [
              {
                type: "text",
                text: `Error saving meal: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.tool(
      'get_meal_data',
      'Query meal data from Supabase fact_meal_macros table. Execute SQL queries to retrieve meal history, aggregations, or specific records. The query MUST be filtered by user_id.',
      {
        user_id: z.string().describe('The user ID to filter meals by (required for security)'),
        query: z.string().describe('SQL query to execute on fact_meal_macros table (e.g., "SELECT * FROM fact_meal_macros WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10"). Use $1 as placeholder for user_id.'),
      },
      async ({ user_id, query }) => {
        process.stderr.write(`[TOOL CALL] get_meal_data called for user: ${user_id}, query: ${query.substring(0, 100)}...\n`);
        try {
          if (!pgPool) {
            throw new Error("PostgreSQL connection is not configured. Please set SUPABASE_DB_URL environment variable.");
          }

          // Security check: ensure query contains user_id filter
          if (!query.toLowerCase().includes('user_id')) {
            throw new Error("Query must include user_id filter for security reasons.");
          }

          // Execute the SQL query using PostgreSQL pool with user_id as parameter
          const result = await pgPool.query(query, [user_id]);

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
    basePath: "/api",
  }
);

export { handler as GET, handler as POST, handler as DELETE };