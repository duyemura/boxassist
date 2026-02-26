/**
 * Artifact rendering engine.
 *
 * Takes structured data → beautiful, self-contained HTML.
 * All styles are inline so artifacts can be:
 *   - Rendered in an iframe/modal
 *   - Sent as an email
 *   - Opened as a standalone page
 *   - Screenshotted and shared
 */
import type { ArtifactType, ResearchSummaryData } from './types'

export function renderArtifact(type: ArtifactType, data: Record<string, unknown>): string {
  switch (type) {
    case 'research_summary':
      return renderResearchSummary(data as unknown as ResearchSummaryData)
    case 'monthly_report':
      return renderResearchSummary(data as unknown as ResearchSummaryData) // same template for now
    default:
      return `<div style="padding: 40px; font-family: -apple-system, sans-serif; color: #333;">
        <p>Unknown artifact type: ${type}</p>
      </div>`
  }
}

// ── Color palette (matches BRAND.md) ────────────────────────

const COLORS = {
  blue: '#0063FF',
  blueBg: 'rgba(0,99,255,0.06)',
  green: '#16A34A',
  greenBg: '#F0FDF4',
  greenBorder: '#BBF7D0',
  amber: '#F59E0B',
  amberBg: '#FFFBEB',
  amberBorder: '#FDE68A',
  red: '#DC2626',
  redBg: '#FEF2F2',
  redBorder: '#FECACA',
  purple: '#7C3AED',
  purpleBg: 'rgba(124,58,237,0.06)',
  dark: '#111827',
  gray600: '#4B5563',
  gray400: '#9CA3AF',
  gray200: '#E5E7EB',
  gray100: '#F3F4F6',
  white: '#FFFFFF',
}

const STATUS_STYLES: Record<string, { color: string; bg: string; border: string; label: string }> = {
  retained:  { color: COLORS.green,  bg: COLORS.greenBg,  border: COLORS.greenBorder, label: 'Retained' },
  at_risk:   { color: COLORS.amber,  bg: COLORS.amberBg,  border: COLORS.amberBorder, label: 'At Risk' },
  churned:   { color: COLORS.red,    bg: COLORS.redBg,    border: COLORS.redBorder,   label: 'Churned' },
  active:    { color: COLORS.blue,   bg: COLORS.blueBg,   border: COLORS.blue,        label: 'Active' },
  escalated: { color: COLORS.red,    bg: COLORS.redBg,    border: COLORS.redBorder,   label: 'Escalated' },
  new:       { color: COLORS.purple, bg: COLORS.purpleBg, border: COLORS.purple,      label: 'New' },
}

// ── Research Summary template ───────────────────────────────

