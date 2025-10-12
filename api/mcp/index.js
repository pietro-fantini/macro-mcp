import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler';

const API_URL = "https://trackapi.nutritionix.com/v2/natural/nutrients";
const API_KEY = process.env.NUTRITIONIX_API_KEY;
const API_ID = process.env.NUTRITIONIX_API_ID;

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
