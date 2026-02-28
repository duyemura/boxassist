# Integrations System Design

AI agents get dramatically more useful when they can act across the owner's real stack — posting to Slack, sending email as themselves, texting members from their own number. This doc designs the integrations layer using **Composio as the backend**, which means we don't build OAuth flows, token storage, or tool implementations ourselves. Composio handles all of that.

**Launch integrations (proving both auth patterns):**
- **Slack** (OAuth) — post retention alerts and task summaries to owner's workspace
- **Gmail** (OAuth) — send email as the owner, not a noreply address
- **Twilio SMS** (API key, multi-field) — text members from the gym's own number

---

## What Composio Gives Us For Free

| Without Composio | With Composio |
|---|---|
| OAuth redirect routes per integration | ✓ Composio generates connect links |
| Callback route + token exchange per integration | ✓ Composio handles the callback |
| `lib/crypto.ts` to encrypt credentials at rest | ✓ Composio stores and encrypts tokens |
| Token refresh logic | ✓ Composio refreshes automatically |
| Per-integration tool files (`slack.ts`, `gmail.ts`…) | ✓ Composio MCP server exposes all tools |
| Supporting 980+ integrations | ✓ Already available in Composio's catalog |

**What we still build:**
- Thin routing layer to initiate Composio connections
- `account_id` → Composio `user_id` mapping in our DB
- Status cache (so our UI doesn't call Composio on every page load)
- MCP client connection in session runtime (route tool calls to Composio)
- `IntegrationsPanel` UI (featured grid, connect/disconnect, status badges)

---

## Architecture

```
Owner clicks "Connect Slack"
  → POST /api/integrations/slack/connect
    → Server calls Composio SDK: entity(accountId).initiateConnection('slack')
      → Composio returns: connect.composio.dev/link/xxxx
        → Server redirects owner to that URL
          → Owner approves Slack permissions on Composio's hosted page
            → Composio stores OAuth tokens (we never see them)
              → Composio redirects to our callback: /api/integrations/callback?status=success&connected_account_id=ca_xxx
                → We update our status cache: Slack connected for this account
                  → Agent session starts → MCP connection to Composio scoped to this account
                    → Agent calls slack_post_message(...)
                      → Composio makes the Slack API call using stored token
```

### Layers

| Layer | Location | Our Code | Composio Does |
|---|---|---|---|
| **Registry** | `lib/integrations/registry.ts` | UI metadata: name, description, icon, category, featured | Nothing |
| **Entity mapping** | `account_integrations` table | Maps `account_id` → Composio `user_id` | Nothing |
| **Status cache** | `account_integration_status` table | Caches connected/disconnected state for UI | Nothing |
| **Connect routes** | `/api/integrations/[id]/connect` | Calls Composio SDK, redirects | Generates OAuth link, hosts flow |
| **Callback route** | `/api/integrations/callback` | Reads status, updates cache | Handles OAuth exchange, stores token |
| **MCP client** | `lib/integrations/composio-mcp.ts` | Opens MCP connection scoped to account | Provides all tool implementations |
| **UI** | `components/IntegrationsPanel.tsx` | Grid, status badges, connect/disconnect | Nothing |

---

## Database

Much simpler than building our own credential store. We just need to map our accounts to Composio entities and cache connection status for the UI.

### Migration 020

```sql
-- Map our account_id to a Composio user_id (stable, created once per account)
CREATE TABLE account_composio_entities (
  account_id  UUID  PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     TEXT  NOT NULL UNIQUE,   -- Composio user_id (we set this = account_id for simplicity)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Cache connection status so we don't hit Composio API on every dashboard load
-- Source of truth is always Composio — this is just a display cache
CREATE TABLE account_integration_status (
  account_id      UUID  NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  integration_id  TEXT  NOT NULL,           -- 'slack', 'gmail', 'twilio'
  connected       BOOLEAN NOT NULL DEFAULT false,
  connected_at    TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}',  -- { workspace: 'PushPress', email: 'dan@...' }
  PRIMARY KEY (account_id, integration_id)
);
```

**Why use `account_id` as the Composio `user_id`:** Composio lets you set any string as the user_id. Using our `account_id` directly means no extra mapping lookup — we always know which Composio entity maps to which account.

---

## Integration Registry

Still needed — but only for **UI metadata**. No auth config required since Composio handles everything. The registry tells our UI what integrations exist, which are featured, what they do, and what auth type label to display.

### `lib/integrations/registry.ts`

```typescript
export interface IntegrationDef {
  id: string                // Composio app name: 'slack', 'gmail', 'twilio'
  name: string
  description: string
  category: IntegrationCategory
  featured: boolean
  authTypeLabel: 'OAuth' | 'API key'   // Display only — Composio handles actual auth
  iconUrl?: string
  docsUrl?: string
}

export type IntegrationCategory =
  | 'communication' | 'email' | 'calendar' | 'crm' | 'productivity' | 'fitness' | 'payments'

export const INTEGRATIONS: IntegrationDef[] = [
  // ── Featured (launch) ──────────────────────────────────────────────────────

  {
    id: 'slack',
    name: 'Slack',
    description: 'Team messaging and notifications',
    category: 'communication',
    featured: true,
    authTypeLabel: 'OAuth',
    iconUrl: '/integrations/slack.svg',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Send email as yourself — not a noreply address',
    category: 'email',
    featured: true,
    authTypeLabel: 'OAuth',
    iconUrl: '/integrations/gmail.svg',
  },
  {
    id: 'twilio',
    name: 'Twilio SMS',
    description: 'Text members from your own number',
    category: 'communication',
    featured: true,
    authTypeLabel: 'API key',
    iconUrl: '/integrations/twilio.svg',
  },

  // ── Catalog (available when needed, no code required) ─────────────────────

  { id: 'google_calendar', name: 'Google Calendar', description: 'Event scheduling and availability', category: 'calendar', featured: false, authTypeLabel: 'OAuth' },
  { id: 'hubspot', name: 'HubSpot', description: 'CRM contacts and deal tracking', category: 'crm', featured: false, authTypeLabel: 'OAuth' },
  { id: 'notion', name: 'Notion', description: 'Member notes and documentation', category: 'productivity', featured: false, authTypeLabel: 'OAuth' },
  { id: 'google_sheets', name: 'Google Sheets', description: 'Export member data and reports', category: 'productivity', featured: false, authTypeLabel: 'OAuth' },
  { id: 'airtable', name: 'Airtable', description: 'Database and applications', category: 'productivity', featured: false, authTypeLabel: 'OAuth' },
  { id: 'instagram', name: 'Instagram', description: 'Respond to DMs from potential leads', category: 'communication', featured: false, authTypeLabel: 'OAuth' },
]

export function getIntegration(id: string): IntegrationDef | undefined {
  return INTEGRATIONS.find(i => i.id === id)
}
export function getFeaturedIntegrations(): IntegrationDef[] {
  return INTEGRATIONS.filter(i => i.featured)
}
```

**Adding a new integration from Composio's 250+ catalog = 1 line in this array.** No routes, no tool files, no OAuth config.

---

## Auth Flows

### OAuth (Slack, Gmail, etc.)

```
1.  Owner clicks "Connect Slack"
2.  POST /api/integrations/slack/connect
3.  Server: ensure Composio entity exists for this account (create if first time)
4.  Server: composio.entity(accountId).initiateConnection({ appName: 'slack' })
5.  Composio returns: { redirectUrl: 'https://connect.composio.dev/link/xxxx' }
6.  Server: 302 → Composio's hosted OAuth page
7.  Owner: approves Slack permissions (standard OAuth screen — Composio is the OAuth app)
8.  Composio: stores tokens, redirects to /api/integrations/callback?status=success&connected_account_id=ca_xxx
9.  Server: updates account_integration_status → connected = true
10. Server: 302 → /dashboard?section=integrations&connected=slack
```

### API Key (Twilio)

```
1.  Owner clicks "Connect Twilio"
2.  Inline connect panel opens in our UI (no redirect needed — Composio supports API key auth)
3.  Owner fills: Account SID + Auth Token + From Number
4.  POST /api/integrations/twilio/connect { credentials: { account_sid, auth_token, from_number } }
5.  Server: composio.entity(accountId).initiateConnection({
      appName: 'twilio',
      authMode: 'API_KEY',
      credentials: { account_sid, auth_token, from_number }
    })
6.  Composio stores the credentials
7.  Server: updates account_integration_status → connected = true
8.  Server: 200 OK
9.  Frontend: panel closes, shows "Connected ✓"
```

### Routes needed

```
POST   /api/integrations/[id]/connect   → initiate Composio connection (OAuth redirect or API key store)
GET    /api/integrations/callback       → Composio's post-OAuth redirect target → update status cache
DELETE /api/integrations/[id]           → composio.entity(accountId).deleteConnection(id) + clear cache
GET    /api/integrations                → return account_integration_status rows (fast, from our DB)
POST   /api/integrations/sync           → re-query Composio for all connections, refresh cache (Refresh button)
```

---

## MCP Tool Injection at Runtime

When an agent session starts, instead of loading local tool files we open an MCP connection to Composio scoped to this account's user_id.

### `lib/integrations/composio-mcp.ts`

```typescript
import { ComposioMCPClient } from '@composio/core'

export async function getComposioTools(accountId: string): Promise<AgentTool[]> {
  // Composio MCP server URL, scoped to this account's entity (user_id = accountId)
  const mcpUrl = `https://backend.composio.dev/v3/mcp/${process.env.COMPOSIO_MCP_SERVER_ID}?user_id=${accountId}`

  const client = new ComposioMCPClient({ url: mcpUrl, apiKey: process.env.COMPOSIO_API_KEY })

  // Discover available tools for this account (only tools for connected integrations are returned)
  const tools = await client.listTools()

  // Adapt Composio's tool format to our AgentTool interface
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    requiresApproval: shouldRequireApproval(t.name),
    execute: async (input, ctx) => {
      return await client.callTool(t.name, input)
    },
  }))
}

