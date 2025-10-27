/**
 * Nutritionix API integration for nutrition data
 */

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const NUTRITIONIX_API_URL = 'https://trackapi.nutritionix.com/v2/natural/nutrients';

/**
 * Fetch nutrition data from Nutritionix API
 */
async function getNutritionData(food) {
  const query = `${food} 100 grams`;

  logger.debug('Fetching nutrition data', { food, query });

  const response = await fetch(NUTRITIONIX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-app-key': config.nutritionix.apiKey,
      'x-app-id': config.nutritionix.apiId
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Nutritionix API error', {
      status: response.status,
      statusText: response.statusText,
      error: errorText
    });
    throw new Error(`Nutritionix API request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.foods || data.foods.length === 0) {
    logger.warn('No nutrition data found', { food });
    return null;
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
    potassium: foodData.nf_potassium
  };

  logger.info('Nutrition data retrieved', { food_name: nutrition.food_name });

  return nutrition;
}

/**
 * Format nutrition data as readable text
 */
function formatNutritionData(nutrition) {
  return `
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
}

/**
 * Get nutrition tool definition
 */
export function getNutritionTools() {
  return [
    {
      name: 'get_nutrition',
      description: 'Get nutritional information (calories and macronutrients) for a food item per 100 grams. Returns calories, protein, total fat, carbohydrates, fiber, sugars, and more.',
      inputSchema: {
        type: 'object',
        properties: {
          food: {
            type: 'string',
            description: 'The name of the food item (e.g., "lamb", "chicken breast", "apple")'
          }
        },
        required: ['food']
      },
      requiresAuth: false,
      handler: async (args) => {
        try {
          const { food } = args;

          if (!food) {
            throw new Error('Food parameter is required');
          }

          const nutrition = await getNutritionData(food);

          if (!nutrition) {
            return {
              content: [{
                type: 'text',
                text: `No nutritional information found for "${food}". Please try a different food name.`
              }]
            };
          }

          const formattedText = formatNutritionData(nutrition);

          return {
            content: [{
              type: 'text',
              text: formattedText
            }]
          };
        } catch (error) {
          logger.error('get_nutrition error', { error: error.message, stack: error.stack });

          // Sanitize error message
          const errorMessage = error.message.includes('Nutritionix')
            ? 'Error fetching nutritional information. Please try again.'
            : `Error: ${error.message}`;

          return {
            content: [{
              type: 'text',
              text: errorMessage
            }],
            isError: true
          };
        }
      }
    }
  ];
}
