# OAuth Flow Diagram

## Architecture: You Own Supabase, Your Users Authenticate With It

```
┌─────────────────────────────────────────────────────────────────────┐
│                         YOUR INFRASTRUCTURE                          │
│                                                                       │
│  ┌──────────────────┐              ┌───────────────────────────┐   │
│  │                  │              │                           │   │
│  │   Vercel (MCP)   │              │   Supabase (Auth + DB)    │   │
│  │                  │              │                           │   │
│  │  • MCP Tools     │◄────────────►│  • OAuth Provider        │   │
│  │  • JWT Validator │   validates  │  • User Management       │   │
│  │  • RLS Queries   │   tokens     │  • Row Level Security    │   │
│  │                  │              │  • PostgreSQL            │   │
│  └────────▲─────────┘              └─────────▲────────────────┘   │
│           │                                  │                      │
│           │ JWT token                        │ OAuth flow           │
│           │ on each request                  │ (authentication)     │
└───────────┼──────────────────────────────────┼──────────────────────┘
            │                                  │
            │                                  │
    ┌───────┴──────────┐            ┌─────────┴─────────┐
    │                  │            │                   │
    │  Claude Desktop  │            │    Web Browser    │
    │                  │            │                   │
    │  • Stores JWT    │            │  • OAuth Login    │
    │  • Auto-refreshes│            │  • User signs in  │
    │  • Sends Bearer  │            │    with Google/   │
    │    token         │            │    GitHub/etc     │
    │                  │            │                   │
    └──────────────────┘            └───────────────────┘
           ▲                                   ▲
           │                                   │
           └───────────────┬───────────────────┘
                           │
                    ┌──────┴───────┐
                    │              │
                    │  Your Users  │
                    │              │
                    └──────────────┘
```

---

## Step-by-Step OAuth Flow

### Initial Setup (One-time per user)

```
1. User adds MCP server URL to Claude Desktop
   └─→ claude_desktop_config.json: { "url": "https://your-server.vercel.app/api/mcp" }

2. Claude fetches OAuth metadata
   └─→ GET https://your-server.vercel.app/.well-known/oauth-protected-resource
   └─→ Response: { "authorization_servers": ["https://yxmpkoaefzprppelrjzx.supabase.co"] }

3. Claude knows: "I need to authenticate with that Supabase project"

4. User clicks "Connect" in Claude Desktop

5. Claude opens browser to YOUR Supabase OAuth page
   └─→ https://yxmpkoaefzprppelrjzx.supabase.co/auth/v1/authorize?...

6. User sees YOUR configured OAuth providers:
   ┌─────────────────────────────────┐
   │   Sign in to Macro MCP          │
   │                                  │
   │   ┌───────────────────────────┐ │
   │   │  Sign in with Google      │ │
   │   └───────────────────────────┘ │
   │   ┌───────────────────────────┐ │
   │   │  Sign in with GitHub      │ │
   │   └───────────────────────────┘ │
   │                                  │
   │   New user? You'll be signed up │
   │   automatically!                 │
   └─────────────────────────────────┘

7. User clicks "Sign in with Google" (or GitHub, etc.)

8. OAuth provider authenticates user

9. Supabase creates user account (if new) in auth.users table

10. Supabase redirects back to Claude with authorization code

11. Claude exchanges code for JWT access token

12. Claude stores token securely

13. ✅ User is now connected!
```

### Every Tool Call (Automatic)

```
1. User asks Claude: "Show me my last 5 meals"

2. Claude calls tool with JWT:
   POST https://your-server.vercel.app/api/mcp
   Headers:
     Authorization: Bearer eyJhbGc....<user's JWT>
   Body:
     {
       "method": "tools/call",
       "params": {
         "name": "get_meal_data",
         "arguments": {
           "query_type": "recent",
           "limit": 5
         }
       }
     }

3. Your MCP server receives request:
   └─→ experimental_withMcpAuth() extracts JWT
   └─→ verifySupabaseToken() validates JWT with Supabase
   └─→ If valid: tool handler gets extra.authInfo with user_id

4. Tool handler creates scoped Supabase client:
   └─→ const supabase = createClient(URL, ANON_KEY, {
         global: { headers: { Authorization: `Bearer ${jwt}` }}
       })

5. Query runs with RLS:
   └─→ SELECT * FROM fact_meal_macros
   └─→ PostgreSQL sees: auth.uid() = '<user-id-from-jwt>'
   └─→ RLS policy allows only rows where user_id = auth.uid()

6. Response sent back to Claude with only user's meals

7. Claude displays results to user
```

---

## Key Points

### 🎯 You Control Everything

- **OAuth Provider**: YOUR Supabase project
- **User Database**: YOUR Supabase `auth.users` table
- **User Data**: YOUR Supabase `fact_meal_macros` table with RLS
- **Access Control**: YOUR RLS policies decide who sees what

### 🔐 Users Don't Need Your Credentials

