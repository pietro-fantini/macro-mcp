# ✅ OAuth Detection Fixed!

## The Problem

Cursor wasn't showing "Needs authentication" or a "Connect" button for your MCP server. Instead, it showed "3 tools enabled" and allowed using tools without authentication.

## Root Cause

With `required: false` in `experimental_withMcpAuth`, the MCP server allowed **unauthenticated initialization**:

```javascript
// Before (WRONG):
{
  required: false,  // ❌ Cursor thinks: "Server works without auth, no need to authenticate"
  authorizationServers: [SUPABASE_URL]
}
```

When Cursor called `initialize` without auth, it got:
```json
{"result": {"protocolVersion": "2024-11-05", "capabilities": {...}}}
```

So Cursor thought: "Great! It works without auth." and never checked for OAuth.

## The Fix

Changed to `required: true`:

```javascript
// After (CORRECT):
{
  required: true,  // ✅ Cursor thinks: "Server requires auth, let me check for OAuth"
  authorizationServers: [SUPABASE_URL]
}
```

Now when Cursor calls `initialize` without auth, it gets:
```json
{"error":"invalid_token","error_description":"No authorization provided"}
```

This triggers Cursor to:
1. Recognize authentication is needed
2. Check `/.well-known/oauth-protected-resource` 
3. Discover Supabase OAuth
4. Show **"Needs authentication"** with **"Connect" button**

## How It Works Now

### 1. Initial Connection (No Auth)
```
Cursor → MCP Server (no token)
Server → {"error":"invalid_token"}
Cursor → "Hmm, needs auth. Let me check for OAuth..."
```

### 2. OAuth Discovery
```
Cursor → GET /.well-known/oauth-protected-resource
Server → {"authorization_servers":["https://yxmpkoaefzprppelrjzx.supabase.co"]}
Cursor → "Aha! Uses Supabase OAuth. Showing Connect button..."
```

### 3. User Clicks "Connect"
```
Cursor → Opens browser to Supabase OAuth
User → Signs in with Google/GitHub/etc.
Supabase → Redirects back to Cursor with token
Cursor → Stores token securely
```

### 4. Authenticated Connection
```
Cursor → MCP Server (with token: Authorization: Bearer xyz...)
Server → Validates JWT with Supabase
Server → {"result": {"protocolVersion": "2024-11-05", ...}}
Cursor → "Connected! Tools are ready."
```

## Next Steps for You

### 1. Restart Cursor
**Close Cursor completely** and reopen it. This ensures it re-initializes the MCP connection.

### 2. Check the MCP Servers Panel
You should now see:
```
macro-mcp
🟡 Needs authentication     [Connect]
```

### 3. Configure Supabase (If Not Done Already)

Before clicking Connect, ensure these are set in your Supabase Dashboard:

**Authentication → URL Configuration:**
- **Site URL**: `https://macro-mcp.vercel.app`
- **Redirect URLs** (add all of these):
  ```
  cursor://oauth-callback
  cursor://auth-callback
  vscode://cursor/auth-callback
  http://localhost:*
  ```

**Authentication → Providers:**
- Enable at least one OAuth provider (Google, GitHub, etc.)

### 4. Click Connect
1. Click the **"Connect"** button in Cursor
2. Browser opens to Supabase OAuth
3. Sign in with Google/GitHub/etc.
4. Browser redirects back to Cursor
5. ✅ You're authenticated!

### 5. Test the Tools
Ask Cursor:
- "Get nutrition info for chicken breast" (should work)
- "Save my breakfast: 2 eggs and toast" (should work now with auth)
- "Show me my last 5 meals" (should work now with auth)

## Verification Commands

Test that it's working:

```bash
# Should reject without auth
curl -X POST -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test"}},"id":1}' \
  https://macro-mcp.vercel.app/api/mcp

# Expected: {"error":"invalid_token","error_description":"No authorization provided"}
```

```bash
# OAuth discovery should still work
curl https://macro-mcp.vercel.app/.well-known/oauth-protected-resource

# Expected: {"authorization_servers":["https://yxmpkoaefzprppelrjzx.supabase.co"]}
```

## Why This is Correct

This matches exactly how Supabase's MCP server works:

**Supabase MCP (with project_ref):**
```bash
curl -X POST ... https://mcp.supabase.com/mcp?project_ref=xxx
# Returns: {"message":"Unauthorized"}
```

**Your MCP (now):**
```bash
curl -X POST ... https://macro-mcp.vercel.app/api/mcp
# Returns: {"error":"invalid_token","error_description":"No authorization provided"}
```

Both reject unauthenticated requests, triggering OAuth detection.

## Troubleshooting

### If Cursor still doesn't show "Connect":

1. **Clear Cursor's MCP cache**:
   - Close Cursor
   - Delete: `~/.cursor/mcp_cache` (if exists)
   - Reopen Cursor

2. **Check Cursor logs**:
   - Help → Toggle Developer Tools → Console
   - Look for MCP-related errors

3. **Verify deployment**:
   ```bash
   curl https://macro-mcp.vercel.app/api/mcp
   # Should return error without proper MCP request
   ```

### If "Connect" fails after clicking:

1. **Add more redirect URIs** to Supabase:
   - Check Cursor logs for the exact redirect_uri it's trying
   - Add that to Supabase's Redirect URLs

2. **Check Supabase logs**:
   - Supabase Dashboard → Logs → Auth
   - Look for failed OAuth attempts

## Summary

✅ **Fixed**: Changed `required: false` → `required: true`  
✅ **Result**: Cursor now detects OAuth requirement  
✅ **Behavior**: Shows "Needs authentication" with "Connect" button  
✅ **Match**: Works exactly like Supabase MCP  

The fix is deployed and committed. Restart Cursor to see the changes!