function renderResearchSummary(data: ResearchSummaryData): string {
  const { stats, members, insights, trend } = data

  const statCards = [
    { label: 'At Risk', value: stats.membersAtRisk.toString(), color: stats.membersAtRisk > 0 ? COLORS.amber : COLORS.gray400 },
    { label: 'Retained', value: stats.membersRetained.toString(), color: stats.membersRetained > 0 ? COLORS.green : COLORS.gray400 },
    { label: 'Revenue Saved', value: `$${stats.revenueRetained.toLocaleString()}`, color: stats.revenueRetained > 0 ? COLORS.green : COLORS.gray400 },
    { label: 'Messages', value: stats.messagesSent.toString(), color: COLORS.blue },
    { label: 'Active Convos', value: stats.conversationsActive.toString(), color: stats.conversationsActive > 0 ? COLORS.blue : COLORS.gray400 },
    { label: 'Escalations', value: stats.escalations.toString(), color: stats.escalations > 0 ? COLORS.red : COLORS.gray400 },
  ]

  const memberRows = members.map(m => {
    const style = STATUS_STYLES[m.status] ?? STATUS_STYLES.active
    const riskDot = m.riskLevel
      ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${
          m.riskLevel === 'high' ? COLORS.red : m.riskLevel === 'medium' ? COLORS.amber : COLORS.green
        };"></span>`
      : ''

    return `
      <div style="border:1px solid ${COLORS.gray200};padding:16px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="display:flex;align-items:center;">
            ${riskDot}
            <span style="font-weight:600;font-size:14px;color:${COLORS.dark};">${escHtml(m.name)}</span>
            ${m.membershipValue ? `<span style="font-size:11px;color:${COLORS.gray400};margin-left:8px;">$${m.membershipValue}/mo</span>` : ''}
          </div>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:2px 8px;color:${style.color};background:${style.bg};border:1px solid ${style.border};">
            ${style.label}
          </span>
        </div>
        <p style="font-size:13px;color:${COLORS.gray600};margin:0;line-height:1.5;">${escHtml(m.detail)}</p>
        ${m.lastCheckin ? `<p style="font-size:11px;color:${COLORS.gray400};margin:6px 0 0;">Last check-in: ${escHtml(m.lastCheckin)}</p>` : ''}
      </div>`
  }).join('')

  const insightItems = insights.map(i =>
    `<li style="font-size:13px;color:${COLORS.gray600};line-height:1.6;margin-bottom:6px;">${escHtml(i)}</li>`
  ).join('')

  const trendBlock = trend ? `
    <div style="display:flex;align-items:center;gap:12px;margin-top:12px;">
      <span style="font-size:12px;color:${COLORS.gray400};">vs last month:</span>
      <span style="font-size:12px;font-weight:600;color:${
        trend.direction === 'up' ? COLORS.green : trend.direction === 'down' ? COLORS.red : COLORS.gray400
      };">
        ${trend.direction === 'up' ? '&#9650;' : trend.direction === 'down' ? '&#9660;' : '&#9644;'}
        ${trend.retainedPrev} retained &middot; $${trend.revenuePrev.toLocaleString()} saved
      </span>
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(data.title ?? data.gymName + ' — Research Summary')}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: ${COLORS.gray100}; color: ${COLORS.dark}; }
    @media print { body { background: white; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div style="max-width:640px;margin:0 auto;padding:32px 20px;">

    <!-- Header -->
    <div style="border-bottom:3px solid ${COLORS.blue};padding-bottom:20px;margin-bottom:28px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <div style="width:24px;height:24px;background:${COLORS.blue};display:flex;align-items:center;justify-content:center;">
              <span style="color:white;font-weight:700;font-size:12px;">G</span>
            </div>
            <span style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.gray400};">GymAgents</span>
          </div>
          <h1 style="font-size:22px;font-weight:700;color:${COLORS.dark};margin-top:8px;">${escHtml(data.gymName)}</h1>
          <p style="font-size:13px;color:${COLORS.gray400};margin-top:2px;">
            ${escHtml(data.period)} &middot; Generated by ${escHtml(data.generatedBy)}
          </p>
        </div>
        <div style="text-align:right;">
          <p style="font-size:11px;color:${COLORS.gray400};">${escHtml(new Date(data.generatedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))}</p>
        </div>
      </div>
    </div>

    <!-- Hero Stats -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:28px;">
      ${statCards.map(s => `
        <div style="background:${COLORS.white};border:1px solid ${COLORS.gray200};padding:16px;">
          <p style="font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${COLORS.gray400};margin-bottom:4px;">${s.label}</p>
          <p style="font-size:24px;font-weight:700;color:${s.color};">${s.value}</p>
        </div>
      `).join('')}
    </div>
    ${trendBlock}

    <!-- Members -->
    ${members.length > 0 ? `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:14px;font-weight:700;color:${COLORS.dark};margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">
        Member Activity
      </h2>
      ${memberRows}
    </div>
    ` : ''}

    <!-- Insights -->
    ${insights.length > 0 ? `
    <div style="background:${COLORS.blueBg};border:1px solid ${COLORS.blue}22;padding:20px;margin-bottom:28px;">
      <h2 style="font-size:14px;font-weight:700;color:${COLORS.blue};margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">
        Insights &amp; Recommendations
      </h2>
      <ul style="padding-left:18px;">
        ${insightItems}
      </ul>
    </div>
    ` : ''}

    <!-- Footer -->
    <div style="border-top:1px solid ${COLORS.gray200};padding-top:16px;display:flex;align-items:center;justify-content:space-between;">
      <p style="font-size:11px;color:${COLORS.gray400};">
        Generated by GymAgents &middot; AI General Manager
      </p>
      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app-orcin-one-70.vercel.app'}/dashboard"
         style="font-size:11px;font-weight:600;color:${COLORS.blue};text-decoration:none;"
         class="no-print">
        Open Dashboard &rarr;
      </a>
    </div>

  </div>
</body>
</html>`
}

// ── Helpers ─────────────────────────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
