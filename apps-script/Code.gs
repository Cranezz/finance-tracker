/**
 * Finance Tracker — sync backend (version 2: the sheet IS the shared copy).
 *
 * Paste this into a Google Apps Script project that is bound to a Google Sheet,
 * deploy it as a Web App ("Execute as: Me", "Who has access: Anyone"), and give
 * the /exec URL to the app. See SYNC-SETUP.md for the click-by-click version.
 *
 * Tabs it keeps:
 *   'Shared values' — every number, setting and record, one per row. This is
 *                     the true copy both phones match. Columns A–D are for
 *                     people to read; E onward are what the app uses.
 *   'Phones'        — one row per phone: app version, when it last synced, and
 *                     the checking / saved totals it had, to compare at a glance.
 *   '_receipts'     — ids of changes already applied (hidden). A phone that
 *                     didn't hear back sends the same change again with the
 *                     same id, and it is NOT applied twice.
 *
 * How a phone syncs: it sends the values it changed since it last heard from
 * the sheet, and gets back every row that changed since then. Money totals
 * (balances) are sent as "what it was → what it is now", so if both phones
 * changed the same balance, both changes land.
 */

var VALUES_SHEET = 'Shared values';
var PHONES_SHEET = 'Phones';
var RECEIPTS_SHEET = '_receipts';
var MAX_RECEIPTS = 1000;

// Columns in 'Shared values' (1-based).
var V_COLS = 8;            // What | Value | Changed | By | path | json | ver | code
var V_WHAT = 0, V_VALUE = 1, V_CHANGED = 2, V_BY = 3, V_PATH = 4, V_JSON = 5, V_VER = 6, V_CODE = 7;

// ── Entry points ───────────────────────────────────────────────────────────
function doGet(e) { return handleRequest_((e && e.parameter) || {}, null); }

// The app sends text/plain on purpose: it keeps the request "simple" so the
// browser skips the CORS preflight, which Apps Script cannot answer.
function doPost(e) {
  var body = null;
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = null; }
  return handleRequest_((e && e.parameter) || {}, body);
}

function handleRequest_(params, body) {
  var req = body || {};
  var action = String(req.action || params.action || 'ping');
  var code = String(req.code || params.code || '').trim().toUpperCase();
  if (!code) return jsonOut_({ ok: false, error: 'missing code' });

  // Phones still running the old app speak the old protocol. Tell them plainly.
  if (action === 'push' || action === 'pull' || action === 'snapshot') {
    return jsonOut_({ ok: false, error: "This phone's app is out of date. Close the app completely and open it again to update it." });
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (err) {
    return jsonOut_({ ok: false, error: 'The sheet is busy — trying again shortly.' });
  }
  try {
    if (action === 'ping') return jsonOut_({ ok: true, pong: true, v2: true, seeded: !!getEpoch_(code) });
    if (action === 'sync2') return jsonOut_(sync_(code, req));
    if (action === 'seed') return jsonOut_(seed_(code, req));
    return jsonOut_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

// Replace the shared copy with one phone's data ("use this phone's numbers").
// A new epoch tells every other phone to download it fresh.
function seed_(code, req) {
  var rows = req.rows || [];
  var sh = valuesSheet_();
  var all = readRows_(sh);
  var keep = all.filter(function (r) { return String(r[V_CODE]) !== code; });
  var rev = getRev_(code) + 1;
  var now = new Date();
  var by = deviceName_(req);
  rows.forEach(function (r) {
    keep.push(makeRow_(r.w, r.h, now, by, r.p, r.v, rev, code));
  });
  writeAll_(sh, keep, all.length);
  setRev_(code, rev);
  var epoch = String(req.epoch || ('E' + now.getTime()));
  PropertiesService.getScriptProperties().setProperty('epoch:' + code, epoch);
  if (req.pushId) addReceipt_(code, String(req.pushId), rev);
  upsertPhone_(code, req);
  return { ok: true, seeded: true, epoch: epoch, rev: rev, devices: listPhones_(code) };
}

function sync_(code, req) {
  var epoch = getEpoch_(code);
  if (!epoch) { upsertPhone_(code, req); return { ok: true, seeded: false, devices: listPhones_(code) }; }

  var sh = valuesSheet_();
  var all = readRows_(sh);
  var rev = getRev_(code);

  // This phone has an older (or no) copy: hand it the whole thing to start from.
  if (String(req.epoch || '') !== epoch) {
    upsertPhone_(code, req);
    return { ok: true, seeded: true, reset: true, epoch: epoch, rev: rev, rows: rowsSince_(all, code, 0, true), devices: listPhones_(code) };
  }

  var index = {};
  for (var i = 0; i < all.length; i++) {
    if (String(all[i][V_CODE]) === code) index[String(all[i][V_PATH])] = i;
  }

  var changes = req.changes || [];
  var pushId = String(req.pushId || '');
  var already = pushId && hasReceipt_(code, pushId);
  var touched = {}, firstNew = all.length;

  if (changes.length && !already) {
    var newRev = rev + 1, now = new Date(), by = deviceName_(req), any = false;
    changes.forEach(function (c) {
      var p = String(c.p);
      var at = index[p];
      var row = at === undefined ? null : all[at];
      var cur = row ? String(row[V_JSON]) : '';
      var next;
      if (c.v === null || c.v === undefined) {
        next = '';                                          // removed
      } else if (typeof c.d === 'number' && row && cur !== '' && isNumberJson_(cur)) {
        // A money total: apply the change, so the other phone's change survives.
        next = JSON.stringify(round2_(Number(cur) + c.d));
      } else {
        next = String(c.v);
      }
      if (row && cur === next) return;                      // nothing to do
      if (!row && next === '') return;                       // removing something that isn't there
      var cells = makeRow_(c.w || (row && row[V_WHAT]) || p, next === '' ? '(removed)' : (c.h !== undefined ? c.h : next),
                           now, by, p, next, newRev, code);
      if (row) { all[at] = cells; touched[at] = true; }
      else { index[p] = all.length; all.push(cells); }
      any = true;
    });
    if (any) { rev = newRev; setRev_(code, rev); }
    writeChanged_(sh, all, touched, firstNew);
  }
  if (pushId && !already) addReceipt_(code, pushId, rev);

  upsertPhone_(code, req);
  return { ok: true, seeded: true, epoch: epoch, rev: rev, rows: rowsSince_(all, code, Number(req.since) || 0, false),
           devices: listPhones_(code) };
}

// ── Values sheet ───────────────────────────────────────────────────────────
function valuesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(VALUES_SHEET);
  if (!sh) {
    sh = ss.insertSheet(VALUES_SHEET);
    sh.getRange(1, 1, 1, V_COLS).setValues([['What', 'Value', 'Changed', 'By', 'path', 'json', 'ver', 'code']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, V_COLS).setFontWeight('bold');
  }
  // Plain text, so Sheets never turns "2026-10-01" into a date or "007" into 7.
  sh.getRange('A:B').setNumberFormat('@');
  sh.getRange('E:F').setNumberFormat('@');
  return sh;
}

function readRows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, V_COLS).getValues();
}

function makeRow_(what, value, when, by, path, json, ver, code) {
  return [String(what || ''), String(value === undefined || value === null ? '' : value).slice(0, 5000), when, String(by || ''),
          String(path), String(json), ver, code];
}

// Rewrites only what changed: a few rows one by one, or everything at once.
function writeChanged_(sh, all, touched, firstNew) {
  var idx = Object.keys(touched).map(Number);
  if (idx.length > 25) { writeAll_(sh, all, all.length); return; }
  idx.forEach(function (i) { sh.getRange(i + 2, 1, 1, V_COLS).setValues([all[i]]); });
  if (all.length > firstNew) sh.getRange(firstNew + 2, 1, all.length - firstNew, V_COLS).setValues(all.slice(firstNew));
}

function writeAll_(sh, rows, oldCount) {
  if (oldCount > 0) sh.getRange(2, 1, oldCount, V_COLS).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, V_COLS).setValues(rows);
}

