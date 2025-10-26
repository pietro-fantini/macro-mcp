# CRITICAL: Disable Vercel Authentication

## Issue

Your MCP server deployment has **Vercel Authentication (Deployment Protection)** enabled, which is blocking MCP clients (like Claude and Cursor) from accessing the OAuth metadata endpoint at `/.well-known/oauth-protected-resource`.

Without access to this endpoint, MCP clients cannot discover that OAuth is required and will not prompt users to authenticate.

## Solution

You **MUST** disable Vercel Authentication for this MCP server to work properly.

### Steps to Disable Vercel Authentication

1. Go to your Vercel dashboard: https://vercel.com/
2. Navigate to your `macro-mcp` project
3. Click on **Settings** → **Deployment Protection**
4. **Disable** "Vercel Authentication" or "Password Protection"
5. Save the changes

### Why This Is Necessary

- MCP clients need to access `/.well-known/oauth-protected-resource` **without** authentication
- This endpoint tells clients where to authenticate (your Supabase project)
- The MCP server's OAuth handles user authentication separately
- Vercel Authentication interferes with this flow

### Security Note

This is safe because:
- Your MCP server already has OAuth authentication via Supabase
- Each tool call requires a valid Supabase JWT
- RLS policies protect your data at the database level
- Vercel Authentication would be redundant and breaks the OAuth flow

## Alternative (Not Recommended)

If you must keep Vercel Authentication enabled, you'll need to:
1. Add the OAuth metadata endpoint to the bypass list in Vercel dashboard
2. Configure bypass tokens for MCP clients (complex and not standard)

**However, this defeats the purpose of having an MCP server and will make it difficult for users to connect.**

## After Disabling

Once you disable Vercel Authentication:
1. Redeploy your MCP server (or it will be automatically redeployed)
2. Test the OAuth endpoint: `curl https://your-deployment.vercel.app/.well-known/oauth-protected-resource`
3. You should see: `{"authorization_servers":["https://yxmpkoaefzprppelrjzx.supabase.co"]}`
4. Claude/Cursor will now prompt users to authenticate via your Supabase OAuth

## Verification

After disabling, run this command to verify:
```bash
curl https://macro-lgxomkvkz-pietro-fantinis-projects.vercel.app/.well-known/oauth-protected-resource
```

Expected output:
```json
{"authorization_servers":["https://yxmpkoaefzprppelrjzx.supabase.co"]}
```

If you still see an authentication page, Vercel Authentication is still enabled.

