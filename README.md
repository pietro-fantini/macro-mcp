# Macro MCP Server

An MCP (Model Context Protocol) server that provides nutritional information for food items using the Nutritionix API. Get calories and macronutrients per 100 grams for any food.

## Features

- Get detailed nutritional information for any food item
- Returns data per 100 grams for easy comparison
- Includes calories, protein, fats, carbohydrates, and more
- Uses the Nutritionix natural language API
- Save meal data with macros to Supabase
- Query and retrieve meal history from Supabase with custom SQL

## Prerequisites

- Node.js (v18 or higher recommended)
- Nutritionix API credentials (API Key and API ID)
- Supabase project (for meal tracking and user management features)

## Getting API Credentials

### Nutritionix API

1. Sign up for a free account at [Nutritionix Developer Portal](https://developer.nutritionix.com/)
2. Create an application to get your API credentials
3. You'll receive:
   - `x-app-id` (API ID)
   - `x-app-key` (API Key)

### Supabase (Optional - Required for meal tracking)

1. Create a free account at [Supabase](https://supabase.com/)
2. Create a new project
3. Get your credentials from Project Settings > API:
   - Project URL (SUPABASE_URL)
   - Anon/Public key (SUPABASE_ANON_KEY)
4. Get your database connection string from Project Settings > Database:
   - Connection string in "URI" format (SUPABASE_DB_URL)

## Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd macro-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables (see Configuration section below)

## Deployment

### Deploy to Vercel (Recommended)

1. Fork or clone this repository

2. Install the Vercel CLI:
```bash
npm install -g vercel
```

3. Deploy to Vercel:
```bash
vercel
```

4. Set environment variables in your Vercel project:
   - Go to your project settings on Vercel dashboard
   - Navigate to "Environment Variables"
   - Add:
     - `NUTRITIONIX_API_KEY`: Your Nutritionix API key
     - `NUTRITIONIX_API_ID`: Your Nutritionix API ID
     - `SUPABASE_URL`: Your Supabase project URL (optional, for meal tracking)
     - `SUPABASE_ANON_KEY`: Your Supabase anon key (optional, for meal tracking)
     - `SUPABASE_DB_URL`: Your Supabase database connection string (optional, for meal tracking)

5. Your MCP server will be available at: `https://your-project.vercel.app`

### Configuration for Claude Desktop

After deploying to Vercel, add the server to your Claude Desktop configuration file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://your-project.vercel.app/api/mcp"
    }
  }
}
```

Replace `your-project.vercel.app` with your actual Vercel deployment URL.

## Usage

Once configured in Claude Desktop, you can ask Claude to:

**Get nutritional information:**
- "What are the macros for chicken breast?"
- "Get nutrition information for salmon"
- "How many calories are in avocado per 100g?"

**Track meals (requires Supabase setup):**
- "Save my breakfast: 2 eggs and toast"
- "Record my lunch: grilled chicken salad with 150g chicken and 50g mixed greens"
- "Log my dinner for today"

**Query meal data (requires Supabase setup):**
- "Show me my last 10 meals"
- "What did I eat yesterday?"
- "Get my total calories by meal type this week"

### Example Output

```
Nutritional Information for lamb (per 100g):

Calories: 294 kcal

Macronutrients:
  " Protein: 24.52g
  " Total Fat: 20.94g
    - Saturated Fat: 8.83g
  " Carbohydrates: 0g
    - Fiber: 0g
    - Sugars: 0g

Other:
  " Cholesterol: 97mg
  " Sodium: 72mg
  " Potassium: 310mg
```

## Available Tools

### get_nutrition

Gets nutritional information for a food item per 100 grams.

**Parameters:**
- `food` (string, required): The name of the food item (e.g., "lamb", "chicken breast", "apple")

**Returns:**
- Calories
- Protein
- Total Fat & Saturated Fat
- Carbohydrates, Fiber, & Sugars
- Cholesterol
- Sodium & Potassium

### save_meal

Save meal macros to Supabase fact_meal_macros table. Records a meal with its nutritional information and items.

**Parameters:**
- `user_id` (string, required): The ID of the user recording this meal
- `meal` (enum, required): The type of meal being recorded. Options: 'breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra'
- `meal_day` (string, required): The date of the meal in YYYY-MM-DD format (e.g., "2025-10-21")
- `calories` (integer, required): Total calories of the meal
- `macros` (object, required): Macronutrients as key-value pairs (e.g., `{"protein": 25.5, "carbs": 30.2, "fat": 10.5, "sodium_mg": 150}`)
- `meal_items` (object, required): Meal items with quantities in grams (e.g., `{"chicken breast": 150, "rice": 100}`)

**Returns:**
- Confirmation message with meal ID and details

**Example:**
```
User: Save my breakfast: 2 eggs and 1 slice of whole wheat bread
Assistant: [Uses save_meal with calculated macros]
```

### get_meal_data

Query meal data from Supabase fact_meal_macros table. Execute SQL queries to retrieve meal history, aggregations, or specific records filtered by user_id.

**Parameters:**
- `user_id` (string, required): The user ID to filter meals by (required for security)
- `query` (string, required): SQL query to execute on fact_meal_macros table. Use `$1` as placeholder for user_id.

**Returns:**
- Query results as JSON array with all matching meal records

**Example queries:**
- Get last 10 meals: `"SELECT * FROM fact_meal_macros WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10"`
- Get meals for a specific day: `"SELECT * FROM fact_meal_macros WHERE user_id = $1 AND meal_day = '2025-10-21'"`
- Get total calories by meal type: `"SELECT meal, SUM(calories) as total_calories FROM fact_meal_macros WHERE user_id = $1 GROUP BY meal"`

**Example usage:**
```
User: Show me my last 5 meals
Assistant: [Uses get_meal_data with appropriate SQL query]
```

## Project Structure

```
macro-mcp/
├── api/
│   └── mcp/
│       └── index.js          # Vercel serverless function (HTTP transport)
├── package.json
├── vercel.json               # Vercel configuration
└── README.md
```

## Development

### Testing Locally with Vercel Dev

```bash
vercel dev
```

This will start a local development server at `http://localhost:3000`

You can test the MCP endpoint at: `http://localhost:3000/api/mcp`

## API Information

This server uses the Nutritionix Natural Language API:
- Endpoint: `https://trackapi.nutritionix.com/v2/natural/nutrients`
- Documentation: [Nutritionix API Docs](https://developer.nutritionix.com/docs/)

## License

MIT

## Notes

- All nutritional information is returned per 100 grams for standardization
- The API uses natural language processing to understand food queries
- Results are based on the USDA nutrition database and Nutritionix's proprietary data