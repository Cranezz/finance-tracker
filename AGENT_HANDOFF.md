# Finance Tracker — Agent Handoff Document

> **Purpose:** This document captures everything done in the development session that produced versions **v2026.6.1 → v2026.6.7**. It is written for the *next* AI agent (or developer) who picks up this project. Read it fully before making changes.

---

## 1. Project Overview

**What it is:** A personal finance tracker PWA for a single user. It is a **single self-contained `index.html` file** (~1950 lines) with inline `<style>` and `<script>`. No build step, no framework, no dependencies. Plain vanilla JS + localStorage.

**Repo:** `Cranezz/finance-tracker` (GitHub). Git user is `Cranezz`.
**Working dir:** `C:\Users\kille\OneDrive\Documents\GitHub\finance-tracker`
**Platform:** Windows 11, PowerShell primary shell (Bash tool also available).
**Hosting:** Served as a PWA (has `manifest.json`, apple-mobile-web-app meta tags). User runs it on an iPhone. Deployed by pushing to `main` (GitHub Pages-style).

### ⚠️ Critical operating constraints
1. **NEVER delete or clear the user's data.** They have real financial data in localStorage (key: `financeData`). Every request reiterates this. Only the explicit "Clear All Data" button (with DELETE confirmation) may remove data, and the user triggers that themselves.
2. **Bump the version number on EVERY change.** The user explicitly demanded this ("also remember to change the version number every single time"). Version lives in the Settings tab near the bottom: search for `v2026.` — it appears as `<div style="font-size:18px;...">v2026.X.Y</div>`. Also update the "Last updated" line if the month changes.
3. **The user gets paid WEEKLY, on FRIDAYS.** All bill/paycheck math must assume weekly Friday paychecks. This was hard-won knowledge — see bug history.
4. **No PR workflow exists.** All commits go **directly to `main`**. The `gh` CLI is **NOT installed** on this machine (`gh: command not found`, `where gh` → not found). Several `/create-pr` attempts failed for this reason. Just commit + push to main. If the user wants PRs, they'd need to install GitHub CLI (`winget install GitHub.cli`) and adopt a feature-branch workflow.
5. Commit message convention used this session ends with: `Co-Authored-By: Claude <noreply@anthropic.com>` style trailers. Keep version in the commit subject, e.g. `v2026.6.7 — short description`.

---

## 2. Data Model (localStorage key `financeData`)

```js
{
  version: 2,
  setupComplete: false,
  categories: {
    emergencyFund:  { label, balance, goal:10000, percent:25, goalMet, redirectTo:'weddingFund',    icon:'🛡️', type:'savings' },
    weddingFund:    { label, balance, goal:30000, percent:25, goalMet, redirectTo:'collegeSavings', icon:'💍', type:'savings' },
    collegeSavings: { label, balance, goal:null,  percent:20, goalMet, redirectTo:null,             icon:'🎓', type:'savings' },
    food:           { label, balance, goal:null,  percent:10, goalMet, redirectTo:null,             icon:'🍔', type:'spending' },
    fun:            { label, balance, goal:null,  percent:10, goalMet, redirectTo:null,             icon:'🎮', type:'spending' },
    clothing:       { label, balance, goal:null,  percent:5,  goalMet, redirectTo:null,             icon:'👕', type:'spending' },
    misc:           { label, balance, goal:null,  percent:5,  goalMet, redirectTo:null,             icon:'📦', type:'spending' },
  },
  paychecks: [ { id, date:'YYYY-MM-DD', grossAmount, splits:{key:amount}, percents:{key:pct}, billContributionsTotal, mode? } ],  // newest first (unshift)
  expenses:  [ { id, date, amount, category, note, isBill?, billId? } ],  // newest first
  checkingBalance: 0,
  transfers: [ { paycheckId, items:[{key, amount, checked}], v2? } ],  // newest first
  bills:     [ { id, label, amount, intervalWeeks|intervalMonths, dayOfMonth, category, active, lastApplied, reserveBalance } ],
}
```

### Key constants
- `ALL_KEYS = ['emergencyFund','weddingFund','collegeSavings','food','fun','clothing','misc']`
- `SAVINGS_KEYS = ['emergencyFund','weddingFund','collegeSavings']`
- `SPENDING_KEYS = ['food','fun','clothing','misc']`

