# Macro MCP Server

An MCP (Model Context Protocol) server built with [mcp-use](https://mcp-use.com) that provides nutritional information for food items using the Nutritionix API. Get calories and macronutrients per 100 grams for any food, and track your meals with Supabase integration.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Test the server (in another terminal)
npm test

# Open inspector in browser
open http://localhost:3000/inspector
```

The inspector provides a web UI to test all tools interactively!

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

### Deploy to mcp-use (Recommended)

This server is built with [mcp-use](https://mcp-use.com), which provides a managed hosting platform for MCP servers with features like authentication, monitoring, and automatic scaling.

1. Sign up at [mcp-use.com](https://mcp-use.com)

2. Deploy your server:
   - Follow the mcp-use deployment guide
   - Set environment variables:
     - `NUTRITIONIX_API_KEY`: Your Nutritionix API key
     - `NUTRITIONIX_API_ID`: Your Nutritionix API ID
     - `SUPABASE_URL`: Your Supabase project URL
     - `SUPABASE_ANON_KEY`: Your Supabase anon key
     - `SUPABASE_DB_URL`: Your Supabase database connection string

3. Your MCP server will be available through the mcp-use platform

### Local Development

Start the server locally:

```bash
npm start
```

The server will start on `http://localhost:3000` with:
- MCP endpoint: `http://localhost:3000/mcp`
- Inspector: `http://localhost:3000/inspector`

### Configuration for Cursor

Add the server to your Cursor MCP configuration file:

**Location**: `~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

For local development:
```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**Steps:**
1. Create the file if it doesn't exist
2. Add the configuration above
3. Start your server: `npm start`
4. Restart Cursor completely
5. Wait for the MCP icon to show tools loaded

**Troubleshooting Cursor:**
- If tools don't load, check server is running: http://localhost:3000/inspector
- Clear Cursor cache and restart
- Check server logs for connection attempts
- Verify configuration file path is correct
- Make sure firewall isn't blocking localhost connections

### Configuration for Claude Desktop

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

For local development:
```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

For mcp-use hosted deployment:
```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://your-server.mcp-use.com/mcp"
    }
  }
}
```

**Important**: Restart Claude Desktop completely after updating the config.

## Usage

Once configured in Claude Desktop or Cursor, you can use the MCP server for various nutrition and meal tracking tasks:

### Nutrition Lookup

**Example prompts:**
- "What are the macros for chicken breast?"
- "Get nutrition information for salmon"
- "How many calories are in avocado per 100g?"

### Meal Tracking

**Example prompts:**
- "Save my breakfast from today: 2 eggs (100g), toast (50g), avocado (40g) - 450 calories with 25g protein, 30g carbs, 28g fat"
- "Record my lunch from yesterday (2025-10-12) for user 'john123'"
- "Log this dinner meal from October 10th with its macros"

**Note:** You can log meals retroactively by specifying the date when the meal was actually consumed, even if you're recording it days later.

### Querying Meal History

**Example prompts:**
- "Show me all my meals from October 13, 2025"
- "What was my total calorie intake on October 12?"
- "Get all my breakfast meals from last week"
- "Show me my daily calorie totals for the last 7 days"
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
- `meal_day` (string, required): The date when the meal was consumed in YYYY-MM-DD format (e.g., "2025-10-13"). This can be different from when the meal is recorded, allowing users to log meals retroactively.
- `calories` (integer, required): Total calories of the meal
- `macros` (object, required): Macronutrients as key-value pairs
  - Example: `{"protein": 25.5, "carbs": 30.2, "fat": 10.5, "fiber": 5.0, "sodium_mg": 150, "cholesterol_mg": 45}`
- `meal_items` (object, required): Meal items with quantities in grams
  - Example: `{"chicken breast": 150, "rice": 100, "broccoli": 80}`

**Returns:**
- Confirmation with meal ID, timestamp, and full meal details

**Example usage:**
```
Save my lunch from yesterday (2025-10-12): 150g chicken breast, 100g rice, 80g broccoli
Total calories: 450
Macros: 45g protein, 50g carbs, 8g fat
```

**Note:** The `meal_day` field allows logging meals retroactively. For example, you can record meals from previous days by specifying the date when they were actually consumed, even if you're entering them later.

### 3. query_meal_data

Query meal data from Supabase. Execute SQL queries to retrieve meal history, aggregations, or specific records.

**Available columns:**
- `id`: UUID - Unique meal identifier
- `created_at`: TIMESTAMP - When the meal was recorded
- `user_id`: TEXT - User identifier
- `meal`: TEXT - Type of meal (breakfast, morning_snack, lunch, afternoon_snack, dinner, extra)
- `meal_day`: DATE - The day when the meal was consumed
- `calories`: INTEGER - Total calories
- `macros`: JSONB - Macronutrient data
- `meal_items`: JSONB - Food items and quantities

**Parameters:**
- `query` (string, required): SQL query to execute against the `fact_meal_macros` table
  - Example: `SELECT * FROM fact_meal_macros WHERE user_id = 'user123' AND meal_day = '2025-10-13'`

**Returns:**
- Query results formatted as JSON

**Example queries:**
- Get meals for a specific day: `SELECT * FROM fact_meal_macros WHERE user_id = 'user123' AND meal_day = '2025-10-13' ORDER BY meal`
- Get last 10 recorded meals: `SELECT * FROM fact_meal_macros WHERE user_id = 'user123' ORDER BY created_at DESC LIMIT 10`
- Total calories for a specific day: `SELECT SUM(calories) FROM fact_meal_macros WHERE user_id = 'user123' AND meal_day = '2025-10-13'`
- Daily calorie totals for the last 7 days: `SELECT meal_day, SUM(calories) as total_calories FROM fact_meal_macros WHERE user_id = 'user123' AND meal_day >= CURRENT_DATE - INTERVAL '7 days' GROUP BY meal_day ORDER BY meal_day DESC`
- Average calories by meal type: `SELECT meal, COUNT(*) as count, AVG(calories) as avg_calories FROM fact_meal_macros WHERE user_id = 'user123' GROUP BY meal`

## Database Schema

The `fact_meal_macros` table in Supabase should have the following structure:

```sql
CREATE TABLE fact_meal_macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  user_id TEXT NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra')),
  meal_day DATE NOT NULL,
  calories INTEGER NOT NULL,
  macros JSONB NOT NULL,
  meal_items JSONB NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX idx_meal_macros_user_id ON fact_meal_macros(user_id);
