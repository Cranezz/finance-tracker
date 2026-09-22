/**
 * Finance Tracker — sync backend.
 *
 * Paste this into a Google Apps Script project that is bound to a Google Sheet,
 * deploy it as a Web App ("Execute as: Me", "Who has access: Anyone"), and give
 * the /exec URL to the app. See SYNC-SETUP.md for the click-by-click version.
 *
 * It stores two things per pairing code:
 *   'ops'   — an append-only log of change batches, one row per push
 *   'state' — the latest full snapshot, split across rows because a single
 *             spreadsheet cell tops out at 50,000 characters
 *
 * Devices merge by replaying ops, so two phones can both make changes without
 * either one overwriting the other. The snapshot is only used to start a new
 * device off, or to rescue one that has been offline longer than the op log.
 */

var OPS_SHEET = 'ops';
var STATE_SHEET = 'state';
var MAX_OPS_ROWS = 4000;   // trimmed from the front once exceeded
var CHUNK_CHARS = 40000;   // per-cell snapshot chunk (cell limit is 50k)

// ── Entry points ───────────────────────────────────────────────────────────
// GET is used for pulls and pings so they can be tested straight from a browser.
function doGet(e) { return handleRequest_((e && e.parameter) || {}, null); }

// POST carries pushes. The app sends text/plain on purpose: it keeps the
// request "simple" so the browser skips the CORS preflight, which Apps Script
// cannot answer.
function doPost(e) {
  var body = null;
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = null; }
  return handleRequest_((e && e.parameter) || {}, body);
}

function handleRequest_(params, body) {
  var req = body || {};
  var action = String(req.action || params.action || 'pull');
  var code = String(req.code || params.code || '').trim().toUpperCase();
  if (!code) return jsonOut_({ ok: false, error: 'missing code' });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (err) {
    return jsonOut_({ ok: false, error: 'busy, try again' });
  }

  try {
    if (action === 'ping')     return jsonOut_({ ok: true, pong: true, seq: latestSeq_(code) });
    if (action === 'snapshot') return jsonOut_(readSnapshot_(code));
    if (action === 'push')     return jsonOut_(push_(code, req));
    if (action === 'pull')     return jsonOut_(pull_(code, num_(req.since !== undefined ? req.since : params.since), String(req.deviceId || params.deviceId || '')));
    return jsonOut_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ── Actions ────────────────────────────────────────────────────────────────
function pull_(code, since, deviceId) {
  var rows = opsRows_();
  var out = [];
  var oldest = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[1]) !== code) continue;
    var seq = num_(r[0]);
    if (!oldest || seq < oldest) oldest = seq;
    if (seq <= since) continue;
    if (deviceId && String(r[2]) === deviceId) continue; // never echo a device its own ops
    out.push({ seq: seq, deviceId: String(r[2]), ops: parseJson_(r[4], []) });
  }
  // Asked for ops older than anything still kept? The caller has to restart
  // from the snapshot instead, or it would silently miss changes.
  var stale = since > 0 && oldest > 0 && since < oldest - 1;
  return { ok: true, stale: stale, seq: latestSeq_(code), ops: out };
}

function push_(code, req) {
  var deviceId = String(req.deviceId || '');
  var ops = req.ops || [];
  var since = num_(req.since);
  var serverSeqBefore = latestSeq_(code);

  var result = pull_(code, since, deviceId);
  var newSeq = serverSeqBefore;

  if (ops.length) {
    newSeq = nextSeq_();
    opsSheet_().appendRow([newSeq, code, deviceId, new Date().toISOString(), JSON.stringify(ops)]);
    trimOps_();
  }

  // Only trust a snapshot from a device that had already caught up, otherwise
  // it would be missing whatever the other phone pushed in the meantime.
  if (req.snapshot && since >= serverSeqBefore) {
    writeSnapshot_(code, String(req.snapshot), newSeq || serverSeqBefore);
  }

  return { ok: true, seq: Math.max(newSeq, result.seq), ops: result.ops, stale: result.stale };
}

function readSnapshot_(code) {
  var sh = stateSheet_();
  var rows = sh.getDataRange().getValues();
  var parts = [], seq = 0;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== code) continue;
    parts.push({ part: num_(rows[i][1]), data: String(rows[i][3]) });
    seq = num_(rows[i][2]);
  }
  if (!parts.length) return { ok: true, snapshot: null, seq: 0 };
  parts.sort(function (a, b) { return a.part - b.part; });
  var joined = parts.map(function (p) { return p.data; }).join('');
  return { ok: true, snapshot: joined, seq: seq };
}

function writeSnapshot_(code, snapshot, seq) {
  var sh = stateSheet_();
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === code) sh.deleteRow(i + 1);
  }
  for (var start = 0, part = 0; start < snapshot.length; start += CHUNK_CHARS, part++) {
    sh.appendRow([code, part, seq, snapshot.substr(start, CHUNK_CHARS)]);
  }
}

// ── Sheet plumbing ─────────────────────────────────────────────────────────
function sheetByName_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
  }
  return sh;
}
function opsSheet_()   { return sheetByName_(OPS_SHEET,   ['seq', 'code', 'deviceId', 'ts', 'ops']); }
function stateSheet_() { return sheetByName_(STATE_SHEET, ['code', 'part', 'seq', 'data']); }

function opsRows_() {
  var sh = opsSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
}

function latestSeq_(code) {
  var rows = opsRows_();
  var max = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) !== code) continue;
    max = Math.max(max, num_(rows[i][0]));
  }
  // A snapshot can sit ahead of the trimmed log, so take whichever is higher.
  var snap = readSnapshot_(code);
  return Math.max(max, num_(snap.seq));
}

// Sequence numbers come from a counter rather than row numbers, so trimming the
// log never renumbers anything.
function nextSeq_() {
  var props = PropertiesService.getScriptProperties();
  var n = num_(props.getProperty('seq')) + 1;
  props.setProperty('seq', String(n));
  return n;
}

function trimOps_() {
  var sh = opsSheet_();
  var extra = sh.getLastRow() - 1 - MAX_OPS_ROWS;
  if (extra > 0) sh.deleteRows(2, extra);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function num_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function parseJson_(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
