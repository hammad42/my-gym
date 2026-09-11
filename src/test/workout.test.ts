import { describe, it, expect } from 'vitest';
import {
  Exercise,
  WorkoutSession,
  SetLog,
  estimateOneRepMax,
  volumeOf
} from '../types';
import {
  resolveSessions,
  summarizeSession,
  weekKeyOf,
  computePersonalRecords,
  exerciseProgressSeries,
  volumeByMuscleGroup,
  sessionsPerWeek
} from '../lib/workout';

const bench: Exercise = { id: 'ex-bench', name: 'Bench Press', muscle_group: 'chest', equipment: 'barbell', icon: 'Dumbbell', color: '#f97316', is_default: true, created_at: '2026-01-01T00:00:00.000Z' };
const squat: Exercise = { id: 'ex-squat', name: 'Squat', muscle_group: 'quads', equipment: 'barbell', icon: 'Dumbbell', color: '#4ade80', is_default: true, created_at: '2026-01-01T00:00:00.000Z' };
const curl: Exercise = { id: 'ex-curl', name: 'Curl', muscle_group: 'biceps', equipment: 'barbell', icon: 'Dumbbell', color: '#f472b6', is_default: true, created_at: '2026-01-01T00:00:00.000Z' };

function makeSession(id: string, date: string): WorkoutSession {
  return { id, name: 'Test', date, routine_id: null, duration_minutes: 60, body_weight: null, notes: '', created_at: `${date}T10:00:00.000Z` };
}

function makeSet(id: string, sessionId: string, exerciseId: string, setNumber: number, weight: number, reps: number, isWarmup = false): SetLog {
  return { id, session_id: sessionId, exercise_id: exerciseId, set_number: setNumber, weight, reps, is_warmup: isWarmup, notes: '', created_at: '2026-09-01T10:00:00.000Z' };
}

describe('estimateOneRepMax', () => {
  it('returns the weight itself for a single rep', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
  });

  it('uses Epley for higher reps', () => {
    // 100 * (1 + 5/30) = 116.67 -> 117
    expect(estimateOneRepMax(100, 5)).toBe(117);
  });

  it('returns 0 for impossible input', () => {
    expect(estimateOneRepMax(100, 0)).toBe(0);
    expect(estimateOneRepMax(0, 5)).toBe(0);
  });
});

describe('resolveSessions', () => {
  it('groups sets under sessions newest first and resolves exercises', () => {
    const sessions = [makeSession('s1', '2026-09-01'), makeSession('s2', '2026-09-05')];
    const sets = [
      makeSet('a', 's1', 'ex-bench', 1, 60, 8),
      makeSet('b', 's2', 'ex-squat', 1, 90, 5),
      makeSet('c', 's2', 'ex-squat', 2, 90, 5)
    ];

    const resolved = resolveSessions(sessions, sets, [bench, squat]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].session.id).toBe('s2'); // newest first
    expect(resolved[0].sets).toHaveLength(2);
    expect(resolved[0].exercises.map((e) => e.id)).toEqual(['ex-squat']);
  });

  it('drops sets whose exercise no longer exists', () => {
    const sessions = [makeSession('s1', '2026-09-01')];
    const sets = [makeSet('a', 's1', 'ex-gone', 1, 60, 8)];
    const resolved = resolveSessions(sessions, sets, [bench]);
    expect(resolved[0].sets).toHaveLength(0);
  });
});

describe('summarizeSession', () => {
  it('sums sets, reps and volume', () => {
    const resolved = {
      session: makeSession('s1', '2026-09-01'),
      sets: [
        { set: makeSet('a', 's1', 'ex-bench', 1, 100, 5), exercise: bench },
        { set: makeSet('b', 's1', 'ex-squat', 1, 140, 8), exercise: squat }
      ],
      exercises: [bench, squat]
    };
    const summary = summarizeSession(resolved);
    expect(summary.totalSets).toBe(2);
    expect(summary.totalReps).toBe(13);
    expect(summary.totalVolume).toBe(100 * 5 + 140 * 8);
    expect(summary.exerciseCount).toBe(2);
  });
});

