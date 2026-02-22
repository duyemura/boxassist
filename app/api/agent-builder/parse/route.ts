import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export interface ParsedAgentConfig {
  name: string
  description: string
  trigger_mode: 'event' | 'cron' | 'both'
  trigger_event: string | null
  cron_schedule: 'hourly' | 'daily' | 'weekly' | null
  data_sources: string[]
  action_type: 'draft_message' | 'send_alert' | 'create_report'
  system_prompt: string
  estimated_value: string
  skill_type: string
}

const SYSTEM_PROMPT = `You are an expert at parsing gym owner descriptions into structured agent configurations for a gym management AI platform called GymAgents.

Available MCP tools (data_sources):
- get_members: Fetch active members list
- get_at_risk_members: Find members at risk of canceling (by check-in frequency)
- get_member_detail: Full member profile + check-in history
- get_recent_leads: Leads from last N days
- get_leads: All leads with pagination
- get_failed_payments: Members with failed/past-due payments
- get_revenue_summary: Revenue health overview
- get_classes: Upcoming class schedule
- get_class_attendance: Class fill rates and trends
- get_checkins: Gym-wide check-in data
- get_checkins_by_member: Check-in history for specific member

PushPress webhook events:
- lead.created: New lead submitted
- member.created: New member signed up
- member.cancelled: Member cancellation
- checkin.created: Member checked into class
- payment.failed: Payment failure
- appointment.created: New appointment booked

You MUST output valid JSON only — no markdown, no explanation outside the JSON.`

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { description } = await req.json()
  if (!description || typeof description !== 'string') {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }

  const userPrompt = `Parse this gym owner's agent description into a structured config:

"${description}"

Output this exact JSON structure:
{
  "name": "short agent name (3-5 words, e.g. 'Lead Follow-Up Agent')",
  "description": "one sentence description of what this agent does",
  "trigger_mode": "event" | "cron" | "both",
  "trigger_event": "lead.created" | "member.created" | "member.cancelled" | "checkin.created" | "payment.failed" | "appointment.created" | null,
  "cron_schedule": "hourly" | "daily" | "weekly" | null,
  "data_sources": ["tool1", "tool2"],
  "action_type": "draft_message" | "send_alert" | "create_report",
  "system_prompt": "The actual system prompt for this agent. Be specific and include the gym owner's intent. 3-5 sentences.",
  "estimated_value": "one sentence about the business value (e.g. 'Recovers ~$500/month in revenue by catching failed payments early')",
  "skill_type": "snake_case_identifier e.g. lead_followup, payment_recovery, at_risk_detector, class_promoter, member_onboarding, win_back"
}

Rules:
- If the description mentions "when" + an event (new lead, payment fails, someone cancels), use trigger_mode: "event"
- If it mentions "daily", "weekly", "every morning", use trigger_mode: "cron"
- Pick data_sources based on what data the agent needs
- system_prompt should be actionable and specific to the description
- estimated_value should be concrete and motivating`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      return NextResponse.json({ error: 'Unexpected response type' }, { status: 500 })
    }

    const text = content.text.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse agent config' }, { status: 500 })
    }

    const config: ParsedAgentConfig = JSON.parse(jsonMatch[0])

    return NextResponse.json({ config })
  } catch (error: any) {
    console.error('Agent parser error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
