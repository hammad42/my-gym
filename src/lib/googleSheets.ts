import {
  Exercise,
  Routine,
  RoutineExercise,
  WorkoutSession,
  SetLog,
  Settings,
  GoogleSheetsSyncConfig
} from '../types';
import { sanitizeSettings } from './sanitize';
import { db } from './db';

/**
 * Bumped when the Apps Script template gains capabilities the client depends on.
 *
 * v2 introduced chunked uploads. Apps Script rejects a POST body above roughly
 * 50 KB at the network layer — the request fails with a bare "Failed to fetch"
 * before the script runs — so a growing training log could not be synced whole.
 * The client now streams the payload as parts and the script assembles them.
 *
 * v3 introduces per-session staging sheets (_MyGymBackupNew_<syncId>), LockService
 * scoped strictly around the commit swap, and safeText formula injection escaping
 * for readable training logs.
 */
export const APPS_SCRIPT_PROTOCOL_VERSION = 3;

/**
 * Character budget for one uploaded part. The ceiling is the ~50 KB Apps Script
 * POST limit; this leaves headroom for the request envelope, for multi-byte
 * characters, and for the row that the spreadsheet stores it in (a cell holds at
 * most 50,000 characters).
 */
export const SYNC_PART_CHARS = 30000;

/** Discriminated part kinds uploaded to, and reassembled by, the webhook. */
export type SyncPart =
  | { k: 'meta'; version: string; exported_at: string; settings: Settings }
  | { k: 'exercises'; items: Exercise[] }
  | { k: 'routines'; items: Routine[] }
  | { k: 'routineExercises'; items: RoutineExercise[] }
  | { k: 'sessions'; items: WorkoutSession[] }
  | { k: 'sets'; items: SetLog[] };

/**
 * Writes a sync-status patch onto the stored Google Sheets config.
 *
 * Reads the row fresh and merges, rather than writing back a config object
 * captured when a sync started. That captured copy goes stale the moment the
 * user saves new credentials: the background sync then finishes and writes its
 * old, key-less config over the freshly saved one, silently erasing the secret
 * ~150ms after the user typed it. This helper also refuses to touch `secretKey`
 * at all — a status write has no business changing a credential.
 */
export async function updateSheetsStatus(
  settingsId: string,
  patch: Partial<Omit<GoogleSheetsSyncConfig, 'secretKey'>>,
  secretKey?: string
): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await db.settings.get(settingsId);
    if (!current) return;
    const { secretKey: stored, ...rest } = current.google_sheets ?? {};
    const next = {
      ...rest,
      ...patch,
      // Only an explicitly supplied, non-empty key replaces the stored one.
      secretKey: secretKey?.trim() ? secretKey.trim() : stored
    } as GoogleSheetsSyncConfig;
    await db.settings.update(settingsId, { google_sheets: next });
  });
}

export interface GoogleSheetsSyncPayload {
  version: string;
  exported_at: string;
  exercises: Exercise[];
  routines: Routine[];
  routine_exercises: RoutineExercise[];
  sessions: WorkoutSession[];
  sets: SetLog[];
  settings: Settings;
}

export interface GoogleSheetsSyncResponse {
  status: 'success' | 'error';
  message?: string;
  timestamp?: string;
  scriptVersion?: number;
  counts?: {
    sessions: number;
    sets: number;
    exercises: number;
  };
}

export interface GoogleSheetsFetchResponse {
  status: 'success' | 'error';
  data?: GoogleSheetsSyncPayload;
  message?: string;
  scriptVersion?: number;
}

export type SyncPartItemKind = Exclude<SyncPart['k'], 'meta'>;
export type PartForKind<K extends SyncPartItemKind> = Extract<SyncPart, { k: K }>;

/**
 * Splits a list into parts whose JSON stays inside the upload budget.
 *
 * A single item larger than the budget still gets its own part rather than being
 * dropped: the server rejects that request and the error surfaces to the user,
 * which is better than a backup that silently omits a row.
 */
export function sliceBySize<K extends SyncPartItemKind>(
  items: PartForKind<K>['items'],
  kind: K,
  maxChars: number = SYNC_PART_CHARS
): PartForKind<K>[] {
  const parts: PartForKind<K>[] = [];
  let current: any[] = [];
  let size = 2; // the enclosing [ ]

  const wrap = (batch: any[]): PartForKind<K> =>
    ({ k: kind, items: batch } as PartForKind<K>);

  for (const item of items) {
    const itemSize = JSON.stringify(item).length + 1; // + separator
    if (current.length > 0 && size + itemSize > maxChars) {
      parts.push(wrap(current));
      current = [];
      size = 2;
    }
    current.push(item);
    size += itemSize;
  }

  if (current.length > 0) parts.push(wrap(current));
  return parts;
}

