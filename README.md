# 🥗 Macro MCP Server

A production-ready MCP (Model Context Protocol) server for personal macro tracking with OAuth 2.0 authentication. Built with Express.js, containerized with Docker, and ready for cloud deployment on Railway, AWS, or any container platform.

## ✨ Features

- **📊 Meal Tracking**: Save and query your meal history with full nutritional data
- **🔐 Secure Authentication**: OAuth 2.0 with PKCE flow + Google Sign-In + Email/Password
- **👤 User Isolation**: Row-Level Security ensures each user only sees their own data
- **🎨 Modern UI**: Beautiful sign-in/sign-up experience with tab navigation
- **🐳 Docker Ready**: Fully containerized for consistent deployments
- **☁️ Cloud Portable**: Deploy to Railway, AWS ECS, Google Cloud Run, or any platform
- **📝 Production Logging**: Structured JSON logs with AsyncLocalStorage for request tracing
- **🔄 Multi-Client Support**: Works seamlessly with Claude Desktop, Cursor, and ChatGPT

## 📋 Prerequisites

- **Node.js 20+** for local development
- **Docker** (optional, for containerized deployment)
- **Supabase Account** with Auth enabled ([Get started](https://supabase.com/))
  - Create a project
  - Set up Auth with Google OAuth provider (optional)
  - Enable email/password authentication

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd macro-mcp
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
BASE_URL=http://localhost:3000

# Supabase (from your Supabase project settings → API)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here

# OAuth Secret (generate with: openssl rand -base64 32)
OAUTH_CLIENT_SECRET=your_random_secret_here
```

### 3. Set Up Supabase Database

#### Create the meals table:

```sql
-- Create meals table
CREATE TABLE fact_meal_macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'extra')),
  meal_day DATE NOT NULL,
  calories INTEGER NOT NULL,
  macros JSONB NOT NULL,
  meal_items JSONB NOT NULL
);

-- Create index for faster queries
CREATE INDEX idx_meal_macros_user_day ON fact_meal_macros(user_id, meal_day DESC);

-- Enable Row Level Security
ALTER TABLE fact_meal_macros ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own meals
CREATE POLICY "Users can view own meals"
  ON fact_meal_macros
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can only insert their own meals
CREATE POLICY "Users can insert own meals"
  ON fact_meal_macros
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own meals
CREATE POLICY "Users can update own meals"
  ON fact_meal_macros
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own meals
CREATE POLICY "Users can delete own meals"
  ON fact_meal_macros
  FOR DELETE
  USING (auth.uid() = user_id);
```

#### Configure OAuth Redirect URLs in Supabase:

1. Go to **Authentication** → **URL Configuration**
2. Add these redirect URLs:
   - **Local**: `http://localhost:3000/oauth/supabase-callback.html`
   - **Production**: `https://your-app.railway.app/oauth/supabase-callback.html`

#### Enable Google OAuth (optional):

1. Go to **Authentication** → **Providers** → **Google**
2. Enable Google provider
3. Add your Google OAuth Client ID and Secret
4. Set authorized redirect URI: `https://your-project.supabase.co/auth/v1/callback`

#### Configure Email Auth:

1. Go to **Authentication** → **Providers** → **Email**
2. Ensure "Enable Email provider" is ON
3. Configure email templates as needed
4. Optionally disable "Confirm email" for faster testing

### 4. Run the Server

