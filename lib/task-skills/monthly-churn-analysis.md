---
id: monthly-churn-analysis
applies_when: "time to produce a monthly analysis of membership health, churn trends, and retention performance"
domain: analysis
triggers: ["monthly_review", "churn_report", "retention_analysis"]
---

# Monthly Churn Analysis - Task Skill

## Role

You are acting as your gym's data analyst. Your job is to analyze membership data,
attendance patterns, and churn indicators to produce a structured report the
gym owner can act on.

## Goal

Produce a monthly churn analysis report. Success = a complete, actionable report
delivered to the owner. This is a research/deliverable task, not a communication task.

## How This Task Type Works

This is a recurring research task that runs monthly. It does NOT send emails
to members. Instead, it:
1. Analyzes the gym's member data
2. Identifies trends and risks
3. Produces a structured report
4. Creates follow-up tasks for members that need attention

## Report Structure

The deliverable should include:

### Executive Summary (2-3 sentences)
- Overall health of the gym's retention this month
- Most notable change vs last month
- One key recommendation

### Key Metrics
- Total active members (vs last month)
- New members this month
- Cancellations this month
- Net member change
- Average attendance per member (visits/month)
- Members flagged as high-risk

### Risk Breakdown
- How many members in each risk tier (high/medium/low)
- Change from last month
- Which risk factors are most common this month

### Top At-Risk Members (up to 10)
For each:
- Name, tenure, last checkin, risk score
- Primary risk factors
- Recommended action (email, call, special attention)
- Whether a task already exists for them

### Trends
- Attendance trend (improving/declining/stable)
- Churn rate trend (3-month view)
- Most common churn risk factors this month
- Seasonal patterns (if detectable)

### Recommendations (3-5 actionable items)
- Specific actions the owner can take
- Prioritized by expected impact
- Reference specific members or segments where relevant

## Data Sources

Pull from:
- Member management system data (status, plan, visits)
- Agent task outcomes (what worked, what didn't)
- Previous month's analysis (for comparison)
- Attributed outcomes (revenue retained, tasks resolved)

## Analysis Guidelines

- Be specific with numbers. "12 members at high risk" not "several members at risk"
- Compare to last month. Trends matter more than snapshots
- Don't alarm unnecessarily. Some churn is normal
- Highlight wins. Members retained, revenue saved, successful outreach
- If data is insufficient or stale, say so explicitly rather than guessing
- Note any data quality issues (members with no checkin data, etc.)

## Completion

- `completed`: full report delivered with all sections
- `incomplete`: some data was unavailable, partial report delivered
- `inconclusive`: not enough data to produce meaningful analysis

## Common Mistakes to Avoid

- Sending member outreach from a research task. This task only analyzes
- Making definitive claims from insufficient data
- Ignoring positive trends in favor of only reporting problems
- Producing a report with no actionable recommendations
- Not comparing to the previous period. Raw numbers without context aren't useful
- Creating too many follow-up tasks at once (respect the gym's daily task limits)
