# Authentication Setup Guide

## Overview

This MCP server uses **Supabase OAuth with PKCE** for authentication. The server expects a Supabase access token (JWT) to be sent with each request, ensuring per-user security through Row Level Security (RLS) policies.

## Architecture

- **Client-side OAuth**: The MCP client (e.g., Claude Desktop) handles the OAuth flow and obtains a Supabase access token
- **Per-request authentication**: Each tool call must include `Authorization: Bearer <supabase_access_token>` header
- **RLS enforcement**: All database queries run with the user's JWT, ensuring users can only access their own data
- **No server-side secrets**: The serverless function never handles OAuth secrets or exchanges

## Prerequisites

1. **Supabase Project** with Auth enabled
2. **MCP Client** that supports OAuth (e.g., Claude Desktop, Claude.app)
3. **Environment Variables** configured (see below)

---

## Step 1: Configure Supabase Auth

### 1.1 Enable OAuth Providers

In your Supabase Dashboard:

1. Go to **Authentication** → **Providers**
2. Enable the OAuth providers you want (Google, GitHub, etc.)
3. Configure redirect URIs:
   - **Important**: The redirect URI will be determined by the MCP client
   - For Claude Desktop, it typically uses: `claude://oauth-callback` or similar
   - You may need to add wildcard redirects or discover the exact URI after first connection attempt
   - Check Claude Desktop logs or Supabase Auth logs to see the actual redirect URI being requested

### 1.2 Configure Site URL and Redirect URLs

In Supabase Dashboard → Authentication → URL Configuration:

1. Set **Site URL** to your MCP server URL: `https://your-project.vercel.app`
2. Add **Redirect URLs**:
   - Add Claude's OAuth callback (will be discovered during first auth attempt)
   - Pattern is typically: `claude://oauth-callback` or `http://localhost:*` for desktop clients

### 1.2 Verify RLS Policies

The following RLS policies should already be applied via migration:

```sql
-- fact_meal_macros table
ALTER TABLE fact_meal_macros ENABLE ROW LEVEL SECURITY;

-- Users can only view their own meals
CREATE POLICY "Users can view own meals"
ON fact_meal_macros FOR SELECT
USING (auth.uid() = user_id);

-- Users can only insert their own meals
CREATE POLICY "Users can insert own meals"
ON fact_meal_macros FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can only update their own meals
CREATE POLICY "Users can update own meals"
ON fact_meal_macros FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own meals
CREATE POLICY "Users can delete own meals"
ON fact_meal_macros FOR DELETE
USING (auth.uid() = user_id);
```

To verify:
```sql
SELECT tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'fact_meal_macros';
```

---

## Step 2: Environment Variables

### Required Variables

