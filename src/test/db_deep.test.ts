import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  db,
  initializeDatabase,
  restoreFromBackup,
  clearAllLogs,
  deleteSession,
  saveWorkout,
  saveRoutineExercises,
  resetDatabaseWithSampleData
} from '../lib/db';
import { buildBackup, isBackupPayload } from '../lib/exportImport';
import { containsSecrets } from '../lib/sanitize';
import { WorkoutSession, SetLog, Settings } from '../types';
import { DEFAULT_EXERCISES } from '../lib/sampleData';

const SHEETS_SETTINGS: Partial<Settings> = {
  google_sheets: {
    enabled: true,
    webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    secretKey: 'the-device-secret',
    autoSyncTwiceDaily: true,
    lastSyncStatus: 'success'
  }
};

function makeSession(id: string, date = '2026-09-01'): WorkoutSession {
  return {
    id,
    name: `Session ${id}`,
    date,
    routine_id: null,
    duration_minutes: 60,
    body_weight: 80,
    notes: '',
    created_at: new Date().toISOString()
  };
}

function makeSets(_sessionId: string, count = 3): Omit<SetLog, 'session_id' | 'created_at'>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: '',
    exercise_id: 'ex-bench',
    set_number: i + 1,
    weight: 80,
    reps: 5,
    is_warmup: i === 0
  }));
}