- Users ONLY need the MCP server URL
- No Supabase credentials in their config
- Claude discovers OAuth automatically
- OAuth flow uses YOUR Supabase as provider

### 🚀 Multi-Tenant SaaS

- Each user has their own account in YOUR Supabase
- RLS ensures data isolation
- One MCP server serves all users
- Each user sees only their own data

### 🔄 Token Management

- Claude handles token storage and refresh
- Tokens expire after 1 hour (Supabase default)
- Claude auto-refreshes tokens
- User only needs to connect once

---

## What Gets Stored Where

### In YOUR Supabase `auth.users`:
```sql
id           | email              | created_at          | last_sign_in
-------------|--------------------|--------------------|------------------
uuid-1234... | alice@gmail.com    | 2025-10-26 10:00   | 2025-10-26 15:30
uuid-5678... | bob@github.com     | 2025-10-26 11:00   | 2025-10-26 16:00
```

### In YOUR Supabase `fact_meal_macros`:
```sql
id           | user_id      | meal      | meal_day   | calories | ...
-------------|--------------|-----------|------------|----------|----
meal-abc...  | uuid-1234... | breakfast | 2025-10-26 | 350      | ...
meal-def...  | uuid-1234... | lunch     | 2025-10-26 | 600      | ...
meal-ghi...  | uuid-5678... | breakfast | 2025-10-26 | 400      | ...
```

### In Claude Desktop (on user's machine):
```json
{
  "macro-mcp": {
    "access_token": "eyJhbGc...",
    "refresh_token": "...",
    "expires_at": 1635264000
  }
}
```

---

## Comparison: Before vs After

### ❌ Old Approach (What I Initially Suggested - WRONG)

```json
// Users would need YOUR Supabase credentials in their config
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://your-server.vercel.app/api/mcp",
      "auth": {
        "supabaseUrl": "https://YOUR-PROJECT.supabase.co",  // ❌ Exposes your project
        "supabaseAnonKey": "eyJ..."                          // ❌ Exposes your anon key
      }
    }
  }
}
```

**Problems:**
- ❌ Users need your Supabase credentials
- ❌ Anon key exposed to all users
- ❌ Users could potentially abuse your Supabase directly
- ❌ Not how OAuth is meant to work

### ✅ New Approach (Correct - OAuth Discovery)

```json
// Users only need your MCP server URL
{
  "mcpServers": {
    "macro-mcp": {
      "url": "https://your-server.vercel.app/api/mcp"
    }
  }
}
```

**Benefits:**
- ✅ Claude discovers OAuth automatically
- ✅ Your credentials stay private
- ✅ Standard OAuth flow
- ✅ Users authenticate with YOUR Supabase
- ✅ You control everything

---

## Security Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Security Layers                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. OAuth 2.0 + PKCE                                         │
│     └─→ Industry standard authentication                     │
│     └─→ Secure for desktop apps                             │
│     └─→ No client secret needed                             │
│                                                               │
│  2. JWT Validation                                           │
│     └─→ Every request validates token with Supabase         │
│     └─→ Expired tokens rejected                             │
│     └─→ Tampered tokens rejected                            │
│                                                               │
│  3. Per-Request Scoped Client                                │
│     └─→ Each tool call creates new Supabase client          │
│     └─→ Client includes user's JWT                          │
│     └─→ No global admin client                              │
│                                                               │
│  4. Row Level Security (RLS)                                 │
│     └─→ Database-level enforcement                          │
│     └─→ user_id = auth.uid() checked on every query        │
│     └─→ Users physically cannot access other users' data    │
│                                                               │
│  5. No Arbitrary SQL                                         │
│     └─→ Only predefined query templates                     │
│     └─→ Prevents SQL injection                              │
│     └─→ Safe by design                                      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## For Your Landing Page (Out of Scope, But FYI)

Your landing page and MCP server share the same Supabase:

```
┌────────────────────────────────────────────────────────┐
│              YOUR SUPABASE (Single Instance)            │
│                                                          │
│  ┌─────────────────────────────────────────────────┐  │
│  │           auth.users (Shared)                    │  │
│  │  • User signs up via landing page → stored here │  │
│  │  • User signs in via MCP OAuth → same account   │  │
│  │  • Single source of truth for users             │  │
│  └─────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─────────────────────────────────────────────────┐  │
│  │      fact_meal_macros (MCP data)                 │  │
│  │  • Meal tracking data                            │  │
│  │  • Linked to auth.users via user_id             │  │
│  │  • Protected by RLS                              │  │
│  └─────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─────────────────────────────────────────────────┐  │
│  │      Other tables (Your app data)                │  │
│  │  • profiles, subscriptions, etc.                 │  │
│  │  • Linked to auth.users via user_id             │  │
│  │  • Your landing page uses this                   │  │
│  └─────────────────────────────────────────────────┘  │
│                                                          │
└────────────────────────────────────────────────────────┘
```

Same user, same database, different entry points!

