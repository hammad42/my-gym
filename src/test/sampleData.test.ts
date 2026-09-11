import { describe, it, expect } from 'vitest';
import { DEFAULT_EXERCISES, DEFAULT_ROUTINES, DEFAULT_ROUTINE_EXERCISES, generateSampleSessions } from '../lib/sampleData';
import { buildBackup, isBackupPayload } from '../lib/exportImport';

describe('sampleData', () => {
  it('every routine exercise references a real exercise', () => {
    const ids = new Set(DEFAULT_EXERCISES.map((e) => e.id));
    for (const line of DEFAULT_ROUTINE_EXERCISES) {
      expect(ids.has(line.exercise_id)).toBe(true);
    }
  });

  it('every routine has at least one planned exercise', () => {
    for (const routine of DEFAULT_ROUTINES) {
      expect(DEFAULT_ROUTINE_EXERCISES.some((l) => l.routine_id === routine.id)).toBe(true);
    }
  });

  it('exercise ids are unique', () => {
    const ids = DEFAULT_EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sample sessions reference seeded exercises and routines', () => {
    const { sessions, sets } = generateSampleSessions();
    expect(sessions.length).toBeGreaterThan(10);
    expect(sets.length).toBeGreaterThan(50);

    const exerciseIds = new Set(DEFAULT_EXERCISES.map((e) => e.id));
    const routineIds = new Set(DEFAULT_ROUTINES.map((r) => r.id));
    const sessionIds = new Set(sessions.map((s) => s.id));

    for (const set of sets) {
      expect(exerciseIds.has(set.exercise_id)).toBe(true);
      expect(sessionIds.has(set.session_id)).toBe(true);
    }
    for (const session of sessions) {
      expect(routineIds.has(session.routine_id!)).toBe(true);
    }
  });

  it('sample sets progress over time (weights increase)', () => {
    const { sets } = generateSampleSessions();
    const benchSets = sets
      .filter((s) => s.exercise_id === 'ex-bench' && !s.is_warmup)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const first = benchSets[0]?.weight || 0;
    const last = benchSets[benchSets.length - 1]?.weight || 0;
    expect(last).toBeGreaterThan(first);
  });
});

describe('exportImport', () => {
  it('builds a backup payload that passes validation', () => {
    const payload = buildBackup(
      DEFAULT_EXERCISES,
      DEFAULT_ROUTINES,
      DEFAULT_ROUTINE_EXERCISES,
      [],
      [],
      { id: 'general', weight_unit: 'kg', weekly_goal: 4, default_rest_seconds: 90 }
    );
    expect(isBackupPayload(payload)).toBe(true);
  });

  it('rejects foreign payloads', () => {
    expect(isBackupPayload(null)).toBe(false);
    expect(isBackupPayload({ app: 'other' })).toBe(false);
    expect(isBackupPayload({ app: 'mygym', exercises: [] })).toBe(false);
  });
});
