# Finance Tracker — Visual Redesign Brief

> The prompt this redesign was built from. Written before any code changed, so
> the result can be checked against it.

---

## The ask, restated

Redesign **how the app looks and feels**. Change nothing about **what it does**:
every number, rule, data field, sync behaviour and paycheck calculation stays
exactly as it is. The app has grown feature by feature and now reads as a stack
of same-looking cards; it should feel like one designed product.

- **Primary device:** iPhone Pro Max class — 15 Pro Max (430 × 932 pt) and the
  current Pro Max generation (440 × 956 pt). Must still hold together at the
  standard 393 pt width.
- **Installed as a home-screen web app**, so it owns the whole screen: status
  bar, Dynamic Island and home indicator are all in play.
- **Professional and easy** — the one-handed, glanceable feel of a good native
  banking app.
- **Its own identity** — explicitly *not* the default "AI app" look.

## What "generic AI app" means here, so we can avoid it

The current app is the template: near-black background, a purple/indigo accent,
a purple gradient hero card, emoji as icons, every section the same rounded
dark card, uppercase grey labels everywhere. None of that survives.

## Identity: *Ledger & Envelope*

Two ideas the app already believes in, made visible:

1. **The ledger.** Warm paper, dark ink, hairline rules, figures that line up.
   Money feels considered, not gamified. The accent is a deep **ledger green** —
   the colour of an old bank book, not a neon fintech green.
2. **The envelope.** Dave Ramsey's cash-envelope system is literally how this
   app budgets. So spending buckets are drawn as **envelopes**: a card with a
   faint flap across the top and a fill line along the bottom showing how much
   of the week's allotment is left. That one motif is the signature — it means
   something, it isn't decoration.

Light mode is warm paper. Dark mode is a warm charcoal ledger (not blue-black),
chosen as its own palette rather than an automatic inversion. The app follows
the phone's setting.

## Design tokens

### Colour — light / dark

| Role | Light | Dark | Use |
|---|---|---|---|
| Page | `#F2EEE5` | `#11100E` | screen background |
| Surface | `#FFFCF5` | `#1C1A17` | cards, sheets |
| Inset | `#F7F2E8` | `#25221E` | inputs, wells, tracks |
| Ink | `#1B1A17` | `#F3EEE4` | primary text, figures |
| Ink 2 | `#57524A` | `#C3BCAF` | secondary text |
| Ink 3 | `#6E675C` | `#8F887C` | captions, axes |
| Rule | `#E4DDCF` | `#2E2A25` | hairlines |
| Accent | `#1E6B52` | `#5FBF95` | buttons, active state, links |
| Negative text | `#B3261E` | `#F08A7E` | overspent amounts (always with a minus sign and an "Over" tag — never colour alone) |

Every text colour clears WCAG AA (4.5:1) on every surface it sits on, in both
modes — checked, not assumed. (The first caption grey, `#8C857A`, measured 3.56:1
on light paper and was darkened.)

Positive balances are **ink**, not green. A balance isn't "good" just because
it's above zero; colour is reserved for what needs attention.

### Colour — where the paycheck goes (validated)

The one categorical palette in the app, used by the paycheck flow bar and the
"where your checking is" bar. Ordered to match Ramsey's sequence. **Checked with
the colour-vision validator in both modes — not eyeballed.**

| Slot | Meaning | Light | Dark |
|---|---|---|---|
| 1 | Giving | `#7B52C9` | `#9173E0` |
| 2 | Saving | `#16875F` | `#1B9A6A` |
| 3 | Four Walls (bills, flat buckets, targets) | `#D98A14` | `#C27612` |
| 4 | Spending | `#2D6FCF` | `#4A82DA` |