/**
 * Flattens the whole backup into ordered, size-bounded parts for upload.
 *
 * Every table is sliced independently, so no single request — and no single
 * spreadsheet cell holding a part — can exceed its limit regardless of how much
 * history the user has accumulated.
 */
export function buildSyncParts(
  exercises: Exercise[],
  routines: Routine[],
  routineExercises: RoutineExercise[],
  sessions: WorkoutSession[],
  sets: SetLog[],
  settings: Settings,
  maxChars: number = SYNC_PART_CHARS
): SyncPart[] {
  return [
    {
      k: 'meta',
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      // The credential is stripped: the stored copy lives inside the sheet.
      settings: sanitizeSettings(settings)
    },
    ...sliceBySize(exercises, 'exercises', maxChars),
    ...sliceBySize(routines, 'routines', maxChars),
    ...sliceBySize(routineExercises, 'routineExercises', maxChars),
    ...sliceBySize(sessions, 'sessions', maxChars),
    ...sliceBySize(sets, 'sets', maxChars)
  ];
}

/**
 * Reassembles parts (as returned by the script) back into one payload. Used by
 * tests and by any caller that has already received a part list.
 */
export function assembleParts(parts: SyncPart[]): GoogleSheetsSyncPayload {
  const out: GoogleSheetsSyncPayload = {
    version: '1.0.0',
    exported_at: new Date().toISOString(),
    exercises: [],
    routines: [],
    routine_exercises: [],
    sessions: [],
    sets: [],
    settings: { id: 'general', weight_unit: 'kg', weekly_goal: 4, default_rest_seconds: 90 }
  };

  for (const part of parts) {
    switch (part.k) {
      case 'meta':
        out.version = part.version ?? out.version;
        out.exported_at = part.exported_at ?? out.exported_at;
        out.settings = part.settings ?? out.settings;
        break;
      case 'exercises':
        out.exercises = out.exercises.concat(part.items);
        break;
      case 'routines':
        out.routines = out.routines.concat(part.items);
        break;
      case 'routineExercises':
        out.routine_exercises = out.routine_exercises.concat(part.items);
        break;
      case 'sessions':
        out.sessions = out.sessions.concat(part.items);
        break;
      case 'sets':
        out.sets = out.sets.concat(part.items);
        break;
    }
  }

  return out;
}

/**
 * Google Apps Script template for the user to copy-paste into their Google Sheet.
 *
 * Three properties matter here:
 *
 *  1. It fails CLOSED. The deployment instructions correctly say "Who has access:
 *     Anyone", so an unsecured script serves a complete training history to
 *     anyone holding the URL. This template refuses every request until
 *     SECRET_KEY has actually been changed, so the failure mode of not reading
 *     the instructions is "nothing works" rather than "wide open".
 *
 *  2. Uploads are PARTITIONED. Apps Script rejects a single POST above ~50 KB
 *     before the script runs, so the payload arrives as ordered parts which are
 *     stored as rows and assembled on commit.
 *
 *  3. The stored backup never contains the key, and is spread across ROWS. A
 *     spreadsheet cell holds at most 50,000 characters, so the payload cannot
 *     live in one cell.
 */
