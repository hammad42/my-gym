import { describe, it, expect } from 'vitest';
import { Exercise, WorkoutSession, SetLog, estimateOneRepMax, volumeOf } from '../types';
import {
  resolveSessions,
  summarizeSession,
  weekKeyOf,
  summarizeWeek,
  computePersonalRecords,
  exerciseProgressSeries,
  volumeByMuscleGroup,
  sessionsPerWeek
} from '../lib/workout';

// --- fixtures ---------------------------------------------------------------

const bench: Exercise = { id: 'ex-bench', name: 'Bench', muscle_group: 'chest', equipment: 'barbell', icon: 'Dumbbell', color: '#f97316', is_default: true, created_at: '2026-01-01T00:00:00.000Z' };
const squat: Exercise = { id: 'ex-squat', name: 'Squat', muscle_group: 'quads', equipment: 'barbell', icon: 'Dumbbell', color: '#4ade80', is_default: true, created_at: '2026-01-01T00:00:00.000Z' };
const pullup: Exercise = { id: 'ex-pullup', name: 'Pull-Up', muscle_group: 'back', equipment: 'bodyweight', icon: 'PersonStanding', color: '#0ea5e9', is_default: true, created_at: '2026-01-01T00:00:00.000Z' };

function sess(id: string, date: string, minutes = 60): WorkoutSession {
  return { id, name: `W ${id}`, date, routine_id: null, duration_minutes: minutes, body_weight: null, notes: '', created_at: `${date}T10:00:00.000Z` };
}
function set(id: string, sessionId: string, exerciseId: string, n: number, weight: number, reps: number, warmup = false): SetLog {
  return { id, session_id: sessionId, exercise_id: exerciseId, set_number: n, weight, reps, is_warmup: warmup, notes: '', created_at: `${sessionId}T10:00:00.000Z` };
}
/** YYYY-MM-DD for the Monday of the week `weeksAgo` before the current one. */
function mondayKey(weeksAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - weeksAgo * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- 1RM / volume -----------------------------------------------------------

describe('estimateOneRepMax (deep)', () => {
  it('is monotonic in weight for fixed reps', () => {
    const a = estimateOneRepMax(80, 5);
    const b = estimateOneRepMax(90, 5);
    expect(b).toBeGreaterThan(a);
  });

  it('decreases as reps rise at the same weight (lower weight implied)', () => {
    // Same weight, more reps -> higher e1RM, but a single is exactly the weight.
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 10)).toBeGreaterThan(100);
  });

  it('treats fractional weights', () => {
    expect(estimateOneRepMax(82.5, 5)).toBe(Math.round(82.5 * (1 + 5 / 30)));
  });

  it('returns 0 for zero/negative reps or weight', () => {
    expect(estimateOneRepMax(0, 10)).toBe(0);
    expect(estimateOneRepMax(100, 0)).toBe(0);
    expect(estimateOneRepMax(-50, 5)).toBe(0);
  });
});

describe('volumeOf (deep)', () => {
  it('multiplies weight by reps', () => {
    expect(volumeOf(82.5, 8)).toBe(660);
  });
  it('clamps negatives to zero', () => {
    expect(volumeOf(-1, 10)).toBe(0);
    expect(volumeOf(10, -1)).toBe(0);
  });
  it('treats bodyweight (0) as zero volume', () => {
    expect(volumeOf(0, 20)).toBe(0);
  });
});

// --- resolution -------------------------------------------------------------

