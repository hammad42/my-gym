import Dexie, { type Table } from 'dexie';
import { Exercise, Routine, RoutineExercise, WorkoutSession, SetLog, Settings } from '../types';
import {
  DEFAULT_EXERCISES,
  DEFAULT_ROUTINES,
  DEFAULT_ROUTINE_EXERCISES,
  DEFAULT_SETTINGS,
  generateSampleSessions
} from './sampleData';
import { mergeRestoredSettings } from './sanitize';
// Type-only: erased at build time, so this does not create a runtime cycle with
// drafts.ts, which imports `db` from here.
import type { WorkoutDraft } from './drafts';

export class GymDatabase extends Dexie {
  exercises!: Table<Exercise, string>;
  routines!: Table<Routine, string>;
  routine_exercises!: Table<RoutineExercise, string>;
  sessions!: Table<WorkoutSession, string>;
  sets!: Table<SetLog, string>;
  settings!: Table<Settings, string>;
  drafts!: Table<WorkoutDraft, string>;

  constructor() {
    super('GymDatabase');

    this.version(1).stores({
      exercises: 'id, name, muscle_group, equipment, is_default, is_archived',
      routines: 'id, name, is_archived',
      routine_exercises: 'id, routine_id, exercise_id, order',
      sessions: 'id, date, routine_id, created_at',
      sets: 'id, session_id, exercise_id, set_number, created_at',
      settings: 'id'
    });

    // v2: in-progress workout drafts, so a tab switch mid-workout is no longer
    // data loss. Additive — existing installs upgrade in place.
    this.version(2).stores({
      drafts: 'id, updatedAt'
    });

    this.on('populate', () => {
      this.exercises.bulkAdd(DEFAULT_EXERCISES);
      this.routines.bulkAdd(DEFAULT_ROUTINES);
      this.routine_exercises.bulkAdd(DEFAULT_ROUTINE_EXERCISES);
      this.settings.add(DEFAULT_SETTINGS);
      this.bulkAddSampleLogs();
    });
  }

  private async bulkAddSampleLogs() {
    const { sessions, sets } = generateSampleSessions();
    this.sessions.bulkAdd(sessions);
    this.sets.bulkAdd(sets);
  }
}

export const db = new GymDatabase();

/**
 * Requests the browser to mark storage as persistent (prevents OS/browser from
 * evicting IndexedDB under storage pressure)
 */