// Tools that always need owner approval
function shouldRequireApproval(toolName: string): boolean {
  const ALWAYS_APPROVE = ['GMAIL_SEND_EMAIL', 'SLACK_POST_MESSAGE', 'TWILIO_SEND_SMS']
  return ALWAYS_APPROVE.some(name => toolName.includes(name))
}
```

### In `session-runtime.ts`

```typescript
// At session start, load Composio tools for this account's connected integrations
const composioTools = await getComposioTools(accountId)
for (const tool of composioTools) {
  registerTool(tool)  // adds to the existing tool registry for this session
}
```

Composio only returns tools for integrations the account has actually connected — so if Slack isn't connected, no Slack tools appear. The agent just works with whatever is available.

---

## UI Design (`components/IntegrationsPanel.tsx`)

**Following BRAND.md:** no border-radius, no shadows, sharp aesthetic.

### Layout

```
┌─ Connection Status ─────────────────────────────────────────┐
│  2 connected  •  [slack]  [gmail]             [Refresh]     │
└──────────────────────────────────────────────────────────────┘

★ Featured
┌───────────────────────────┐  ┌───────────────────────────┐
│  [icon]  Gmail            │  │  [icon]  Slack            │
│          Send as yourself │  │          Notifications     │
│  Connected 2/25/2026      │  │  OAuth                    │
│  [Disconnect]             │  │  [Connect →]              │
└───────────────────────────┘  └───────────────────────────┘
┌───────────────────────────┐
│  [icon]  Twilio SMS       │
│          Text members     │
│  API key                  │
│  [Connect →]              │
└───────────────────────────┘

