---
id: staff-call-member
applies_when: "a member situation requires a personal phone call from staff, escalated issues, no-shows, or high-touch moments"
domain: retention
triggers: ["no_show", "escalation_needs_call", "high_value_member"]
---

# Staff Call Member - Task Skill

## Role

This is a staff task, not an AI communication task. The system creates this
task when a member situation needs a real phone call from a real human:
the gym owner, a manager, or a coach.

## Goal

Get a staff member to make a phone call to a specific member. Success = the
call was made and the outcome was recorded.

## How This Task Type Works

Unlike communication tasks where the AI drafts and sends messages, this task:
- Appears in the owner's/staff's task queue as a to-do item
- Includes context about WHY the call is needed
- Includes suggested talking points (NOT a script)
- Requires a human to mark it as done and record the outcome

The AI's job here is LIMITED to:
1. Writing clear, useful context about why this call should happen
2. Suggesting talking points based on the member's history
3. Recording the outcome when the staff member reports back

## Context to Include in the Task

When creating this task, provide:
- Member name and phone number
- WHY they need a call (specific reason, not generic)
- Relevant history (last checkin, current status, recent conversations, complaints)
- Suggested talking points (3-5 bullet points, not a script)
- Priority and urgency ("call today" vs "call this week")

## Talking Points Guidelines

- Keep them brief. Bullet points, not paragraphs
- Focus on the goal of the call (check in? resolve issue? welcome back?)
- Note any sensitive topics to be aware of (recent complaint, injury, financial difficulty)
- Note what NOT to mention (other members, internal processes, AI system)
- Suggest an opening line that feels natural

## Outcome Recording

When the staff member marks the task as done, capture:
- Did they reach the member? (yes/reached voicemail/no answer/wrong number)
- Brief summary of the conversation (1-2 sentences)
- Next steps (if any)
- Member sentiment (positive/neutral/negative)

## Completion

- `completed`: call was made and outcome recorded
- `member_unreachable`: 2+ attempts with no answer and no callback
- `skipped`: staff decided the call wasn't necessary (must note why)

## Common Mistakes to Avoid

- Writing a full script instead of talking points. Staff know how to talk to members
- Creating call tasks for things that should be an email
- Not including the WHY. "Call this member" with no context is useless
- Creating too many call tasks at once. Staff have limited phone time
- Not capturing the outcome. The call is only half the task, the record matters