Set these in your Vercel project settings (or `.env` for local development):

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Nutritionix API (for get_nutrition tool)
NUTRITIONIX_API_KEY=your-nutritionix-api-key
NUTRITIONIX_API_ID=your-nutritionix-app-id
```

### Variables No Longer Needed

⚠️ **Remove these** (no longer used after OAuth implementation):

```bash
# SUPABASE_DB_URL - Removed (bypassed RLS)
# SUPABASE_SERVICE_ROLE_KEY - Not needed (using anon key + JWT)
```

---

## Step 3: MCP Client Configuration

### For End Users (Claude Desktop)

Your users simply add your MCP server URL to their Claude Desktop configuration:

**File location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Configuration:**
```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://your-vercel-deployment.vercel.app/api/mcp"
    }
  }
}
```

That's it! Claude will automatically:
1. Discover OAuth is required via the `/.well-known/oauth-protected-resource` endpoint
2. Prompt the user to authenticate
3. Open the browser to your Supabase OAuth login
4. Handle the OAuth flow and token management

### Authentication Flow

1. User adds MCP server URL to Claude Desktop config
2. Claude Desktop fetches OAuth metadata from `/.well-known/oauth-protected-resource`
3. Claude detects authentication is required
4. User clicks "Connect" in Claude
5. Browser opens to Supabase OAuth login page (your Supabase project)
6. User authenticates via OAuth provider (Google, GitHub, etc.) **OR** signs up if new user
7. Supabase redirects back to Claude with authorization code
8. Claude exchanges code for access token (JWT)
9. On each tool call, Claude sends `Authorization: Bearer <access_token>` header
10. Your MCP server validates JWT with Supabase and creates per-request client
11. Queries run as the authenticated user with RLS enforcement

---

## Step 4: API Changes & Security

### What Changed

#### ✅ **Removed**
- Raw SQL queries via PostgreSQL connection
- `user_id` parameter from tool inputs (prevents spoofing)
- Global Supabase client (per-request clients ensure RLS)

#### ✅ **Added**
- JWT extraction and validation from `Authorization` header
- Per-request Supabase client with user's token
- Predefined, safe query types for `get_meal_data`
- Comprehensive error messages for auth issues

### Tool Changes

#### `save_meal`
**Before:**
```javascript
{
  user_id: "uuid-here",  // ❌ Client-provided, could be spoofed
  meal: "breakfast",
  // ...
}
```

**After:**
```javascript
{
  // ✅ No user_id - derived from JWT automatically
  meal: "breakfast",
  meal_day: "2025-10-26",  // ✅ Now validated with regex
  // ...
}
```

#### `get_meal_data`
**Before:**
```javascript
{
  user_id: "uuid-here",  // ❌ Client-provided
  query: "SELECT * FROM fact_meal_macros WHERE user_id = $1"  // ❌ Arbitrary SQL
}
```

**After:**
```javascript
{
  // ✅ No user_id - derived from JWT
  query_type: "recent",  // ✅ Predefined safe queries
  limit: 10,
  // OR
  query_type: "by_date",
  date: "2025-10-26",
  // OR
  query_type: "daily_totals",
  date: "2025-10-01",
  end_date: "2025-10-26"
}
```

**Supported query types:**
- `recent` - Last N meals
- `by_date` - Meals for a specific day
- `date_range` - Meals between two dates
- `by_meal_type` - Filter by meal type (breakfast, lunch, etc.)
- `daily_totals` - Aggregate calories/macros by day
- `weekly_totals` - Aggregate by ISO week
- `monthly_totals` - Aggregate by month

---

## Step 5: Testing

### Test Authentication

1. **Connect via MCP Client**:
   - Open Claude Desktop
   - Navigate to MCP servers
   - Click "Connect" on macro-mcp
   - Complete OAuth flow

2. **Verify Token Flow**:
   ```bash
   # Check Vercel logs to see authentication
   vercel logs
   ```
   
   You should see:
   ```
   [TOOL CALL] save_meal called for user: <actual-user-id>, meal: breakfast, day: 2025-10-26
   ```

3. **Test Without Auth** (should fail):
   ```bash
   curl https://your-deployment.vercel.app/api \
     -H "Content-Type: application/json" \
     -d '{"method":"tools/call","params":{"name":"get_meal_data","arguments":{}}}'
   ```
   
   Expected error:
   ```json
   {
     "error": "Authentication required. Please connect your Supabase account. The MCP client must send 'Authorization: Bearer <supabase_access_token>' on each request."
   }
   ```

4. **Test With Auth**:
   ```bash
   curl https://your-deployment.vercel.app/api \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <your-supabase-access-token>" \
     -d '{"method":"tools/call","params":{"name":"get_meal_data","arguments":{"query_type":"recent","limit":5}}}'
   ```

---

## Step 6: Security Checklist

- [x] RLS enabled on `fact_meal_macros`
- [x] RLS policies created for SELECT, INSERT, UPDATE, DELETE
- [x] `user_id` removed from tool inputs
- [x] JWT validation on every request
- [x] Per-request Supabase client with user token
- [x] No arbitrary SQL queries
- [x] Predefined, safe query templates
- [x] PostgreSQL direct connection removed
- [x] Date format validation (YYYY-MM-DD)
- [x] Error messages don't leak sensitive info

---

## Troubleshooting

### "Authentication required" error

**Cause**: No `Authorization` header sent with request

**Fix**: Ensure your MCP client is configured to send the Supabase access token on each request. Check your client's OAuth configuration.

### "Invalid or expired authentication token"

**Cause**: JWT is malformed, expired, or from wrong Supabase project

**Fix**:
1. Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` match your project
2. Reconnect via MCP client to get a fresh token
3. Check token expiration (Supabase JWTs expire after 1 hour by default)

### "Database error: new row violates row-level security policy"

**Cause**: Trying to insert data for a different user than the authenticated user

**Fix**: This should be impossible with the new implementation. If you see this, there's a bug in the JWT extraction logic.

### "Query must include user_id filter"

**Cause**: You're trying to use the old `get_meal_data` tool format

**Fix**: Update your tool calls to use the new `query_type` parameter instead of raw SQL.

---

## Migration Guide (For Existing Users)

If you were using the old version without OAuth:

1. **Update environment variables**: Remove `SUPABASE_DB_URL`
2. **Update tool calls**:
   - Remove `user_id` from `save_meal` calls
   - Replace `get_meal_data` SQL queries with `query_type` presets
3. **Configure OAuth** in your MCP client
4. **Reconnect** to authenticate

### Example Migration

**Old `save_meal` call:**
```json
{
  "tool": "save_meal",
  "arguments": {
    "user_id": "4499be88-366c-40b9-89b1-dd64776119d5",
    "meal": "breakfast",
    "meal_day": "2025-10-26",
    "calories": 350,
    "macros": {"protein": 20, "carbs": 40, "fat": 10},
    "meal_items": {"oatmeal": 50, "banana": 120}
  }
}
```

**New `save_meal` call:**
```json
{
  "tool": "save_meal",
  "arguments": {
    "meal": "breakfast",
    "meal_day": "2025-10-26",
    "calories": 350,
    "macros": {"protein": 20, "carbs": 40, "fat": 10},
    "meal_items": {"oatmeal": 50, "banana": 120}
  }
}
```

**Old `get_meal_data` call:**
```json
{
  "tool": "get_meal_data",
  "arguments": {
    "user_id": "4499be88-366c-40b9-89b1-dd64776119d5",
    "query": "SELECT * FROM fact_meal_macros WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10"
  }
}
```

**New `get_meal_data` call:**
```json
{
  "tool": "get_meal_data",
  "arguments": {
    "query_type": "recent",
    "limit": 10
  }
}
```

---

## Additional Resources

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Row Level Security Guide](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [OAuth 2.0 PKCE Flow](https://oauth.net/2/pkce/)

---

## Support

For issues or questions:
1. Check Vercel logs: `vercel logs`
2. Check Supabase logs: Dashboard → Logs → API
3. Verify RLS policies are active
4. Ensure JWT is being sent correctly by the client

**Common mistake**: Forgetting to add the `Authorization: Bearer` header. The MCP client framework should handle this automatically if OAuth is configured correctly.