export const GOOGLE_APPS_SCRIPT_TEMPLATE = `/**
 * =========================================================================
 *  MYGYM PWA — Secure Google Sheets Webhook (protocol v${APPS_SCRIPT_PROTOCOL_VERSION})
 * =========================================================================
 *  Instructions:
 *  1. Open your Google Sheet (create a blank spreadsheet first).
 *  2. Go to: Extensions > Apps Script.
 *  3. Delete all code and paste this entire file.
 *  4. REQUIRED: change SECRET_KEY below to your own private password
 *     (at least 8 characters). Until you do, this webhook refuses every
 *     request — that is deliberate, because it is deployed publicly.
 *  5. Deploy > "Manage deployments" > edit the EXISTING deployment (pencil
 *     icon) > Version: "New version" > Deploy. Editing the existing one keeps
 *     your Web App URL unchanged.
 *     First time only: Deploy > New deployment > gear icon > "Web app",
 *     Execute as "Me", Who has access "Anyone".
 *  6. Paste the Web App URL and the same Secret Key into MyGym under
 *     Settings > Google Sheets Backup.
 * =========================================================================
 */

// REQUIRED: replace this with your own private password (min 8 characters).
var SECRET_KEY = "CHANGE_THIS_TO_YOUR_PASSWORD";

var PLACEHOLDER_KEY = "CHANGE_THIS_TO_YOUR_PASSWORD";
var SCRIPT_VERSION = ${APPS_SCRIPT_PROTOCOL_VERSION};

var BACKUP_SHEET = '_MyGymBackup';

var LOG_HEADERS = ['Date', 'Workout', 'Exercise', 'Set', 'Weight', 'Reps', 'Warmup', 'Session ID', 'Set ID'];

function isSecured() {
  return SECRET_KEY && SECRET_KEY !== PLACEHOLDER_KEY && SECRET_KEY.length >= 8;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function notSecuredResponse() {
  return jsonOut({
    status: 'error',
    scriptVersion: SCRIPT_VERSION,
    message: 'This webhook is not secured. Open Apps Script and set SECRET_KEY to your own password (min 8 characters), then redeploy.'
  });
}

function unauthorizedResponse() {
  return jsonOut({
    status: 'error',
    scriptVersion: SCRIPT_VERSION,
    message: 'Unauthorized: Invalid Secret Key.'
  });
}

/** Escapes spreadsheet formula prefixes (=, +, -, @, \\t, \\r) with a leading single quote. */
function safeText(value) {
  if (value === null || value === undefined) return '';
  var s = String(value);
  if (/^[=+\\-@\\t\\r]/.test(s)) {
    return "'" + s;
  }
  return s;
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'ping';

    // The ping reveals no data, so it needs no key. It lets MyGym detect which
    // version of this script is deployed before sending anything.
    if (action === 'ping') {
      return jsonOut({
        status: isSecured() ? 'success' : 'error',
        scriptVersion: SCRIPT_VERSION,
        message: isSecured()
          ? 'MyGym Google Sheets Webhook is secured and online.'
          : 'Webhook is online but NOT secured. Set SECRET_KEY in Apps Script and redeploy.'
      });
    }

    if (!isSecured()) return notSecuredResponse();

    var key = (e && e.parameter && e.parameter.key) ? e.parameter.key : '';
    if (key !== SECRET_KEY) return unauthorizedResponse();

    return readBackup();

  } catch (err) {
    return jsonOut({ status: 'error', message: err.toString() });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ status: 'error', message: 'No payload data received.' });
    }

    if (!isSecured()) return notSecuredResponse();

    var payload = JSON.parse(e.postData.contents);

    if (!payload.secretKey || payload.secretKey !== SECRET_KEY) return unauthorizedResponse();

    var action = payload.action || 'sync';

    if (action === 'test') {
      return jsonOut({
        status: 'success',
        scriptVersion: SCRIPT_VERSION,
        message: 'Authenticated and connected to your private Google Sheet!'
      });
    }

    if (action === 'fetch') return readBackup();

    // --- partitioned upload (protocol v2/v3) ---------------------------------
    if (action === 'sync-start') return syncStart(payload);
    if (action === 'sync-part') return syncPart(payload);
    if (action === 'sync-commit') return syncCommit(payload);

    // --- single-request upload (legacy, small payloads only) ---------------
    if (action === 'sync') return syncWhole(payload);

    return jsonOut({ status: 'error', message: 'Unknown action: ' + action });

  } catch (err) {
    return jsonOut({ status: 'error', message: err.toString() });
  }
}

/**
 * Opens a new sync session on a dedicated staging sheet: _MyGymBackupNew_<syncId>.
 * The existing _MyGymBackup is left untouched until commit succeeds.
 * Cleans up orphaned staging sheets older than 1 hour.
 */
function syncStart(payload) {
  var syncId = String(payload.syncId || '');
  if (!syncId) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Missing syncId.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stagingName = '_MyGymBackupNew_' + syncId;

  // Clean up stale staging sheets older than 1 hour
  var now = Date.now();
  var allSheets = ss.getSheets();
  for (var i = 0; i < allSheets.length; i++) {
    var sName = allSheets[i].getName();
    if (sName.indexOf('_MyGymBackupNew_') === 0 && sName !== stagingName) {
      var match = sName.match(/^_MyGymBackupNew_sync-(\\d+)-/);
      if (match && (now - Number(match[1]) > 3600000)) {
        try { ss.deleteSheet(allSheets[i]); } catch(e) {}
      }
    }
  }

  var staging = sheetNamed(ss, stagingName);
  staging.clear();

  var props = PropertiesService.getScriptProperties();
  props.setProperty('mygym_sync_id_' + syncId, syncId);
  props.setProperty('mygym_part_count_' + syncId, '0');
  if (payload.partCount != null) {
    props.setProperty('mygym_expected_parts_' + syncId, String(payload.partCount));
  }

  return jsonOut({ status: 'success', scriptVersion: SCRIPT_VERSION, message: 'Upload started.' });
}

/** Stores one payload part as a row in the session staging sheet. */
function syncPart(payload) {
  var syncId = String(payload.syncId || '');
  if (!syncId) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Missing syncId.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stagingName = '_MyGymBackupNew_' + syncId;
  var staging = ss.getSheetByName(stagingName);
  if (!staging) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Sync session expired or not found. Start the sync again.' });
  }

  var serialized = JSON.stringify(payload.part);
  if (serialized.length > 49000) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Payload part is too large for a spreadsheet cell.' });
  }

  staging.getRange(staging.getLastRow() + 1, 1).setValue(serialized);

  var props = PropertiesService.getScriptProperties();
  var countKey = 'mygym_part_count_' + syncId;
  var count = parseInt(props.getProperty(countKey) || '0', 10) + 1;
  props.setProperty(countKey, String(count));

  return jsonOut({ status: 'success', scriptVersion: SCRIPT_VERSION, part: payload.index });
}

/**
 * Closes the sync: acquires a short ScriptLock, verifies all parts were received,
 * reassembles data from staging, swaps staging sheet to _MyGymBackup, and writes readable sheets.
 */
function syncCommit(payload) {
  var syncId = String(payload.syncId || '');
  if (!syncId) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Missing syncId.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stagingName = '_MyGymBackupNew_' + syncId;
  var staging = ss.getSheetByName(stagingName);
  if (!staging) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Sync session expired or not found. Start the sync again.' });
  }

  var props = PropertiesService.getScriptProperties();
  var expectedStr = props.getProperty('mygym_expected_parts_' + syncId);
  var receivedStr = props.getProperty('mygym_part_count_' + syncId);
  if (expectedStr && receivedStr && parseInt(receivedStr, 10) < parseInt(expectedStr, 10)) {
    return jsonOut({
      status: 'error',
      scriptVersion: SCRIPT_VERSION,
      message: 'Incomplete upload: expected ' + expectedStr + ' parts but received ' + receivedStr + '.'
    });
  }

  var data = readPartsFromSheet(staging);
  if (!data) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'No uploaded data found to commit.' });
  }

  var lock = LockService.getScriptLock();
  try {
    var hasLock = lock.waitLock(30000);
    if (!hasLock) {
      return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Could not acquire lock to finalize backup. Please retry.' });
    }

    var oldBackup = ss.getSheetByName(BACKUP_SHEET);
    if (oldBackup) {
      oldBackup.setName('_MyGymBackup_Old_' + Date.now());
      staging.setName(BACKUP_SHEET);
      try { ss.deleteSheet(oldBackup); } catch(e) {}
    } else {
      staging.setName(BACKUP_SHEET);
    }

    writeWorkoutLogSheet(ss, data.sets, data.sessions, data.exercises);
    writeSessionsSheet(ss, data.sessions, data.sets, data.exercises);
    writeExercisesSheet(ss, data.exercises);
    writeRoutinesSheet(ss, data.routines, data.routine_exercises, data.exercises);

    props.deleteProperty('mygym_sync_id_' + syncId);
    props.deleteProperty('mygym_part_count_' + syncId);
    props.deleteProperty('mygym_expected_parts_' + syncId);

    // Clean up any remaining _MyGymBackupNew_ or _MyGymBackup_Old_ sheets
    var allSheets = ss.getSheets();
    for (var i = 0; i < allSheets.length; i++) {
      var sName = allSheets[i].getName();
      if (sName !== BACKUP_SHEET && (sName.indexOf('_MyGymBackupNew_') === 0 || sName.indexOf('_MyGymBackup_Old_') === 0)) {
        try { ss.deleteSheet(allSheets[i]); } catch(e) {}
      }
    }
  } finally {
    lock.releaseLock();
  }

  return jsonOut({
    status: 'success',
    scriptVersion: SCRIPT_VERSION,
    message: 'Backup saved successfully to your private Google Sheet!',
    timestamp: new Date().toISOString(),
    counts: {
      sessions: data.sessions.length,
      sets: data.sets.length,
      exercises: data.exercises.length
    }
  });
}

/** Single-request upload with ScriptLock. Kept for small payloads and older clients. */
function syncWhole(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock();
  try {
    var hasLock = lock.waitLock(30000);
    if (!hasLock) {
      return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Could not acquire lock to finalize backup. Please retry.' });
    }

    var data = {
      version: payload.version,
      exported_at: payload.exported_at,
      exercises: payload.exercises || [],
      routines: payload.routines || [],
      routine_exercises: payload.routine_exercises || [],
      sessions: payload.sessions || [],
      sets: payload.sets || [],
      settings: payload.settings || {}
    };

    writeWholeBackup(ss, data);
    writeWorkoutLogSheet(ss, data.sets, data.sessions, data.exercises);
    writeSessionsSheet(ss, data.sessions, data.sets, data.exercises);
    writeExercisesSheet(ss, data.exercises);
    writeRoutinesSheet(ss, data.routines, data.routine_exercises, data.exercises);

    return jsonOut({
      status: 'success',
      scriptVersion: SCRIPT_VERSION,
      message: 'Backup saved successfully to your private Google Sheet!',
      timestamp: new Date().toISOString(),
      counts: { sessions: data.sessions.length, sets: data.sets.length, exercises: data.exercises.length }
    });
  } finally {
    lock.releaseLock();
  }
}

/** Reads every stored part from a given sheet and merges it back into one payload. */
function readPartsFromSheet(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return null;

  var values = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  var data = {
    version: '1.0.0',
    exported_at: null,
    exercises: [], routines: [], routine_exercises: [],
    sessions: [], sets: [],
    settings: {}
  };
  var seen = false;

  values.forEach(function(row) {
    if (!row[0]) return;
    var part;
    try { part = JSON.parse(row[0]); } catch (err) { return; }
    if (!part || !part.k) return;
    seen = true;
    switch (part.k) {
      case 'meta':
        data.version = part.version || data.version;
        data.exported_at = part.exported_at || data.exported_at;
        data.settings = part.settings || data.settings;
        break;
      case 'exercises': data.exercises = data.exercises.concat(part.items || []); break;
      case 'routines': data.routines = data.routines.concat(part.items || []); break;
      case 'routineExercises': data.routine_exercises = data.routine_exercises.concat(part.items || []); break;
      case 'sessions': data.sessions = data.sessions.concat(part.items || []); break;
      case 'sets': data.sets = data.sets.concat(part.items || []); break;
    }
  });

  return seen ? data : null;
}

function readParts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var backup = ss.getSheetByName(BACKUP_SHEET);
  return readPartsFromSheet(backup);
}

function sheetNamed(ss, name) {
  var sheet = ss.getSheetByName(name);
  return sheet ? sheet : ss.insertSheet(name);
}

/** Stores the payload as rows of size-bounded parts (never one huge cell). */
function writeWholeBackup(ss, data) {
  var backup = sheetNamed(ss, BACKUP_SHEET);
  backup.clear();

  var settings = data.settings || {};
  if (settings.google_sheets) delete settings.google_sheets.secretKey;

  var parts = [{ k: 'meta', version: data.version, exported_at: data.exported_at, settings: settings }];
  parts = parts
    .concat(slicePart(data.exercises, 'exercises'))
    .concat(slicePart(data.routines, 'routines'))
    .concat(slicePart(data.routine_exercises, 'routineExercises'))
    .concat(slicePart(data.sessions, 'sessions'))
    .concat(slicePart(data.sets, 'sets'));

  var rows = parts.map(function(p) { return [JSON.stringify(p)]; });
  backup.getRange(1, 1, rows.length, 1).setValues(rows);
}

function slicePart(items, kind) {
  var out = [];
  var current = [];
  var size = 2;
  (items || []).forEach(function(item) {
    var len = JSON.stringify(item).length + 1;
    if (current.length > 0 && size + len > ${SYNC_PART_CHARS}) {
      out.push({ k: kind, items: current });
      current = []; size = 2;
    }
    current.push(item); size += len;
  });
  if (current.length > 0) out.push({ k: kind, items: current });
  return out;
}

function writeWorkoutLogSheet(ss, sets, sessions, exercises) {
  var exMap = {};
  exercises.forEach(function(x) { exMap[x.id] = x.name; });
  var sessionMap = {};
  sessions.forEach(function(s) { sessionMap[s.id] = s; });

  var sheet = sheetNamed(ss, 'Workout Log');
  sheet.clear();

  var rows = [LOG_HEADERS];
  var sorted = (sets || []).slice().sort(function(a, b) {
    var da = (sessionMap[a.session_id] || {}).date || '';
    var db2 = (sessionMap[b.session_id] || {}).date || '';
    if (da !== db2) return da < db2 ? -1 : 1;
    return (a.set_number || 0) - (b.set_number || 0);
  });

  sorted.forEach(function(s) {
    var session = sessionMap[s.session_id] || {};
    rows.push([
      safeText(session.date || ''),
      safeText(session.name || ''),
      safeText(exMap[s.exercise_id] || s.exercise_id || ''),
      s.set_number,
      s.weight,
      s.reps,
      s.is_warmup ? 'YES' : 'NO',
      safeText(s.session_id || ''),
      safeText(s.id || '')
    ]);
  });

  sheet.getRange(1, 1, rows.length, LOG_HEADERS.length).setValues(rows);
  formatHeader(sheet, LOG_HEADERS.length);
}

function writeSessionsSheet(ss, sessions, sets, exercises) {
  var setCount = {};
  var reps = {};
  var volume = {};
  var perSessionExercises = {};

  (sets || []).forEach(function(s) {
    setCount[s.session_id] = (setCount[s.session_id] || 0) + 1;
    reps[s.session_id] = (reps[s.session_id] || 0) + (Number(s.reps) || 0);
    volume[s.session_id] = (volume[s.session_id] || 0) + (Number(s.weight) || 0) * (Number(s.reps) || 0);
    if (!perSessionExercises[s.session_id]) perSessionExercises[s.session_id] = [];
    if (perSessionExercises[s.session_id].indexOf(s.exercise_id) === -1) {
      perSessionExercises[s.session_id].push(s.exercise_id);
    }
  });

  var sheet = sheetNamed(ss, 'Sessions');
  sheet.clear();

  var headers = ['Date', 'Workout', 'Duration (min)', 'Body Weight', 'Exercises', 'Sets', 'Total Reps', 'Volume', 'Notes', 'Session ID'];
  var rows = [headers];

  (sessions || []).slice().sort(function(a, b) {
    return (b.date || '').localeCompare(a.date || '');
  }).forEach(function(s) {
    rows.push([
      safeText(s.date || ''),
      safeText(s.name || ''),
      s.duration_minutes,
      s.body_weight != null ? s.body_weight : '',
      (perSessionExercises[s.id] || []).length,
      setCount[s.id] || 0,
      reps[s.id] || 0,
      volume[s.id] || 0,
      safeText(s.notes || ''),
      safeText(s.id || '')
    ]);
  });

  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  formatHeader(sheet, headers.length);
}

function writeExercisesSheet(ss, exercises) {
  var sheet = sheetNamed(ss, 'Exercises');
  sheet.clear();

  var headers = ['Exercise', 'Muscle Group', 'Equipment', 'Archived', 'Exercise ID'];
  var rows = [headers];
  (exercises || []).forEach(function(x) {
    rows.push([
      safeText(x.name || ''),
      safeText(x.muscle_group || ''),
      safeText(x.equipment || ''),
      x.is_archived ? 'YES' : 'NO',
      safeText(x.id || '')
    ]);
  });

  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  formatHeader(sheet, headers.length);
}

function writeRoutinesSheet(ss, routines, routineExercises, exercises) {
  var exMap = {};
  exercises.forEach(function(x) { exMap[x.id] = x.name; });

  var sheet = sheetNamed(ss, 'Routines');
  sheet.clear();

  var headers = ['Routine', 'Day Hint', 'Order', 'Exercise', 'Target Sets', 'Target Reps', 'Description', 'Routine ID'];
  var rows = [headers];

  (routines || []).forEach(function(r) {
    var lines = (routineExercises || [])
      .filter(function(l) { return l.routine_id === r.id; })
      .sort(function(a, b) { return (a.order || 0) - (b.order || 0); });

    lines.forEach(function(l) {
      rows.push([
        safeText(r.name || ''),
        safeText(r.day_hint || ''),
        l.order,
        safeText(exMap[l.exercise_id] || l.exercise_id || ''),
        l.target_sets,
        l.target_reps,
        safeText(r.description || ''),
        safeText(r.id || '')
      ]);
    });
  });

  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  formatHeader(sheet, headers.length);
}

function formatHeader(sheet, colCount) {
  var headerRange = sheet.getRange(1, 1, 1, colCount);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#ea580c'); // MyGym orange
  headerRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}
`;

