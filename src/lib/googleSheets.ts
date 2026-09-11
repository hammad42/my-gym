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

/** Bumped when the Apps Script template gains capabilities the client depends on. */
export const APPS_SCRIPT_PROTOCOL_VERSION = 1;

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
 * Google Apps Script template for the user to copy-paste into their Google Sheet.
 *
 * Two security properties matter here:
 *
 *  1. It fails CLOSED. The deployment instructions correctly say "Who has access:
 *     Anyone", so an unsecured script serves a complete training history to
 *     anyone holding the URL. This template refuses every request until
 *     SECRET_KEY has actually been changed, so the failure mode of not reading
 *     step 4 is "nothing works" rather than "wide open".
 *
 *  2. The stored backup never contains the key. The raw snapshot written to
 *     _MyGymBackup has the auth fields stripped first, so the credential that
 *     protects the sheet is not sitting inside the sheet.
 */
export const GOOGLE_APPS_SCRIPT_TEMPLATE = `/**
 * =========================================================================
 *  MYGYM PWA — Secure Google Sheets Webhook
 * =========================================================================
 *  Instructions:
 *  1. Open your Google Sheet (create a blank spreadsheet first).
 *  2. Go to: Extensions > Apps Script.
 *  3. Delete all code and paste this entire file.
 *  4. REQUIRED: change SECRET_KEY below to your own private password
 *     (at least 8 characters). Until you do, this webhook refuses every
 *     request — that is deliberate, because it is deployed publicly.
 *  5. Click "Deploy" (top right) > "New deployment".
 *  6. Click the gear icon next to "Select type" > select "Web app".
 *  7. Set:
 *     - Description: "MyGym Backup Sync"
 *     - Execute as: "Me" (your Google account)
 *     - Who has access: "Anyone" (HTTP access without browser cookie prompts)
 *  8. Click "Deploy", authorize access, and COPY the generated Web App URL.
 *  9. Paste the Web App URL AND the same Secret Key into MyGym under
 *     Settings > Google Sheets Backup.
 * =========================================================================
 */

// REQUIRED: replace this with your own private password (min 8 characters).
var SECRET_KEY = "CHANGE_THIS_TO_YOUR_PASSWORD";

var PLACEHOLDER_KEY = "CHANGE_THIS_TO_YOUR_PASSWORD";
var SCRIPT_VERSION = ${APPS_SCRIPT_PROTOCOL_VERSION};

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

    if (!isSecured()) {
      return notSecuredResponse();
    }

    // GET fetch keeps the key out of server logs only when sent via POST; this
    // legacy query-string form exists so the URL can be tested in a browser.
    var key = (e && e.parameter && e.parameter.key) ? e.parameter.key : '';
    if (key !== SECRET_KEY) {
      return unauthorizedResponse();
    }

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

    if (!isSecured()) {
      return notSecuredResponse();
    }

    var payload = JSON.parse(e.postData.contents);

    if (!payload.secretKey || payload.secretKey !== SECRET_KEY) {
      return unauthorizedResponse();
    }

    var action = payload.action || 'sync';

    if (action === 'test') {
      return jsonOut({
        status: 'success',
        scriptVersion: SCRIPT_VERSION,
        message: 'Authenticated and connected to your private Google Sheet!'
      });
    }

    if (action === 'fetch') {
      return readBackup();
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Write a readable training log (one row per set)
    writeWorkoutLogSheet(ss, payload.sets || [], payload.sessions || [], payload.exercises || []);

    // 2. Write a sessions summary sheet
    writeSessionsSheet(ss, payload.sessions || [], payload.sets || [], payload.exercises || []);

    // 3. Write the exercise library
    writeExercisesSheet(ss, payload.exercises || []);

    // 4. Write the routine plans
    writeRoutinesSheet(ss, payload.routines || [], payload.routine_exercises || [], payload.exercises || []);

    // 5. Save raw full backup in '_MyGymBackup' for 100% accurate self-recovery
    writeRawBackupSheet(ss, payload);

    return jsonOut({
      status: 'success',
      scriptVersion: SCRIPT_VERSION,
      message: 'Backup saved successfully to your private Google Sheet!',
      timestamp: new Date().toISOString(),
      counts: {
        sessions: (payload.sessions || []).length,
        sets: (payload.sets || []).length,
        exercises: (payload.exercises || []).length
      }
    });

  } catch (err) {
    return jsonOut({ status: 'error', message: err.toString() });
  }
}

function readBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var backupSheet = ss.getSheetByName('_MyGymBackup');
  if (!backupSheet) {
    return jsonOut({
      status: 'error',
      scriptVersion: SCRIPT_VERSION,
      message: 'No backup found in this Google Sheet yet. Perform a Sync first.'
    });
  }

  var jsonString = backupSheet.getRange('A1').getValue();
  if (!jsonString) {
    return jsonOut({
      status: 'error',
      scriptVersion: SCRIPT_VERSION,
      message: 'Backup sheet is empty.'
    });
  }

  return jsonOut({
    status: 'success',
    data: JSON.parse(jsonString)
  });
}

function writeWorkoutLogSheet(ss, sets, sessions, exercises) {
  var exMap = {};
  exercises.forEach(function(x) { exMap[x.id] = x.name; });

  var sessionMap = {};
  sessions.forEach(function(s) { sessionMap[s.id] = s; });

  var sheet = ss.getSheetByName('Workout Log');
  if (!sheet) {
    sheet = ss.insertSheet('Workout Log');
  } else {
    sheet.clear();
  }

  var headers = ['Date', 'Workout', 'Exercise', 'Set', 'Weight', 'Reps', 'Warmup', 'Session ID', 'Set ID'];
  var rows = [headers];

  // Sort ascending by date then set number
  var sorted = sets.slice().sort(function(a, b) {
    var da = (sessionMap[a.session_id] || {}).date || '';
    var db = (sessionMap[b.session_id] || {}).date || '';
    if (da !== db) return da < db ? -1 : 1;
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

  if (rows.length > 0) {
    sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
    formatHeader(sheet, headers.length);
  }
}

function writeSessionsSheet(ss, sessions, sets, exercises) {
  var exMap = {};
  exercises.forEach(function(x) { exMap[x.id] = x.name; });

  // Volume per session, computed once
  var volumeBySession = {};
  var repsBySession = {};
  sets.forEach(function(s) {
    if (!volumeBySession[s.session_id]) {
      volumeBySession[s.session_id] = 0;
      repsBySession[s.session_id] = 0;
    }
    volumeBySession[s.session_id] += (s.weight || 0) * (s.reps || 0);
    repsBySession[s.session_id] += (s.reps || 0);
  });

  var exerciseIdsBySession = {};
  sets.forEach(function(s) {
    if (!exerciseIdsBySession[s.session_id]) exerciseIdsBySession[s.session_id] = [];
    if (exerciseIdsBySession[s.session_id].indexOf(s.exercise_id) === -1) {
      exerciseIdsBySession[s.session_id].push(s.exercise_id);
    }
  });

  var sheet = ss.getSheetByName('Sessions');
  if (!sheet) {
    sheet = ss.insertSheet('Sessions');
  } else {
    sheet.clear();
  }

  var headers = ['Date', 'Workout', 'Duration (min)', 'Body Weight', 'Exercises', 'Sets', 'Total Reps', 'Volume', 'Notes', 'Session ID'];
  var rows = [headers];

  var sorted = sessions.slice().sort(function(a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });

  sorted.forEach(function(s) {
    var exIds = exerciseIdsBySession[s.id] || [];
    var names = exIds.map(function(id) { return exMap[id] || id; }).join(', ');
    rows.push([
      s.date,
      s.name,
      s.duration_minutes,
      s.body_weight != null ? s.body_weight : '',
      exIds.length,
      sets.filter(function(x) { return x.session_id === s.id; }).length,
      repsBySession[s.id] || 0,
      volumeBySession[s.id] || 0,
      s.notes || '',
      s.id
    ]);
  });

  if (rows.length > 0) {
    sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
    formatHeader(sheet, headers.length);
  }
}

function writeExercisesSheet(ss, exercises) {
  var sheet = ss.getSheetByName('Exercises');
  if (!sheet) {
    sheet = ss.insertSheet('Exercises');
  } else {
    sheet.clear();
  }

  var headers = ['Exercise', 'Muscle Group', 'Equipment', 'Archived', 'Exercise ID'];
  var rows = [headers];

  exercises.forEach(function(x) {
    rows.push([
      x.name,
      x.muscle_group,
      x.equipment,
      x.is_archived ? 'YES' : 'NO',
      x.id
    ]);
  });

  if (rows.length > 0) {
    sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
    formatHeader(sheet, headers.length);
  }
}

function writeRoutinesSheet(ss, routines, routineExercises, exercises) {
  var exMap = {};
  exercises.forEach(function(x) { exMap[x.id] = x.name; });

  var sheet = ss.getSheetByName('Routines');
  if (!sheet) {
    sheet = ss.insertSheet('Routines');
  } else {
    sheet.clear();
  }

  var headers = ['Routine', 'Day Hint', 'Order', 'Exercise', 'Target Sets', 'Target Reps', 'Description', 'Routine ID'];
  var rows = [headers];

  routines.forEach(function(r) {
    var lines = routineExercises
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

  if (rows.length > 0) {
    sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
    formatHeader(sheet, headers.length);
  }
}

function writeRawBackupSheet(ss, payload) {
  var sheet = ss.getSheetByName('_MyGymBackup');
  if (!sheet) {
    sheet = ss.insertSheet('_MyGymBackup');
  } else {
    sheet.clear();
  }

  // Never store the credential inside the thing it protects.
  var snapshot = {};
  for (var k in payload) {
    if (k === 'secretKey' || k === 'action') continue;
    snapshot[k] = payload[k];
  }
  if (snapshot.settings && snapshot.settings.google_sheets) {
    delete snapshot.settings.google_sheets.secretKey;
  }

  sheet.getRange('A1').setValue(JSON.stringify(snapshot));
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
 * Builds the complete export payload to send to Google Sheets.
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
    const response = await fetch(webAppUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'test', secretKey: secretKey?.trim() || undefined })
    });

    if (!response.ok) {
      return { success: false, message: `Server returned HTTP ${response.status}` };
    }

    const res = await response.json();
    if (res.status === 'success') {
      return { success: true, message: res.message || 'Connected successfully!' };
    } else {
      return { success: false, message: res.message || 'Error reported by Google Sheet' };
    }
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Could not connect to Google Apps Script. Please verify Web App deployment.'
    };
  }
}

/**
 * Sends current MyGym data to Google Sheets (Sync / Export).
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
    return {
      success: false,
      message: 'Missing or invalid Google Sheets Web App URL.'
    };
  }

  const payload = buildGoogleSheetsPayload(
    exercises,
    routines,
    routineExercises,
    sessions,
    sets,
    settings,
    'sync',
    secretKey
  );

  try {
    const response = await fetch(webAppUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return { success: false, message: `Google Sheets returned HTTP ${response.status}` };
    }

    const res: GoogleSheetsSyncResponse = await response.json();
    if (res.status === 'success') {
      return {
        success: true,
        message: res.message || 'Data backed up to Google Sheets successfully!',
        counts: res.counts,
        timestamp: res.timestamp || new Date().toISOString()
      };
    } else {
      return {
        success: false,
        message: res.message || 'Failed to save to Google Sheets.'
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Network error while connecting to Google Sheets.'
    };
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
    return {
      success: false,
      message: 'Missing or invalid Google Sheets Web App URL.'
    };
  }

  try {
    const response = await fetch(webAppUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'fetch', secretKey: secretKey?.trim() || undefined })
    });

    if (!response.ok) {
      return { success: false, message: `Google Sheets returned HTTP ${response.status}` };
    }

    const res: GoogleSheetsFetchResponse = await response.json();
    if (res.status === 'success' && res.data) {
      if (!Array.isArray(res.data.sessions) || !Array.isArray(res.data.sets)) {
        return {
          success: false,
          message: 'Google Sheet backup is missing required tables (sessions/sets).'
        };
      }
      return { success: true, data: res.data };
    }

    return {
      success: false,
      message: res.message || 'No backup found in Google Sheet.'
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Network error fetching backup from Google Sheets.'
    };
  }
}