function rowsSince_(all, code, since, liveOnly) {
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    if (String(r[V_CODE]) !== code) continue;
    if (Number(r[V_VER]) <= since) continue;
    var json = String(r[V_JSON]);
    if (liveOnly && json === '') continue;
    out.push({ p: String(r[V_PATH]), v: json === '' ? null : json, ver: Number(r[V_VER]) });
  }
  return out;
}

// ── Phones sheet ───────────────────────────────────────────────────────────
function phonesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PHONES_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PHONES_SHEET);
    sh.getRange(1, 1, 1, 8).setValues([['Phone', 'App version', 'Last synced', 'Checking', 'Saved', 'Changes waiting to send', 'deviceId', 'code']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  return sh;
}

function upsertPhone_(code, req) {
  var d = req.device || {};
  var id = String(req.deviceId || '');
  if (!id) return;
  var sh = phonesSheet_();
  var last = sh.getLastRow();
  var rows = last >= 2 ? sh.getRange(2, 1, last - 1, 8).getValues() : [];
  var cells = [String(d.name || id), String(d.version || ''), new Date(),
               num_(d.checking), num_(d.saved), num_(d.pending), id, code];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][6]) === id && String(rows[i][7]) === code) {
      sh.getRange(i + 2, 1, 1, 8).setValues([cells]);
      return;
    }
  }
  sh.getRange(rows.length + 2, 1, 1, 8).setValues([cells]);
}

function listPhones_(code) {
  var sh = phonesSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 8).getValues()
    .filter(function (r) { return String(r[7]) === code; })
    .map(function (r) {
      return { name: String(r[0]), version: String(r[1]), at: r[2] instanceof Date ? r[2].toISOString() : String(r[2]),
               checking: num_(r[3]), saved: num_(r[4]), pending: num_(r[5]), deviceId: String(r[6]) };
    });
}

function deviceName_(req) { return String((req.device && req.device.name) || req.deviceId || ''); }

// ── Receipts: each change batch is applied once, however often it's sent ─────
function receiptsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(RECEIPTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(RECEIPTS_SHEET);
    sh.getRange(1, 1, 1, 4).setValues([['code', 'pushId', 'rev', 'at']]);
    try { sh.hideSheet(); } catch (e) {}
  }
  return sh;
}
function hasReceipt_(code, pushId) {
  var sh = receiptsSheet_();
  var last = sh.getLastRow();
  if (last < 2) return false;
  var rows = sh.getRange(2, 1, last - 1, 2).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][1]) === pushId && String(rows[i][0]) === code) return true;
  }
  return false;
}
function addReceipt_(code, pushId, rev) {
  var sh = receiptsSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues([[code, pushId, rev, new Date()]]);
  var extra = sh.getLastRow() - 1 - MAX_RECEIPTS;
  if (extra > 0) sh.deleteRows(2, extra);
}

// ── Counters ───────────────────────────────────────────────────────────────
function getRev_(code) { return num_(PropertiesService.getScriptProperties().getProperty('rev:' + code)); }
function setRev_(code, rev) { PropertiesService.getScriptProperties().setProperty('rev:' + code, String(rev)); }
function getEpoch_(code) { return PropertiesService.getScriptProperties().getProperty('epoch:' + code) || ''; }

// ── Helpers ────────────────────────────────────────────────────────────────
function num_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function round2_(n) { return Math.round(n * 100) / 100; }
function isNumberJson_(s) { return /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s); }
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