describe('database integrity (deep)', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  beforeEach(async () => {
    // A stable starting point for every case below.
    await resetDatabaseWithSampleData();
  });

  // --- seeding ------------------------------------------------------------

  it('seeds a coherent demo dataset', async () => {
    const [exercises, routines, lines, sessions, sets, settings] = await Promise.all([
      db.exercises.toArray(),
      db.routines.toArray(),
      db.routine_exercises.toArray(),
      db.sessions.toArray(),
      db.sets.toArray(),
      db.settings.get('general')
    ]);

    expect(exercises.length).toBeGreaterThan(15);
    expect(routines.length).toBe(3);
    expect(sessions.length).toBeGreaterThan(10);
    expect(sets.length).toBeGreaterThan(50);
    expect(settings?.weekly_goal).toBe(4);

    // Referential integrity: nothing dangles.
    const exerciseIds = new Set(exercises.map((e) => e.id));
    const routineIds = new Set(routines.map((r) => r.id));
    const sessionIds = new Set(sessions.map((s) => s.id));

    expect(lines.every((l) => exerciseIds.has(l.exercise_id) && routineIds.has(l.routine_id))).toBe(true);
    expect(sets.every((s) => exerciseIds.has(s.exercise_id) && sessionIds.has(s.session_id))).toBe(true);
    expect(sessions.every((s) => !s.routine_id || routineIds.has(s.routine_id))).toBe(true);
  });

  it('never seeds duplicate primary keys', async () => {
    const [exercises, sets] = await Promise.all([db.exercises.toArray(), db.sets.toArray()]);
    expect(new Set(exercises.map((e) => e.id)).size).toBe(exercises.length);
    expect(new Set(sets.map((s) => s.id)).size).toBe(sets.length);
  });

  // --- workout writes -----------------------------------------------------

  it('saveWorkout assigns unique ids and preserves data exactly', async () => {
    await saveWorkout(makeSession('s-a'), makeSets('s-a', 4));

    const stored = await db.sets.where('session_id').equals('s-a').toArray();
    expect(stored).toHaveLength(4);
    expect(new Set(stored.map((s) => s.id)).size).toBe(4);
    expect(stored.every((s) => s.created_at)).toBe(true);
    expect(stored.filter((s) => s.is_warmup)).toHaveLength(1);
    expect(stored.map((s) => s.set_number).sort()).toEqual([1, 2, 3, 4]);
  });

  it('saveWorkout with zero sets still records the session', async () => {
    await saveWorkout(makeSession('s-empty'), []);
    expect(await db.sessions.get('s-empty')).toBeDefined();
    expect(await db.sets.where('session_id').equals('s-empty').toArray()).toHaveLength(0);
  });

  it('saveWorkout is atomic — a duplicate session id writes no orphan sets', async () => {
    await saveWorkout(makeSession('s-dup'), makeSets('s-dup', 2));
    const before = await db.sets.where('session_id').equals('s-dup').toArray();

    await expect(saveWorkout(makeSession('s-dup'), makeSets('s-dup', 2))).rejects.toThrow();

    const after = await db.sets.where('session_id').equals('s-dup').toArray();
    expect(after).toHaveLength(before.length); // no partial second write
  });

  it('deleteSession removes the session and only its own sets', async () => {
    await saveWorkout(makeSession('s-1'), makeSets('s-1', 3));
    await saveWorkout(makeSession('s-2'), makeSets('s-2', 2));

    await deleteSession('s-1');

    expect(await db.sessions.get('s-1')).toBeUndefined();
    expect(await db.sets.where('session_id').equals('s-1').toArray()).toHaveLength(0);
    expect(await db.sets.where('session_id').equals('s-2').toArray()).toHaveLength(2);
  });

  it('clearAllLogs keeps the library, routines and sheets config', async () => {
    await db.settings.update('general', SHEETS_SETTINGS);
    const exercisesBefore = await db.exercises.count();
    const routinesBefore = await db.routines.count();

    await clearAllLogs();

    expect(await db.sessions.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
    expect(await db.exercises.count()).toBe(exercisesBefore);
    expect(await db.routines.count()).toBe(routinesBefore);
    expect((await db.settings.get('general'))?.google_sheets?.secretKey).toBe('the-device-secret');
  });

  // --- routines -----------------------------------------------------------

  it('saveRoutineExercises replaces rather than appends, and renumbers 1..N', async () => {
    await saveRoutineExercises('routine-push', [
      { exercise_id: 'ex-squat', target_sets: 4, target_reps: 6 },
      { exercise_id: 'ex-bench', target_sets: 3, target_reps: 8 },
      { exercise_id: 'ex-curl', target_sets: 2, target_reps: 12 }
    ]);

    const lines = (await db.routine_exercises.where('routine_id').equals('routine-push').toArray()).sort(
      (a, b) => a.order - b.order
    );
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.order)).toEqual([1, 2, 3]);
    expect(lines.map((l) => l.exercise_id)).toEqual(['ex-squat', 'ex-bench', 'ex-curl']);

    // Second write fully replaces the first.
    await saveRoutineExercises('routine-push', [{ exercise_id: 'ex-ohp', target_sets: 5, target_reps: 5 }]);
    const after = await db.routine_exercises.where('routine_id').equals('routine-push').toArray();
    expect(after).toHaveLength(1);
    expect(after[0].exercise_id).toBe('ex-ohp');
  });

  it('saveRoutineExercises with an empty list clears the plan', async () => {
    await saveRoutineExercises('routine-pull', []);
    expect(await db.routine_exercises.where('routine_id').equals('routine-pull').toArray()).toHaveLength(0);
  });

  it('saveRoutineExercises only touches the target routine', async () => {
    const before = await db.routine_exercises.where('routine_id').equals('routine-legs').toArray();
    await saveRoutineExercises('routine-push', [{ exercise_id: 'ex-bench', target_sets: 3, target_reps: 5 }]);
    const after = await db.routine_exercises.where('routine_id').equals('routine-legs').toArray();
    expect(after.length).toBe(before.length);
  });

  // --- reset behaviour ----------------------------------------------------

  it('resetDatabaseWithSampleData preserves the Sheets credential', async () => {
    await db.settings.update('general', SHEETS_SETTINGS);
    await db.settings.update('general', { weekly_goal: 7 });

    await resetDatabaseWithSampleData();

    const settings = await db.settings.get('general');
    expect(settings?.google_sheets?.secretKey).toBe('the-device-secret');
    expect(settings?.google_sheets?.webAppUrl).toBe(SHEETS_SETTINGS.google_sheets!.webAppUrl);
    // Preferences themselves return to defaults, as the action promises.
    expect(settings?.weekly_goal).toBe(4);
  });

  it('resetDatabaseWithSampleData leaves no orphan sets behind', async () => {
    await saveWorkout(makeSession('custom'), makeSets('custom', 2));
    await resetDatabaseWithSampleData();

    const sessions = await db.sessions.toArray();
    const sets = await db.sets.toArray();
    const sessionIds = new Set(sessions.map((s) => s.id));
    expect(sets.every((s) => sessionIds.has(s.session_id))).toBe(true);
    expect(sessionIds.has('custom')).toBe(false);
  });
});

