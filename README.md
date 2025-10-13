# Macro MCP Server

An MCP (Model Context Protocol) server that provides nutritional information for food items using the Nutritionix API. Get calories and macronutrients per 100 grams for any food.

## Features

- Get detailed nutritional information for any food item
- Returns data per 100 grams for easy comparison
- Includes calories, protein, fats, carbohydrates, and more
- Uses the Nutritionix natural language API
- **Save meal macros to Supabase** - Track your meals with complete macro and item data
- **Query meal history** - Retrieve and analyze your meal data from Supabase

## Prerequisites

- Node.js (v18 or higher recommended)
- Nutritionix API credentials (API Key and API ID)
- Supabase project (for meal tracking features)
  - Supabase URL and anon key (for saving meals)
  - Supabase database connection string (for querying meals)

## Getting API Credentials

1. Sign up for a free account at [Nutritionix Developer Portal](https://developer.nutritionix.com/)
2. Create an application to get your API credentials
3. You'll receive:
   - `x-app-id` (API ID)
   - `x-app-key` (API Key)

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

3. Set up environment variables:

Create a `.env` file in the project root:
```bash
# Nutritionix API credentials
NUTRITIONIX_API_ID=your_api_id_here
NUTRITIONIX_API_KEY=your_api_key_here

# Supabase credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@db.your-project.supabase.co:5432/postgres
```

**Getting Supabase credentials:**
- `SUPABASE_URL` and `SUPABASE_ANON_KEY`: Found in your Supabase project settings under "API"
- `SUPABASE_DB_URL`: Found in your Supabase project settings under "Database" → "Connection string" → "URI" (select "Session pooler" or "Transaction pooler")

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

Once configured in Claude Desktop or Cursor, you can use the MCP server for various nutrition and meal tracking tasks:

### Nutrition Lookup

**Example prompts:**
- "What are the macros for chicken breast?"
- "Get nutrition information for salmon"
- "How many calories are in avocado per 100g?"

### Meal Tracking

**Example prompts:**
- "Save my breakfast: 2 eggs (100g), toast (50g), avocado (40g) - 450 calories with 25g protein, 30g carbs, 28g fat"
- "Record my lunch for user 'john123'"
- "Log this dinner meal with its macros"

### Querying Meal History

**Example prompts:**
- "Show me my last 10 meals"
- "What was my total calorie intake today?"
- "Get all my breakfast meals from this week"
- "Calculate average calories per meal type"

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

### 1. get_nutrition

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

### 2. save_meal_macros

Save meal macros to Supabase `fact_meal_macros` table. Records a complete meal with nutritional information and items.

**Parameters:**
- `user_id` (string, required): The ID of the user recording this meal
- `meal` (enum, required): Type of meal - one of: `breakfast`, `morning_snack`, `lunch`, `afternoon_snack`, `dinner`, `extra`
- `calories` (integer, required): Total calories of the meal
- `macros` (object, required): Macronutrients as key-value pairs
  - Example: `{"protein": 25.5, "carbs": 30.2, "fat": 10.5, "fiber": 5.0, "sodium_mg": 150, "cholesterol_mg": 45}`
- `meal_items` (object, required): Meal items with quantities in grams
  - Example: `{"chicken breast": 150, "rice": 100, "broccoli": 80}`

**Returns:**
- Confirmation with meal ID, timestamp, and full meal details

**Example usage:**
```
Save my lunch: 150g chicken breast, 100g rice, 80g broccoli
Total calories: 450
Macros: 45g protein, 50g carbs, 8g fat
```

### 3. query_meal_data

Query meal data from Supabase. Execute SQL queries to retrieve meal history, aggregations, or specific records.

**Parameters:**
- `query` (string, required): SQL query to execute against the `fact_meal_macros` table
  - Example: `SELECT * FROM fact_meal_macros WHERE user_id = 'user123' ORDER BY created DESC LIMIT 10`

**Returns:**
- Query results or instructions to use the Supabase MCP server

**Example queries:**
- Get last 10 meals: `SELECT * FROM fact_meal_macros WHERE user_id = 'user123' ORDER BY created DESC LIMIT 10`
- Total calories today: `SELECT SUM(calories) FROM fact_meal_macros WHERE user_id = 'user123' AND DATE(created) = CURRENT_DATE`
- Meals by type: `SELECT meal, COUNT(*), AVG(calories) FROM fact_meal_macros WHERE user_id = 'user123' GROUP BY meal`

## Database Schema

The `fact_meal_macros` table in Supabase should have the following structure:

```sql
CREATE TABLE fact_meal_macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  user_id TEXT NOT NULL,
  meal TEXT CHECK (meal IN ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra')),
  calories INTEGER NOT NULL,
  macros JSONB NOT NULL,
  meal_items JSONB NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX idx_meal_macros_user_id ON fact_meal_macros(user_id);
CREATE INDEX idx_meal_macros_created ON fact_meal_macros(created DESC);
CREATE INDEX idx_meal_macros_meal ON fact_meal_macros(meal);
```

### JSONB Field Examples

**macros field:**
```json
{
  "protein": 45.5,
  "carbs": 50.2,
  "fat": 10.5,
  "fiber": 5.0,
  "sodium_mg": 150,
  "potassium_mg": 400,
  "cholesterol_mg": 45
}
```

**meal_items field:**
```json
{
  "chicken breast": 150,
  "brown rice": 100,
  "broccoli": 80,
  "olive oil": 10
}
```

## Supabase Integration Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com)

2. **Create the table** in the SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS fact_meal_macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  user_id TEXT NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra')),
  calories INTEGER NOT NULL,
  macros JSONB NOT NULL,
  meal_items JSONB NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_meal_macros_user_id ON fact_meal_macros(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_macros_created ON fact_meal_macros(created DESC);
CREATE INDEX IF NOT EXISTS idx_meal_macros_meal ON fact_meal_macros(meal);
CREATE INDEX IF NOT EXISTS idx_meal_macros_user_created ON fact_meal_macros(user_id, created DESC);
```

3. **Get your Supabase credentials** from the project settings:
   - Navigate to Settings → API
   - Copy the `URL` and `anon/public` key
   - Navigate to Settings → Database
   - Copy the connection string (use Session or Transaction pooler)

4. **Set environment variables** as shown in the Installation section above

5. **Test the connection** by running the server and using the tools

## Project Structure

```
macro-mcp/
├── server.js                 # Main MCP server with HTTP/SSE support
├── package.json
├── package-lock.json
└── README.md
```

## Development

### Running Locally

1. Make sure you have set up the `.env` file with all required credentials

2. Start the server:
```bash
npm start
```

3. The server will start on `http://localhost:3000` (or the port specified in `PORT` environment variable)

4. You can test the MCP endpoints:
   - Streamable HTTP: `http://localhost:3000/mcp`
   - SSE: `http://localhost:3000/sse`
   - SSE message: `http://localhost:3000/message`

### Logs

All logs are written to stderr to ensure visibility. You'll see:
- HTTP request/response logs
- Tool call logs
- MCP event logs
- Error logs

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
