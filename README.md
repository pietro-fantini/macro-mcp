# Macro MCP Server

An MCP (Model Context Protocol) server that provides nutritional information for food items using the Nutritionix API. Get calories and macronutrients per 100 grams for any food. Track meals and query meal history with secure, per-user authentication via Supabase OAuth.

## Features

- Get detailed nutritional information for any food item
- Returns data per 100 grams for easy comparison
- Includes calories, protein, fats, carbohydrates, and more
- Uses the Nutritionix natural language API
- **🔐 Secure meal tracking** with OAuth authentication and Row Level Security (RLS)
- **Save meal data** with automatic user association (no user_id spoofing)
- **Query meal history** with predefined safe queries (recent, by date, daily/weekly/monthly totals)

## Prerequisites

- Node.js (v18 or higher recommended)
- Nutritionix API credentials (API Key and API ID)
- Supabase project with Auth enabled (for meal tracking features)
- MCP client with OAuth support (e.g., Claude Desktop, Claude.app)

## Getting API Credentials

### Nutritionix API

1. Sign up for a free account at [Nutritionix Developer Portal](https://developer.nutritionix.com/)
2. Create an application to get your API credentials
3. You'll receive:
   - `x-app-id` (API ID)
   - `x-app-key` (API Key)

### Supabase (Required for meal tracking)

1. Create a free account at [Supabase](https://supabase.com/)
2. Create a new project
3. **Enable Authentication**: Go to Authentication → Providers and enable OAuth providers (Google, GitHub, etc.)
4. Get your credentials from Project Settings > API:
   - Project URL (SUPABASE_URL)
   - Anon/Public key (SUPABASE_ANON_KEY)
5. **Configure Row Level Security**: See [AUTH_SETUP.md](./AUTH_SETUP.md) for detailed setup instructions

> **⚠️ Important**: Do NOT use `SUPABASE_DB_URL` or service role keys. This server uses OAuth with per-request JWT authentication for security.

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
     - `SUPABASE_URL`: Your Supabase project URL (required for meal tracking)
     - `SUPABASE_ANON_KEY`: Your Supabase anon key (required for meal tracking)

> **Note**: `SUPABASE_DB_URL` is no longer needed. We use OAuth with per-request authentication.

5. Your MCP server will be available at: `https://your-project.vercel.app`

### ⚠️ CRITICAL: Disable Vercel Authentication

**Your MCP server will NOT work if Vercel Authentication (Deployment Protection) is enabled.**

MCP clients need to access the OAuth metadata endpoint (`/.well-known/oauth-protected-resource`) without authentication. If Vercel Authentication is blocking it, Claude/Cursor will not prompt users to authenticate.

**Steps to disable:**
1. Go to your Vercel dashboard
2. Navigate to your project → Settings → Deployment Protection
3. **Disable** "Vercel Authentication"
4. Save changes

For more details, see [DISABLE_VERCEL_AUTH.md](./DISABLE_VERCEL_AUTH.md).

**Note:** Your data is still protected by Supabase OAuth + RLS. Vercel Authentication is redundant and breaks the OAuth flow.

## Authentication Setup

**This server requires OAuth authentication for meal tracking features.**

📖 **[Read the complete Authentication Setup Guide](./AUTH_SETUP.md)** for:
- Configuring Supabase OAuth
- Setting up Row Level Security policies
- Configuring your MCP client
- Understanding the authentication flow
- Troubleshooting common issues

**Quick Setup:**
1. Enable RLS on `fact_meal_macros` table (already done via migration)
2. Configure OAuth providers in Supabase Dashboard
3. Add OAuth config to your MCP client (see below)
4. Connect your account in the MCP client

### Configuration for Claude Desktop

After deploying to Vercel, tell your users to add the server to their Claude Desktop configuration file:

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

> **🔐 Authentication**: Claude will automatically detect OAuth is required via the `/.well-known/oauth-protected-resource` endpoint. Users click "Connect" in Claude Desktop to authenticate with your Supabase instance. New users can sign up during the OAuth flow.

## Usage

Once configured in Claude Desktop, you can ask Claude to:

**Get nutritional information:**
- "What are the macros for chicken breast?"
- "Get nutrition information for salmon"
- "How many calories are in avocado per 100g?"

**Track meals (requires authentication):**
- "Save my breakfast: 2 eggs and toast"
- "Record my lunch: grilled chicken salad with 150g chicken and 50g mixed greens"
- "Log my dinner for today"

**Query meal data (requires authentication):**
- "Show me my last 10 meals"
- "What did I eat yesterday?"
- "Show me my daily calorie totals for the past week"
- "Get my breakfast meals from the last 7 days"

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

**Authentication**: Not required

---

### save_meal

Save meal macros to Supabase fact_meal_macros table. Records a meal with its nutritional information and items.

> **🔐 Requires Authentication**: User must be authenticated via OAuth. The `user_id` is automatically derived from the JWT.

**Parameters:**
- `meal` (enum, required): The type of meal being recorded. Options: `breakfast`, `morning_snack`, `lunch`, `afternoon_snack`, `dinner`, `extra`
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

**Security Notes:**
- ✅ `user_id` is derived from JWT (cannot be spoofed)
- ✅ Row Level Security ensures users can only save to their own account
- ✅ Date format is validated with regex

---

### get_meal_data

Query meal data from Supabase fact_meal_macros table. Retrieve meal history with predefined safe queries that respect RLS policies.

> **🔐 Requires Authentication**: User must be authenticated via OAuth. Results are automatically filtered to the authenticated user.

**Parameters:**
- `query_type` (enum, required): Type of query to run. Options:
  - `recent` - Last N meals
  - `by_date` - Meals for a specific day
  - `date_range` - Meals between two dates
  - `by_meal_type` - Filter by meal type (breakfast, lunch, etc.)
  - `daily_totals` - Aggregate calories/macros by day
  - `weekly_totals` - Aggregate by ISO week
  - `monthly_totals` - Aggregate by month
- `limit` (integer, optional): Number of records to return (for "recent" queries). Default: 10
- `date` (string, optional): Date in YYYY-MM-DD format (for "by_date" and as start for "date_range")
- `end_date` (string, optional): End date in YYYY-MM-DD format (for "date_range" queries)
- `meal_type` (enum, optional): Filter by meal type (for "by_meal_type" queries)

**Returns:**
- Query results as JSON array with all matching meal records

**Example queries:**

Get last 10 meals:
```json
{
  "query_type": "recent",
  "limit": 10
}
```

Get meals for a specific day:
```json
{
  "query_type": "by_date",
  "date": "2025-10-26"
}
```

Get daily totals for the past week:
```json
{
  "query_type": "daily_totals",
  "date": "2025-10-20",
  "end_date": "2025-10-26"
}
```

Get all breakfast meals from the last 7 days:
```json
{
  "query_type": "by_meal_type",
  "meal_type": "breakfast",
  "limit": 20
}
```

**Security Notes:**
- ✅ No arbitrary SQL (prevents SQL injection)
- ✅ Predefined query templates only
- ✅ Row Level Security automatically filters by authenticated user
- ✅ Date formats validated with regex

## Project Structure

```
macro-mcp/
├── api/
│   └── mcp/
│       └── index.js          # Vercel serverless function (HTTP transport)
├── package.json
├── vercel.json               # Vercel configuration
├── README.md                 # This file
└── AUTH_SETUP.md             # Detailed authentication setup guide
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

Meal storage uses Supabase with:
- Row Level Security (RLS) for per-user data isolation
- OAuth 2.0 with PKCE for authentication
- JWT-based access control

## Security

This server implements several security best practices:

- ✅ **OAuth 2.0 with PKCE**: Industry-standard authentication
- ✅ **Row Level Security (RLS)**: Database-level data isolation
- ✅ **Per-request JWT validation**: No global admin access
- ✅ **No user_id spoofing**: User identity derived from JWT
- ✅ **No arbitrary SQL**: Predefined query templates only
- ✅ **Input validation**: Regex validation for dates and meal types
- ✅ **Error sanitization**: API errors don't leak sensitive info

For more details, see [AUTH_SETUP.md](./AUTH_SETUP.md).

## Troubleshooting

### "Authentication required" error
Make sure your MCP client is configured with OAuth and you've clicked "Connect" to authenticate.

### "Invalid or expired authentication token"
Your token may have expired. Reconnect via your MCP client to get a fresh token.

### Other issues
Check the [Troubleshooting section in AUTH_SETUP.md](./AUTH_SETUP.md#troubleshooting) for more solutions.

## License

MIT

## Notes

- All nutritional information is returned per 100 grams for standardization
- The API uses natural language processing to understand food queries
- Results are based on the USDA nutrition database and Nutritionix's proprietary data