### Bill object detail
- `intervalWeeks` XOR `intervalMonths` set (the other is `null`). Frequency encoded in modals as `'w1','w2','w4'` / `'m1','m2','m3','m6','m12'` via `billFreqValue`/`parseFreqValue`.
- `dayOfMonth` only meaningful for month-based bills (1–28 enforced).
- `lastApplied`: for month bills it's `'YYYY-MM'`; for week bills it's `'YYYY-MM-DD'`. `null` = never applied (new bill).
- `reserveBalance`: **NEW this session.** Running total of money set aside (sinking fund). Added via `migrateData`.
- `category`: **As of v2026.6.7 this is DISPLAY/ICON ONLY.** It no longer affects where bill money is deducted (see bug #9).

### Tabs (DOM order matters — `switchTab(n)` indexes by DOM position)
0 = Dashboard, 1 = Paychecks, 2 = Goals, 3 = Settings, 4 = Analytics.
⚠️ **Gotcha:** Analytics tab HTML must remain the LAST `.tab-content` in the DOM. It was initially inserted before Settings and broke tab indexing; it was moved to after Settings/before `</main>`. Keep DOM order == tab index order.

---

## 3. Everything That Was Built / Changed This Session

The session began at **v2026.3.3** and ended at **v2026.6.7**. Original user request had 5 parts; the rest were bug-fix iterations.

### Feature A — Bill Sinking Fund system (the big one)
**User goal:** Don't get surprised by bills. Instead of paying the full bill at once and going negative, set aside a fraction of each bill every paycheck so the money is ready when due. Examples the user gave: "$20/month bill → $5 each weekly paycheck"; "$100 every 3 weeks → $33.33/week"; "$50 every 2 months → $50/8 per week."

**How it works now (final state, v2026.6.7):**
- Each bill accumulates a `reserveBalance`.
- On each paycheck (`processNewPaycheck`): for every active bill, `billPaycheckContribution(bill)` is added to `bill.reserveBalance` (capped at `bill.amount`). The **sum** of all contributions is taken **off the top** of the gross BEFORE the percentage split. `billContributionsTotal` is stored on the paycheck record.
- The remaining `(gross − billContributionsTotal)` is split by category percentages.
- When a bill's due date arrives (`processDueBills`, runs on `init`): the bill amount is **deducted from checking only**, and `reserveBalance` resets (minus the bill amount). An expense record is logged with `isBill:true`.
- **The reserved money physically lives in the checking balance.** It's just earmarked. The dashboard shows "💸 $X reserved for bills · $Y available to spend."

**Per-paycheck contribution math (final, v2026.6.6):**
```
needed     = bill.amount − reserveBalance            // remaining, self-correcting
paychecks  = fridaysUntilDate(nextDueDate)           // count actual Fridays from today→due
perPaycheck = needed / paychecks
```
`fridaysUntilDate()` advances to this week's Friday (counts today if it's Friday), then counts each Friday ≤ due date. Always ≥ 1.

### Feature B — Transfer/Checking bug fix
See bug #1 below. This was the #1 original complaint.

### Feature C — Analytics tab (tab 4, 📊)
New 5th nav button + tab. Contains:
- **Summary stat cards** (2×2 grid): Total Earned, Total Spent, Total Saved, Avg Paycheck.
- **Spending by Category**: horizontal bars, all-time, sorted desc.
- **Monthly Spending**: SVG bar chart, with `6 Mo` / `All` filter toggle (`setAnalyticsFilter`). Built from `data.expenses` grouped by `YYYY-MM`.
- **Paycheck History**: SVG bar chart of last 12 paychecks.
- **Recent Transactions**: last 20 expenses.
- Charts are hand-rolled inline SVG (no chart library). Functions: `renderAnalytics`, `renderMonthlyChart`, `renderPaycheckChart`, `fmtC` (compact `$1.3k` formatter).
- Bars have `onclick="alert(...)"` showing the exact amount (mobile-friendly tap-to-read) and a compact `$Nk` label above each bar.
- `renderAnalytics()` is called from `renderAll()` only when `activeTab===4`, and from `switchTab(4)`.

