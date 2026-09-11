import {
  Exercise,
  WorkoutSession,
  SetLog,
  ResolvedSet,
  ResolvedSession,
  SessionSummary,
  WeekSummary,
  PersonalRecord,
  estimateOneRepMax,
  volumeOf,
  MuscleGroup
} from '../types';

/**
 * Groups a flat list of sets under their sessions and resolves each set against
 * its exercise. Sessions are returned newest-first.
 */
export function resolveSessions(
  sessions: WorkoutSession[],
  sets: SetLog[],
  exercises: Exercise[]
): ResolvedSession[] {
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const setsBySession = new Map<string, SetLog[]>();
  for (const set of sets) {
    const list = setsBySession.get(set.session_id);
    if (list) list.push(set);
    else setsBySession.set(set.session_id, [set]);
  }

  return [...sessions]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((session) => {
      const sessionSets = (setsBySession.get(session.id) || []).sort(
        (a, b) => a.set_number - b.set_number
      );
      const resolved: ResolvedSet[] = sessionSets
        .map((set) => {
          const exercise = exerciseById.get(set.exercise_id);
          return exercise ? { set, exercise } : null;
        })
        .filter((r): r is ResolvedSet => r !== null);

      const seen = new Set<string>();
      const uniqueExercises: Exercise[] = [];
      for (const { exercise } of resolved) {
        if (!seen.has(exercise.id)) {
          seen.add(exercise.id);
          uniqueExercises.push(exercise);
        }
      }

      return { session, sets: resolved, exercises: uniqueExercises };
    });
}

/**
 * Per-session totals. `totalSets` counts every logged row (a warmup is still a
 * set you performed); `totalReps` and `totalVolume` count WORKING sets only —
 * the same rule the PR engine and progression charts apply, so all volume
 * numbers across the app agree.
 */
export function summarizeSession(resolved: ResolvedSession): SessionSummary {
  let totalReps = 0;
  let totalVolume = 0;
  for (const { set } of resolved.sets) {
    if (set.is_warmup) continue;
    totalReps += set.reps;
    totalVolume += volumeOf(set.weight, set.reps);
  }
  return {
    totalSets: resolved.sets.length,
    totalReps,
    totalVolume,
    exerciseCount: resolved.exercises.length
  };
}

/** Monday-based week key "YYYY-Www" from a YYYY-MM-DD date string. */
export function weekKeyOf(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  // Shift to Thursday of the ISO week so the key is stable across week edges.
  const dayNum = (d.getDay() + 6) % 7; // Monday = 0
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - dayNum + 3);
  const week1Thursday = new Date(thursday.getFullYear(), 0, 4);
  const week1DayNum = (week1Thursday.getDay() + 6) % 7;
  week1Thursday.setDate(week1Thursday.getDate() - week1DayNum + 3);
  const week = Math.round((thursday.getTime() - week1Thursday.getTime()) / (7 * 24 * 3600 * 1000)) + 1;
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function summarizeWeek(
  sessions: WorkoutSession[],
  sets: SetLog[],
  weeklyGoal: number
): WeekSummary {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const from = toKey(monday);
  const to = toKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));

  const thisWeek = sessions.filter((s) => s.date >= from && s.date <= to);
  const sessionIdSet = new Set(thisWeek.map((s) => s.id));
  const weekSets = sets.filter((s) => sessionIdSet.has(s.session_id));

  // Working sets only, matching the session summary and PR engine.
  let totalVolume = 0;
  for (const s of weekSets) {
    if (s.is_warmup) continue;
    totalVolume += volumeOf(s.weight, s.reps);
  }

  return {
    sessionsThisWeek: thisWeek.length,
    weeklyGoal,
    totalSets: weekSets.length,
    totalVolume,
    totalMinutes: thisWeek.reduce((sum, s) => sum + s.duration_minutes, 0),
    streakWeeks: countGoalStreak(sessions, weeklyGoal)
  };
}

/**
 * Consecutive weeks, ending with the current week (or the most recent week with
 * any activity if the current one is empty), that hit the weekly goal.
 */
