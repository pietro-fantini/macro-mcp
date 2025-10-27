# Macro MCP Server

A production-ready MCP (Model Context Protocol) server for nutritional tracking with OAuth 2.0 authentication. Built with Express.js, containerized with Docker, and ready for cloud deployment.

## 🚀 Features

- **Nutritional Information**: Get detailed macros for any food item using Nutritionix API
- **Meal Tracking**: Save and query meal history with per-user data isolation
- **OAuth 2.0 + PKCE**: Secure authentication flow with Supabase
- **Row-Level Security**: Database-level data isolation per user
- **Docker Ready**: Fully containerized for consistent deployments
- **Cloud Portable**: Deploy to Railway, AWS ECS, Google Cloud Run, or any container platform
- **Production Logging**: Structured JSON logs for easy monitoring

## 📋 Prerequisites

- Node.js 20 or higher
- Docker (for containerized deployment)
- Nutritionix API credentials ([Get here](https://developer.nutritionix.com/))
- Supabase project with Auth enabled ([Get started](https://supabase.com/))

## 🔧 Setup

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd macro-mcp
npm install
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
BASE_URL=http://localhost:3000

# Nutritionix API (from https://developer.nutritionix.com/)
NUTRITIONIX_API_KEY=your_key_here
NUTRITIONIX_API_ID=your_id_here

# Supabase (from your Supabase project settings)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here

# OAuth Secret (generate with: openssl rand -base64 32)
OAUTH_CLIENT_SECRET=your_random_secret_here
```

### 3. Configure Supabase OAuth Redirect URLs

In your Supabase Dashboard:

1. Go to **Authentication** → **URL Configuration**
2. Add these redirect URLs:
   - Local: `http://localhost:3000/oauth/callback`
   - Railway: `https://macro-mcp.railway.app/oauth/callback` (update after deployment)

### 4. Verify Database Setup

Ensure your Supabase database has:

1. Table `fact_meal_macros` with appropriate columns
2. RLS (Row Level Security) policies enabled:
   - Users can only read/write their own rows
   - Policy example: `auth.uid() = user_id`

## 🏃 Running Locally

### Option 1: Node.js (Development)

```bash
npm run dev
```

Server runs at `http://localhost:3000`

### Option 2: Docker Compose (Production-like)

```bash
npm run docker:compose
```

Or manually:

```bash
docker-compose up --build
```

### Option 3: Docker (Manual)

```bash
# Build
docker build -t macro-mcp .

# Run
docker run -p 3000:3000 --env-file .env macro-mcp
```

## 🧪 Testing with MCP Inspector

The MCP Inspector is a visual tool for testing your MCP server:

```bash
# Start your server first
npm run dev

# In another terminal, launch inspector
npm run inspector
```

This opens a web UI at `http://localhost:6274` where you can:
- Test tool calls (`get_nutrition`, `save_meal`, `get_meal_data`)
- Test OAuth authentication flow
- View request/response history
- Debug tool parameters

### Example Test Commands

**Get nutrition info:**
```json
{
  "tool": "get_nutrition",
  "arguments": {
    "food": "chicken breast"
  }
}
```

**Save a meal (requires auth):**
```json
{
  "tool": "save_meal",
  "arguments": {
    "meal": "breakfast",
    "meal_day": "2025-01-27",
    "calories": 350,
    "macros": {
      "protein": 25,
      "carbs": 30,
      "fat": 10
    },
    "meal_items": {
      "eggs": 100,
      "toast": 50
    }
  }
}
```

## 🚂 Deploying to Railway

### Step 1: Create Railway Project

1. Go to [Railway](https://railway.app/)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository

### Step 2: Configure Environment Variables

In Railway dashboard, add these environment variables:

```
NUTRITIONIX_API_KEY=<your_key>
NUTRITIONIX_API_ID=<your_id>
SUPABASE_URL=<your_supabase_url>
SUPABASE_ANON_KEY=<your_anon_key>
OAUTH_CLIENT_SECRET=<your_secret>
NODE_ENV=production
LOG_LEVEL=info
```

**Important:** Railway automatically sets `PORT` - don't override it!

### Step 3: Update BASE_URL

After deployment, Railway gives you a URL like `https://macro-mcp.railway.app`.

1. Update `BASE_URL` in Railway environment variables:
   ```
   BASE_URL=https://macro-mcp.railway.app
   ```
2. Update Supabase OAuth redirect URL:
   - Add `https://macro-mcp.railway.app/oauth/callback` to Supabase Auth settings

### Step 4: Deploy

Railway auto-deploys from your GitHub repo. Every push to `main` triggers a new deployment.

Check deployment status:
- Railway dashboard shows build logs
- Health check: `https://your-app.railway.app/health`

## 🔐 Connecting to Claude Desktop

After deployment, configure Claude Desktop to use your MCP server:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://macro-mcp.railway.app/mcp"
    }
  }
}
```

Replace `macro-mcp.railway.app` with your actual Railway URL.

### OAuth Flow

1. Restart Claude Desktop
2. Claude will detect OAuth is required
3. Click "Connect" in Claude Desktop
4. You'll be redirected to Supabase login
5. Choose "Sign in with Google" or "Email"
6. After login, you'll be redirected back to Claude
7. Now you can use all tools!

## 🛠️ Available Tools

### `get_nutrition`

Get nutritional information for a food item (per 100g).

**No authentication required**

**Parameters:**
- `food` (string): Food item name (e.g., "chicken breast", "apple")

**Example:**
```
User: What are the macros for salmon?
Claude: [Uses get_nutrition tool]
```

### `save_meal`

Save a meal to your personal tracking database.

**Requires authentication**

**Parameters:**
- `meal` (enum): breakfast, morning_snack, lunch, afternoon_snack, dinner, extra
- `meal_day` (string): Date in YYYY-MM-DD format
- `calories` (integer): Total calories
- `macros` (object): Macronutrients (e.g., `{"protein": 25, "carbs": 30, "fat": 10}`)
- `meal_items` (object): Items with quantities (e.g., `{"chicken": 150, "rice": 100}`)

**Example:**
```
User: Save my breakfast: 2 eggs and toast
Claude: [Uses get_nutrition to calculate macros, then save_meal]
```

### `get_meal_data`

Query your meal history.

**Requires authentication**

**Parameters:**
- `query_type` (enum): recent, by_date, date_range, by_meal_type, daily_totals, weekly_totals, monthly_totals
- `limit` (integer, optional): Number of records (default: 10)
- `date` (string, optional): Date in YYYY-MM-DD
- `end_date` (string, optional): End date for ranges
- `meal_type` (string, optional): Filter by meal type

**Examples:**
```
User: Show me my last 10 meals
Claude: [Uses get_meal_data with query_type: "recent"]

User: What did I eat yesterday?
Claude: [Uses get_meal_data with query_type: "by_date", date: "2025-01-26"]

User: Show my daily calorie totals for the past week
Claude: [Uses get_meal_data with query_type: "daily_totals"]
```

## 📊 Monitoring & Logs

### Structured Logging

All logs are output as JSON for easy parsing:

```json
{
  "timestamp": "2025-01-27T10:30:00.000Z",
  "level": "INFO",
  "message": "MCP server started",
  "port": 3000
}
```

### Log Levels

Set via `LOG_LEVEL` environment variable:
- `error`: Only errors
- `warn`: Warnings and errors
- `info`: General info (default)
- `debug`: Verbose debugging

### Railway Logs

View logs in Railway dashboard:
1. Select your project
2. Click "Deployments"
3. View build and runtime logs

## 🔒 Security Features

- ✅ **OAuth 2.0 with PKCE**: Industry-standard auth flow
- ✅ **Row-Level Security**: Database enforces user isolation
- ✅ **JWT Token Validation**: Every request verified
- ✅ **No Admin Access**: Server uses user-scoped tokens only
- ✅ **HTTPS Required**: Production enforces SSL
- ✅ **Secrets Management**: Environment variables only
- ✅ **Non-root Container**: Docker runs as unprivileged user

## 🐳 Docker Details

### Multi-stage Build

The Dockerfile uses a lean Alpine-based image:
- Base image: `node:20-alpine`
- Production dependencies only
- Non-root user for security
- Health checks built-in

### Health Checks

Both Docker and Railway use `/health` endpoint:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "service": "macro-mcp",
  "version": "2.0.0",
  "timestamp": "2025-01-27T10:30:00.000Z"
}
```

## 🌍 Deploying to Other Platforms

This Docker container is **platform-agnostic** and can run anywhere:

### AWS ECS/Fargate

1. Push image to ECR:
   ```bash
   docker build -t macro-mcp .
   docker tag macro-mcp:latest <ecr-repo-url>:latest
   docker push <ecr-repo-url>:latest
   ```

2. Create ECS task definition
3. Set environment variables in task definition
4. Deploy as ECS service

### Google Cloud Run

```bash
gcloud run deploy macro-mcp \
  --image gcr.io/<project-id>/macro-mcp \
  --platform managed \
  --region us-central1 \
  --set-env-vars="NODE_ENV=production,SUPABASE_URL=..."
```

### Azure Container Instances

```bash
az container create \
  --resource-group myResourceGroup \
  --name macro-mcp \
  --image <your-image> \
  --ports 3000 \
  --environment-variables NODE_ENV=production ...
```

## 🆘 Troubleshooting

### "Authentication required" error

**Cause:** User not logged in or token expired

**Fix:**
1. In Claude Desktop, disconnect and reconnect the MCP server
2. Complete OAuth flow again

### "Database error: permission denied"

**Cause:** RLS policy not configured correctly

**Fix:**
1. Go to Supabase SQL Editor
2. Verify RLS policies on `fact_meal_macros`:
   ```sql
   -- Check policies
   SELECT * FROM pg_policies WHERE tablename = 'fact_meal_macros';

   -- Should have policies like:
   -- Users can view own meals: auth.uid() = user_id
   -- Users can insert own meals: auth.uid() = user_id
   ```

### OAuth redirect loop

**Cause:** Redirect URL mismatch

**Fix:**
1. Check Supabase Auth → URL Configuration
2. Ensure exact match: `https://your-app.railway.app/oauth/callback`
3. Update `BASE_URL` in environment variables

### Railway build fails

**Cause:** Missing environment variables or Docker build error

**Fix:**
1. Check Railway build logs
2. Verify all required env vars are set
3. Test Docker build locally: `docker build -t test .`

### MCP Inspector can't connect

**Cause:** Server not running or wrong URL in config

**Fix:**
1. Ensure server is running: `npm run dev`
2. Check `mcp-config.json` has correct URL
3. Verify port 3000 is not blocked

## 📝 Development Notes

### Project Structure

```
macro-mcp/
├── src/
│   ├── index.js              # Express app entry point
│   ├── config/
│   │   └── env.js            # Environment validation
│   ├── routes/
│   │   ├── oauth.js          # OAuth 2.0 endpoints
│   │   └── mcp.js            # MCP protocol handler
│   ├── tools/
│   │   ├── nutrition.js      # Nutritionix integration
│   │   └── meals.js          # Meal tracking tools
│   └── utils/
│       └── logger.js         # Structured logging
├── Dockerfile                # Docker image definition
├── docker-compose.yml        # Local Docker orchestration
├── railway.json              # Railway configuration
├── package.json              # Dependencies
├── .env.example              # Environment template
└── mcp-config.json           # MCP Inspector config
```

### Adding New Tools

1. Create tool definition in `src/tools/`
2. Register tool in `src/routes/mcp.js`
3. Update README with tool documentation

### Updating Dependencies

```bash
npm update
npm audit fix
```

## 📜 License

MIT

## 🙏 Credits

- [MCP Protocol](https://github.com/modelcontextprotocol) - Model Context Protocol
- [Nutritionix API](https://www.nutritionix.com/) - Nutrition data
- [Supabase](https://supabase.com/) - Auth and database
- [Express.js](https://expressjs.com/) - Web framework

---

**Need help?** Open an issue on GitHub or check the troubleshooting section above.