describe('restoreFromBackup — "load data from sheet" path (deep)', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  beforeEach(async () => {
    await resetDatabaseWithSampleData();
    await db.settings.update('general', SHEETS_SETTINGS);
  });

  it('replaces local data with the incoming backup and reports counts', async () => {
    const incoming = {
      exercises: DEFAULT_EXERCISES.slice(0, 5),
      routines: [],
      routine_exercises: [],
      sessions: [makeSession('from-sheet-1'), makeSession('from-sheet-2', '2026-09-02')],
      sets: [
        { id: 'x1', session_id: 'from-sheet-1', exercise_id: 'ex-bench', set_number: 1, weight: 100, reps: 5, is_warmup: false, notes: '', created_at: '2026-09-01T10:00:00.000Z' }
      ]
    };

    const report = await restoreFromBackup(incoming);

    expect(report).toEqual({ exercises: 5, routines: 0, sessions: 2, sets: 1 });
    expect(await db.sessions.count()).toBe(2);
    expect(await db.sets.count()).toBe(1);
    expect(await db.exercises.count()).toBe(5);
    const stored = await db.sets.get('x1');
    expect(stored?.weight).toBe(100);
  });

  it('keeps this device\u2019s Sheets secret (the backup never contains one)', async () => {
    const backup = {
      exercises: DEFAULT_EXERCISES,
      sessions: [makeSession('r1')],
      sets: [],
      // What a sheet actually stores: config present, credential stripped.
      settings: {
        id: 'general',
        weight_unit: 'kg' as const,
        weekly_goal: 6,
        default_rest_seconds: 120,
        google_sheets: {
          enabled: true,
          webAppUrl: 'https://script.google.com/macros/s/abc/exec',
          autoSyncTwiceDaily: true
        }
      }
    };

    await restoreFromBackup(backup);

    const settings = await db.settings.get('general');
    expect(settings?.google_sheets?.secretKey).toBe('the-device-secret');
    // Non-secret values from the backup are honoured.
    expect(settings?.weekly_goal).toBe(6);
    expect(settings?.default_rest_seconds).toBe(120);
  });

  it('survives a full export -> restore round trip losslessly', async () => {
    await saveWorkout(makeSession('rt-1'), makeSets('rt-1', 3));
    await saveWorkout(makeSession('rt-2', '2026-09-05'), makeSets('rt-2', 2));

    const [exercises, routines, lines, sessions, sets, settings] = await Promise.all([
      db.exercises.toArray(),
      db.routines.toArray(),
      db.routine_exercises.toArray(),
      db.sessions.toArray(),
      db.sets.toArray(),
      db.settings.get('general')
    ]);

    const backup = buildBackup(exercises, routines, lines, sessions, sets, settings!);
    expect(containsSecrets(backup.settings)).toBe(false); // export is sanitized

    // Wipe, then restore from that exact export.
    await clearAllLogs();
    await db.exercises.clear();
    await db.routines.clear();
    await db.routine_exercises.clear();
    expect(await db.sessions.count()).toBe(0);

    const report = await restoreFromBackup(backup);
    expect(report.sessions).toBe(sessions.length);
    expect(report.sets).toBe(sets.length);

    const restoredSessions = await db.sessions.toArray();
    const restoredSets = await db.sets.toArray();
    expect(restoredSessions.map((s) => s.id).sort()).toEqual(sessions.map((s) => s.id).sort());
    expect(restoredSets.map((s) => s.id).sort()).toEqual(sets.map((s) => s.id).sort());

    // Field-level fidelity for one set.
    const before = sets.find((s) => s.id === 'set-rt-1-0') ?? sets[0];
    const after = restoredSets.find((s) => s.id === before.id);
    expect(after).toEqual(before);
  });

  it('falls back to the shipped library when a backup carries none', async () => {
    const report = await restoreFromBackup({ sessions: [], sets: [] });
    expect(report.exercises).toBe(DEFAULT_EXERCISES.length);
    expect(await db.exercises.count()).toBe(DEFAULT_EXERCISES.length);
  });

  it('treats missing tables as empty instead of leaving stale rows', async () => {
    await saveWorkout(makeSession('stale'), makeSets('stale', 2));
    expect(await db.sessions.count()).toBeGreaterThan(0);

    await restoreFromBackup({ exercises: DEFAULT_EXERCISES });

    expect(await db.sessions.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
    expect(await db.routines.count()).toBe(0);
  });

  it('accepts a payload that still carries a secret without adopting it', async () => {
    await restoreFromBackup({
      exercises: DEFAULT_EXERCISES,
      sessions: [],
      sets: [],
      settings: {
        id: 'general',
        weight_unit: 'kg',
        weekly_goal: 4,
        default_rest_seconds: 90,
        google_sheets: {
          enabled: true,
          webAppUrl: 'https://script.google.com/macros/s/other/exec',
          secretKey: 'attacker-supplied',
          autoSyncTwiceDaily: true
        }
      }
    });

    const settings = await db.settings.get('general');
    expect(settings?.google_sheets?.secretKey).toBe('the-device-secret');
  });

  it('restores a large backup without losing rows', async () => {
    const sessions = Array.from({ length: 60 }, (_, i) => makeSession(`bulk-${i}`, `2026-08-${String((i % 28) + 1).padStart(2, '0')}`));
    const sets = sessions.flatMap((s, i) =>
      Array.from({ length: 4 }, (_, j) => ({
        id: `bulk-set-${i}-${j}`,
        session_id: s.id,
        exercise_id: 'ex-bench',
        set_number: j + 1,
        weight: 60 + j * 5,
        reps: 8,
        is_warmup: false,
        notes: '',
        created_at: '2026-08-01T10:00:00.000Z'
      }))
    );

    const report = await restoreFromBackup({ exercises: DEFAULT_EXERCISES, sessions, sets });
    expect(report.sessions).toBe(60);
    expect(report.sets).toBe(240);
    expect(await db.sets.count()).toBe(240);
  });
});

describe('backup payload validation (deep)', () => {
  it('accepts a well-formed payload', () => {
    const payload = buildBackup(
      DEFAULT_EXERCISES,
      [],
      [],
      [],
      [],
      { id: 'general', weight_unit: 'kg', weekly_goal: 4, default_rest_seconds: 90 }
    );
    expect(isBackupPayload(payload)).toBe(true);
  });

  it('rejects payloads missing required tables', () => {
    expect(isBackupPayload({ app: 'mygym', exercises: [], routines: [], sessions: [] })).toBe(false);
    expect(isBackupPayload({ app: 'mygym', exercises: [], routines: [], sessions: [], sets: 'nope' })).toBe(false);
  });

  it('rejects foreign, null and primitive payloads', () => {
    expect(isBackupPayload(null)).toBe(false);
    expect(isBackupPayload(undefined)).toBe(false);
    expect(isBackupPayload('string')).toBe(false);
    expect(isBackupPayload(42)).toBe(false);
    expect(isBackupPayload({ app: 'paisa', exercises: [], routines: [], sessions: [], sets: [] })).toBe(false);
  });
});