function countGoalStreak(sessions: WorkoutSession[], weeklyGoal: number): number {
  if (sessions.length === 0 || weeklyGoal <= 0) return 0;

  const counts = new Map<string, number>();
  for (const s of sessions) {
    const key = weekKeyOf(s.date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Walk back from the current week. A current week that is at goal counts;
  // if the current week isn't done yet, the streak continues from last week.
  const today = new Date();
  let cursor = new Date(today);
  cursor.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // this Monday

  let streak = 0;
  let first = true;
  for (let i = 0; i < 520; i++) {
    const key = weekKeyOf(toKey(cursor));
    const count = counts.get(key) || 0;
    if (count >= weeklyGoal) {
      streak++;
    } else if (first && count > 0) {
      // Current week in progress but not yet at goal — don't break the streak.
    } else if (first && count === 0) {
      // Week hasn't started — keep looking at previous weeks.
    } else {
      break;
    }
    first = false;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Personal records per exercise: heaviest working set and best estimated 1RM.
 * Warmup sets never count.
 */
export function computePersonalRecords(
  sessions: WorkoutSession[],
  sets: SetLog[],
  exercises: Exercise[]
): PersonalRecord[] {
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const best = new Map<string, PersonalRecord>();

  for (const set of sets) {
    if (set.is_warmup) continue;
    const exercise = exerciseById.get(set.exercise_id);
    if (!exercise) continue;

    const session = sessions.find((s) => s.id === set.session_id);
    const date = session?.date || set.created_at.slice(0, 10);
    const oneRm = estimateOneRepMax(set.weight, set.reps);

    const current = best.get(exercise.id);
    if (!current) {
      best.set(exercise.id, {
        exercise,
        bestWeight: set.weight,
        bestWeightReps: set.reps,
        bestWeightDate: date,
        bestOneRepMax: oneRm,
        bestOneRepMaxDate: date,
        bestSetCount: 1,
        lastPerformed: date
      });
      continue;
    }

    if (set.weight > current.bestWeight) {
      current.bestWeight = set.weight;
      current.bestWeightReps = set.reps;
      current.bestWeightDate = date;
    }
    if (oneRm > current.bestOneRepMax) {
      current.bestOneRepMax = oneRm;
      current.bestOneRepMaxDate = date;
    }
    if (date > (current.lastPerformed || '')) {
      current.lastPerformed = date;
    }
    current.bestSetCount++;
  }

  return [...best.values()].sort((a, b) => b.bestOneRepMax - a.bestOneRepMax);
}

/**
 * The heaviest working-set weight per session date for one exercise — the
 * series behind the progress chart.
 */
export function exerciseProgressSeries(
  sessions: WorkoutSession[],
  sets: SetLog[],
  exerciseId: string
): { date: string; weight: number; reps: number }[] {
  const sessionDate = new Map(sessions.map((s) => [s.id, s.date]));
  const perDate = new Map<string, { weight: number; reps: number }>();

  for (const set of sets) {
    if (set.exercise_id !== exerciseId || set.is_warmup) continue;
    const date = sessionDate.get(set.session_id);
    if (!date) continue;
    const current = perDate.get(date);
    if (!current || set.weight > current.weight) {
      perDate.set(date, { weight: set.weight, reps: set.reps });
    }
  }

  return [...perDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, weight: v.weight, reps: v.reps }));
}

/** Total volume per muscle group across all logged WORKING sets — chart data. */
export function volumeByMuscleGroup(
  sets: SetLog[],
  exercises: Exercise[]
): { group: MuscleGroup; volume: number }[] {
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const totals = new Map<MuscleGroup, number>();
  for (const set of sets) {
    if (set.is_warmup) continue;
    const exercise = exerciseById.get(set.exercise_id);
    if (!exercise) continue;
    totals.set(
      exercise.muscle_group,
      (totals.get(exercise.muscle_group) || 0) + volumeOf(set.weight, set.reps)
    );
  }
  return [...totals.entries()]
    .map(([group, volume]) => ({ group, volume }))
    .sort((a, b) => b.volume - a.volume);
}

/** Sessions per week over the last N weeks (oldest first) — chart data. */
export function sessionsPerWeek(
  sessions: WorkoutSession[],
  weeks = 8
): { week: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const key = weekKeyOf(s.date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const out: { week: string; count: number }[] = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7)); // this Monday
  for (let i = 0; i < weeks; i++) {
    const key = weekKeyOf(toKey(cursor));
    out.unshift({ week: key, count: counts.get(key) || 0 });
    cursor.setDate(cursor.getDate() - 7);
  }
  return out;
}
