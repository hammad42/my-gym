import { Exercise, Routine, RoutineExercise, WorkoutSession, SetLog, Settings, MuscleGroup, Equipment, ExerciseMetric } from '../types';
import { sanitizeSettings } from './sanitize';

export interface BackupPayload {
  app: 'mygym';
  version: 1;
  exported_at: string;
  exercises: Exercise[];
  routines: Routine[];
  routine_exercises: RoutineExercise[];
  sessions: WorkoutSession[];
  sets: SetLog[];
  settings: Settings;
}

export interface ValidatedBackup {
  exercises: Exercise[];
  routines: Routine[];
  routine_exercises: RoutineExercise[];
  sessions: WorkoutSession[];
  sets: SetLog[];
  settings?: Partial<Settings>;
  exported_at?: string;
  pendingSheetsUrl?: string;
  warnings: string[];
}

export interface BackupValidationResult {
  valid: boolean;
  errors: string[];
  data?: ValidatedBackup;
}

/**
 * Builds the downloadable backup.
 *
 * Settings are sanitized first: an exported file is something people email to
 * themselves or drop in cloud storage, so the Sheets secret key must not ride
 * along in it.
 */
export function buildBackup(
  exercises: Exercise[],
  routines: Routine[],
  routineExercises: RoutineExercise[],
  sessions: WorkoutSession[],
  sets: SetLog[],
  settings: Settings
): BackupPayload {
  return {
    app: 'mygym',
    version: 1,
    exported_at: new Date().toISOString(),
    exercises,
    routines,
    routine_exercises: routineExercises,
    sessions,
    sets,
    settings: sanitizeSettings(settings)
  };
}

const VALID_MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'forearms', 'traps', 'cardio', 'full_body', 'other'
];

const VALID_EQUIPMENT: Equipment[] = [
  'barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell', 'other'
];

const VALID_METRICS: ExerciseMetric[] = ['reps', 'seconds', 'minutes'];

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

/** True only for a real calendar date — prevents silent rollovers like Feb 31 -> Mar 3. */
export function isRealDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}

export function isValidCalendarDate(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string') return false;
  const isoMatch = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!isoMatch) return false;
  const y = Number(isoMatch[1]);
  const m = Number(isoMatch[2]);
  const d = Number(isoMatch[3]);
  return isRealDate(y, m, d);
}

/**
 * Validates a parsed JSON backup before any data touches IndexedDB.
 *
 * Enforces:
 * 1. Required top-level lists. If routine_exercises is missing, warns and defaults to empty.
 * 2. Real calendar dates (preventing JS Date rollover bugs).
 * 3. Coercing exercise enum mismatches to 'other' (avoiding cascade-deletion of historical sets).
 * 4. Referential integrity: dropped orphaned sets or routine_exercises with named warnings.
 * 5. Extraction of incoming google_sheets.webAppUrl into pendingSheetsUrl (no silent hijack).
 */
