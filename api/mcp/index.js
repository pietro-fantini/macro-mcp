import { z } from 'zod';
import { createMcpHandler, experimental_withMcpAuth } from 'mcp-handler';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const API_URL = "https://trackapi.nutritionix.com/v2/natural/nutrients";
const API_KEY = process.env.NUTRITIONIX_API_KEY;
const API_ID = process.env.NUTRITIONIX_API_ID;

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

/**
 * Creates a per-request Supabase client with the user's JWT.
 * This ensures RLS policies are enforced and queries run as the authenticated user.
 * 
 * @param {string} accessToken - The user's Supabase access token from Authorization header
 * @returns {Object} - Supabase client scoped to the user
 */
function createUserSupabaseClient(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.");
  }
  
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

/**
 * Verifies a Supabase JWT token.
 * @param {Request} req - The incoming request
 * @param {string} bearerToken - The bearer token from Authorization header
 * @returns {Promise<Object|undefined>} - Auth info if valid, undefined otherwise
 */
async function verifySupabaseToken(req, bearerToken) {
  if (!bearerToken) {
    return undefined;
  }

  try {
    // Create a temporary Supabase client with the token to verify it
    const supabase = createUserSupabaseClient(bearerToken);
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      return undefined;
    }

    return {
      token: bearerToken,
      clientId: user.id,
      scopes: ['read:meals', 'write:meals'],
      extra: {
        userId: user.id,
        email: user.email,
      }
    };
  } catch (error) {
    // Token verification failed
    return undefined;
  }
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
      async ({ food }, context) => {
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
          // Log the full error to Vercel logs for debugging
          process.stderr.write(`[TOOL ERROR] get_nutrition failed: ${error.message}\n`);
          process.stderr.write(`[TOOL ERROR] Stack: ${error.stack}\n`);
          
          // Redact API errors for security (but log them above)
          const errorMessage = error.message.includes('API') || error.message.includes('NUTRITIONIX')
            ? 'Error fetching nutritional information. Please try again.' 
            : `Error: ${error.message}`;
          
          return {
            content: [
              {
                type: "text",
                text: errorMessage,
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.tool(
      'save_meal',
      '🔐 [REQUIRES AUTH] Save meal macros to Supabase fact_meal_macros table. Records a meal with its nutritional information and items. You must authenticate with Supabase before using this tool.',
      {
        meal: z.enum(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra'])
          .describe('The type of meal being recorded'),
        meal_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date of the meal in YYYY-MM-DD format (e.g., "2025-10-21")'),
        calories: z.number().int().describe('Total calories of the meal (integer)'),
        macros: z.record(z.number()).describe('Macronutrients as key-value pairs (e.g., {"protein": 25.5, "carbs": 30.2, "fat": 10.5, "sodium_mg": 150})'),
        meal_items: z.record(z.number()).describe('Meal items with quantities (e.g., {"chicken breast": 150, "rice": 100})'),
      },
      async ({ meal, meal_day, calories, macros, meal_items }, extra) => {
        try {
          // Check if user is authenticated
          if (!extra?.authInfo?.token) {
            throw new Error(
              "Authentication required. Please connect your Supabase account to save meals."
            );
          }
          
          // Extract user ID from auth info
          const user_id = extra.authInfo.extra.userId;
          const accessToken = extra.authInfo.token;
          
          // Create user-scoped Supabase client
          const supabase = createUserSupabaseClient(accessToken);
          
          process.stderr.write(`[TOOL CALL] save_meal called for user: ${user_id}, meal: ${meal}, day: ${meal_day}\n`);

          // Generate UUID for the meal ID
          const id = crypto.randomUUID();
          const created_at = new Date().toISOString();

          // Insert into Supabase - RLS will automatically enforce user_id = auth.uid()
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
            throw new Error(`Database error: ${error.message}`);
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
      '🔐 [REQUIRES AUTH] Query meal data from Supabase fact_meal_macros table. Retrieve meal history with predefined safe queries that respect RLS policies. You must authenticate with Supabase before using this tool.',
      {
        query_type: z.enum(['recent', 'by_date', 'date_range', 'by_meal_type', 'daily_totals', 'weekly_totals', 'monthly_totals'])
          .describe('Type of query: "recent" (last N meals), "by_date" (specific day), "date_range" (between dates), "by_meal_type" (filter by meal), "daily_totals" (aggregate by day), "weekly_totals" (aggregate by week), "monthly_totals" (aggregate by month)'),
        limit: z.number().int().optional().default(10).describe('Number of records to return (for "recent" queries). Default: 10'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date in YYYY-MM-DD format (for "by_date" and as start for "date_range")'),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('End date in YYYY-MM-DD format (for "date_range" queries)'),
        meal_type: z.enum(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra']).optional()
          .describe('Filter by meal type (for "by_meal_type" queries)'),
      },
      async ({ query_type, limit, date, end_date, meal_type }, extra) => {
        try {
          // Check if user is authenticated
          if (!extra?.authInfo?.token) {
            throw new Error(
              "Authentication required. Please connect your Supabase account to query meals."
            );
          }
          
          // Extract user ID from auth info
          const user_id = extra.authInfo.extra.userId;
          const accessToken = extra.authInfo.token;
          
          // Create user-scoped Supabase client
          const supabase = createUserSupabaseClient(accessToken);
          
          process.stderr.write(`[TOOL CALL] get_meal_data called for user: ${user_id}, query_type: ${query_type}\n`);

          let query = supabase.from('fact_meal_macros').select('*');
          let resultText = '';
          
          // Build query based on type - RLS automatically filters by user_id
          switch (query_type) {
            case 'recent':
              query = query.order('created_at', { ascending: false }).limit(limit || 10);
              break;
              
            case 'by_date':
              if (!date) {
                throw new Error('Date parameter is required for "by_date" query');
              }
              query = query.eq('meal_day', date).order('created_at', { ascending: false });
              break;
              
            case 'date_range':
              if (!date || !end_date) {
                throw new Error('Both date and end_date parameters are required for "date_range" query');
              }
              query = query.gte('meal_day', date).lte('meal_day', end_date).order('meal_day', { ascending: false });
              break;
              
            case 'by_meal_type':
              if (!meal_type) {
                throw new Error('meal_type parameter is required for "by_meal_type" query');
              }
              query = query.eq('meal', meal_type).order('created_at', { ascending: false }).limit(limit || 10);
              break;
              
            case 'daily_totals':
              // Use raw SQL for aggregations through RPC or execute_sql
              const startDate = date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              const endDateVal = end_date || new Date().toISOString().split('T')[0];
              
              const { data: dailyData, error: dailyError } = await supabase.rpc('get_daily_totals', {
                p_user_id: user_id,
                p_start_date: startDate,
                p_end_date: endDateVal
              });
              
              if (dailyError) {
                // Fallback to manual aggregation if RPC doesn't exist
                const { data: meals, error: mealsError } = await supabase
                  .from('fact_meal_macros')
                  .select('meal_day, calories, macros')
                  .gte('meal_day', startDate)
                  .lte('meal_day', endDateVal)
                  .order('meal_day', { ascending: false });
                
                if (mealsError) throw mealsError;
                
                // Aggregate manually
                const dailyTotals = {};
                meals.forEach(meal => {
                  if (!dailyTotals[meal.meal_day]) {
                    dailyTotals[meal.meal_day] = { 
                      meal_day: meal.meal_day, 
                      total_calories: 0, 
                      total_protein: 0, 
                      total_carbs: 0, 
                      total_fat: 0,
                      meal_count: 0
                    };
                  }
                  dailyTotals[meal.meal_day].total_calories += meal.calories || 0;
                  dailyTotals[meal.meal_day].total_protein += meal.macros?.protein || 0;
                  dailyTotals[meal.meal_day].total_carbs += meal.macros?.carbs || 0;
                  dailyTotals[meal.meal_day].total_fat += meal.macros?.fat || 0;
                  dailyTotals[meal.meal_day].meal_count += 1;
                });
                
                resultText = `Daily Totals (${Object.keys(dailyTotals).length} days):\n\n${JSON.stringify(Object.values(dailyTotals), null, 2)}`;
                return {
                  content: [{ type: "text", text: resultText }],
                };
              }
              
              resultText = `Daily Totals (${dailyData?.length || 0} days):\n\n${JSON.stringify(dailyData, null, 2)}`;
              return {
                content: [{ type: "text", text: resultText }],
              };
              
            case 'weekly_totals':
            case 'monthly_totals':
              // Similar aggregation logic
              const periodStartDate = date || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              const periodEndDate = end_date || new Date().toISOString().split('T')[0];
              
              const { data: periodMeals, error: periodError } = await supabase
                .from('fact_meal_macros')
                .select('meal_day, calories, macros')
                .gte('meal_day', periodStartDate)
                .lte('meal_day', periodEndDate)
                .order('meal_day', { ascending: false });
              
              if (periodError) throw periodError;
              
              // Aggregate by week or month
              const periodTotals = {};
              periodMeals.forEach(meal => {
                const mealDate = new Date(meal.meal_day);
                let periodKey;
                
                if (query_type === 'weekly_totals') {
                  // Get ISO week
                  const weekNum = getISOWeek(mealDate);
                  periodKey = `${mealDate.getFullYear()}-W${weekNum}`;
                } else {
                  // Get month
                  periodKey = `${mealDate.getFullYear()}-${String(mealDate.getMonth() + 1).padStart(2, '0')}`;
                }
                
                if (!periodTotals[periodKey]) {
                  periodTotals[periodKey] = { 
                    period: periodKey, 
                    total_calories: 0, 
                    total_protein: 0, 
                    total_carbs: 0, 
                    total_fat: 0,
                    meal_count: 0,
                    days_count: new Set()
                  };
                }
                periodTotals[periodKey].total_calories += meal.calories || 0;
                periodTotals[periodKey].total_protein += meal.macros?.protein || 0;
                periodTotals[periodKey].total_carbs += meal.macros?.carbs || 0;
                periodTotals[periodKey].total_fat += meal.macros?.fat || 0;
                periodTotals[periodKey].meal_count += 1;
                periodTotals[periodKey].days_count.add(meal.meal_day);
              });
              
              // Convert Set to count
              Object.values(periodTotals).forEach(period => {
                period.days_count = period.days_count.size;
                period.avg_calories_per_day = Math.round(period.total_calories / period.days_count);
              });
              
              resultText = `${query_type === 'weekly_totals' ? 'Weekly' : 'Monthly'} Totals (${Object.keys(periodTotals).length} periods):\n\n${JSON.stringify(Object.values(periodTotals), null, 2)}`;
              return {
                content: [{ type: "text", text: resultText }],
              };
          }

          // Execute the query for non-aggregate types
          const { data, error } = await query;

          if (error) {
            throw new Error(`Database error: ${error.message}`);
          }

          process.stderr.write(`[TOOL RESULT] Query executed successfully, returned ${data?.length || 0} rows\n`);
          
          resultText = data && data.length > 0
            ? `Query Results (${data.length} ${query_type === 'recent' ? 'meals' : 'records'}):\n\n${JSON.stringify(data, null, 2)}`
            : 'Query executed successfully. No results found.';
          
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
                text: `Error querying meal data: ${error.message}`,
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

// Helper function to get ISO week number
function getISOWeek(date) {
  const target = new Date(date.valueOf());
  const dayNum = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNum + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target) / 604800000);
}

// Wrap the handler with authentication
const authHandler = experimental_withMcpAuth(handler, verifySupabaseToken, {
  required: true, // Require authentication - this makes Cursor show "Connect" button
  authorizationServers: SUPABASE_URL ? [SUPABASE_URL] : [], // Tell MCP clients to use Supabase for OAuth
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };