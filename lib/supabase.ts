import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
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
      gyms: {
        Row: {
          id: string
          user_id: string
          pushpress_api_key: string
          pushpress_company_id: string
          gym_name: string
          member_count: number
          webhook_id: string | null
          connected_at: string
        }
      }
      agent_runs: {
        Row: {
          id: string
          gym_id: string
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
      autopilots: {
        Row: {
          id: string
          gym_id: string
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