export function validateBackupJson(parsed: unknown): BackupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(parsed)) {
    return { valid: false, errors: ['Backup file is not a valid JSON object.'] };
  }

  if (parsed.app !== 'mygym') {
    return { valid: false, errors: ['Backup file is not a MyGym backup (missing app: "mygym").'] };
  }

  if (!Array.isArray(parsed.exercises) || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.sets)) {
    return {
      valid: false,
      errors: ['Backup file is missing required tables (exercises, sessions, or sets).']
    };
  }

  // 1. Exercises
  const exercises: Exercise[] = [];
  let droppedExercises = 0;
  for (const raw of parsed.exercises) {
    if (!isObject(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.name)) {
      droppedExercises++;
      continue;
    }

    let muscle_group = raw.muscle_group as MuscleGroup;
    if (!VALID_MUSCLE_GROUPS.includes(muscle_group)) {
      warnings.push(`Exercise "${raw.name}" had unrecognized muscle group "${String(raw.muscle_group)}"; coerced to "other".`);
      muscle_group = 'other';
    }

    let equipment = raw.equipment as Equipment;
    if (!VALID_EQUIPMENT.includes(equipment)) {
      warnings.push(`Exercise "${raw.name}" had unrecognized equipment "${String(raw.equipment)}"; coerced to "other".`);
      equipment = 'other';
    }

    let metric: ExerciseMetric | undefined = undefined;
    if (raw.metric) {
      metric = VALID_METRICS.includes(raw.metric as ExerciseMetric) ? (raw.metric as ExerciseMetric) : 'reps';
    }

    exercises.push({
      id: raw.id.trim(),
      name: raw.name.trim(),
      muscle_group,
      equipment,
      icon: isNonEmptyString(raw.icon) ? raw.icon : 'Dumbbell',
      color: isNonEmptyString(raw.color) ? raw.color : '#f97316',
      is_default: Boolean(raw.is_default),
      is_archived: Boolean(raw.is_archived),
      ...(metric ? { metric } : {}),
      created_at: isNonEmptyString(raw.created_at) ? raw.created_at : new Date().toISOString()
    });
  }

  if (droppedExercises > 0) {
    warnings.push(`${droppedExercises} exercise(s) were missing required id or name and were dropped.`);
  }

  if (exercises.length === 0) {
    errors.push('Backup contains no valid exercises.');
  }

  const validExerciseIds = new Set(exercises.map((e) => e.id));

  // 2. Routines
  const routines: Routine[] = [];
  if (Array.isArray(parsed.routines)) {
    for (const raw of parsed.routines) {
      if (!isObject(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.name)) {
        continue;
      }
      routines.push({
        id: raw.id.trim(),
        name: raw.name.trim(),
        day_hint: typeof raw.day_hint === 'string' ? raw.day_hint : '',
        description: typeof raw.description === 'string' ? raw.description : '',
        color: isNonEmptyString(raw.color) ? raw.color : '#f97316',
        icon: isNonEmptyString(raw.icon) ? raw.icon : 'Dumbbell',
        is_archived: Boolean(raw.is_archived),
        created_at: isNonEmptyString(raw.created_at) ? raw.created_at : new Date().toISOString()
      });
    }
  }

  const validRoutineIds = new Set(routines.map((r) => r.id));

  // 3. Routine Exercises
  const routine_exercises: RoutineExercise[] = [];
  if (!Array.isArray(parsed.routine_exercises)) {
    warnings.push('The backup did not include routine exercise plans; routines will have empty exercise lists.');
  } else {
    let droppedRoutineLines = 0;
    for (const raw of parsed.routine_exercises) {
      if (!isObject(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.routine_id) || !isNonEmptyString(raw.exercise_id)) {
        droppedRoutineLines++;
        continue;
      }

      if (!validRoutineIds.has(raw.routine_id.trim()) || !validExerciseIds.has(raw.exercise_id.trim())) {
        droppedRoutineLines++;
        continue;
      }

      routine_exercises.push({
        id: raw.id.trim(),
        routine_id: raw.routine_id.trim(),
        exercise_id: raw.exercise_id.trim(),
        order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
        target_sets: Number.isFinite(Number(raw.target_sets)) && Number(raw.target_sets) > 0 ? Number(raw.target_sets) : 3,
        target_reps: Number.isFinite(Number(raw.target_reps)) && Number(raw.target_reps) > 0 ? Number(raw.target_reps) : 10
      });
    }
    if (droppedRoutineLines > 0) {
      warnings.push(`${droppedRoutineLines} routine exercise line(s) referenced deleted routines or exercises and were dropped.`);
    }
  }

  // 4. Sessions
  const sessions: WorkoutSession[] = [];
  let droppedSessions = 0;
  for (const raw of parsed.sessions) {
    if (!isObject(raw) || !isNonEmptyString(raw.id) || !isValidCalendarDate(raw.date)) {
      droppedSessions++;
      continue;
    }

    const duration = Number(raw.duration_minutes);
    const bodyWeight = raw.body_weight != null ? Number(raw.body_weight) : undefined;

    sessions.push({
      id: raw.id.trim(),
      date: (raw.date as string).slice(0, 10),
      name: typeof raw.name === 'string' ? raw.name : 'Workout',
      duration_minutes: Number.isFinite(duration) && duration >= 0 ? duration : 0,
      routine_id: isNonEmptyString(raw.routine_id) && validRoutineIds.has(raw.routine_id.trim()) ? raw.routine_id.trim() : null,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      body_weight: bodyWeight != null && Number.isFinite(bodyWeight) && bodyWeight > 0 ? bodyWeight : null,
      created_at: isNonEmptyString(raw.created_at) ? raw.created_at : new Date().toISOString()
    });
  }

  if (droppedSessions > 0) {
    warnings.push(`${droppedSessions} workout session(s) had invalid IDs or impossible dates and were dropped.`);
  }

  const validSessionIds = new Set(sessions.map((s) => s.id));

  // 5. Sets
  const sets: SetLog[] = [];
  let droppedSets = 0;
  for (const raw of parsed.sets) {
    if (!isObject(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.session_id) || !isNonEmptyString(raw.exercise_id)) {
      droppedSets++;
      continue;
    }

    // Referential integrity
    if (!validSessionIds.has(raw.session_id.trim()) || !validExerciseIds.has(raw.exercise_id.trim())) {
      droppedSets++;
      continue;
    }

    const weight = Number(raw.weight);
    const reps = Number(raw.reps);

    if (!Number.isFinite(weight) || weight < 0 || !Number.isFinite(reps) || reps < 0) {
      droppedSets++;
      continue;
    }

    sets.push({
      id: raw.id.trim(),
      session_id: raw.session_id.trim(),
      exercise_id: raw.exercise_id.trim(),
      set_number: Number.isFinite(Number(raw.set_number)) ? Number(raw.set_number) : 1,
      weight: Math.round(weight * 100) / 100,
      reps: Math.round(reps * 100) / 100,
      is_warmup: Boolean(raw.is_warmup),
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      created_at: isNonEmptyString(raw.created_at) ? raw.created_at : new Date().toISOString()
    });
  }

  if (droppedSets > 0) {
    warnings.push(`${droppedSets} set(s) had invalid weights/reps or referenced deleted sessions/exercises and were dropped.`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 6. Settings
  let settings: Partial<Settings> | undefined;
  let pendingSheetsUrl: string | undefined;

  if (isObject(parsed.settings)) {
    const raw = parsed.settings;
    settings = {};

    if (raw.weight_unit === 'kg' || raw.weight_unit === 'lb') {
      settings.weight_unit = raw.weight_unit;
    }

    // Destination Hijack Protection: Never apply incoming google_sheets automatically.
    if (isObject(raw.google_sheets) && isNonEmptyString(raw.google_sheets.webAppUrl)) {
      pendingSheetsUrl = raw.google_sheets.webAppUrl.trim();
      warnings.push('The backup contained a Google Sheets sync destination. It was NOT applied — review and confirm it in Settings.');
    }
  }

  return {
    valid: true,
    errors: [],
    data: {
      exercises,
      routines,
      routine_exercises,
      sessions,
      sets,
      settings,
      exported_at: isNonEmptyString(parsed.exported_at) ? parsed.exported_at : undefined,
      pendingSheetsUrl,
      warnings
    }
  };
}

export function isBackupPayload(data: unknown): data is BackupPayload {
  const result = validateBackupJson(data);
  return result.valid;
}

/**
 * Triggers a browser file download for backup JSON.
 *
 * Device compatibility:
 * - On iOS Safari / PWAs, uses navigator.share({ files: [file] }) when available
 *   because the anchor click trick silently no-ops on iOS.
 * - On desktop / Android, creates a hidden anchor with rel="noopener", triggers click,
 *   and revokes the Object URL on a 10s delay to prevent the download start race.
 */
export function downloadBackup(payload: BackupPayload): void {
  const json = JSON.stringify(payload, null, 2);
  const filename = `mygym-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], filename, { type: 'application/json' });

  const canShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files: [file] });
  const isIOS =
    typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  if (isIOS && canShare) {
    navigator.share({ files: [file] }).catch(() => {
      // User dismissed share sheet — nothing to clean up.
    });
    return;
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