/**
 * Checks if a 2-times-a-day sync is due based on 12-hour interval.
 */
export function isBackupDue(lastSyncTime?: string, intervalHours: number = 12): boolean {
  if (!lastSyncTime) return true;
  const last = new Date(lastSyncTime).getTime();
  if (isNaN(last)) return true;
  const elapsedMs = Date.now() - last;
  return elapsedMs >= intervalHours * 60 * 60 * 1000;
}

/**
 * Builds the complete export payload as one object. Used by tests and by callers
 * that want the whole snapshot rather than the wire parts.
 *
 * `secretKey` rides at the top level as the request's auth field; the copy stored
 * inside `settings` is stripped, so the credential that protects the sheet is not
 * written into the sheet.
 */
export function buildGoogleSheetsPayload(
  exercises: Exercise[],
  routines: Routine[],
  routineExercises: RoutineExercise[],
  sessions: WorkoutSession[],
  sets: SetLog[],
  settings: Settings,
  action: 'sync' | 'test' | 'fetch' = 'sync',
  secretKey?: string
): GoogleSheetsSyncPayload & { action: string; secretKey?: string } {
  return {
    action,
    secretKey: secretKey?.trim() || undefined,
    version: '1.0.0',
    exported_at: new Date().toISOString(),
    exercises,
    routines,
    routine_exercises: routineExercises,
    sessions,
    sets,
    settings: sanitizeSettings(settings)
  };
}

