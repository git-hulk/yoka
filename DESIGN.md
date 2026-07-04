# Design

Linear-language light UI: cool green-tinted neutrals, crisp 1px hairlines,
compact controls, a single sans family, layered low-alpha shadows. All colors
live in `frontend/tailwind.config.js`; never introduce ad-hoc hex codes in
components.

Reference: the community "Linear Design System" Figma file
(figma.com/design/CNXYRgL0onSP4xDkCPxoE6, dark mode, indigo brand). We port
its system logic, not its hexes: neutrals tinted toward the brand hue (theirs
purple, ours green), a three-step text ramp (their #EEEFFC/#B0B5C0/#858699 →
our ink/ink-dim/ink-faint), low-delta hairline dividers, a brand ramp with
core/hover/soft-wash steps, and a categorical "decoration" palette separate
from the brand color (their teal/blue/purple/orange/red/grey → our identity
palette in `src/lib/colors.ts`, darkened for AA text on white).

## Theme

Light only. Scene: a household member glances at pace and spend on a laptop
in daylight; content sits on white, chrome (sidebar, table headers, page
background) sits on a barely-gray canvas so panels read as the foreground.

## Color

Neutrals are tinted toward the brand green hue (very low chroma), never pure
gray or pure black.

| Token | Value | Role |
|---|---|---|
| `ink` | `#232826` | Primary text |
| `ink-dim` | `#5F6B65` | Secondary text (AA on white) |
| `ink-faint` | `#8B968F` | Tertiary text, meta labels |
| `canvas` | `#F9FAF9` | App chrome: sidebar, auth pages, out-of-month cells |
| `surface` | `#FFFFFF` | Content panels, cards, modals |
| `subtle` | `#F2F4F3` | Hover wash, zebra rows, table headers |
| `hairline` | `#E4E7E5` | All 1px borders and dividers |
| `accent` | `#15803D` | Brand green: primary action, selection, live state |
| `accent-soft` | `#15803D14` | 8% green wash for active nav / selected items |
| `pace-green` | `#15803D` | Burndown health: on pace |
| `pace-amber` | `#A16207` | Burndown health: behind |
| `pace-red` | `#C22F2F` | Burndown health: at risk / expired |
| `track-*` | 8% washes | Pill and bar fills for each pace color |

Pace colors are semantic (burndown health), not brand. Categorical identity
colors (per-subscription dots, currency bars) come from `src/lib/colors.ts`
and the chart palettes: cool mid-dark hues (blue, teal, violet, amber, rose,
slate), all legible as text on white.

## Typography

- One family: Inter (with metric-adjusted local fallback). No serif, no
  display face, no italics ever.
- Body letter-spacing -0.01em; headings add `tracking-tight`.
- UI text is 13–14px (`text-sm`), meta 11–12px (`text-xs`), page titles
  `text-xl font-semibold`. Weight carries hierarchy (400/500/600), not size
  jumps.
- All numerals in data contexts use the `num` class (tabular).

## Depth & radius

- Borders first: 1px `hairline` defines every container edge.
- `shadow-card` (1px low-alpha) for resting panels that need lift.
- `shadow-pop` for menus/popovers, `shadow-modal` for dialogs. Shadows are
  cool, layered, low alpha; never a single heavy drop shadow.
- Radius: 6px (`rounded-md`) on controls and chips, 8px (`rounded-lg`) on
  containers, popovers, and modals.

## Components

- Buttons: 32px (`h-8`) height, `rounded-md`, `text-sm font-medium`.
  Primary is solid accent with darker hover; secondary is white with a
  hairline border and `subtle` hover. Every control has hover, focus
  (accent outline), and disabled states.
- Lists are bordered tables: `rounded-lg border border-hairline` container,
  `subtle` header band, `divide-hairline` rows, row hover `bg-subtle`.
- Status pills: tinted wash + hairline-tinted border + glyph mark
  (dot / ring / square / cross) so status never relies on color alone.
- Skeletons (pulsing `bg-ink/5` blocks) for loading, never spinners
  mid-content.

## Motion

100–200 ms, exponential ease-out only. Existing keyframes (`modalIn`,
`chipIn`, `rowIn`, `gridIn`, `breathe`) are the full vocabulary; motion
conveys state change, never decoration. `prefers-reduced-motion` disables
everything.
