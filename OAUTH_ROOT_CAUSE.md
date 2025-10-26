# 🔍 Root Cause Analysis: OAuth Flow Failure

## The Error

When testing the OAuth flow manually:
```
https://yxmpkoaefzprppelrjzx.supabase.co/auth/v1/authorize?redirect_uri=https://claude.ai/api/mcp/auth_callback&response_type=code&scope=openid

Response:
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: Provider  could not be found"}
```

## Why This Happens

### What You Have vs What You Need

**Current Setup (What You Have):**
```
Supabase Auth configured as OAuth CLIENT
├─ Users log into YOUR app
├─ Via providers: Google, GitHub, etc.
└─ Supabase forwards auth to Google/GitHub
```

**Required Setup (What Claude Needs):**
```
Supabase Auth configured as OAuth SERVER  
├─ Claude logs users into SUPABASE
├─ Supabase IS the authorization server
└─ Supabase issues tokens to Claude
```

## The Fundamental Mismatch

1. **MCP Server advertises**: `authorization_servers: ["https://yxmpkoaefzprppelrjzx.supabase.co"]`
2. **Claude tries**: `GET /auth/v1/authorize?redirect_uri=...`
3. **Supabase expects**: A `provider` parameter (like `provider=google`)
4. **Claude doesn't send** `provider` because Supabase should BE the provider
5. **Supabase errors**: "Provider could not be found"

## Why Supabase Can't Be OAuth AS (Yet)

Supabase Auth is designed for:
- ✅ Letting users log into your app
- ✅ Via external OAuth providers (Google, GitHub)
- ❌ NOT for being an OAuth Authorization Server itself

To act as an OAuth AS (letting Claude authenticate users), Supabase needs **OAuth 2.1 Server capabilities**, which are:
- Currently in private beta
- Discussed here: https://github.com/orgs/supabase/discussions/38022
- Not publicly available yet

## The Solution

### Option 1: Pre-Authentication (Recommended - Works Now)

Instead of Claude doing OAuth, users get tokens manually:

**Flow:**
1. User visits `https://macro-mcp.vercel.app/auth.html`
2. Signs in with Google via Supabase
3. Gets a long-lived access token
4. Adds token to Claude config with headers:
   ```json
   {
     "mcpServers": {
       "macro-mcp": {
         "url": "https://macro-mcp.vercel.app/api/mcp",
         "headers": {
           "Authorization": "Bearer TOKEN_HERE"
         }
       }
     }
   }
   ```
5. Claude uses the token on every request

**Why this works:**
- ✅ No OAuth flow needed between Claude ↔ Supabase
- ✅ Token is valid Supabase JWT
- ✅ MCP server validates token normally
- ✅ Works TODAY without beta features

### Option 2: Wait for OAuth 2.1 Server (Future)

When Supabase releases OAuth 2.1 Server publicly:
- Supabase can act as OAuth AS
- Claude can do real OAuth flow
- Current `.well-known/oauth-protected-resource` will work

### Option 3: Custom OAuth Server (Complex)

Build your own OAuth server that:
- Integrates with Supabase
- Acts as OAuth AS for Claude
- Issues tokens that your MCP validates

**Not recommended** - too complex for this use case.

## Current Behavior Explained

### Why Claude Shows "Connect"

With `required: true`:
```javascript
const authHandler = experimental_withMcpAuth(handler, verifySupabaseToken, {
  required: true,  // ← MCP server rejects unauth requests
  authorizationServers: [SUPABASE_URL]  // ← Advertises OAuth
});
```

1. Claude tries to connect without auth
2. Gets rejected: `{"error":"invalid_token"}`
3. Checks for OAuth: `GET /.well-known/oauth-protected-resource`
4. Finds: `{"authorization_servers":["https://yxmpkoaefzprppelrjzx.supabase.co"]}`
5. Shows "Connect" button
6. User clicks → Browser opens → Supabase OAuth fails (provider error)

### Why It Fails

When Claude opens:
```
https://yxmpkoaefzprppelrjzx.supabase.co/auth/v1/authorize?
  client_id=...&
  redirect_uri=https://claude.ai/api/mcp/auth_callback&
  response_type=code&
  scope=openid
```

Supabase expects:
```
https://yxmpkoaefzprppelrjzx.supabase.co/auth/v1/authorize?
  provider=google&  ← MISSING! This is the problem
  redirect_uri=...
```

Because Supabase Auth's `/authorize` endpoint is for **logging INTO apps** (requires provider), not **authenticating apps** (acts as provider).

## The Fix: Pre-Authentication

### 1. Keep MCP Server As-Is

The server code is correct:
- ✅ Has `required: true` (so users know auth is needed)
- ✅ Validates Supabase JWTs properly
- ✅ Enforces RLS

### 2. Add Auth Web Page

Created `public/auth.html`:
- Users sign in with Google via Supabase
- Get their access token
- Copy to Claude config

### 3. Update Supabase Redirect URLs

Change redirect URLs in Supabase to:
```
https://macro-mcp.vercel.app/auth.html
```

This allows the auth page to complete OAuth with Supabase.

### 4. Users Add Token to Config

Instead of OAuth flow, users paste token:
```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://macro-mcp.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer <token-from-auth-page>"
      }
    }
  }
}
```

## Summary

**Root Cause**: Supabase Auth can't be an OAuth Authorization Server (yet)

**Error**: `"Unsupported provider: Provider could not be found"`

**Why**: Supabase expects `provider=google` because it's designed to let users log into apps, not to be an OAuth server itself

**Solution**: Pre-authentication via web page + token in headers

**Future**: When Supabase releases OAuth 2.1 Server, the original OAuth flow will work

## Next Steps

1. Get your Supabase anon key
2. Add it to `public/auth.html`
3. Deploy to Vercel
4. Update Supabase redirect URLs
5. Tell users to visit `https://macro-mcp.vercel.app/auth.html`
6. Users copy token and add to their Claude config

See `PRE_AUTH_SETUP.md` for detailed steps!

