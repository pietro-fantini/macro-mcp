# OAuth Implementation - Complete Summary

## What Was Fixed

### Issue
Your MCP server was missing the OAuth discovery endpoint, causing Claude and Cursor to not prompt users for authentication. Additionally, Vercel Authentication was blocking access to critical OAuth endpoints.

### Changes Made

#### 1. Created OAuth Metadata Endpoint
- **File**: `api/oauth-metadata.js`
- **Purpose**: Exposes OAuth configuration so MCP clients can discover your Supabase auth
- **Endpoint**: `/.well-known/oauth-protected-resource`
- **Returns**: `{"authorization_servers":["https://yxmpkoaefzprppelrjzx.supabase.co"]}`

#### 2. Updated Vercel Configuration
- **File**: `vercel.json`
- Added rewrite rule: `/.well-known/oauth-protected-resource` → `/api/oauth-metadata`
- Configured CORS headers for MCP clients
- Added function configuration for the new endpoint

#### 3. Enhanced MCP Handler Configuration
- **File**: `api/mcp/index.js`
- Added `authorizationServers` configuration to `experimental_withMcpAuth`
- Improved error logging for debugging

#### 4. Improved Error Handling
- Added detailed error logging for the `get_nutrition` tool
- Errors are logged to Vercel logs while showing user-friendly messages

## What You Need To Do

### CRITICAL: Disable Vercel Authentication

Your deployment has Vercel Authentication enabled, which is blocking the OAuth endpoint. See `DISABLE_VERCEL_AUTH.md` for detailed instructions.

**Quick Steps:**
1. Go to https://vercel.com/ → Your Project → Settings → Deployment Protection
2. Disable "Vercel Authentication"
3. Save changes

### Then Test

After disabling Vercel Authentication:

```bash
# Test the OAuth metadata endpoint
curl https://macro-lgxomkvkz-pietro-fantinis-projects.vercel.app/.well-known/oauth-protected-resource
```

**Expected output:**
```json
{"authorization_servers":["https://yxmpkoaefzprppelrjzx.supabase.co"]}
```

### Configure Supabase

Ensure your Supabase project has:

1. **OAuth providers enabled** (Google, GitHub, etc.)
   - Go to Supabase Dashboard → Authentication → Providers
   - Enable at least one OAuth provider

2. **Redirect URLs configured**
   - Add: `claude://oauth-callback` (for Claude Desktop)
   - Add: `cursor://oauth-callback` (for Cursor)
   - Add: `http://localhost:*` (for local testing)

3. **Site URL configured**
   - Set to: Your MCP server URL (e.g., `https://macro-lgxomkvkz-pietro-fantinis-projects.vercel.app`)

## How Users Will Connect

Once everything is configured:

### Step 1: User adds MCP server URL
```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://macro-lgxomkvkz-pietro-fantinis-projects.vercel.app/api/mcp"
    }
  }
}
```

### Step 2: Claude/Cursor discovers OAuth
- Fetches `/.well-known/oauth-protected-resource`
- Sees your Supabase URL as the authorization server
- Prompts user: "This server requires authentication"

### Step 3: User clicks "Connect"
- Browser opens to your Supabase OAuth page
- User signs in with Google/GitHub/etc.
- Supabase redirects back to Claude/Cursor with auth code
- Claude/Cursor exchanges code for JWT token

### Step 4: User can now use the MCP server
- All tool calls include `Authorization: Bearer <jwt>` header
- Your server validates JWT with Supabase
- RLS policies ensure data isolation

## OAuth Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│  User configures MCP server URL in Claude/Cursor        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Claude fetches /.well-known/oauth-protected-resource   │
│  Response: {"authorization_servers": ["supabase.co"]}   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Claude prompts: "Authenticate with Supabase"           │
│  User clicks "Connect"                                   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Browser opens: Supabase OAuth page                     │
│  User signs in with Google/GitHub/etc.                  │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Supabase redirects to Claude with auth code            │
│  Claude exchanges code for JWT token                    │
│  Token stored securely in Claude                        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  User makes tool call (e.g., "save my meal")            │
│  Claude sends: Authorization: Bearer <jwt>              │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Your MCP server validates JWT with Supabase            │
│  Creates user-scoped Supabase client                    │
│  Query runs with RLS enforcement                        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Response sent back to user                             │
│  User sees only their own data                          │
└─────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Issue: Still getting "Error fetching nutritional information"

This could be due to:
1. **Missing Nutritionix API keys** in Vercel environment variables
   - Set: `NUTRITIONIX_API_KEY` and `NUTRITIONIX_API_ID`
2. **Vercel Authentication still enabled** (blocks all requests)
3. **OAuth not configured** (blocks authenticated tools)

Check Vercel logs:
```bash
vercel logs --follow
```

### Issue: Claude/Cursor don't prompt for authentication

1. Verify Vercel Authentication is disabled
2. Test the OAuth endpoint:
   ```bash
   curl https://your-deployment.vercel.app/.well-known/oauth-protected-resource
   ```
3. Should return JSON, not an HTML authentication page

### Issue: "Invalid or expired token"

- Token expired (1 hour default)
- Claude should auto-refresh
- User can reconnect to get a new token

## Security Notes

✅ **What's Protected:**
- User data isolated by RLS policies
- JWT validated on every request
- No arbitrary SQL queries
- User IDs extracted from JWT (can't be spoofed)

✅ **What's Public:**
- `get_nutrition` tool (doesn't require auth)
- OAuth metadata endpoint (required for discovery)
- MCP server homepage (if any)

✅ **Best Practices:**
- Keep `SUPABASE_URL` and `SUPABASE_ANON_KEY` in env vars
- Never expose `SUPABASE_SERVICE_ROLE_KEY`
- RLS policies are your primary security layer
- JWT validation is your secondary layer

## Files Modified

1. `api/oauth-metadata.js` (new)
2. `api/mcp/index.js` (updated)
3. `vercel.json` (updated)
4. `DISABLE_VERCEL_AUTH.md` (new)
5. `OAUTH_IMPLEMENTATION_COMPLETE.md` (this file)

## Next Steps

1. ✅ Disable Vercel Authentication (see `DISABLE_VERCEL_AUTH.md`)
2. ✅ Verify OAuth endpoint is accessible
3. ✅ Configure Supabase OAuth providers and redirect URLs
4. ✅ Set Nutritionix API keys in Vercel (if not already done)
5. ✅ Test connection from Claude or Cursor
6. ✅ Monitor Vercel logs for any issues

## Support

If you encounter issues:
- Check Vercel logs: `vercel logs --follow`
- Check Supabase logs: Dashboard → Logs → API
- Verify environment variables are set
- Ensure RLS policies are active
- Test OAuth endpoint returns JSON

## Reference Documentation

- MCP OAuth Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- Supabase Auth: https://supabase.com/docs/guides/auth
- Claude MCP: https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers
- Your OAuth Flow: See `OAUTH_FLOW_DIAGRAM.md`