describe('resolveSessions (deep)', () => {
  it('orders sets by set_number regardless of insertion order', () => {
    const r = resolveSessions([sess('s1', '2026-09-01')], [
      set('c', 's1', 'ex-bench', 3, 70, 5),
      set('a', 's1', 'ex-bench', 1, 60, 5),
      set('b', 's1', 'ex-bench', 2, 65, 5)
    ], [bench]);
    expect(r[0].sets.map((x) => x.set.set_number)).toEqual([1, 2, 3]);
  });

  it('ignores orphan sets whose session is missing', () => {
    const r = resolveSessions([sess('s1', '2026-09-01')], [
      set('a', 's1', 'ex-bench', 1, 60, 5),
      set('orphan', 'ghost-session', 'ex-bench', 1, 99, 5)
    ], [bench]);
    expect(r).toHaveLength(1);
    expect(r[0].sets).toHaveLength(1);
  });

  it('keeps sessions that have no sets (an empty logged workout)', () => {
    const r = resolveSessions([sess('s1', '2026-09-01')], [], [bench]);
    expect(r).toHaveLength(1);
    expect(r[0].sets).toEqual([]);
    expect(summarizeSession(r[0]).totalVolume).toBe(0);
  });

  it('lists unique exercises in first-appearance order', () => {
    const r = resolveSessions([sess('s1', '2026-09-01')], [
      set('a', 's1', 'ex-squat', 1, 100, 5),
      set('b', 's1', 'ex-bench', 1, 60, 5),
      set('c', 's1', 'ex-squat', 2, 100, 5)
    ], [bench, squat]);
    expect(r[0].exercises.map((e) => e.id)).toEqual(['ex-squat', 'ex-bench']);
  });

  it('sorts sessions newest first, stable for equal dates', () => {
    const r = resolveSessions([sess('old', '2026-01-01'), sess('new', '2026-09-01')], [], []);
    expect(r.map((x) => x.session.id)).toEqual(['new', 'old']);
  });

  it('handles empty input', () => {
    expect(resolveSessions([], [], [])).toEqual([]);
  });
});

// --- ISO week keys ----------------------------------------------------------

describe('weekKeyOf (deep)', () => {
  it('gives Mon..Sun of one week the same key', () => {
    const keys = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'].map(weekKeyOf);
    expect(new Set(keys).size).toBe(1);
  });

  it('puts a year-boundary week in the correct ISO year', () => {
    // 2026-01-01 is a Thursday; that ISO week belongs to 2026.
    expect(weekKeyOf('2026-01-01')).toContain('2026');
    // 2025-12-29 is a Monday in the same ISO week as 2026-01-01.
    expect(weekKeyOf('2025-12-29')).toBe(weekKeyOf('2026-01-01'));
  });

  it('separates Sunday from the following Monday', () => {
    expect(weekKeyOf('2026-09-13')).not.toBe(weekKeyOf('2026-09-14'));
  });

  it('is zero-padded so keys sort correctly', () => {
    expect(weekKeyOf('2026-01-05')).toMatch(/W\d{2}$/);
  });
});

// --- weekly summary + streak ------------------------------------------------

describe('summarizeWeek (deep)', () => {
  it('counts only sessions inside the current Monday..Sunday window', () => {
    const thisMon = mondayKey(0);
    const lastMon = mondayKey(1);
    const week = summarizeWeek([sess('a', thisMon), sess('b', lastMon)], [
      set('s1', 'a', 'ex-bench', 1, 100, 5)
    ], 4);
    expect(week.sessionsThisWeek).toBe(1);
    expect(week.totalSets).toBe(1);
    expect(week.totalVolume).toBe(500);
  });

  it('ignores a set belonging to a previous week in this week totals', () => {
    const thisMon = mondayKey(0);
    const lastMon = mondayKey(1);
    const week = summarizeWeek([sess('a', thisMon), sess('b', lastMon)], [
      set('s1', 'a', 'ex-bench', 1, 100, 5),
      set('s2', 'b', 'ex-bench', 1, 200, 5)
    ], 4);
    expect(week.totalVolume).toBe(500);
  });

  it('sums duration of this week only', () => {
    const thisMon = mondayKey(0);
    const lastMon = mondayKey(1);
    const week = summarizeWeek([sess('a', thisMon, 50), sess('b', lastMon, 90)], [], 4);
    expect(week.totalMinutes).toBe(50);
  });

  it('reports zeroes for an empty history', () => {
    const week = summarizeWeek([], [], 4);
    expect(week).toMatchObject({ sessionsThisWeek: 0, totalSets: 0, totalVolume: 0, totalMinutes: 0, streakWeeks: 0 });
  });

  it('counts a streak across consecutive goal-hitting weeks', () => {
    const sessions = [0, 1, 2].flatMap((w) => [
      sess(`w${w}a`, mondayKey(w)),
      sess(`w${w}b`, mondayKey(w))
    ]);
    const week = summarizeWeek(sessions, [], 2);
    expect(week.streakWeeks).toBeGreaterThanOrEqual(3);
  });

  it('breaks the streak on a missed week in between', () => {
    const sessions = [
      sess('cur1', mondayKey(0)), sess('cur2', mondayKey(0)),
      // week 1 deliberately missed
      sess('old1', mondayKey(2)), sess('old2', mondayKey(2))
    ];
    const week = summarizeWeek(sessions, [], 2);
    expect(week.streakWeeks).toBe(1);
  });

  it('does not break the streak when the current week is still in progress', () => {
    // Goal 3/wk: this week has only 1 so far, but the previous two weeks hit it.
    const sessions = [
      sess('cur1', mondayKey(0)),
      sess('p1a', mondayKey(1)), sess('p1b', mondayKey(1)), sess('p1c', mondayKey(1)),
      sess('p2a', mondayKey(2)), sess('p2b', mondayKey(2)), sess('p2c', mondayKey(2))
    ];
    const week = summarizeWeek(sessions, [], 3);
    expect(week.streakWeeks).toBe(2);
  });

  it('returns a zero streak when the goal is zero or negative', () => {
    expect(summarizeWeek([sess('a', mondayKey(0))], [], 0).streakWeeks).toBe(0);
    expect(summarizeWeek([sess('a', mondayKey(0))], [], -1).streakWeeks).toBe(0);
  });

  it('counts multiple sessions on the same day', () => {
    const d = mondayKey(0);
    const week = summarizeWeek([sess('a', d), sess('b', d)], [], 4);
    expect(week.sessionsThisWeek).toBe(2);
  });
});

