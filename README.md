# Macro MCP Server

An MCP (Model Context Protocol) server that provides nutritional information for food items using the Nutritionix API. Get calories and macronutrients per 100 grams for any food.

## Features

- Get detailed nutritional information for any food item
- Returns data per 100 grams for easy comparison
- Includes calories, protein, fats, carbohydrates, and more
- Uses the Nutritionix natural language API

## Prerequisites

- Node.js (v18 or higher recommended)
- Nutritionix API credentials (API Key and API ID)

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

Once configured in Claude Desktop, you can ask Claude to get nutritional information:

**Example prompts:**
- "What are the macros for chicken breast?"
- "Get nutrition information for salmon"
- "How many calories are in avocado per 100g?"

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
