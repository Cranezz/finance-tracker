# Sharing the app between two phones

This sets up one shared copy of your data in **a Google Sheet you own**, so your
phone and your fiancée's phone show the same numbers. The Sheet holds every
number and setting on its own row, and both phones copy it exactly.

> **Already set up sharing before November 2026?** You only need
> [Updating the script](#updating-the-script) below.

Do the setup once, on a computer (about 10 minutes). After that it's two taps on
each phone.

---

## What you're building

```
   Your phone  ─┐                                    ┌─ a Google Sheet
                ├─→  Apps Script web app  ──────────→│  in YOUR Drive
   Her phone   ─┘     (the bit you deploy)           └─ ('Shared values' + 'Phones' tabs)
```

Nothing goes to me or to GitHub. No password or API key is stored in the app.
The Sheet lives in your Google Drive and you can open it and look at it any time.

---

## Step 1 — Make the Sheet

1. Go to <https://sheets.google.com> and create a **blank spreadsheet**.
2. Name it something like `Finance Tracker Sync`.

You don't need to add any tabs or headers. The script creates them on first use.

## Step 2 — Add the script

1. In that Sheet, click **Extensions → Apps Script**.
2. Delete whatever is in the editor (`function myFunction() {}`).
3. Open [`apps-script/Code.gs`](apps-script/Code.gs) from this repo, copy the
   **whole file**, and paste it in.
4. Click the **save** icon (💾).

## Step 3 — Deploy it

1. Click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description:** anything, e.g. `finance sync`
   - **Execute as:** **Me** (your own account)
   - **Who has access:** **Anyone**
4. Click **Deploy**.
5. Google asks you to authorise it. Click **Authorize access**, pick your
   account, and on the "Google hasn't verified this app" screen click
   **Advanced → Go to (your project name)** → **Allow**. This is normal for a
   script you wrote yourself.
6. Copy the **Web app URL**. It ends in `/exec` and looks like:

   ```
   https://script.google.com/macros/s/AKfycb..../exec
   ```

> **"Who has access: Anyone" — is that safe?**
> It means anyone who knows the URL can *talk to* the script, but the script
> only answers requests carrying your 12-character pairing code. Anyone without
> the code gets nothing back. Treat the invite code like a password: don't post
> it anywhere public. If it ever leaks, see "Starting over" below.

## Step 4 — Connect your phone

1. Open the app → **Settings → 📡 Share With Another Phone → Set Up Sharing**.
2. Paste the Web app URL into **First Phone — Set It Up**.
3. Tap **Connect This Phone**.

Your current data becomes the shared copy. A backup of what was on the phone is
kept in the phone's storage first, just in case.

## Step 5 — Connect her phone

1. On your phone, tap **Copy Invite Code** and text it to her.
2. On her phone, open the app → **Settings → 📡 Share With Another Phone**.
3. Paste the code under **Second Phone — Join** and tap **Join**.

Her phone replaces whatever it had with the shared data (also backed up locally
first). From then on both phones stay in step.

---

## Updating the script

Sharing version 2 (app v2026.13.0 and later) needs the new script — and the
hourly Sheet backups need the version from v2026.13.1 or later. Do this once, on a
computer, with the Sheet you already use:

1. Open the Sheet → **Extensions → Apps Script**.
2. Select everything in the editor and delete it. Open
   [`apps-script/Code.gs`](apps-script/Code.gs) from this repo, copy the
   **whole file**, and paste it in. Click save (💾).
3. **Deploy → Manage deployments** → click the **pencil** icon on your existing
   deployment → **Version: New version** → **Deploy**. The URL stays the same,
   so nothing changes on the phones.
4. Update the app on **both** phones: close it completely and open it again.
   The bottom of Settings should say **v2026.13.0**.
5. Check which phone's numbers are right (compare checking and savings with the
   bank). On **that** phone, tap **Use this phone's numbers** on the Home screen.
6. Open the app on the other phone. It switches to those numbers by itself,
   and keeps a backup of what it had.

The old `ops` and `state` tabs aren't used any more; delete them whenever you
like.

