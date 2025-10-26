# 🚀 Quick Start: OAuth Setup

## ✅ What's Done

Your MCP server now has a **full OAuth 2.0 Authorization Server** built-in!

Users just add the URL - no manual tokens, no complicated setup.

## 🎯 One Configuration Needed

### Update Supabase Redirect URL

In your Supabase Dashboard:

1. Go to **Authentication** → **URL Configuration**
2. Under **Redirect URLs**, replace everything with:
   ```
   https://macro-mcp.vercel.app/api/oauth/callback
   ```
3. Click **Save**

That's it! Everything else is done.

## 👤 User Instructions

Tell your users to:

### 1. Add to Config

**Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Cursor**: `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://macro-mcp.vercel.app/api/mcp"
    }
  }
}
```

### 2. Restart Claude/Cursor

Close and reopen completely.

### 3. Click "Connect"

You'll see:
```
macro-mcp
🟡 Needs authentication     [Connect]
```

Click "Connect" → Browser opens → Sign in with Google → Done!

### 4. Use the Tools

Ask Claude:
- "Get nutrition for chicken breast" ✅
- "Save my breakfast: 2 eggs and toast" ✅  
- "Show me my last 5 meals" ✅

## 🔍 How It Works

```
User adds URL → Claude detects OAuth needed → 
Shows "Connect" button → User clicks → 
Browser opens to your OAuth server → 
Redirects to Supabase → User signs in with Google →
Supabase redirects back → Your server generates code →
Redirects to Claude → Claude exchanges code for token →
Token stored → All future requests authenticated! ✅
```

## 🎉 Benefits

✅ **Zero manual configuration** - Just add URL
✅ **Standard OAuth flow** - Works with any MCP client
✅ **Automatic authentication** - Click once, works forever
✅ **Secure** - PKCE, state validation, JWT validation
✅ **Your server, your control** - Full OAuth AS on your domain

## 📚 More Details

- Full technical details: `OAUTH_PROPER_IMPLEMENTATION.md`
- Why Supabase direct OAuth failed: `OAUTH_ROOT_CAUSE.md`

## 🧪 Testing

Test the OAuth metadata:
```bash
curl https://macro-mcp.vercel.app/.well-known/oauth-protected-resource
```

Should return your OAuth server configuration with:
- `authorization_endpoint: https://macro-mcp.vercel.app/api/oauth/authorize`
- `token_endpoint: https://macro-mcp.vercel.app/api/oauth/token`

## ✅ Checklist

- [x] OAuth server implemented
- [x] Deployed to Vercel
- [x] OAuth metadata endpoint working
- [ ] Update Supabase redirect URL (only thing left!)
- [ ] Test with Claude/Cursor

**Next**: Update that Supabase redirect URL and you're done! 🎊