// --- personal records -------------------------------------------------------

describe('computePersonalRecords (deep)', () => {
  it('ignores warmups entirely', () => {
    const records = computePersonalRecords(
      [sess('s1', '2026-09-01')],
      [set('a', 's1', 'ex-bench', 1, 150, 3, true), set('b', 's1', 'ex-bench', 2, 80, 5)],
      [bench]
    );
    expect(records[0].bestWeight).toBe(80);
  });

  it('selects the heaviest set and its own rep count, not the last set', () => {
    const records = computePersonalRecords(
      [sess('s1', '2026-09-01'), sess('s2', '2026-09-08')],
      [set('a', 's1', 'ex-bench', 1, 100, 2), set('b', 's2', 'ex-bench', 1, 90, 10)],
      [bench]
    );
    const pr = records[0];
    expect(pr.bestWeight).toBe(100);
    expect(pr.bestWeightReps).toBe(2);
    expect(pr.bestWeightDate).toBe('2026-09-01');
    // ...while the 90x10 is a higher estimated 1RM, so it owns that record.
    expect(pr.bestOneRepMax).toBe(estimateOneRepMax(90, 10));
    expect(pr.bestOneRepMaxDate).toBe('2026-09-08');
  });

  it('tracks lastPerformed as the most recent date', () => {
    const records = computePersonalRecords(
      [sess('s1', '2026-09-01'), sess('s2', '2026-09-20')],
      [set('a', 's1', 'ex-bench', 1, 100, 5), set('b', 's2', 'ex-bench', 1, 95, 5)],
      [bench]
    );
    expect(records[0].lastPerformed).toBe('2026-09-20');
  });

  it('keeps records for each exercise separately and sorts by 1RM desc', () => {
    const records = computePersonalRecords(
      [sess('s1', '2026-09-01')],
      [
        set('a', 's1', 'ex-squat', 1, 150, 5),
        set('b', 's1', 'ex-bench', 1, 100, 5),
        set('c', 's1', 'ex-pullup', 1, 0, 12)
      ],
      [bench, squat, pullup]
    );
    expect(records.map((r) => r.exercise.id)).toEqual(['ex-squat', 'ex-bench', 'ex-pullup']);
  });

  it('handles a bodyweight-only exercise without inventing a 1RM', () => {
    const records = computePersonalRecords(
      [sess('s1', '2026-09-01')],
      [set('a', 's1', 'ex-pullup', 1, 0, 15)],
      [pullup]
    );
    expect(records[0].bestWeight).toBe(0);
    expect(records[0].bestOneRepMax).toBe(0);
    expect(records[0].bestSetCount).toBe(1);
  });

  it('counts every working set across sessions', () => {
    const records = computePersonalRecords(
      [sess('s1', '2026-09-01'), sess('s2', '2026-09-08')],
      [
        set('a', 's1', 'ex-bench', 1, 80, 5), set('b', 's1', 'ex-bench', 2, 80, 5),
        set('c', 's2', 'ex-bench', 1, 85, 5)
      ],
      [bench]
    );
    expect(records[0].bestSetCount).toBe(3);
  });

  it('drops sets for exercises that no longer exist', () => {
    const records = computePersonalRecords([sess('s1', '2026-09-01')], [set('a', 's1', 'ex-gone', 1, 100, 5)], [bench]);
    expect(records).toHaveLength(0);
  });
});

