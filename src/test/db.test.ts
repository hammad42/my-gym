import { describe, it, expect, beforeAll } from 'vitest';
import { db, initializeDatabase, clearAllLogs, deleteSession, saveWorkout, saveRoutineExercises } from '../lib/db';
import { WorkoutSession, SetLog } from '../types';

// fake-indexeddb/auto (via test setup) gives every test file a fresh
// in-memory IndexedDB, so the populate handler seeds demo data on first open.

describe('database', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  it('seeds defaults on first open', async () => {
    const exercises = await db.exercises.count();
    const routines = await db.routines.count();
    const sessions = await db.sessions.count();
    const settings = await db.settings.get('general');

    expect(exercises).toBeGreaterThan(10);
    expect(routines).toBeGreaterThan(0);
    expect(sessions).toBeGreaterThan(0);
    expect(settings?.weight_unit).toBe('kg');
    expect(settings?.weekly_goal).toBe(4);
  });

  it('is idempotent — initializeDatabase twice does not double-seed', async () => {
    const before = await db.exercises.count();
    await initializeDatabase();
    const after = await db.exercises.count();
    expect(after).toBe(before);
  });

  it('saveWorkout writes the session and its sets atomically', async () => {
    const session: WorkoutSession = {
      id: 'session-test-1',
      name: 'Test Workout',
      date: '2026-09-11',
      routine_id: null,
      duration_minutes: 45,
      body_weight: 80,
      notes: 'felt strong',
      created_at: new Date().toISOString()
    };

    const sets: Omit<SetLog, 'session_id' | 'created_at'>[] = [
      { id: '', exercise_id: 'ex-bench', set_number: 1, weight: 80, reps: 5, is_warmup: false },
      { id: '', exercise_id: 'ex-bench', set_number: 2, weight: 80, reps: 5, is_warmup: false }
    ];

    await saveWorkout(session, sets);

    const storedSession = await db.sessions.get('session-test-1');
    expect(storedSession?.name).toBe('Test Workout');

    const storedSets = await db.sets.where('session_id').equals('session-test-1').toArray();
    expect(storedSets).toHaveLength(2);
    expect(storedSets.every((s) => s.session_id === 'session-test-1')).toBe(true);
    // saveWorkout assigns ids when the caller passes empty ones.
    expect(storedSets.every((s) => s.id.length > 0)).toBe(true);
  });

  it('deleteSession removes the session and its sets', async () => {
    await deleteSession('session-test-1');
    expect(await db.sessions.get('session-test-1')).toBeUndefined();
    expect(await db.sets.where('session_id').equals('session-test-1').toArray()).toHaveLength(0);
  });

  it('clearAllLogs empties sessions and sets but keeps the library', async () => {
    const exercisesBefore = await db.exercises.count();
    const routinesBefore = await db.routines.count();

    await clearAllLogs();

    expect(await db.sessions.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
    expect(await db.exercises.count()).toBe(exercisesBefore);
    expect(await db.routines.count()).toBe(routinesBefore);
  });

  it('saveRoutineExercises replaces the routine plan and renumbers order', async () => {
    const routineId = 'routine-push';
    await saveRoutineExercises(routineId, [
      { exercise_id: 'ex-bench', target_sets: 5, target_reps: 5 },
      { exercise_id: 'ex-curl', target_sets: 3, target_reps: 12 }
    ]);

    const lines = (await db.routine_exercises.where('routine_id').equals(routineId).toArray()).sort(
      (a, b) => a.order - b.order
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].exercise_id).toBe('ex-bench');
    expect(lines[0].order).toBe(1);
    expect(lines[0].target_sets).toBe(5);
    expect(lines[1].exercise_id).toBe('ex-curl');
    expect(lines[1].order).toBe(2);
  });
});
