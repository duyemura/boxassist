---
name: readme-maintenance
description: Decide whether README.md needs updating after shipping a feature, and patch only the affected sections.
triggers:
  - update readme
  - readme outdated
  - docs out of date
  - major feature shipped
  - new section added
  - new integration
  - new environment variable
  - project structure changed
---

# README Maintenance

Use this skill when deciding whether `README.md` needs updating after completing a task.

---

## When to Update

**Update README.md when you shipped:**

| What changed | Which README section(s) |
|---|---|
| New user-facing feature (new panel, new agent capability) | Features |
| New integration or channel | Features → Integrations |
| New env var or removed env var | Environment Variables |
| New npm script or changed command | Commands |
| New top-level directory or major file moves | Project Structure |
| New service added to the stack (DB, API, tool) | Tech Stack |
| Architecture pattern changed | Key Design Decisions, or How It Works |
| A section of the product removed or renamed | Any section that references it |

**Do not update README.md for:**
- Bug fixes, perf improvements, small UI tweaks
- Adding or changing tests
- Internal refactors with no observable behaviour change
- Dependency version bumps (unless it changes what's listed in the stack)
- Comment/doc changes inside source files

---

## How to Update

**Patch only the affected sections.** Do not rewrite the whole README unless the user asks.

1. Read the current README section that's affected
2. Make the minimal edit that makes it accurate — add a row, update a name, add a bullet
3. Keep the existing style and tone — don't expand scope or add new sections unless necessary
4. If multiple unrelated sections are stale, update each one targeted

---

## What "Major Feature" Means

A major feature is something that changes what the product can do, what tools/services it uses, or how a developer would set it up. Examples:

- **Integrations system** → update Features (new section), Tech Stack (Composio added), Env Vars (COMPOSIO_API_KEY)
- **New agent type** → update Features (new agent), Project Structure (new files)
- **URL-based routing** → no README update needed (internal implementation detail)
- **New cron job** → probably no update unless it's a user-visible capability
- **New skill files** → update the skill count in Features if it's significantly different

---

## Quick Checklist

After shipping, scan these questions:

- [ ] Is there a new feature a user or developer would want to know about?
- [ ] Did the tech stack change (new service, removed service)?
- [ ] Did env vars change?
- [ ] Did any commands change?
- [ ] Does the project structure section still reflect reality?
- [ ] Does "How It Works" still accurately describe the data flow?

If all answers are no → no README update needed. Say so and move on.
If any answer is yes → make the targeted patch, commit it alongside the feature.