Validator results: light — all checks pass, worst adjacent colour-blind ΔE 11.0,
normal-vision ΔE 24.2; dark — all pass, worst colour-blind ΔE 8.8. Light amber
sits under 3:1 against the surface, so **every bar ships with a legend carrying
the values** (the validator's "relief" rule). A rose was tried for giving and
rejected: it merged with green under deuteranopia.

Single-series charts use one hue, with the current period emphasised and the
rest recessive — never a rainbow of categories.

### Type

The system face (SF Pro on iPhone) throughout — native, crisp, no download,
works offline. No serif or display face, including on the big number.

| Style | Size / weight | Use |
|---|---|---|
| Hero figure | 52 / 700, −0.03em | exactly one per screen |
| Large title | 34 / 700 | screen title; shrinks on scroll |
| Title | 22 / 700 | card leads, sheet titles |
| Headline | 17 / 600 | row titles |
| Body | 16 / 400 | text, **all inputs** (≥16 stops iOS zooming) |
| Footnote | 13 / 400 | row detail |
| Eyebrow | 11 / 600, +0.08em, caps | section labels |

Big standalone numbers use proportional figures; columns of numbers use
`tabular-nums` so they line up.

### Space, shape, depth

- 4-pt grid. 20-pt screen gutters (native Pro Max margin).
- Card radius 22, inner controls 14, pills fully round.
- Depth from **hairlines**, not shadows. One soft shadow in light mode only,
  for floating things (the + button, sheets).
- Touch targets ≥ 44 × 44 pt.

## Components

- **Large-title header.** Date eyebrow, screen title, and a compact
  "Spendable / Saved" readout on the right that's visible on every screen. The
  title shrinks as you scroll; a hairline appears under it.
- **Tab bar.** Five equal columns spanning the full width, drawn line icons
  (no emoji), labels under each. The active tab gets a pill that slides between
  tabs. Sits above the home indicator.
- **+ button.** A single floating action button above the tab bar opens an
  **action sheet**: Log purchase, Add paycheck, Deposit, Withdraw.
  (Receipt scanning was removed in v2026.12.1.) This replaces the three stacked "Log a purchase" buttons
  and the Deposit/Withdraw pair — the biggest decluttering win.
- **Bottom sheet.** Every form opens in a sheet with a grab handle that slides
  up, and can be swiped down to dismiss.
- **Envelope card.** Spending bucket: icon stamp, name, balance, fill line.
- **Row.** Icon stamp · title + detail · figure on the right · optional meter.
  Used for savings goals, targets, bills, purchases, paychecks, settings.
- **Meter.** Thin track in the inset colour, fill in accent; overspent reads
  as empty with an "Over" tag.
- **Section rule.** Eyebrow label with a hairline running to a right-aligned
  total — like a ledger column heading.
- **Settings.** iOS grouped lists: eyebrow headers over rounded groups.

## Screens

- **Home** — Hero: *Safe to spend* (checking minus what's promised to bills and
  targets), counting up to its value. Under it a thin bar showing where checking
  is: targets · bills · free. Then three small tiles: In checking, Saved, Last
  paycheck. Then Envelopes (2-up grid), Savings, Coming up (targets + bills),
  Recent.
- **Paychecks** — Enter paycheck. The latest paycheck as its own card with the
  flow bar (giving → saving → four walls → spending) and legend, the detail
  table under it, transfers to check off, history.
- **Goals** — the Ramsey order as a short callout, targets, savings goals with
  ETAs, envelope budgets.
- **Insights** (was Analytics) — four stat tiles, spending by category (one hue,
  sorted), monthly spending and paycheck history as columns with the current
  bar emphasised, tap-for-value tooltips, and a "see the numbers" table under
  each chart.
- **Settings** — grouped lists, same content.

## Motion — purposeful, and off when the phone asks

- Hero and tile figures count up to new values.
- Meters grow from zero when a screen draws.
- Sheets slide up on a spring-like curve and follow your finger down.
- Tab indicator slides; header title compacts on scroll.
- Presses give a small scale-down.
- **`prefers-reduced-motion` turns all of it off.**

## Hard constraints — the redesign must not break these

1. **No logic changes.** Data model, paycheck order, sync, migrations, and every
   calculation are untouched. Only markup-producing code and CSS change.
2. **Every element ID the script reads stays** — 50 of them (`dash-*`,
   `settings-*`, `analytics-*`, `modal-*`, `header-balance`,
   `header-checking-amt`, `transfer-*`, `sync-*`, …).
3. **Tab panels stay in DOM order 0–4.** `switchTab(n)` indexes by position.
4. **`switchTab` and `showModal` overwrite `className`** on nav buttons, tab
   panels and the modal overlay — style those only through their base class/ID.
5. Every existing test (paycheck order, targets, two-phone sync fuzz, migration)
   must still pass, and a UI smoke test must show zero console errors.
6. The previous version is preserved on GitHub before any of this lands.
