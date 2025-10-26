# Pre-Authentication Setup Guide

## The Problem

Supabase Auth is designed to let users log into YOUR app (via Google/GitHub), but Claude needs Supabase to ACT AS an OAuth server itself. This feature (OAuth 2.1 Server) is in beta and not publicly available yet.

## The Solution: Pre-Authentication

Instead of real-time OAuth with Claude, users authenticate ONCE through a web page to get a long-lived token, then use that token in their Claude config.

## Setup Steps

### 1. Update Supabase Redirect URLs

In your Supabase Dashboard:
1. Go to **Authentication** → **URL Configuration**
2. **Redirect URLs** - Replace all existing URLs with JUST this one:
   ```
   https://macro-mcp.vercel.app/auth.html
   ```
3. **Site URL** - Keep as: `https://macro-mcp.vercel.app`
4. Save changes

### 2. Get Your Supabase Anon Key

You need to add your anon key to the auth page:

1. Go to **Project Settings** → **API**
2. Copy your **anon public** key
3. Edit `public/auth.html`
4. Replace `YOUR_ANON_KEY_HERE` with your actual anon key

### 3. Deploy

Deploy your changes to Vercel:
```bash
vercel --prod --yes
```

### 4. Update Documentation

Tell your users to:

1. **Get their token**: Go to https://macro-mcp.vercel.app/auth.html
2. **Sign in with Google**
3. **Copy the token** shown on the page
4. **Update their Claude config**:

```json
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://macro-mcp.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer PASTE_TOKEN_HERE"
      }
    }
  }
}
```

5. **Restart Claude**

## How It Works

### Before (OAuth - Not Working):
```
Claude → MCP Server → Supabase OAuth AS ❌
(Supabase can't be OAuth AS without beta feature)
```

### Now (Pre-Auth - Works!):
```
User → auth.html → Supabase (Google login) → Get Token ✅
Claude → MCP Server (with token in header) → Validates token → Works! ✅
```

## Benefits

✅ Works TODAY (no beta features needed)
✅ Tokens are long-lived (default: 1 hour, refreshable)
✅ Simple for users (one-time setup)
✅ Secure (token tied to user's Supabase account)

## Token Lifecycle

- **Duration**: Tokens expire after 1 hour by default
- **Refresh**: Users can refresh by visiting auth.html again
- **Revoke**: Users can sign out on auth.html to invalidate
- **Security**: Tokens are JWT signed by Supabase

## Alternative: Configure Token Duration

To make tokens last longer, in Supabase Dashboard:

1. Go to **Authentication** → **Settings**
2. Find **JWT expiry limit**
3. Increase to 7 days (604800 seconds) for less frequent refreshes
4. Save changes

## Future: OAuth 2.1 Server

When Supabase releases OAuth 2.1 Server publicly, you can switch back to real OAuth flow. For now, pre-authentication is the recommended approach per the Cursor MCP community.

## Troubleshooting

### Token doesn't work
- Check the token was copied correctly (no extra spaces)
- Verify the token hasn't expired (get a new one)
- Check Vercel logs: `vercel logs --follow`

### Can't sign in on auth.html
- Verify redirect URL is exactly: `https://macro-mcp.vercel.app/auth.html`
- Check Google OAuth is enabled in Supabase
- Ensure anon key is correct in auth.html

### Claude still shows "Connect"
- This is expected! Just ignore it
- Claude will work with the token in headers
- The "needs authentication" is because `required: true` in the server
- But authentication happens via the header, not OAuth flow

