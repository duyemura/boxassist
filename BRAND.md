# GymAgents — Design System

_Source of truth for all visual decisions. If you're writing UI code, read this first._

---

## Colors

### Brand palette
| Token | Hex | Usage |
|---|---|---|
| `pacific-blue` | `#0063FF` | Primary action, links, active states, focus rings, brand accents |
| `dark-black` | `#080808` | Page-level headings (H1, H2) |
| `deep-blue` | `#031A3C` | Sidebar background, dark surfaces |
| `glowing-green` | `#62FB84` | Positive metric highlights (use sparingly) |
| `candy-coral` | `#F86262` | Error states, destructive actions |
| `laser-lemon` | `#F4FF78` | Reserved — do not use in UI text (illegible on white) |
| `sky-blue` | `#D3E4FF` | Light blue tints, hover states on dark surfaces |

### Grays (Tailwind)
| Token | Hex | Usage |
|---|---|---|
| `gray-900` / `#111827` | — | Body text, list item titles |
| `gray-700` / `#374151` | — | Secondary body text |
| `gray-500` / `#6B7280` | — | Muted text, metadata |
| `gray-400` / `#9CA3AF` | — | Placeholder text, disabled labels |
| `gray-300` / `#D1D5DB` | — | Borders on inputs, dividers |
| `gray-200` / `#E5E7EB` | — | Section borders, table lines |
| `gray-100` / `#F3F4F6` | — | Subtle backgrounds, zebra rows |
| `gray-50` / `#F9FAFB` | — | Table headers, hover state on rows |

### Surface colors
| Token | Hex | Usage |
|---|---|---|
| `#F8F9FB` | — | Center column background |
| `#F4F5F7` | — | CommandBar / stats bar background |
| `#111827` | — | Sidebar background |
| `white` | `#FFFFFF` | Card backgrounds, right rail, panels |

### Semantic colors
| Purpose | Color |
|---|---|
| Success / positive ROI / retained | `#16A34A` (green-700) |
| Warning / medium risk | `#F59E0B` (amber-400) |
| Danger / high risk / error | `#EF4444` (red-500) |
| Info / playbook tag | `#0063FF` at 8% opacity bg |

---

## Typography

### Scale
| Role | Class | Size | Weight | Usage |
|---|---|---|---|---|
| Page title | `text-lg font-semibold` | 18px | 600 | H1 under CommandBar (Dashboard, Playbooks…) |
| Section header | `text-base font-bold` | 16px | 700 | Category headers within a list (Retention, Growth…) |
| List item title | `text-sm font-medium` | 14px | 500 | Agent names, playbook names, member names |
| Body / description | `text-xs` | 12px | 400 | Descriptions, risk reasons, situation text |
| Micro-label | `text-[10px] font-semibold tracking-widest uppercase` | 10px | 600 | Section labels (SITUATION, DRAFTED MESSAGE, PLAYBOOKS USED) |
| Tag / badge | `text-[10px] font-semibold tracking-wide uppercase` | 10px | 600 | Playbook chips, status badges |
| Metadata | `text-[10px]` | 10px | 400 | Timestamps, secondary metadata |

### Rules
- **No text-[11px]** — use `text-xs` (12px) or `text-[10px]`. The 11px size is a rounding error.
- **No inline font sizes** unless absolutely necessary — use the scale above.
- **Headings use dark-black** (`#080808`), not gray-900. Gray-900 for body.
- **Micro-labels** always `uppercase tracking-widest` — this is a consistent pattern throughout.
- **Monospace** (`font-mono`) only for drafted message textareas and custom instruction fields.

---

## Spacing

### Layout
| Area | Value |
|---|---|
| Center column horizontal padding | `px-6` (24px) |
| Section content padding | `p-8` (32px) for full-page sections |
| Card / panel internal padding | `p-4` (16px) |
| List row padding | `px-4 py-3` |
| Right rail padding | `px-4 py-4` |

### Component gaps
| Usage | Value |
|---|---|
| Header icon + label | `gap-2` |
| Form field stack | `space-y-6` |
| Button group | `gap-3` |
| Tag group (chips) | `gap-1.5` |
| Tight inline | `gap-1` |

---

## Borders & Radius

- **No border-radius anywhere** — this is a hard rule. The aesthetic is sharp, precise, futuristic.
- All borders use `border border-gray-200` or `border-b border-gray-100` for dividers.
- Focus rings: `focus:outline-none focus:border-blue-400` (no `focus:ring`).
- Cards/panels: `border border-gray-100` or `border border-gray-200`.

---

## Buttons

