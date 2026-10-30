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
 *   'Backups'       — full copies of 'Shared values', taken at most once an
 *                     hour while a phone is syncing. If nothing changed since
 *                     the last copy, that copy just gets a new time instead of
 *                     a duplicate. An extra copy is always taken right before
 *                     anything that replaces or removes a lot of data. Kept:
 *                     everything from the last 48 hours, then one per day for
 *                     60 days.
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
var BACKUPS_SHEET = 'Backups';
var BACKUP_EVERY_MS = 60 * 60 * 1000;        // hourly
var KEEP_ALL_MS = 48 * 60 * 60 * 1000;       // keep every backup this recent
var KEEP_DAILY_DAYS = 60;                    // then one per day for this long
var CHUNK_CHARS = 40000;                     // per cell (a cell holds 50,000)

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
    if (action === 'ping') return jsonOut_({ ok: true, pong: true, v2: true, backups: true, seeded: !!getEpoch_(code) });
    if (action === 'sync2') return jsonOut_(sync_(code, req));
    if (action === 'seed') return jsonOut_(seed_(code, req));
    if (action === 'backups') return jsonOut_({ ok: true, backups: listBackups_(code) });
    if (action === 'getBackup') return jsonOut_(getBackup_(code, String(req.id || '')));
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
  backup_(code, all, 'Before switching to ' + deviceName_(req) + "'s numbers", true);
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
  backup_(code, keep, 'New shared copy from ' + by, true);
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
    // About to remove a lot at once (say, "clear all data" on a phone)? Copy first.
    var live = 0, removing = 0;
    for (var p0 in index) if (String(all[index[p0]][V_JSON]) !== '') live++;
    changes.forEach(function (c) {
      var at0 = index[String(c.p)];
      if ((c.v === null || c.v === undefined) && at0 !== undefined && String(all[at0][V_JSON]) !== '') removing++;
    });
    if (removing >= 25 && removing > live * 0.3) {
      backup_(code, all, 'Before ' + deviceName_(req) + ' removed ' + removing + ' values', true);
    }
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
  backup_(code, all, 'Hourly', false);

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

// ── Backups ────────────────────────────────────────────────────────────────
function backupsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(BACKUPS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(BACKUPS_SHEET);
    sh.getRange(1, 1, 1, 8).setValues([['Backup', 'Saved at', 'Why', 'Values', 'Size', 'Part', 'data', 'code']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  sh.getRange('A:A').setNumberFormat('@');
  sh.getRange('G:G').setNumberFormat('@');
  return sh;
}

// Copies this code's live values. Not forced: only if the last copy is an
// hour old, and if nothing changed the last copy just gets the new time.
function backup_(code, all, why, force) {
  var props = PropertiesService.getScriptProperties();
  var last = parseJson_(props.getProperty('bk:' + code), null);
  var now = new Date();
  if (!force && last && now.getTime() - last.at < BACKUP_EVERY_MS) return;
  var map = {}, n = 0;
  for (var i = 0; i < all.length; i++) {
    if (String(all[i][V_CODE]) !== code) continue;
    var json = String(all[i][V_JSON]);
    if (json === '') continue;
    map[String(all[i][V_PATH])] = json; n++;
  }
  if (!n) return;
  var keys = Object.keys(map).sort();
  var hash = hash_(JSON.stringify(keys.map(function (k) { return [k, map[k]]; })));
  var sh = backupsSheet_();
  var rows = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues() : [];
  if (last && last.hash === hash) {
    // Same as the last copy: give it the new time instead of saving it twice.
    for (var r = 0; r < rows.length; r++) {
      if (String(rows[r][0]) === last.id && String(rows[r][7]) === code) sh.getRange(r + 2, 2).setValues([[now]]);
    }
    props.setProperty('bk:' + code, JSON.stringify({ id: last.id, at: now.getTime(), hash: hash }));
    return;
  }
  var id = 'B' + now.getTime();
  var text = JSON.stringify(map);
  var add = [];
  for (var start = 0, part = 1; start < text.length; start += CHUNK_CHARS, part++) {
    add.push([id, now, String(why || ''), n, text.length, part, text.substr(start, CHUNK_CHARS), code]);
  }
  sh.getRange(rows.length + 2, 1, add.length, 8).setValues(add);
  props.setProperty('bk:' + code, JSON.stringify({ id: id, at: now.getTime(), hash: hash }));
  pruneBackups_(sh, code);
}

function backupGroups_(rows, code) {
  var byId = {}, list = [];
  rows.forEach(function (r) {
    if (String(r[7]) !== code) return;
    var id = String(r[0]);
    if (!byId[id]) { byId[id] = { id: id, at: r[1] instanceof Date ? r[1].getTime() : Date.parse(r[1]) || 0, why: String(r[2]), values: num_(r[3]), size: num_(r[4]), parts: [] }; list.push(byId[id]); }
    byId[id].parts.push({ part: num_(r[5]), data: String(r[6]) });
  });
  list.sort(function (a, b) { return b.at - a.at; });
  return list;
}

// Everything from the last 48 hours; before that, the newest copy of each day
// for 60 days. Older copies go.
function pruneBackups_(sh, code) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var rows = sh.getRange(2, 1, last - 1, 8).getValues();
  var now = Date.now(), seenDay = {}, drop = {};
  backupGroups_(rows, code).forEach(function (b) {
    if (now - b.at <= KEEP_ALL_MS) return;
    var day = new Date(b.at).toISOString().slice(0, 10);
    if (now - b.at > KEEP_DAILY_DAYS * 86400000 || seenDay[day]) { drop[b.id] = true; return; }
    seenDay[day] = true;
  });
  if (!Object.keys(drop).length) return;
  var keep = rows.filter(function (r) { return !(String(r[7]) === code && drop[String(r[0])]); });
  sh.getRange(2, 1, rows.length, 8).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, 8).setValues(keep);
}

function listBackups_(code) {
  var sh = backupsSheet_();
  var rows = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues() : [];
  return backupGroups_(rows, code).map(function (b) {
    return { id: b.id, at: new Date(b.at).toISOString(), why: b.why, values: b.values, size: b.size };
  });
}

function getBackup_(code, id) {
  var sh = backupsSheet_();
  var rows = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues() : [];
  var b = backupGroups_(rows, code).filter(function (x) { return x.id === id; })[0];
  if (!b) return { ok: false, error: 'That backup is no longer in the sheet.' };
  b.parts.sort(function (x, y) { return x.part - y.part; });
  return { ok: true, id: b.id, at: new Date(b.at).toISOString(), data: b.parts.map(function (x) { return x.data; }).join('') };
}

// Two FNV-1a passes with different seeds: plenty to tell "changed" from "same".
function hash_(s) {
  var a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x0100019d) >>> 0;
  }
  return a.toString(16) + b.toString(16);
}

// ── Counters ───────────────────────────────────────────────────────────────
function getRev_(code) { return num_(PropertiesService.getScriptProperties().getProperty('rev:' + code)); }
function setRev_(code, rev) { PropertiesService.getScriptProperties().setProperty('rev:' + code, String(rev)); }
function getEpoch_(code) { return PropertiesService.getScriptProperties().getProperty('epoch:' + code) || ''; }

// ── Helpers ────────────────────────────────────────────────────────────────
function num_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function parseJson_(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } }
function round2_(n) { return Math.round(n * 100) / 100; }
function isNumberJson_(s) { return /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s); }
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