export async function requestStoragePersistence(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Initializes the database if empty or opens it.
 */
export async function initializeDatabase(): Promise<void> {
  // Proactively request persistent storage from mobile Chrome / Safari
  requestStoragePersistence().catch(() => {});

  await db.open();
  const exCount = await db.exercises.count();
  if (exCount === 0) {
    await db.exercises.bulkAdd(DEFAULT_EXERCISES);
    await db.routines.bulkAdd(DEFAULT_ROUTINES);
    await db.routine_exercises.bulkAdd(DEFAULT_ROUTINE_EXERCISES);
    await db.settings.put(DEFAULT_SETTINGS);
    const { sessions, sets } = generateSampleSessions();
    await db.sessions.bulkAdd(sessions);
    await db.sets.bulkAdd(sets);
  }
}

/**
 * Shape accepted from any backup source (JSON file or Google Sheets). Tables the
 * payload omits fall back to an empty list rather than leaving stale local rows.
 */
export interface RestorableData {
  exercises?: Exercise[];
  routines?: Routine[];
  routine_exercises?: RoutineExercise[];
  sessions?: WorkoutSession[];
  sets?: SetLog[];
  settings?: Settings;
}

export interface RestoreReport {
  exercises: number;
  routines: number;
  sessions: number;
  sets: number;
}

/**
 * Replaces the local database with a backup, atomically.
 *
 * Settings are merged rather than overwritten: a backup is always sanitized, so
 * the incoming copy carries no Sheets secret, and writing it verbatim would
 * silently kill the scheduled backup. `mergeRestoredSettings` keeps this
 * device's own credential (see lib/sanitize.ts).
 *
 * `localSettings` lets the caller supply the authoritative current row. The UI
 * holds the live settings it is rendering, and passing them in keeps the
 * credential guarantee true even if the stored row is momentarily behind it.
 */
export async function restoreFromBackup(
  data: RestorableData,
  localSettings?: Settings
): Promise<RestoreReport> {
  // A restore that leaves no exercise library would silently break logging and
  // history rendering, so an empty list falls back to the shipped defaults.
  const exercises = data.exercises && data.exercises.length > 0 ? data.exercises : DEFAULT_EXERCISES;
  const routines = data.routines ?? [];
  const routineExercises = data.routine_exercises ?? [];
  const sessions = data.sessions ?? [];
  const sets = data.sets ?? [];

  const currentSettings = localSettings ?? (await db.settings.get('general')) ?? DEFAULT_SETTINGS;
  const nextSettings = mergeRestoredSettings(data.settings, currentSettings);

  await db.transaction(
    'rw',
    [db.exercises, db.routines, db.routine_exercises, db.sessions, db.sets, db.settings],
    async () => {
      await db.exercises.clear();
      await db.routines.clear();
      await db.routine_exercises.clear();
      await db.sessions.clear();
      await db.sets.clear();

      if (exercises.length > 0) await db.exercises.bulkAdd(exercises);
      if (routines.length > 0) await db.routines.bulkAdd(routines);
      if (routineExercises.length > 0) await db.routine_exercises.bulkAdd(routineExercises);
      if (sessions.length > 0) await db.sessions.bulkAdd(sessions);
      if (sets.length > 0) await db.sets.bulkAdd(sets);

      await db.settings.put(nextSettings);
    }
  );

  return {
    exercises: exercises.length,
    routines: routines.length,
    sessions: sessions.length,
    sets: sets.length
  };
}

/**
 * Reset and reload initial sample data.
 *
 * Preferences go back to defaults, but the Google Sheets sync configuration is
 * preserved — including its secret key. Wiping it here would silently disable
 * the backup the user had already set up, with no warning that it happened.
 */
export async function resetDatabaseWithSampleData(): Promise<void> {
  const existing = await db.settings.get('general');

  await db.transaction(
    'rw',
    [db.exercises, db.routines, db.routine_exercises, db.sessions, db.sets, db.settings],
    async () => {
      await db.exercises.clear();
      await db.routines.clear();
      await db.routine_exercises.clear();
      await db.sessions.clear();
      await db.sets.clear();
      await db.settings.clear();

      await db.exercises.bulkAdd(DEFAULT_EXERCISES);
      await db.routines.bulkAdd(DEFAULT_ROUTINES);
      await db.routine_exercises.bulkAdd(DEFAULT_ROUTINE_EXERCISES);
      await db.settings.put({
        ...DEFAULT_SETTINGS,
        ...(existing?.google_sheets ? { google_sheets: existing.google_sheets } : {})
      });
      const { sessions, sets } = generateSampleSessions();
      await db.sessions.bulkAdd(sessions);
      await db.sets.bulkAdd(sets);
    }
  );
}

/**
 * Clear all logged data (sessions + sets) for a fresh clean start. Keeps the
 * exercise library, routines and settings intact.
 */
export async function clearAllLogs(): Promise<void> {
  await db.transaction('rw', [db.sessions, db.sets], async () => {
    await db.sessions.clear();
    await db.sets.clear();
  });
}

/** Delete a session together with every set that references it. */
export async function deleteSession(sessionId: string): Promise<void> {
  await db.transaction('rw', [db.sessions, db.sets], async () => {
    await db.sets.where('session_id').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}

export const LB_PER_KG = 2.2046226218;

/**
 * Rewrites every stored weight into the target unit, in one transaction.
 *
 * Weights are dimensionless floats in the database, so "switching units" in the
 * settings would silently relabel six months of kilograms as pounds. The only
 * correct move is to convert the data itself, which is why the settings screen
 * asks for confirmation first and reports what it changed.
 *
 * Rounding to 2 decimals keeps plate math readable; a kg -> lb -> kg round trip
 * stays within 0.01 of the original.
 */
export async function convertStoredWeights(target: 'kg' | 'lb'): Promise<{ sets: number; sessions: number }> {
  const factor = target === 'lb' ? LB_PER_KG : 1 / LB_PER_KG;
  let setCount = 0;
  let sessionCount = 0;

  await db.transaction('rw', [db.sets, db.sessions], async () => {
    await db.sets
      .filter((s) => s.weight > 0)
      .modify((s) => {
        s.weight = Math.round(s.weight * factor * 100) / 100;
        setCount++;
      });

    await db.sessions
      .filter((s) => (s.body_weight ?? 0) > 0)
      .modify((s) => {
        if (s.body_weight != null) {
          s.body_weight = Math.round(s.body_weight * factor * 100) / 100;
          sessionCount++;
        }
      });
  });

  return { sets: setCount, sessions: sessionCount };
}

/** Save a full workout: one session row plus its set rows, atomically. */
export async function saveWorkout(
  session: WorkoutSession,
  sets: Omit<SetLog, 'session_id' | 'created_at'>[]
): Promise<void> {
  await db.transaction('rw', [db.sessions, db.sets], async () => {
    await db.sessions.add(session);
    if (sets.length > 0) {
      await db.sets.bulkAdd(
        sets.map((s) => ({
          ...s,
          id: s.id || `set-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          session_id: session.id,
          created_at: new Date().toISOString()
        }))
      );
    }
  });
}

/**
 * Replace a routine's planned exercises in one atomic write. `lines` arrives in
 * display order; `order` is rewritten 1..N here so callers never have to.
 */
export async function saveRoutineExercises(
  routineId: string,
  lines: { exercise_id: string; target_sets: number; target_reps: number }[]
): Promise<void> {
  await db.transaction('rw', [db.routine_exercises], async () => {
    await db.routine_exercises.where('routine_id').equals(routineId).delete();
    await db.routine_exercises.bulkAdd(
      lines.map((line, index) => ({
        id: `rex-${routineId}-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
        routine_id: routineId,
        exercise_id: line.exercise_id,
        order: index + 1,
        target_sets: line.target_sets,
        target_reps: line.target_reps
      }))
    );
  });
}
