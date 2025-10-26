# OAuth Setup Guide for Supabase Owner

## Overview

Your MCP server is now configured to use **your Supabase instance** as the OAuth provider. Your users will authenticate directly with YOUR Supabase project, which you control.

---

## What Your Users See

1. Add your MCP server URL to Claude Desktop:
   ```json
   {
     "mcpServers": {
       "macro-mcp": {
         "url": "https://your-project.vercel.app/api/mcp"
       }
     }
   }
   ```

2. Claude detects OAuth is required (via `/.well-known/oauth-protected-resource`)

3. User clicks "Connect" → browser opens to YOUR Supabase login

4. User signs in with Google/GitHub/etc. (or signs up if new)

5. Done! Token is stored by Claude and sent with each request

---

## Your Supabase Configuration

### 1. Enable OAuth Providers

**Supabase Dashboard → Authentication → Providers**

Enable one or more:
- ✅ Google
- ✅ GitHub  
- ✅ Apple
- ✅ Azure
- ✅ Or any other supported provider

### 2. Configure Redirect URLs

**Supabase Dashboard → Authentication → URL Configuration**

**Site URL:**
```
https://your-vercel-project.vercel.app
```

**Additional Redirect URLs:**

You'll need to add the redirect URL that Claude Desktop uses. This might be:
- `claude://oauth-callback`
- `http://localhost:[port]/callback`
- Custom app protocol

**How to discover it:**
1. Have a test user try to connect
2. Check **Supabase Dashboard → Authentication → Logs**
3. Look for failed redirect attempts
4. Add that URL to redirect URLs list

Or check Claude Desktop's documentation/logs.

### 3. Configure PKCE (Already Enabled)

PKCE (Proof Key for Code Exchange) should be enabled by default in Supabase for security. Verify:

**Supabase Dashboard → Authentication → Settings**
- ✅ Enable PKCE (should be on by default)

---

## How It Works

### OAuth Flow

```
1. User adds MCP URL to Claude → Claude fetches /.well-known/oauth-protected-resource
2. Claude sees: "authServerUrls": ["https://yxmpkoaefzprppelrjzx.supabase.co"]
3. Claude initiates OAuth with YOUR Supabase
4. User authenticates via Google/GitHub/etc on YOUR Supabase
5. Supabase redirects back to Claude with auth code
6. Claude exchanges code for JWT access token
7. Claude sends JWT with every tool call: Authorization: Bearer <jwt>
8. Your MCP server validates JWT with Supabase
9. RLS policies ensure users only see their own data
```

### Security Model

- **You control the auth**: All users authenticate with YOUR Supabase
- **No secrets in client**: PKCE ensures desktop clients are secure
- **Per-user isolation**: RLS policies enforce `user_id = auth.uid()`
- **JWT validation**: Every request validates the token with Supabase
- **Per-request client**: Each tool call creates a scoped Supabase client

---

## User Management

### Where Are Users Stored?

**Supabase Dashboard → Authentication → Users**

You'll see:
- User ID (UUID)
- Email
- OAuth provider used
- Last sign in
- Created date

### User Profiles

Users in `auth.users` are automatically created by Supabase OAuth.

If you want custom profile data:
1. Create a `profiles` table with `user_id` FK to `auth.users(id)`
2. Add trigger to create profile on signup
3. Users can update their profile via your landing page

### Managing Your Landing Page + MCP Integration

**Landing Page (out of scope, but for reference):**
- Users sign up on your website
- Use Supabase Auth UI or custom form
- Supabase creates user in `auth.users`

**MCP Connection:**
- Same users can connect to MCP server
- They authenticate with the SAME Supabase account
- No separate signup needed for MCP
- Their meal data is linked to their `user_id`

---

## Deployment Checklist

### Vercel Environment Variables

```bash
SUPABASE_URL=https://yxmpkoaefzprppelrjzx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
NUTRITIONIX_API_KEY=...
NUTRITIONIX_API_ID=...
```

### Supabase Settings

- ✅ OAuth providers enabled (Google, GitHub, etc.)
- ✅ Site URL set to Vercel URL
- ✅ Redirect URLs configured (add Claude's callback)
- ✅ PKCE enabled
- ✅ RLS policies active on `fact_meal_macros`

### Deploy

```bash
vercel --prod
```

### Test OAuth Metadata Endpoint

```bash
curl https://your-project.vercel.app/.well-known/oauth-protected-resource
```

Expected response:
```json
{
  "resource": "https://your-project.vercel.app",
  "authorization_servers": ["https://yxmpkoaefzprppelrjzx.supabase.co"]
}
```

---

## Testing

### Test as a User

1. Add MCP server to Claude Desktop config (just the URL)
2. Restart Claude Desktop
3. Look for the macro-mcp server in the tools list
4. Click "Connect" when prompted
5. Browser opens to Supabase OAuth
6. Sign in with Google/GitHub/etc.
7. Approve permissions
8. Redirected back to Claude
9. Try: "Show me my last 5 meals"
10. If no meals: "Save my breakfast: 2 eggs and toast"

### Check Logs

**Vercel:**
```bash
vercel logs --follow
```

Look for:
```
[TOOL CALL] save_meal called for user: <uuid>, meal: breakfast, day: 2025-10-26
```

**Supabase:**
Dashboard → Logs → API

Look for successful `getUser()` calls from your Vercel function.

---

## Troubleshooting

### "Redirect URI mismatch"

**Problem:** Supabase rejects the OAuth callback

**Solution:**
1. Check Supabase Auth logs for the actual redirect URI
2. Add it to: Dashboard → Authentication → URL Configuration → Additional Redirect URLs

### "Invalid token" or "Token expired"

**Problem:** JWT validation fails

**Solution:**
- Tokens expire after 1 hour by default
- User needs to reconnect (Claude should handle this automatically)
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct

### User can't see their meals

**Problem:** RLS is blocking access

**Solution:**
```sql
-- Verify RLS policies exist
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'fact_meal_macros';

-- Should return 4 policies (SELECT, INSERT, UPDATE, DELETE)
```

---

## Advanced: Custom OAuth Scope

If you want to limit what the MCP server can access, you can configure OAuth scopes in Supabase. The MCP server currently requests basic read/write access to meal data.

---

## Support for Your Users

When users have issues connecting:

1. **Check their config:**
   - URL should be: `https://your-project.vercel.app/api/mcp`
   - No additional auth config needed

2. **Check OAuth redirect:**
   - Ask them to check Supabase error if any
   - Look for "redirect URI mismatch"

3. **Token issues:**
   - Have them disconnect and reconnect
   - Check if token expired (1 hour default)

4. **Can't see data:**
   - Verify they're authenticated (click "Connect")
   - Check Vercel logs for their user_id
   - Verify RLS policies are active

---

## Next Steps

1. **Create your landing page** (out of scope)
   - Use Supabase Auth UI
   - Same users can connect to MCP

2. **Test the OAuth flow**
   - Add test user
   - Connect via Claude
   - Save/query meals

3. **Monitor usage**
   - Supabase Dashboard → Auth → Users
   - Vercel Analytics

4. **Document for your users**
   - How to add MCP server to Claude
   - What the tools do
   - Privacy policy

---

Your MCP server is now a **multi-tenant SaaS** with:
- ✅ Per-user authentication
- ✅ Row Level Security
- ✅ OAuth 2.0 with PKCE
- ✅ Automatic token management
- ✅ Secure by default

Users authenticate with YOUR Supabase and their data is isolated via RLS. You control the auth provider, user management, and data access.

