# Sharing the app between two phones

This sets up one shared copy of your data in **a Google Sheet you own**, so your
phone and your fiancée's phone show the same numbers. Both phones can add things
at the same time — changes merge, so neither phone wipes out the other's.

Do the setup once, on a computer (about 10 minutes). After that it's two taps on
each phone.

---

## What you're building

```
   Your phone  ─┐                                    ┌─ a Google Sheet
                ├─→  Apps Script web app  ──────────→│  in YOUR Drive
   Her phone   ─┘     (the bit you deploy)           └─ (ops + state tabs)
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

## How it behaves day to day

- **Updates land within about 10 seconds** while an app is open, and right away
  when you switch back to it. It is not instant — Apps Script can't push, so the
  app checks in on a timer.
- **Offline is fine.** Keep using the app on a plane or with no signal; it sends
  everything the next time it connects. Nothing is lost.
- **Both of you can edit at once.** Money changes are sent as amounts
  ("checking −$40"), never as totals, so two purchases logged at the same moment
  both come off. Settings like names and percentages are last-edit-wins.
- **Bills only auto-charge once** even with both phones open.
- If something goes wrong you'll see a red banner on the dashboard with the
  reason, and Settings shows when it last synced.

## Keeping a backup

**Settings → 💾 Backup → Download Backup** saves a file of everything. Worth
doing before any big change. **Restore From Backup** puts one back.

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

**Her phone shows old data**
Open Settings → Share With Another Phone → **Sync Now**.

## Starting over

To reset sharing (say the invite code leaked):

1. Both phones: Settings → Share With Another Phone → **Turn Sharing Off**.
   Each phone keeps its own copy of the data.
2. In the Sheet, delete the rows in the `ops` and `state` tabs.
3. Set it up again from Step 4. A fresh pairing code is generated, and the old
   one stops working.