All Integrations  [Search...]
┌─ 2-col grid of remaining catalog entries ─────────────────────┘
```

### Card states

**Connected:** left border 2px solid `#22C55E`, green `✓ Connected` badge top-right, `Connected [date]` + `[Disconnect]` at bottom.

**Disconnected:** `[Connect →]` button at bottom right, `OAuth` or `API key` label at bottom left.

### Connect panel (API key integrations)

Slides in below the card (no modal, no redirect). Field list is hardcoded per integration for now (Twilio: 3 fields). Can be made registry-driven later.

### Navigation

Add `'integrations'` to `NavSection` in `AppShell.tsx`. Place in `NAV_BOTTOM` between Skills and Settings.

---

## Environment Variables

```bash
# Composio
COMPOSIO_API_KEY=              # From composio.dev dashboard — one key for the whole app
COMPOSIO_MCP_SERVER_ID=        # Created in Composio dashboard — the MCP server for your app
```

That's it. No per-integration OAuth client IDs. No encryption keys. No redirect URIs to register.

---

## Build Order

### Phase 1 — Foundation

1. **Sign up for Composio**, get `COMPOSIO_API_KEY`, create an MCP server in their dashboard, get `COMPOSIO_MCP_SERVER_ID`
2. **Install SDK**: `npm install @composio/core`
3. **Migration 020** — `account_composio_entities` + `account_integration_status` tables
4. **`lib/db/integrations.ts`** — `ensureEntity(accountId)`, `getIntegrationStatus(accountId)`, `setIntegrationStatus(...)`, `clearIntegrationStatus(...)`
5. **`lib/integrations/registry.ts`** — registry with 3 featured + catalog entries