### Primary
```
text-xs font-semibold text-white px-4 py-1.5
style={{ backgroundColor: '#0063FF' }}
```
Hover: `hover:opacity-80` — never change background color on hover, just opacity.

### Secondary / outline
```
text-xs font-semibold px-3 py-1.5 border
style={{ borderColor: '#0063FF', color: '#0063FF' }}
```

### Ghost / text
```
text-xs text-gray-400 hover:text-gray-700 transition-colors
```

### Destructive
```
text-xs text-red-400 hover:text-red-600 transition-colors
```

### Disabled state
Always `disabled:opacity-50` — never `disabled:cursor-not-allowed` alone.

---

## Form fields

### Text input / textarea / select
```
w-full text-sm border border-gray-200 bg-white px-3 py-2
focus:outline-none focus:border-blue-400 transition-colors
```
No border-radius. No shadow. Blue border on focus.

### Textarea variants
- Resizable: `resize-y`
- Fixed: `resize-none`
- Code/monospace content: add `font-mono text-xs leading-relaxed`

---

## Toggles / switches

```jsx
<button
  style={{
    width: 44, height: 24, borderRadius: 12,
    backgroundColor: active ? '#0063FF' : '#D1D5DB',
  }}
>
  <span style={{
    top: 2, left: 2, width: 20, height: 20, borderRadius: 10,
    transform: active ? 'translateX(20px)' : 'translateX(0)',
  }} />
</button>
```
The pill itself uses `borderRadius` (exception to no-radius rule — toggles are always pills).

---

## Tags / chips

### Playbook / info chip
```
text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5
style={{ color: '#0063FF', backgroundColor: 'rgba(0,99,255,0.08)' }}
```

### System / muted chip
```
text-[10px] font-medium px-2 py-0.5
style={{ color: '#6B7280', backgroundColor: '#F3F4F6' }}
```

### Status badges
- Connected: `text-[10px] font-medium text-green-600`
- Soon: `text-[10px] font-medium text-gray-300`
- Read-only: `text-[10px] text-gray-300 border border-gray-100 px-2 py-0.5`

---

## Navigation & layout

### App shell
- Sidebar: `#111827` bg, `w-14` collapsed / icon-only
- Center: `#F8F9FB` bg, `flex-1`, scrollable
- Right rail: `white` bg, `w-96` fixed width

### CommandBar
- Background: `#F4F5F7`
- Sits above center + right rail as a unified strip
- Left zone: stats (flex-1), Right zone: active agent status (w-96)

### Page header pattern (under CommandBar)
```jsx
<div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-gray-100">
  <h1 className="text-lg font-semibold text-gray-900">Page Name</h1>
  {/* optional action button top-right */}
</div>
```

### Editor back-button pattern
```jsx
<div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
  <button className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
    ← Section Name
  </button>
  {/* Save / action buttons right side */}
</div>
```

---

## Section labels (micro-labels)

Used above content blocks inside panels (SITUATION, DRAFTED MESSAGE, PLAYBOOKS USED, etc.):
```jsx
<p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-1.5">
  Section Name
</p>
```

---

## Active / selected states

- Selected list row: `bg-gray-50` (not blue background)
- Selected tab / method: `backgroundColor: '#EEF5FF'`, `color: '#0063FF'`
- Highlighted card (visitor / you): `border-l-2 border-[#0063FF] bg-blue-50/30`

---

## Risk indicators

| Level | Dot color | Label |
|---|---|---|
| high | `#EF4444` | At risk |
| medium | `#F59E0B` | Watch |
| low | `#9CA3AF` | Stable |

```jsx
<span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors[level] }} />
```

---

## Animations

- Scanning pulse: `animate-pulse` on a `w-1.5 h-1.5 rounded-full` dot in `#0063FF`
- Loading spinner: `w-6 h-6 border-2 border-t-transparent rounded-full animate-spin` in `#0063FF`
- Skeleton: `animate-pulse bg-gray-200 h-5 w-16`
- Toggle slide: `transition-transform duration-200`

---

## What NOT to do

- ❌ No `rounded-md`, `rounded-lg`, `rounded-xl` on cards, inputs, buttons (only pill toggles)
- ❌ No `shadow-*` — no drop shadows anywhere
- ❌ No emoji in UI chrome (section headers, nav, buttons) — only in copy/messages
- ❌ No `text-[11px]` — it's between two scales, pick one
- ❌ No green/yellow/coral for text on white bg — illegible
- ❌ No hover background change on primary buttons — use `hover:opacity-80` only
- ❌ No `cursor-not-allowed` alone — pair with `disabled:opacity-50`
