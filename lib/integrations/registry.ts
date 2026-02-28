/**
 * Integration registry — static definitions of all supported integrations.
 *
 * This is the ONLY place that knows about integrations. Auth config, routes,
 * session runtime, and UI all read from here. Adding a new integration from
 * Composio's catalog = one entry in INTEGRATIONS[].
 *
 * Auth is handled entirely by Composio — no OAuth client IDs or secrets needed here.
 */

export type IntegrationCategory =
  | 'communication'
  | 'email'
  | 'calendar'
  | 'crm'
  | 'productivity'
  | 'fitness'
  | 'payments'

export type AuthType = 'oauth' | 'api_key'

export interface ApiKeyField {
  key: string               // Storage key in Composio credentials: 'username', 'password'
  label: string             // Display label: 'Account SID'
  placeholder: string       // 'ACxxxxxxxx...'
  required?: boolean        // Default true
  secret?: boolean          // Mask like password input (default true for non-first field)
  helpText?: string         // Hint shown below field
}

export interface IntegrationDef {
  id: string                // Composio toolkit slug: 'slack', 'gmail', 'twilio'
  name: string
  description: string
  category: IntegrationCategory
  featured: boolean
  authType: AuthType
  iconEmoji: string         // Fallback when no SVG
  iconUrl?: string          // /public/integrations/[id].svg
  docsUrl?: string
  // For api_key integrations: fields to collect in the connect panel
  // Composio stores them via AuthScheme.Basic (username/password) or AuthScheme.APIKey
  apiKeyFields?: ApiKeyField[]
}

export const INTEGRATIONS: IntegrationDef[] = [
  // ── Featured — launch integrations ────────────────────────────────────────

  {
    id: 'slack',
    name: 'Slack',
    description: 'Post retention alerts and task summaries to your workspace',
    category: 'communication',
    featured: true,
    authType: 'oauth',
    iconEmoji: '💬',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Send email as yourself — not from a noreply address',
    category: 'email',
    featured: true,
    authType: 'oauth',
    iconEmoji: '✉️',
  },
  {
    id: 'twilio',
    name: 'Twilio SMS',
    description: 'Text members from your gym\'s own number',
    category: 'communication',
    featured: true,
    authType: 'api_key',
    iconEmoji: '📱',
    apiKeyFields: [
      {
        key: 'username',              // Composio BASIC auth: username = Account SID
        label: 'Account SID',
        placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        required: true,
        secret: false,
        helpText: 'Found on your Twilio Console dashboard',
      },
      {
        key: 'password',              // Composio BASIC auth: password = Auth Token
        label: 'Auth Token',
        placeholder: '••••••••••••••••••••••••••••••••',
        required: true,
        secret: true,
        helpText: 'Keep this secret',
      },
      {
        key: 'from_number',           // Stored in our DB metadata, not in Composio
        label: 'From Phone Number',
        placeholder: '+15551234567',
        required: true,
        secret: false,
        helpText: 'Your Twilio number in E.164 format (+1...)',
      },
    ],
  },

  // ── Catalog — define now, available immediately via Composio ──────────────

  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Scheduling awareness and event context',
    category: 'calendar',
    featured: false,
    authType: 'oauth',
    iconEmoji: '📅',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'CRM contacts and deal tracking',
    category: 'crm',
    featured: false,
    authType: 'oauth',
    iconEmoji: '🔶',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Member notes and documentation',
    category: 'productivity',
    featured: false,
    authType: 'oauth',
    iconEmoji: '📓',
  },
  {
    id: 'googlesheets',
    name: 'Google Sheets',
    description: 'Export member data and custom reports',
    category: 'productivity',
    featured: false,
    authType: 'oauth',
    iconEmoji: '📊',
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Database and flexible applications',
    category: 'productivity',
    featured: false,
    authType: 'oauth',
    iconEmoji: '🗂️',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Respond to DMs from potential leads',
    category: 'communication',
    featured: false,
    authType: 'oauth',
    iconEmoji: '📸',
  },
]

export function getIntegration(id: string): IntegrationDef | undefined {
  return INTEGRATIONS.find(i => i.id === id)
}

export function getFeaturedIntegrations(): IntegrationDef[] {
  return INTEGRATIONS.filter(i => i.featured)
}