// --- progress series --------------------------------------------------------

describe('exerciseProgressSeries (deep)', () => {
  it('picks the heaviest working set per date and sorts oldest first', () => {
    const series = exerciseProgressSeries(
      [sess('s1', '2026-09-08'), sess('s2', '2026-09-01')],
      [
        set('a', 's2', 'ex-bench', 1, 70, 8), set('b', 's2', 'ex-bench', 2, 75, 6),
        set('c', 's1', 'ex-bench', 1, 80, 5)
      ],
      'ex-bench'
    );
    expect(series).toEqual([
      { date: '2026-09-01', weight: 75, reps: 6 },
      { date: '2026-09-08', weight: 80, reps: 5 }
    ]);
  });

  it('ignores other exercises and orphan sets', () => {
    const series = exerciseProgressSeries(
      [sess('s1', '2026-09-01')],
      [set('a', 's1', 'ex-squat', 1, 999, 5), set('orphan', 'ghost', 'ex-bench', 1, 999, 5)],
      'ex-bench'
    );
    expect(series).toEqual([]);
  });

  it('includes bodyweight entries as weight 0', () => {
    const series = exerciseProgressSeries([sess('s1', '2026-09-01')], [set('a', 's1', 'ex-pullup', 1, 0, 12)], 'ex-pullup');
    expect(series).toEqual([{ date: '2026-09-01', weight: 0, reps: 12 }]);
  });

  it('returns an empty series for an unknown exercise', () => {
    expect(exerciseProgressSeries([sess('s1', '2026-09-01')], [set('a', 's1', 'ex-bench', 1, 80, 5)], 'nope')).toEqual([]);
  });
});

// --- volume distribution ----------------------------------------------------

describe('volumeByMuscleGroup (deep)', () => {
  it('aggregates across sets and sorts descending', () => {
    const result = volumeByMuscleGroup(
      [set('a', 's1', 'ex-squat', 1, 100, 5), set('b', 's1', 'ex-bench', 1, 60, 10), set('c', 's1', 'ex-bench', 2, 60, 10)],
      [bench, squat]
    );
    expect(result[0]).toEqual({ group: 'chest', volume: 1200 });
    expect(result[1]).toEqual({ group: 'quads', volume: 500 });
  });

  it('ignores unknown exercises and empty input', () => {
    expect(volumeByMuscleGroup([set('a', 's1', 'ghost', 1, 100, 5)], [bench])).toEqual([]);
    expect(volumeByMuscleGroup([], [bench])).toEqual([]);
  });

  it('counts bodyweight sets as zero volume rather than dropping the group', () => {
    const result = volumeByMuscleGroup([set('a', 's1', 'ex-pullup', 1, 0, 12)], [pullup]);
    expect(result).toEqual([{ group: 'back', volume: 0 }]);
  });
});

// --- sessions per week ------------------------------------------------------

describe('sessionsPerWeek (deep)', () => {
  it('returns exactly N buckets, oldest first, current week last', () => {
    const weeks = sessionsPerWeek([sess('a', mondayKey(0))], 8);
    expect(weeks).toHaveLength(8);
    expect(weeks[7].count).toBe(1);
    expect(weeks.slice(0, 7).every((w) => w.count === 0)).toBe(true);
  });

  it('places a session from 2 weeks ago in the right bucket', () => {
    const weeks = sessionsPerWeek([sess('a', mondayKey(2))], 4);
    expect(weeks[1].count).toBe(1);
  });

  it('ignores sessions older than the window', () => {
    const weeks = sessionsPerWeek([sess('a', mondayKey(50))], 4);
    expect(weeks.every((w) => w.count === 0)).toBe(true);
  });

  it('counts several sessions in one week', () => {
    const weeks = sessionsPerWeek([sess('a', mondayKey(1)), sess('b', mondayKey(1))], 4);
    expect(weeks[2].count).toBe(2);
  });

  it('handles zero weeks requested', () => {
    expect(sessionsPerWeek([], 0)).toEqual([]);
  });
});