### Feature D — Bill UI redesign (dashboard "Bills & Sinking Funds" section)
- Renamed section from "Monthly Bills" → "Bills & Sinking Funds".
- Each bill card (`.bill-fund-item`) shows: name + icon, due date + "Nd away", "$reserve saved of $amount needed", a progress bar, and "N paychecks before this bill · ~$X/paycheck".
- **Status badges were REMOVED** entirely (user demand — see bug #3).

### Feature E — Nav expanded 4→5 tabs
CSS grid changed `repeat(4,1fr)` → `repeat(5,1fr)`; font/padding shrunk slightly to fit.

---

## 4. Bug History — every bug, the fix, and what DIDN'T work

This is the most important section. Many bugs took **multiple iterations**. The math bugs in particular were fixed wrong several times before landing.

### Bug #1 — Paycheck double-counted savings; transfer checkboxes did nothing
**Symptom (user words):** "when I add a paycheck it puts the full paycheck into my checking, then it ALSO puts the savings amount into my savings, so I have extra showing in checking and after I check the boxes it doesn't move any money."
**Root cause:** Old `processNewPaycheck` added every category's split to its balance immediately AND added full gross to checking. The transfer checklist was cosmetic (just marked `checked`).
**Fix (v2026.6.1):**
- `processNewPaycheck`: full gross → checking; **spending** categories credited immediately; **savings** categories NOT credited at paycheck time. Transfer record tagged `v2:true`.
- `toggleTransfer`: for `v2` transfers, checking a box moves money (checking −= amount, savings category += amount); unchecking reverses it. Goal-met celebration now fires on transfer-check, not paycheck.
- **Backward compat:** old transfer records lack `v2`, so they keep the old "just mark done" behavior. This preserved historical data integrity.
- "Already Deposited" paycheck mode (`mode:'nobalances'`) was rewritten to only credit spending buckets — no checking, no savings, no bill reserves.

### Bug #2 — Weekly set-aside amount displayed 7× too high
**Symptom:** $33.64 bill showed "~$54.16/week".
**Root cause:** `billWeeklyContribution()` already returns $/week, but display code did `perPaycheck = roundCent(weeklyRate * 7)`.
**Fix (432fa7f):** removed the `* 7`.

### Bug #3 — Bills always showed "Behind" (took 3 iterations, ended in removal)
**Symptom:** Bills the user had *just paid* showed red "Behind"/"Overdue" even with weeks of runway.
- **Attempt 1 (v2026.6.1):** status compared `reserve` vs `expectedReserve = amount*(elapsed/period)`. Threshold `expectedReserve <= 1` for the "grace" state. **Didn't work** — 1–2 days into a cycle expected was ~$1.55 > $1, so it fell through to "Behind".
- **Attempt 2 (9b50548):** "never Behind unless due within 7 days." Renamed states (Saving/On Track/Due Soon). **User still unhappy** — didn't want ANY alarming labels, and conceptually "I should never be behind, it's either saving or saved."
- **Final (ee97af2):** **Removed the status badge entirely.** Card header now just shows due date + days away. This is the current state. **Do not re-add status badges** unless the user asks.

### Bug #4 — Analytics charts showed no dollar values
**Symptom:** Bars had no numbers; user couldn't see amounts.
**Fix (432fa7f):** added compact `$Nk`/`$N` labels above each bar (`fmtC`), increased chart `padT` to make room, and added `onclick` alerts showing the exact `fmt()` amount on tap.

### Bug #5 — New bills auto-charged immediately on setup
**Symptom:** Adding a bill instantly created an expense / deducted money, and the app "thinks I've already paid a bill and I haven't."
**Root cause:** `processDueBills` with `lastApplied==null` pushed `currentYM` to `toApply` if `todayDay >= dayOfMonth` (month bills), and immediately `applyOn(today)` for week bills.
**Fix (ee97af2):** New bills now only **initialize the `lastApplied` anchor** without charging:
- Week bill, no lastApplied → set `lastApplied = today`, no charge.
- Month bill, no lastApplied → if `todayDay < dayOfMonth`, anchor to **last month** (so next due = this month); else anchor to **current month** (next due = next month). Never charge on first setup.

### Bug #6 — Gym bill showed wrong due date (45 days instead of ~12–16)
**Symptom (emphatic):** "IT SHOULD NOT BE 45 DAYS AWAY, I checked my transactions it NEVER HAPPENED, reset it."
**Root cause:** The Gym bill's `lastApplied` was already `"2026-06"` (current month) from an earlier buggy auto-charge, making `billNextDueDate` compute July 17 instead of June 17.
**Fix (a33432a):**
- `migrateData` now auto-corrects: if a **month** bill has `lastApplied === currentYM` but `todayDay < dayOfMonth` (i.e. due date this month hasn't happened yet, so it couldn't have been legitimately paid), reset `lastApplied` to the **previous month**. This self-heals on next load.
- Added a manual **"🔄 Reset Due Date"** button in the Edit Bill modal → `resetBillDueDate(id)`: clears `lastApplied` + `reserveBalance`, re-runs `processDueBills` (which re-anchors without charging).
- **Note on JS date gotcha used in the fix:** `today.getMonth()` is 0-indexed (June = 5). The code reuses that value as the *1-indexed previous month* (5 = May) deliberately. There are comments noting this. Be careful if you touch it.

### Bug #7 — Fractional weeks gave weird amounts ($4.38 for a $5 bill due in 8 days)
**Symptom:** "use common sense... it should need $5 set aside... stop doing it by days."
- **Attempt 1 (44aaeb4):** `weeksLeft = Math.max(1, Math.floor(daysUntil/7))`. This counted only whole *future* weeks and **introduced bug #8**.

### Bug #8 — Bill fully funded in ONE paycheck when it should span two
**Symptom:** "my gym bill was completely set aside in one paycheck, but I actually have 2 paychecks until this bill was due, so it should take out only half."
- **Attempt 2 (03dc6a4):** `paychecksLeft = Math.floor((daysUntil-1)/7)+1` to "include the current paycheck." Mathematically closer but still day-based and fragile.
- **Final (302a33a):** Replaced all day-math with **`fridaysUntilDate(dueDate)`** — literally count the Friday paydays between today and the due date. This is the current approach and the user explicitly endorsed it ("I get paid on Fridays, use that math... how many paychecks before this bill? then that's how you do it"). **Keep this approach.** If pay schedule ever changes, generalize `fridaysUntilDate`.

### Bug #9 — Bills deducted from a category (Emergency Fund) instead of checking
**Symptom (final request):** "all my bills get taken from my checking IRL but the app says they get taken from the emergency fund... the change we made shouldn't take it from a category... can that money show in my checking account?"
**Root cause:** Legacy design: bills had a `category` and `applyOn` subtracted the bill from that category's balance (spending categories also hit checking; savings categories only hit the category).
**Fix (v2026.6.7, de86c15):**
- `processDueBills.applyOn` now deducts **from checking ONLY**. No category balance is ever touched by a bill.
- Added `totalBillReserves(d)` = sum of all `bill.reserveBalance`.
- **Checking card** (`renderDashboard`) now shows: `💸 $X reserved for bills · $Y available to spend · $Z moved to savings`, where available = `checkingBalance − totalBillReserves`.
- **Header** checking amount now shows **spendable** = `checkingBalance − totalBillReserves` (not raw checking).
- Bill category dropdowns relabeled "(icon/display only — bills are paid from checking)". The field is kept only so the bill card can show an icon.

---

## 5. Current State of Key Functions (where to look)

All in the single `<script>` in `index.html`. Approximate anchors (line numbers drift — grep the function name):

| Function | Purpose |
|---|---|
| `freshData()` | Initial data shape. |
| `migrateData(d)` | Runs on every load. Adds `reserveBalance`, ensures `transfers`, and **auto-heals** mis-anchored monthly bills (bug #6). |
| `processNewPaycheck(d, gross)` | Bill reserves off the top → split remainder → spending credited now, savings via transfers → full gross to checking. |
| `processDueBills(d)` | On init. Applies due bills **from checking only**; resets reserves; logs expenses. New bills just anchor `lastApplied`. |
| `toggleTransfer(idx)` | v2 transfers physically move checking↔savings. |
| `billNextDueDate(bill)` | Next due `Date` from `lastApplied` + interval. |
| `fridaysUntilDate(dueDate)` | **Core of the sinking-fund math.** Counts Friday paychecks today→due. |
| `billWeeklyContribution(bill)` | `(amount − reserve) / fridaysUntilDate(next)`. Self-correcting on remaining balance. |
| `billPaycheckContribution(bill)` | One paycheck's share, capped at remaining needed. |
| `totalBillReserves(d)` | Sum of reserves (earmarked checking). |
| `renderBills()` | Dashboard + settings bill lists. No status badges. |
| `renderDashboard()` | Checking card breakdown lives here. |
| `renderHeader()` | Header shows spendable checking. |
| `renderAnalytics()` / `renderMonthlyChart()` / `renderPaycheckChart()` / `fmtC()` | Analytics tab. |
| `resetBillDueDate(id)` | Manual due-date reset button handler. |

---

## 6. Version / Commit Log This Session

```
de86c15 v2026.6.7 — bill reserves live in checking, not categories          (bug #9)
302a33a v2026.6.6 — use actual Friday paycheck count for bill contributions  (bug #8 final)
03dc6a4 v2026.6.5 — fix paycheck-count formula to include current paycheck   (bug #8 attempt)
a33432a v2026.6.4 — auto-fix incorrectly paid bills + Reset Due Date button   (bug #6)
44aaeb4 v2026.6.3 — fix per-paycheck rate to use whole weeks not fractional   (bug #7 attempt)
ee97af2 v2026.6.2 — fix bill auto-charge, dynamic weekly rate, remove badge   (bugs #3 final, #5)
9b50548          — Fix bill status: never Behind unless due within 7 days     (bug #3 attempt 2)
432fa7f          — Fix bill status, weekly rate 7x bug, analytics labels       (bugs #2, #3 attempt 1, #4)
c13b8d9 v2026.6.1 — Add bill sinking funds, fix transfer bug, add Analytics    (features A–E, bug #1)
```
(Note: two fix commits between v2026.6.1 and v2026.6.2 did not carry a version bump in the subject — the user then insisted on always bumping the version, which is why every subsequent commit has one. **Follow the always-bump rule.**)

---

## 7. Receipt Scanning (pre-existing, untouched this session)
- Two flows: camera photo and pasted text, both → Claude API.
- Calls go through a **Cloudflare Worker proxy** at `https://rough-bush-c143.killerclown73242.workers.dev` (avoids CORS; forwards to Anthropic). The user's Anthropic API key is stored in localStorage (`anthropicApiKey`) and sent as `x-api-key`.
- Model used: `claude-haiku-4-5-20251001`.
- A service-worker-unregister block runs on load to prevent stale SWs from intercepting API calls. Leave it.

---

## 8. Gotchas & Advice for the Next Agent

1. **Single-file edits.** Everything is `index.html`. Use exact-string `Edit`. The file is large — grep for anchors rather than reading top-to-bottom.
2. **Don't reintroduce removed things.** Status badges were deliberately removed. Bill→category deduction was deliberately removed. The `expectedReserve` status math is gone.
3. **Math must be Friday-based.** Don't "simplify" `fridaysUntilDate` back into `days/7` — that path caused bugs #7 and #8. The user paid close attention to these numbers and will notice.
4. **`reserveBalance` self-corrects.** Because contribution = `(amount−reserve)/paychecksLeft`, partial progress is handled automatically; the next paycheck divides the *remaining* over the *remaining* Fridays. No special "already partially saved" handling needed (the user asked about this; it already works).
5. **Verify, don't assume, on date logic.** Today's date in this session was around **2026-06-26** per system context, but screenshots showed various dates (the app uses the real device clock). Date bugs are easy to introduce; test mentally against a concrete date.
6. **localStorage migrations run on every load** via `migrateData`. Make migrations idempotent and never destructive.
7. **The user tests on a real iPhone** and pastes screenshots. Expect terse, results-focused feedback ("it still says X"). Read the screenshot numbers carefully — they're the ground truth.
8. **Commit + push to `main` directly.** No PRs (no `gh`). Always bump the version. Always preserve data.

---

## 9. Possible Future Work (mentioned or implied, not done)
- Generalize pay schedule beyond Fridays (currently hard-coded to Friday in `fridaysUntilDate`).
- The "Already Deposited" paycheck mode skips bill reserves — confirm that's still desired now that reserves live in checking.
- Analytics could add savings-over-time and bill-reserve trends.
- Consider showing each bill's reserve as a line item somewhere more prominent than the dashboard meta text.
- A real feature-branch + PR workflow if the user installs `gh`.

---

## 10. Session v2026.8.0 → v2026.8.1 — Paycheck Funds (gas)

**User request:** "I need a spot in my app for gas… instead of a percentage of my paycheck you take out a certain amount. Let me edit this amount somewhere, kind of like the bills but in a separate area… change the amount and how often, like every paycheck, every other paycheck… this doesn't calculate by calendar but by paycheck. Take out $25 each paycheck." Plus two questions: can the app pull transactions straight from his bank, and can he get an area for his investing account.

### What was built — "Paycheck Funds"
A second set-aside system, deliberately separate from Bills. Bills answer *"a known charge is coming on a date"*; funds answer *"take a flat $X out every N paychecks."* No due dates, no calendar math — the schedule is a countdown in paychecks.

**Data model (`data.funds`, plus `data.fundsSeeded`):**
```js
{ id, key, label, icon, amount, everyN, paychecksUntilNext, active, totalContributed, scanHint? }
```
- **A fund's balance is NOT on the fund object.** It lives in `data.categories[fund.key].balance`, registered by `ensureFundCategories()` as a pseudo-category (`isFund:true`, `type:'spending'`, `percent:0`). That's the key design decision: every existing expense path (`logExpense`, `saveEditExpense`, `deleteExpense`, analytics, recent-purchases list) works on funds with **zero** special-casing. The fund object holds only the schedule.
- Fund keys are **not** in `ALL_KEYS`, so `resolvePercents`, the % settings editor, and the paycheck split never see them.
- Money stays in checking, earmarked, until it's spent; purchases are logged against the fund like a bucket.
- Fund balances are earmarked inside checking exactly like bill reserves: header + dashboard spendable = `checking − totalBillReserves − totalFundReserves`. A negative (overspent) fund is floored at 0 there so it can't inflate spendable money.

**Scheduling:** `paychecksUntilNext` counts down on every paycheck. 0 = contributes on the next one, then resets to `everyN − 1`. Contributions come **off the top** alongside bill reserves, before the % split. The paycheck record stores `fundContributionsTotal` + `fundContributions:[{fundId,key,amount}]` so `deletePaycheck` reverses the exact amounts (`reverseFundContributions`); countdowns are only restored precisely when the deleted paycheck was the newest one, which is noted in the code.

**Seeded on first load:** a Gas fund — $25, every paycheck, ⛽ — guarded by `data.fundsSeeded` so a deleted Gas fund never comes back. ($25/wk ≈ $108/mo; the user's gas is $205/mo and his parents cover every other fill-up.)

**UI:** "Paycheck Funds" section on the dashboard between Spending Buckets and Bills (reuses the `.bill-fund-*` classes), a management card in Settings, an add/edit modal (name, icon, amount, how-often select, balance correction, "take it out of my next paycheck", active, delete), a "Log a purchase" shortcut on each fund, and a per-fund line in the paycheck breakdown + delete-paycheck reversal list.

**Also wired in:** `catOptions` now appends active funds (and keeps an unknown selected key so editing an old purchase can't silently re-categorize it — this is why `spendingCatOptions` is now just a delegate); gas keywords in `guessCategory` (fund names are matched first); `fundScanCategoryLines()` injects fund categories into both receipt-scanner prompts, so a fill-up scans straight into the Gas fund.

### Gotchas for the next agent
1. **Never store a fund balance on the fund object.** Two sources of truth for money is how you get drift. `fundBal(d,f)` / `addToFund(d,f,amt)` are the only accessors.
2. **Deleting a fund keeps its pseudo-category.** Historical expenses still point at that key and must keep rendering. The money stays in checking (it was always there) and simply stops being earmarked.
3. `ensureFundCategories(data)` must be called after any fund add/edit — `submitFund` does it.
4. Funds are skipped by the "Already Deposited" paycheck mode, matching how that mode already skipped bill reserves.
5. Tested headlessly (contribution math, every-other-paycheck cadence, paycheck deletion reversal, migration of pre-fund data, idempotency) and rendered in Chromium at iPhone width.

### Answered, not built
- **Bank connection:** not possible from this app as it stands. A static `index.html` on GitHub Pages has no server, and aggregators (Plaid/Teller/MX) require a backend to hold secrets plus a business agreement — an API key in localStorage would be exposed. The offered path is a **CSV/OFX import**: export transactions from the bank, paste or upload, auto-categorize into buckets and funds. Not built this session.
- **Investing account:** **dropped at the user's request** in v2026.8.1. v2026.8.0 had shipped a second fund kind (`kind:'external'`) for money moved out to a brokerage, with an "I moved it" button and a `totalMovedOut` counter. The user's follow-up: *"Get rid of the investing thing, that was only if I could connect the banks account."* All of it is gone — the Kind selector, `moveFundOut()`, `spendFunds()` (now just `activeFunds()`), and the external branches in `renderFunds`. `migrateFunds` deletes a stale `kind` field, so a fund created under v2026.8.0 keeps its money and becomes an ordinary set-aside fund rather than being destroyed. **Don't re-add a fund kind unless the user asks** — and note the request was conditional on bank syncing, so it may come back if a CSV/bank-import path ever lands.

---
*End of handoff. When you finish your work, append your own session's changes/bugs to this file so the chain of context continues.*