describe('weekKeyOf', () => {
  it('assigns all days of one ISO week the same key', () => {
    // 2026-09-07 is a Monday.
    const keys = ['2026-09-07', '2026-09-08', '2026-09-13'].map(weekKeyOf);
    expect(new Set(keys).size).toBe(1);
  });

  it('separates adjacent weeks', () => {
    expect(weekKeyOf('2026-09-06')).not.toBe(weekKeyOf('2026-09-07'));
  });
});

describe('computePersonalRecords', () => {
  it('tracks heaviest set and best estimated 1RM, ignoring warmups', () => {
    const sessions = [makeSession('s1', '2026-09-01'), makeSession('s2', '2026-09-08')];
    const sets = [
      makeSet('a', 's1', 'ex-bench', 1, 40, 10, true), // warmup, ignored
      makeSet('b', 's1', 'ex-bench', 2, 80, 5),
      makeSet('c', 's2', 'ex-bench', 1, 85, 3),
      makeSet('d', 's2', 'ex-curl', 1, 30, 8)
    ];

    const records = computePersonalRecords(sessions, sets, [bench, curl]);
    const benchPr = records.find((r) => r.exercise.id === 'ex-bench')!;
    expect(benchPr.bestWeight).toBe(85);
    expect(benchPr.bestWeightReps).toBe(3);
    expect(benchPr.bestOneRepMax).toBe(estimateOneRepMax(85, 3));
    expect(benchPr.bestWeightDate).toBe('2026-09-08');
    expect(benchPr.lastPerformed).toBe('2026-09-08');
  });

  it('returns an empty list with no sets', () => {
    expect(computePersonalRecords([], [], [bench])).toHaveLength(0);
  });
});

describe('exerciseProgressSeries', () => {
  it('returns the heaviest working set per session date, oldest first', () => {
    const sessions = [makeSession('s1', '2026-09-01'), makeSession('s2', '2026-09-08')];
    const sets = [
      makeSet('a', 's1', 'ex-bench', 1, 70, 8),
      makeSet('b', 's1', 'ex-bench', 2, 75, 6),
      makeSet('c', 's2', 'ex-bench', 1, 80, 5),
      makeSet('d', 's2', 'ex-curl', 1, 30, 8)
    ];

    const series = exerciseProgressSeries(sessions, sets, 'ex-bench');
    expect(series).toEqual([
      { date: '2026-09-01', weight: 75, reps: 6 },
      { date: '2026-09-08', weight: 80, reps: 5 }
    ]);
  });

  it('ignores warmups', () => {
    const sessions = [makeSession('s1', '2026-09-01')];
    const sets = [makeSet('a', 's1', 'ex-bench', 1, 40, 10, true), makeSet('b', 's1', 'ex-bench', 2, 75, 6)];
    const series = exerciseProgressSeries(sessions, sets, 'ex-bench');
    expect(series).toEqual([{ date: '2026-09-01', weight: 75, reps: 6 }]);
  });
});

describe('volumeByMuscleGroup', () => {
  it('aggregates volume per muscle group sorted descending', () => {
    const sets = [
      makeSet('a', 's1', 'ex-squat', 1, 100, 5), // 500 quads
      makeSet('b', 's1', 'ex-bench', 1, 60, 10), // 600 chest
      makeSet('c', 's1', 'ex-curl', 1, 20, 12) // 240 biceps
    ];
    const result = volumeByMuscleGroup(sets, [bench, squat, curl]);
    expect(result.map((r) => r.group)).toEqual(['chest', 'quads', 'biceps']);
    expect(result[0].volume).toBe(600);
  });
});

describe('sessionsPerWeek', () => {
  it('returns N weeks oldest first, including empty weeks', () => {
    const thisMonday = new Date();
    thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const sessions = [makeSession('s1', key(thisMonday)), makeSession('s2', key(thisMonday))];
    const weeks = sessionsPerWeek(sessions, 4);
    expect(weeks).toHaveLength(4);
    expect(weeks[3].count).toBe(2); // current week is last
    expect(weeks.slice(0, 3).every((w) => w.count === 0)).toBe(true);
  });
});

describe('volumeOf', () => {
  it('never returns negative volume', () => {
    expect(volumeOf(-10, 5)).toBe(0);
    expect(volumeOf(10, 0)).toBe(0);
    expect(volumeOf(10, 5)).toBe(50);
  });
});