CREATE INDEX idx_meal_macros_created_at ON fact_meal_macros(created_at DESC);
CREATE INDEX idx_meal_macros_meal ON fact_meal_macros(meal);
CREATE INDEX idx_meal_macros_meal_day ON fact_meal_macros(meal_day DESC);
CREATE INDEX idx_meal_macros_user_meal_day ON fact_meal_macros(user_id, meal_day DESC);
```

**Key fields:**
- `created_at`: Timestamp when the meal record was created (when it was logged in the system)
- `meal_day`: Date when the meal was actually consumed (allows retroactive logging)

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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  user_id TEXT NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra')),
  meal_day DATE NOT NULL,
  calories INTEGER NOT NULL,
  macros JSONB NOT NULL,
  meal_items JSONB NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_meal_macros_user_id ON fact_meal_macros(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_macros_created_at ON fact_meal_macros(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meal_macros_meal ON fact_meal_macros(meal);
CREATE INDEX IF NOT EXISTS idx_meal_macros_meal_day ON fact_meal_macros(meal_day DESC);
CREATE INDEX IF NOT EXISTS idx_meal_macros_user_meal_day ON fact_meal_macros(user_id, meal_day DESC);
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
├── server.js                 # MCP server built with mcp-use
├── package.json              # Dependencies including mcp-use
├── package-lock.json
└── README.md
```

## Technology Stack

- **[mcp-use](https://mcp-use.com)**: MCP server framework with built-in HTTP/SSE support
- **Nutritionix API**: Nutritional data provider
- **Supabase**: Database for meal tracking
- **PostgreSQL**: Direct SQL queries for meal data

## Development

### Running Locally

1. Make sure you have set up the `.env` file with all required credentials

2. Start the server:
```bash
npm start
```

3. The server will start on `http://localhost:3000` (or the port specified in `PORT` environment variable)

4. Test everything is working:
```bash
npm test
```

This will check:
- ✓ Server is running
- ✓ Inspector is accessible
- ✓ MCP protocol works
- ✓ All 3 tools are available
- ✓ Configuration file exists

5. Open the inspector:
   - Inspector UI: `http://localhost:3000/inspector` (for interactive testing)
   - MCP endpoint: `http://localhost:3000/mcp` (for programmatic access)

### Logs

All logs are written to stderr to ensure visibility. You'll see:
- Tool call logs with detailed parameters
- Tool execution results
- Database operation logs
- Error logs with stack traces

mcp-use provides automatic request/response logging and performance metrics.

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