---

## What's in the Sheet

- **Shared values** — the shared copy. One row per setting, balance and
  record: *What* (e.g. `Category › Food › Balance`), *Value*, when it last
  changed and which phone changed it. Sort or filter it to find anything. The
  columns after *By* are for the app; please don't edit them by hand.
- **Backups** — full copies of *Shared values*, saved at most once an hour
  while a phone is using the app. If nothing changed since the last copy, that
  copy just gets the new time instead of being saved twice. An extra copy is
  always saved right before anything that replaces or erases a lot (choosing
  "Use this phone's numbers", restoring, a big removal). Kept: everything from
  the last 48 hours, then one per day for 60 days. Restore any of them from the
  app: **Settings → Backup → See backups**.
- **Phones** — one row per phone: its name, app version, when it last synced,
  and its checking and savings totals at that moment. If the phones ever
  disagree, this shows which one and by how much. The app shows the same
  table under Settings → Share With Another Phone.

## How it behaves day to day

- **Every change is applied exactly once.** Each batch of changes carries a
  receipt number. If a phone loses signal before the Sheet answers, it sends
  the same batch again later and the Sheet recognises it.
- **The Sheet always wins.** After every sync a phone copies the Sheet's values,
  so two phones that have both synced can't disagree.

- **Updates land within about 10 seconds** while an app is open, and right away
  when you switch back to it. It is not instant — Apps Script can't push, so the
  app checks in on a timer.
- **Offline is fine.** Keep using the app on a plane or with no signal; it sends
  everything the next time it connects. Nothing is lost.
- **Both of you can edit at once.** Balances are sent as "was → is", so two
  purchases logged at the same moment both come off. Settings like names and
  percentages are last-edit-wins.
- **Bills only auto-charge once.** A phone syncs before charging, and if both
  still charge the same bill, the extra charge undoes itself.
- If something goes wrong you'll see a red banner on the dashboard with the
  reason, and Settings shows when it last synced.

## Backups

Two sets of automatic copies, both hourly, both skipping duplicates:

- **In the Google Sheet** (the *Backups* tab) — survives anything that happens
  to a phone.
- **On each phone** — works with sharing off or no signal: the 8 newest copies
  plus one per day for a week.

**Settings → Backup → See backups** lists both; **Restore** on any of them puts
everything back to that moment (on both phones when sharing is on). A copy of
the current state is saved first, so a restore can itself be undone.

**Clear all data** saves a copy first, and with sharing on it only erases the
phone you're holding and turns sharing off on it — the Sheet and the other
phone keep everything.

**Download file / Restore file** still work for keeping a copy somewhere else.

---

## If it doesn't work

**"The link did not return data"**
The URL is wrong or the deployment isn't public. Check it ends in `/exec` (not
`/dev`), and re-check **Who has access: Anyone** under Deploy → Manage
deployments.

**"Could not reach the sheet"**
Usually the authorisation step didn't finish. Open the Web app URL in a browser
— you should see `{"ok":true,...}` or a complaint about a missing code, not a
Google sign-in page.

**You changed the script after deploying**
Apps Script keeps serving the old version until you redeploy: **Deploy → Manage
deployments → pencil icon → Version: New version → Deploy**. The URL stays the
same.

**"The Google Sheet script is the old version"**
Do [Updating the script](#updating-the-script).

**"This phone's app is out of date"**
That phone is still on the old app. Close the app completely and reopen it.

**The phones show different numbers**
Open Settings → Share With Another Phone and look at the **Phones** table.
A phone with an old version or "changes waiting to send" just needs to be
opened with signal. If the numbers are really wrong, pick the phone that matches
the bank and tap **Phones don't match? Use this phone's numbers**.

## Starting over

To reset sharing (say the invite code leaked):

1. Both phones: Settings → Share With Another Phone → **Turn Sharing Off**.
   Each phone keeps its own copy of the data.
2. In the Sheet, delete the `Shared values`, `Phones` and `_receipts` tabs.
3. Set it up again from Step 4. A fresh pairing code is generated, and the old
   one stops working.
