import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy singletons — avoids crashing during Next.js build when env vars aren't available
let _supabase: SupabaseClient | null = null
let _supabaseAdmin: SupabaseClient | null = null

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabase) {
      _supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    }
    return (_supabase as any)[prop]
  }
})

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabaseAdmin) {
      _supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
    }
    return (_supabaseAdmin as any)[prop]
  }
})

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          stripe_customer_id: string | null
          stripe_subscription_status: string | null
          stripe_price_id: string | null
          trial_ends_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          stripe_customer_id?: string | null
          stripe_subscription_status?: string | null
          stripe_price_id?: string | null
          trial_ends_at?: string | null
          created_at?: string
        }
        Update: {
          stripe_customer_id?: string | null
          stripe_subscription_status?: string | null
          stripe_price_id?: string | null
          trial_ends_at?: string | null
        }
      }
      accounts: {
        Row: {
          id: string
          pushpress_api_key: string
          pushpress_company_id: string
          account_name: string
          member_count: number
          webhook_id: string | null
          connected_at: string
        }
      }
      agent_runs: {
        Row: {
          id: string
          account_id: string
          agent_type: string
          status: string
          input_summary: string | null
          output: any
          action_taken: string | null
          created_at: string
        }
      }
      agent_actions: {
        Row: {
          id: string
          agent_run_id: string
          action_type: string
          content: any
          approved: boolean | null
          dismissed: boolean | null
          created_at: string
        }
      }
      agents: {
        Row: {
          id: string
          account_id: string
          skill_type: string
          trigger_config: any
          is_active: boolean
          last_run_at: string | null
          run_count: number
          approval_rate: number
          created_at: string
        }
      }
    }
  }
}
