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
 */
export const APPS_SCRIPT_PROTOCOL_VERSION = 2;

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

/**
 * Splits a list into parts whose JSON stays inside the upload budget.
 *
 * A single item larger than the budget still gets its own part rather than being
 * dropped: the server rejects that request and the error surfaces to the user,
 * which is better than a backup that silently omits a row.
 */
export function sliceBySize<T>(items: T[], kind: string, maxChars: number = SYNC_PART_CHARS): SyncPart[] {
  const parts: SyncPart[] = [];
  let current: T[] = [];
  let size = 2; // the enclosing [ ]

  const wrap = (batch: T[]): SyncPart => ({ k: kind, items: batch } as SyncPart);

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

    // --- partitioned upload (protocol v2) ---------------------------------
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

/** Opens a new sync: clears the backup rows so parts start from a clean slate. */
function syncStart(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var backup = sheetNamed(ss, BACKUP_SHEET);
  backup.clear();

  var props = PropertiesService.getScriptProperties();
  props.setProperty('mygym_sync_id', String(payload.syncId || ''));
  props.setProperty('mygym_part_count', '0');

  return jsonOut({ status: 'success', scriptVersion: SCRIPT_VERSION, message: 'Upload started.' });
}

/** Stores one payload part as a row. Each part is already size-bounded. */
function syncPart(payload) {
  var props = PropertiesService.getScriptProperties();
  if (String(payload.syncId || '') !== props.getProperty('mygym_sync_id')) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Sync session expired. Start the sync again.' });
  }

  var serialized = JSON.stringify(payload.part);
  if (serialized.length > 49000) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Payload part is too large for a spreadsheet cell.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var backup = sheetNamed(ss, BACKUP_SHEET);
  backup.getRange(backup.getLastRow() + 1, 1).setValue(serialized);

  props.setProperty('mygym_part_count', String(parseInt(props.getProperty('mygym_part_count') || '0', 10) + 1));

  return jsonOut({ status: 'success', scriptVersion: SCRIPT_VERSION, part: payload.index });
}

/**
 * Closes the sync: reassembles the parts, writes the readable sheets from the
 * assembled data, and reports what was stored.
 */
function syncCommit(payload) {
  var props = PropertiesService.getScriptProperties();
  if (String(payload.syncId || '') !== props.getProperty('mygym_sync_id')) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'Sync session expired. Start the sync again.' });
  }

  var data = readParts();
  if (!data) {
    return jsonOut({ status: 'error', scriptVersion: SCRIPT_VERSION, message: 'No uploaded data found to commit.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  writeWorkoutLogSheet(ss, data.sets, data.sessions, data.exercises);
  writeSessionsSheet(ss, data.sessions, data.sets, data.exercises);
  writeExercisesSheet(ss, data.exercises);
  writeRoutinesSheet(ss, data.routines, data.routine_exercises, data.exercises);

  props.deleteProperty('mygym_sync_id');
  props.deleteProperty('mygym_part_count');

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

/** Single-request upload. Kept for small payloads and older clients. */
function syncWhole(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
}

/** Reads every stored part and merges it back into one payload. */
function readParts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var backup = ss.getSheetByName(BACKUP_SHEET);
  if (!backup || backup.getLastRow() < 1) return null;

  var values = backup.getRange(1, 1, backup.getLastRow(), 1).getValues();
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

function readBackup() {
  var data = readParts();
  if (!data) {
    return jsonOut({
      status: 'error',
      scriptVersion: SCRIPT_VERSION,
      message: 'No backup found in this Google Sheet yet. Perform a Sync first.'
    });
  }
  return jsonOut({ status: 'success', scriptVersion: SCRIPT_VERSION, data: data });
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
      session.date || '',
      session.name || '',
      exMap[s.exercise_id] || s.exercise_id,
      s.set_number,
      s.weight,
      s.reps,
      s.is_warmup ? 'YES' : 'NO',
      s.session_id,
      s.id
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
      s.date,
      s.name,
      s.duration_minutes,
      s.body_weight != null ? s.body_weight : '',
      (perSessionExercises[s.id] || []).length,
      setCount[s.id] || 0,
      reps[s.id] || 0,
      volume[s.id] || 0,
      s.notes || '',
      s.id
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
    rows.push([x.name, x.muscle_group, x.equipment, x.is_archived ? 'YES' : 'NO', x.id]);
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
        r.name,
        r.day_hint || '',
        l.order,
        exMap[l.exercise_id] || l.exercise_id,
        l.target_sets,
        l.target_reps,
        r.description || '',
        r.id
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
): Promise<{ success: boolean; message: string }> {
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
    if (res.status === 'success') {
      return { success: true, message: res.message || 'Connected successfully!' };
    }
    return { success: false, message: res.message || 'Error reported by Google Sheet' };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Could not connect to Google Apps Script. Please verify Web App deployment.'
    };
  }
}

/**
 * Single-request upload, used as a fallback for deployments still running the
 * v1 script. It works only while the payload fits in one POST (roughly 50 KB);
 * beyond that Apps Script rejects the request and the error is reported.
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
 * A deployment still running the older v1 script does not know those actions, so
 * the request falls back to the legacy single-shot upload — which keeps working
 * until the log grows past the POST limit, at which point the user is told to
 * update the script.
 */
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
  if (!isValidScriptUrl(webAppUrl)) {
    return { success: false, message: 'Missing or invalid Google Sheets Web App URL.' };
  }

  const key = secretKey?.trim() || undefined;
  const parts = buildSyncParts(exercises, routines, routineExercises, sessions, sets, settings);
  const syncId = `sync-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const UPDATE_HINT =
    ' This deployment is running an older Apps Script. Open MyGym > Settings > Google Sheets Backup, copy the updated code, and paste it into Apps Script (Deploy > Manage deployments > New version).';
  const isUnknownAction = (message?: string) => /unknown action/i.test(message || '');

  try {
    const start = await postToScript(webAppUrl, { action: 'sync-start', secretKey: key, syncId, partCount: parts.length });

    if (start.status !== 'success') {
      if (isUnknownAction(start.message)) {
        return await syncWholePayloadToScript(webAppUrl, parts, key);
      }
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
        if (isUnknownAction(res.message)) {
          return await syncWholePayloadToScript(webAppUrl, parts, key);
        }
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
      if (isUnknownAction(commit.message)) {
        return await syncWholePayloadToScript(webAppUrl, parts, key);
      }
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
    // A bare fetch failure on a v1 deployment means the single request exceeded
    // the POST limit — the one case where updating the script is required.
    if (/failed to fetch/i.test(message) && sets.length > 0) {
      return { success: false, message: message + UPDATE_HINT };
    }
    return { success: false, message };
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