### Phase 2 — Connect/Disconnect Routes

6. **`app/api/integrations/route.ts`** — `GET`: return `account_integration_status` rows
7. **`app/api/integrations/[id]/connect/route.ts`** — `POST`: `ensureEntity` → `initiateConnection` → redirect (OAuth) or store + 200 (API key)
8. **`app/api/integrations/callback/route.ts`** — `GET`: parse Composio callback params → `setIntegrationStatus` → redirect to dashboard
9. **`app/api/integrations/[id]/route.ts`** — `DELETE`: `deleteConnection` on Composio → `clearIntegrationStatus`
10. **`app/api/integrations/sync/route.ts`** — `POST`: re-query Composio for all connections → refresh status cache

### Phase 3 — MCP Tool Injection

11. **`lib/integrations/composio-mcp.ts`** — `getComposioTools(accountId)`: open MCP connection, list tools, adapt to `AgentTool[]`
12. **Update `lib/agents/session-runtime.ts`** — at session start, call `getComposioTools` and register results

### Phase 4 — UI

13. **`components/IntegrationsPanel.tsx`** — full panel: status summary, featured 2-col grid, all integrations grid with search
14. **Update `components/AppShell.tsx`** — add `'integrations'` to `NavSection`
15. **Update `app/dashboard/page.tsx`** — add integrations section, handle `?connected=slack` flash toast

### Phase 5 — Tests + Polish

16. **Unit tests** — `lib/db/integrations.ts`, connect route (mock Composio SDK), callback route
17. **E2E test** — integrations page renders, connected badge shows
18. **Error handling** — Composio API down → graceful degradation (show last known status, tools silently unavailable)

---

## Trade-offs

### What we give up

| Concern | Detail |
|---|---|
| **Vendor dependency** | If Composio has downtime, integrations stop working. Mitigate: graceful degradation in session runtime (no Composio tools ≠ session fails) |
| **Data privacy** | Tool call inputs/outputs pass through Composio's servers. Member names, email content, etc. travel through a third party. Get a DPA. |
| **Cost at scale** | Composio charges per tool call. At 3,000 gyms × N tool calls/day, this adds up. Free tier: 1,000 calls/hour. Paid: 100,000/hour. Monitor usage. |
| **Tool quality** | Composio's tool descriptions and schemas may not be optimized for our prompts. We can override descriptions in our adapter. |

### What we gain

- **10x faster to launch** — no OAuth infrastructure to build
- **980+ integrations available on day 1** — gym owner wants Notion? Already there.
- **Zero token management** — no rotation, no refresh bugs, no encryption keys
- **Automatic updates** — when Slack updates their API, Composio updates their tools

### Exit strategy

If we outgrow Composio (cost, privacy, reliability), the abstraction makes migration clean:
- `lib/integrations/composio-mcp.ts` is the only file that talks to Composio
- Replace `getComposioTools(accountId)` with a local implementation
- The rest of the system — routes, UI, session runtime, registry — doesn't change

---

## Future: Expanding the Catalog

Adding any of Composio's 250+ integrations is **one line** in the registry array. No other changes needed — Composio already has the OAuth app, tool implementations, and token storage. The UI card renders from the registry entry automatically.

```typescript
// Adding Google Calendar support:
{ id: 'google_calendar', name: 'Google Calendar', description: 'Event scheduling', category: 'calendar', featured: false, authTypeLabel: 'OAuth' }
// Done. Owner can now connect it. Agent gets calendar tools automatically.
```