function isValidScriptUrl(webAppUrl: string): boolean {
  return Boolean(webAppUrl && webAppUrl.trim().startsWith('https://script.google.com/'));
}

/**
 * One request to the webhook. Apps Script answers a POST with a redirect to
 * script.googleusercontent.com, which the browser follows transparently as long
 * as both hosts are allowed by the page's Content-Security-Policy.
 */
async function postToScript(webAppUrl: string, body: unknown): Promise<any> {
  const response = await fetch(webAppUrl.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Google Sheets returned HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Tests connection with the Google Apps Script Web App URL.
 */
export async function testGoogleSheetsConnection(
  webAppUrl: string,
  secretKey?: string
): Promise<{ success: boolean; message: string; scriptVersion?: number }> {
  if (!isValidScriptUrl(webAppUrl)) {
    return {
      success: false,
      message: 'Invalid URL. Must be a Google Apps Script URL starting with https://script.google.com/'
    };
  }

  try {
    const res = await postToScript(webAppUrl, {
      action: 'test',
      secretKey: secretKey?.trim() || undefined
    });
    const scriptVersion = res.scriptVersion != null ? Number(res.scriptVersion) : undefined;
    if (res.status === 'success') {
      return {
        success: true,
        message: res.message || 'Connected successfully!',
        ...(scriptVersion !== undefined ? { scriptVersion } : {})
      };
    }
    return {
      success: false,
      message: res.message || 'Error reported by Google Sheet',
      ...(scriptVersion !== undefined ? { scriptVersion } : {})
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Could not connect to Google Apps Script. Please verify Web App deployment.'
    };
  }
}

/**
 * Asks the deployed script which protocol version it speaks, without sending the
 * key or receiving any data.
 *
 * This must happen BEFORE choosing an upload protocol. A v1 deployment has no
 * unknown-action guard: it treats any POST as a whole-sync request, so sending
 * it `sync-start` (which carries no data) would make it clear the sheets and
 * write nothing, then report success — a silent wipe. Returns 0 when the version
 * cannot be determined, which is treated as "legacy".
 */
export async function detectScriptVersion(webAppUrl: string): Promise<number> {
  if (!isValidScriptUrl(webAppUrl)) return 0;

  try {
    const base = webAppUrl.trim();
    const pingUrl = `${base}${base.includes('?') ? '&' : '?'}action=ping&_t=${Date.now()}`;
    const response = await fetch(pingUrl, { method: 'GET' });
    if (!response.ok) return 0;
    const res = await response.json();
    const version = Number(res?.scriptVersion);
    return Number.isFinite(version) && version > 0 ? version : 0;
  } catch {
    return 0;
  }
}

/**
 * Single-request upload, used for deployments running the v1 script. It works
 * only while the payload fits in one POST (roughly 50 KB); beyond that Apps
 * Script rejects the request and the user is told to update the script.
 */
async function syncWholePayloadToScript(
  webAppUrl: string,
  parts: SyncPart[],
  key?: string
): Promise<{ success: boolean; message: string; counts?: any; timestamp?: string }> {
  const payload = assembleParts(parts);
  try {
    const res = await postToScript(webAppUrl, {
      action: 'sync',
      secretKey: key,
      version: payload.version,
      exported_at: payload.exported_at,
      exercises: payload.exercises,
      routines: payload.routines,
      routine_exercises: payload.routine_exercises,
      sessions: payload.sessions,
      sets: payload.sets,
      settings: sanitizeSettings(payload.settings)
    });
    if (res.status === 'success') {
      return {
        success: true,
        message: res.message || 'Data backed up to Google Sheets successfully!',
        counts: res.counts,
        timestamp: res.timestamp || new Date().toISOString()
      };
    }
    return { success: false, message: res.message || 'Failed to save to Google Sheets.' };
  } catch (err: any) {
    return { success: false, message: err.message || 'Network error while connecting to Google Sheets.' };
  }
}

/**
 * Sends current MyGym data to Google Sheets.
 *
 * The payload is uploaded as size-bounded parts (start / part… / commit), because
 * Apps Script rejects a POST body above roughly 50 KB before the script runs.
 *
 * The protocol is chosen from the deployed script's reported version, never by
 * trial and error: sending partitioned actions to a v1 deployment would make it
 * write empty sheets and report success.
 */
/**
 * In-flight sync mutex to prevent overlapping sync requests from colliding on
 * Google Apps Script's LockService.
 */
let syncInProgress = false;

export function isSyncInProgress(): boolean {
  return syncInProgress;
}

export async function syncToGoogleSheets(
  webAppUrl: string,
  exercises: Exercise[],
  routines: Routine[],
  routineExercises: RoutineExercise[],
  sessions: WorkoutSession[],
  sets: SetLog[],
  settings: Settings,
  secretKey?: string
): Promise<{ success: boolean; message: string; counts?: any; timestamp?: string }> {
  if (syncInProgress) {
    return { success: false, message: 'A sync is already in progress. Please wait a moment.' };
  }

  if (!isValidScriptUrl(webAppUrl)) {
    return { success: false, message: 'Missing or invalid Google Sheets Web App URL.' };
  }

  const UPDATE_HINT =
    ' If you have not yet pasted the latest Apps Script from MyGym > Settings > Google Sheets Backup, do that (Deploy > Manage deployments > New version) and sync again.';

  syncInProgress = true;
  try {
    const key = secretKey?.trim() || undefined;
    const parts = buildSyncParts(exercises, routines, routineExercises, sessions, sets, settings);

    // Decide the protocol up front.
    // Chunked partitioned upload was introduced in v2. Both v2 and v3 support partitioned upload.
    // Deployments < 2 fall back to legacy single-request sync.
    const scriptVersion = await detectScriptVersion(webAppUrl);
    if (scriptVersion < 2) {
      const legacy = await syncWholePayloadToScript(webAppUrl, parts, key);
      if (!legacy.success && /failed to fetch/i.test(legacy.message) && sets.length > 0) {
        return { success: false, message: legacy.message + UPDATE_HINT };
      }
      return legacy;
    }

    const syncId = `sync-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const start = await postToScript(webAppUrl, { action: 'sync-start', secretKey: key, syncId, partCount: parts.length });
    if (start.status !== 'success') {
      return { success: false, message: start.message || 'Could not start the sync.' };
    }

    for (let index = 0; index < parts.length; index++) {
      const res = await postToScript(webAppUrl, {
        action: 'sync-part',
        secretKey: key,
        syncId,
        index,
        part: parts[index]
      });
      if (res.status !== 'success') {
        return { success: false, message: res.message || `Could not upload part ${index + 1} of ${parts.length}.` };
      }
    }

    const commit = await postToScript(webAppUrl, {
      action: 'sync-commit',
      secretKey: key,
      syncId,
      partCount: parts.length
    });
    if (commit.status !== 'success') {
      return { success: false, message: commit.message || 'Could not finalise the sync.' };
    }

    return {
      success: true,
      message: commit.message || 'Data backed up to Google Sheets successfully!',
      counts: commit.counts,
      timestamp: commit.timestamp || new Date().toISOString()
    };
  } catch (err: any) {
    const message = err.message || 'Network error while connecting to Google Sheets.';
    if (/failed to fetch/i.test(message)) {
      return { success: false, message: message + UPDATE_HINT };
    }
    return { success: false, message };
  } finally {
    syncInProgress = false;
  }
}

/**
 * Fetches the backup data from the connected Google Sheet for self-recovery.
 */
export async function fetchFromGoogleSheets(
  webAppUrl: string,
  secretKey?: string
): Promise<{ success: boolean; data?: GoogleSheetsSyncPayload; message?: string }> {
  if (!isValidScriptUrl(webAppUrl)) {
    return { success: false, message: 'Missing or invalid Google Sheets Web App URL.' };
  }

  try {
    const res: GoogleSheetsFetchResponse = await postToScript(webAppUrl, {
      action: 'fetch',
      secretKey: secretKey?.trim() || undefined
    });

    if (res.status === 'success' && res.data) {
      if (!Array.isArray(res.data.sessions) || !Array.isArray(res.data.sets)) {
        return {
          success: false,
          message: 'Google Sheet backup is missing required tables (sessions/sets).'
        };
      }
      return { success: true, data: res.data };
    }

    return { success: false, message: res.message || 'No backup found in Google Sheet.' };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Network error fetching backup from Google Sheets.'
    };
  }
}
