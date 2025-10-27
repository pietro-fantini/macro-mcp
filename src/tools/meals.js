/**
 * Meal tracking tools with Supabase integration
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Create user-scoped Supabase client
 */
function createUserSupabaseClient(accessToken) {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

/**
 * Helper to get ISO week number
 */
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

/**
 * Get meal tracking tool definitions
 */
export function getMealTools() {
  return [
    {
      name: 'save_meal',
      description: '🔐 [REQUIRES AUTH] Save meal macros to your personal meal tracking database. Records a meal with its nutritional information and items. You must authenticate to use this tool.',
      inputSchema: {
        type: 'object',
        properties: {
          meal: {
            type: 'string',
            enum: ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra'],
            description: 'The type of meal being recorded'
          },
          meal_day: {
            type: 'string',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            description: 'The date of the meal in YYYY-MM-DD format (e.g., "2025-01-27")'
          },
          calories: {
            type: 'integer',
            description: 'Total calories of the meal (integer)'
          },
          macros: {
            type: 'object',
            description: 'Macronutrients as key-value pairs (e.g., {"protein": 25.5, "carbs": 30.2, "fat": 10.5})',
            additionalProperties: { type: 'number' }
          },
          meal_items: {
            type: 'object',
            description: 'Meal items with quantities in grams (e.g., {"chicken breast": 150, "rice": 100})',
            additionalProperties: { type: 'number' }
          }
        },
        required: ['meal', 'meal_day', 'calories', 'macros', 'meal_items']
      },
      requiresAuth: true,
      handler: async (args, authInfo) => {
        try {
          const { meal, meal_day, calories, macros, meal_items } = args;

          if (!authInfo?.token) {
            throw new Error('Authentication required');
          }

          const userId = authInfo.userId;
          const supabase = createUserSupabaseClient(authInfo.token);

          logger.info('Saving meal', { user_id: userId, meal, meal_day });

          // Generate UUID for meal
          const id = crypto.randomUUID();
          const created_at = new Date().toISOString();

          // Insert meal - RLS ensures user can only insert to their own records
          const { data, error } = await supabase
            .from('fact_meal_macros')
            .insert({
              id,
              created_at,
              user_id: userId,
              meal,
              meal_day,
              calories,
              macros,
              meal_items
            })
            .select()
            .single();

          if (error) {
            logger.error('Supabase insert error', { error: error.message, user_id: userId });
            throw new Error(`Database error: ${error.message}`);
          }

          logger.info('Meal saved successfully', { meal_id: id, user_id: userId });

          return {
            content: [{
              type: 'text',
              text: `✅ Meal saved successfully!

Meal ID: ${id}
Meal Type: ${meal}
Meal Day: ${meal_day}
Calories: ${calories}
Created: ${created_at}

Macros: ${JSON.stringify(macros, null, 2)}
Items: ${JSON.stringify(meal_items, null, 2)}`
            }]
          };
        } catch (error) {
          logger.error('save_meal error', { error: error.message, stack: error.stack });

          return {
            content: [{
              type: 'text',
              text: `Error saving meal: ${error.message}`
            }],
            isError: true
          };
        }
      }
    },
    {
      name: 'get_meal_data',
      description: '🔐 [REQUIRES AUTH] Query your meal history from the database. Retrieve meals with predefined safe queries. You must authenticate to use this tool.',
      inputSchema: {
        type: 'object',
        properties: {
          query_type: {
            type: 'string',
            enum: ['recent', 'by_date', 'date_range', 'by_meal_type', 'daily_totals', 'weekly_totals', 'monthly_totals'],
            description: 'Type of query: "recent" (last N meals), "by_date" (specific day), "date_range" (between dates), "by_meal_type" (filter by meal), "daily_totals" (aggregate by day), "weekly_totals" (aggregate by week), "monthly_totals" (aggregate by month)'
          },
          limit: {
            type: 'integer',
            default: 10,
            description: 'Number of records to return (for "recent" queries). Default: 10'
          },
          date: {
            type: 'string',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            description: 'Date in YYYY-MM-DD format (for "by_date" and as start for "date_range")'
          },
          end_date: {
            type: 'string',
            pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            description: 'End date in YYYY-MM-DD format (for "date_range" queries)'
          },
          meal_type: {
            type: 'string',
            enum: ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra'],
            description: 'Filter by meal type (for "by_meal_type" queries)'
          }
        },
        required: ['query_type']
      },
      requiresAuth: true,
      handler: async (args, authInfo) => {
        try {
          const { query_type, limit = 10, date, end_date, meal_type } = args;

          if (!authInfo?.token) {
            throw new Error('Authentication required');
          }

          const userId = authInfo.userId;
          const supabase = createUserSupabaseClient(authInfo.token);

          logger.info('Querying meal data', { user_id: userId, query_type });

          let query = supabase.from('fact_meal_macros').select('*');
          let resultText = '';

          // Build query based on type - RLS automatically filters by user_id
          switch (query_type) {
            case 'recent': {
              query = query.order('created_at', { ascending: false }).limit(limit);
              const { data, error } = await query;
              if (error) throw new Error(`Database error: ${error.message}`);

              resultText = data?.length > 0
                ? `Recent Meals (${data.length} meals):\n\n${JSON.stringify(data, null, 2)}`
                : 'No meals found.';
              break;
            }

            case 'by_date': {
              if (!date) throw new Error('Date parameter is required for "by_date" query');
              query = query.eq('meal_day', date).order('created_at', { ascending: false });
              const { data, error } = await query;
              if (error) throw new Error(`Database error: ${error.message}`);

              resultText = data?.length > 0
                ? `Meals for ${date} (${data.length} meals):\n\n${JSON.stringify(data, null, 2)}`
                : `No meals found for ${date}.`;
              break;
            }

            case 'date_range': {
              if (!date || !end_date) {
                throw new Error('Both date and end_date parameters are required for "date_range" query');
              }
              query = query.gte('meal_day', date).lte('meal_day', end_date).order('meal_day', { ascending: false });
              const { data, error } = await query;
              if (error) throw new Error(`Database error: ${error.message}`);

              resultText = data?.length > 0
                ? `Meals from ${date} to ${end_date} (${data.length} meals):\n\n${JSON.stringify(data, null, 2)}`
                : `No meals found between ${date} and ${end_date}.`;
              break;
            }

            case 'by_meal_type': {
              if (!meal_type) throw new Error('meal_type parameter is required for "by_meal_type" query');
              query = query.eq('meal', meal_type).order('created_at', { ascending: false }).limit(limit);
              const { data, error } = await query;
              if (error) throw new Error(`Database error: ${error.message}`);

              resultText = data?.length > 0
                ? `${meal_type} meals (${data.length} meals):\n\n${JSON.stringify(data, null, 2)}`
                : `No ${meal_type} meals found.`;
              break;
            }

            case 'daily_totals':
            case 'weekly_totals':
            case 'monthly_totals': {
              const startDate = date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              const endDateVal = end_date || new Date().toISOString().split('T')[0];

              const { data: meals, error } = await supabase
                .from('fact_meal_macros')
                .select('meal_day, calories, macros')
                .gte('meal_day', startDate)
                .lte('meal_day', endDateVal)
                .order('meal_day', { ascending: false });

              if (error) throw new Error(`Database error: ${error.message}`);

              if (query_type === 'daily_totals') {
                // Aggregate by day
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
              } else {
                // Aggregate by week or month
                const periodTotals = {};
                meals.forEach(meal => {
                  const mealDate = new Date(meal.meal_day);
                  let periodKey;

                  if (query_type === 'weekly_totals') {
                    const weekNum = getISOWeek(mealDate);
                    periodKey = `${mealDate.getFullYear()}-W${weekNum}`;
                  } else {
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
              }
              break;
            }

            default:
              throw new Error(`Unknown query type: ${query_type}`);
          }

          logger.info('Query executed successfully', { user_id: userId, query_type });

          return {
            content: [{
              type: 'text',
              text: resultText
            }]
          };
        } catch (error) {
          logger.error('get_meal_data error', { error: error.message, stack: error.stack });

          return {
            content: [{
              type: 'text',
              text: `Error querying meal data: ${error.message}`
            }],
            isError: true
          };
        }
      }
    }
  ];
}