**Development mode (with hot reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

Server will be available at `http://localhost:3000`

### 5. Test the Server

Check if it's running:
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "macro-mcp",
  "version": "2.0.0",
  "timestamp": "2025-11-05T10:30:00.000Z"
}
```

## 🔌 Connecting to AI Clients

### Claude Desktop

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

For production:
```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://your-app.railway.app/mcp"
    }
  }
}
```

### Cursor

**macOS**: `~/.cursor/mcp.json`  
**Windows**: `%USERPROFILE%\.cursor\mcp.json`

```json
{
  "mcpServers": {
    "user-macro-mcp": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### OAuth Flow

1. Restart your AI client (Claude/Cursor)
2. The client will detect OAuth is required
3. Click "Connect" or authorize when prompted
4. You'll see a modern authentication page with two options:
   - **Sign In**: For existing users (Google or Email)
   - **Sign Up**: For new users (Google or Email)
5. Complete authentication
6. You'll see "Success - Completing authentication..."
7. The window will redirect back to your client
8. Now you can use all tools!

## 🛠️ Available Tools

### `save_meal`

Save a meal to your personal tracking database.

**🔐 Requires Authentication**

**Parameters:**
- `meal` (enum): `breakfast`, `morning_snack`, `lunch`, `afternoon_snack`, `dinner`, `extra`
- `meal_day` (string): Date in YYYY-MM-DD format (e.g., "2025-11-05")
- `calories` (integer): Total calories for the meal
- `macros` (object): Macronutrients as key-value pairs
  - Example: `{"protein": 25.5, "carbs": 30.2, "fat": 10.5}`
- `meal_items` (object): Food items with quantities in grams
  - Example: `{"chicken breast": 150, "rice": 100, "broccoli": 80}`

**Example Usage:**
```
User: "I had 150g chicken breast, 100g rice, and 80g broccoli for lunch"
Claude: [Calculates macros and saves with save_meal tool]
```

### `get_meal_data`

Query your meal history with flexible filtering and aggregation.

**🔐 Requires Authentication**

**Parameters:**
- `query_type` (required, enum):
  - `recent`: Last N meals
  - `by_date`: Meals on a specific day
  - `date_range`: Meals between two dates
  - `by_meal_type`: Filter by meal type (breakfast, lunch, etc.)
  - `daily_totals`: Aggregate calories and macros by day
  - `weekly_totals`: Aggregate by week
  - `monthly_totals`: Aggregate by month
- `limit` (optional, integer): Number of records to return (default: 10, for `recent` and `by_meal_type`)
- `date` (optional, string): Date in YYYY-MM-DD format (for `by_date`, or start date for `date_range`)
- `end_date` (optional, string): End date for `date_range` queries
- `meal_type` (optional, enum): Filter by meal type for `by_meal_type` queries

**Example Usage:**
```
User: "What did I eat yesterday?"
Claude: [Uses get_meal_data with query_type: "by_date"]

User: "Show me my last 5 meals"
Claude: [Uses get_meal_data with query_type: "recent", limit: 5]

User: "What are my daily calorie totals this week?"
Claude: [Uses get_meal_data with query_type: "daily_totals"]

User: "Show all my breakfast meals"
Claude: [Uses get_meal_data with query_type: "by_meal_type", meal_type: "breakfast"]
```

## 🐳 Docker Deployment

### Using Docker Compose (Recommended for Local)

```bash
docker-compose up --build
```

### Manual Docker

```bash
# Build the image
docker build -t macro-mcp .

# Run the container
docker run -p 3000:3000 --env-file .env macro-mcp
```

The Dockerfile uses a multi-stage build with Alpine Linux for a minimal image size (~100MB).

## ☁️ Production Deployment

### Railway (Recommended)

1. **Connect Your Repository:**
   - Go to [Railway](https://railway.app/)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your macro-mcp repository

2. **Set Environment Variables:**
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your_anon_key_here
   OAUTH_CLIENT_SECRET=your_random_secret_here
   NODE_ENV=production
   LOG_LEVEL=info
   ```
   
   **Note:** Railway automatically provides `PORT` - don't set it!

3. **Get Your Deployment URL:**
   - Railway provides a URL like `https://macro-mcp-production.up.railway.app`

4. **Update BASE_URL:**
   - Add to Railway environment variables:
     ```
     BASE_URL=https://macro-mcp-production.up.railway.app
     ```

5. **Update Supabase Redirect URLs:**
   - Go to Supabase Dashboard → Authentication → URL Configuration
   - Add: `https://macro-mcp-production.up.railway.app/oauth/supabase-callback.html`

6. **Deploy:**
   - Railway auto-deploys on push to main
   - Check health: `https://your-app.railway.app/health`

### Other Platforms

#### AWS ECS/Fargate

```bash
# Push to ECR
docker build -t macro-mcp .
docker tag macro-mcp:latest <ecr-repo>:latest
docker push <ecr-repo>:latest

# Create ECS task with environment variables
# Deploy as ECS service
```

#### Google Cloud Run

```bash
gcloud run deploy macro-mcp \
  --image gcr.io/<project-id>/macro-mcp \
  --platform managed \
  --region us-central1 \
  --set-env-vars="NODE_ENV=production,SUPABASE_URL=...,SUPABASE_ANON_KEY=...,OAUTH_CLIENT_SECRET=..."
```

#### Fly.io

```bash
flyctl launch
flyctl secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... OAUTH_CLIENT_SECRET=...
flyctl deploy
```

## 🔐 Security Features

- ✅ **OAuth 2.0 with PKCE**: Industry-standard authentication
- ✅ **Multiple Sign-In Methods**: Google OAuth + Email/Password
- ✅ **Row-Level Security (RLS)**: Database-enforced user isolation
- ✅ **JWT Token Validation**: Every API request is verified
- ✅ **AsyncLocalStorage**: Request-scoped authentication context
- ✅ **HTTPS Required**: Production enforces SSL
- ✅ **Secrets Management**: Environment variables only
- ✅ **Non-root Container**: Docker runs as unprivileged user
- ✅ **Input Validation**: All tool parameters are validated

## 📊 Monitoring & Debugging

### Structured Logging

All logs are JSON-formatted for easy parsing:

```json
{
  "level": "info",
  "timestamp": "2025-11-05T10:30:00.000Z",
  "message": "Request authenticated",
  "user_id": "abc-123-def",
  "path": "/mcp"
}
```

### Log Levels

Set via `LOG_LEVEL` environment variable:
- `error`: Only errors
- `warn`: Warnings and errors
- `info`: General information (recommended for production)
- `debug`: Verbose debugging (use for development only)

### Testing with MCP Inspector

```bash
# Terminal 1: Start your server
npm run dev

# Terminal 2: Launch inspector
npm run inspector
```

Opens at `http://localhost:6274` for visual testing of tools and OAuth flow.

## 🆘 Troubleshooting

### "Authentication required" error

**Cause:** Token expired or not authenticated

**Solution:**
1. In your client, disconnect and reconnect the MCP server
2. Complete the OAuth flow again

### "Database error: permission denied"

**Cause:** RLS policies not set up correctly

**Solution:**
```sql
-- Check existing policies
SELECT * FROM pg_policies WHERE tablename = 'fact_meal_macros';

-- Ensure you have the policies listed in the setup section
```

### OAuth redirect loop / "Missing required OAuth parameters"

**Cause:** Redirect URL mismatch or missing OAuth state

**Solution:**
1. Check Supabase Auth settings match your BASE_URL exactly
2. Ensure `/oauth/supabase-callback.html` is in the redirect URLs list
3. For Cursor/ChatGPT: The server handles missing OAuth params automatically

### Tools not showing up in client

**Cause:** Server not properly connected

**Solution:**
1. Check server is running: `curl http://localhost:3000/health`
2. Verify config file has correct URL
3. Restart your AI client
4. Check client logs for connection errors

### Signup page shows "Configuration error"

**Cause:** Supabase credentials not properly injected

**Solution:**
1. Ensure server is running (not accessing static file directly)
2. Verify SUPABASE_URL and SUPABASE_ANON_KEY are set in `.env`
3. Restart the server after changing environment variables

## 📁 Project Structure

```
macro-mcp/
├── src/
│   ├── index.js              # Express app entry point
│   ├── config/
│   │   └── env.js            # Environment variable validation
│   ├── routes/
│   │   ├── oauth.js          # OAuth 2.0 + PKCE implementation
│   │   └── mcp.js            # MCP protocol handler (uses AsyncLocalStorage)
│   ├── tools/
│   │   └── meals.js          # Meal tracking tools
│   └── utils/
│       └── logger.js         # Structured JSON logging
├── public/
│   └── oauth/
│       ├── signup.html       # Modern auth UI (sign in + sign up)
│       └── supabase-callback.html  # OAuth callback handler
├── Dockerfile                # Multi-stage Alpine build
├── docker-compose.yml        # Local development with Docker
├── railway.json              # Railway platform configuration
├── package.json              # Dependencies and scripts
├── .env.example              # Environment variable template
├── mcp-config.json           # MCP Inspector configuration
└── README.md                 # This file
```

## 🧪 Development

### Adding New Tools

1. Create tool definition in `src/tools/yourTool.js`:
```javascript
export function getYourTools() {
  return [{
    name: 'your_tool_name',
    description: 'What your tool does',
    inputSchema: { /* JSON schema */ },
    requiresAuth: true, // or false
    handler: async (args, authInfo) => {
      // Your logic here
      return {
        content: [{
          type: 'text',
          text: 'Result'
        }]
      };
    }
  }];
}
```

2. Register in `src/routes/mcp.js`:
```javascript
import { getYourTools } from '../tools/yourTool.js';

const yourTools = getYourTools();
const allTools = [...mealTools, ...yourTools];
```

3. Update README documentation

### Running Tests

```bash
# Unit tests (when implemented)
npm test

# Manual testing with MCP Inspector
npm run inspector
```

## 📜 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 💬 Support

- **Issues**: Open an issue on GitHub
- **Documentation**: Check this README and troubleshooting section
- **MCP Specification**: [Model Context Protocol](https://modelcontextprotocol.io)

## 🙏 Acknowledgments

- [Model Context Protocol](https://github.com/modelcontextprotocol) - Protocol specification
- [Supabase](https://supabase.com/) - Authentication and database
- [Express.js](https://expressjs.com/) - Web framework
- [Railway](https://railway.app/) - Deployment platform

---

**Built with ❤️ for the MCP community**
