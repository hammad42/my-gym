import { Exercise, Routine, RoutineExercise, WorkoutSession, SetLog, Settings } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  id: 'general',
  weight_unit: 'kg',
  weekly_goal: 4,
  default_rest_seconds: 90
};

// ---------------------------------------------------------------------------
// Exercise library — the equivalent of the ledger app's default categories.
// Icons are lucide-react names resolved by components/ExerciseIcon.
// ---------------------------------------------------------------------------
export const DEFAULT_EXERCISES: Exercise[] = [
  // Chest
  { id: 'ex-bench', name: 'Barbell Bench Press', muscle_group: 'chest', equipment: 'barbell', icon: 'Dumbbell', color: '#f97316', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-incline-db', name: 'Incline Dumbbell Press', muscle_group: 'chest', equipment: 'dumbbell', icon: 'Dumbbell', color: '#fb923c', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-cable-fly', name: 'Cable Chest Fly', muscle_group: 'chest', equipment: 'cable', icon: 'Cable', color: '#fdba74', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-pushup', name: 'Push-Up', muscle_group: 'chest', equipment: 'bodyweight', icon: 'PersonStanding', color: '#fed7aa', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },

  // Back
  { id: 'ex-deadlift', name: 'Deadlift', muscle_group: 'back', equipment: 'barbell', icon: 'Dumbbell', color: '#38bdf8', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-pullup', name: 'Pull-Up', muscle_group: 'back', equipment: 'bodyweight', icon: 'PersonStanding', color: '#0ea5e9', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-lat-pulldown', name: 'Lat Pulldown', muscle_group: 'back', equipment: 'machine', icon: 'Cable', color: '#38bdf8', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-barbell-row', name: 'Barbell Row', muscle_group: 'back', equipment: 'barbell', icon: 'Dumbbell', color: '#0284c7', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },

  // Shoulders
  { id: 'ex-ohp', name: 'Overhead Press', muscle_group: 'shoulders', equipment: 'barbell', icon: 'Dumbbell', color: '#a78bfa', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-lateral-raise', name: 'Lateral Raise', muscle_group: 'shoulders', equipment: 'dumbbell', icon: 'Dumbbell', color: '#8b5cf6', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },

  // Legs
  { id: 'ex-squat', name: 'Barbell Back Squat', muscle_group: 'quads', equipment: 'barbell', icon: 'Dumbbell', color: '#4ade80', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-leg-press', name: 'Leg Press', muscle_group: 'quads', equipment: 'machine', icon: 'Cable', color: '#22c55e', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-rdl', name: 'Romanian Deadlift', muscle_group: 'hamstrings', equipment: 'barbell', icon: 'Dumbbell', color: '#16a34a', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-leg-curl', name: 'Leg Curl', muscle_group: 'hamstrings', equipment: 'machine', icon: 'Cable', color: '#4ade80', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-calf-raise', name: 'Standing Calf Raise', muscle_group: 'calves', equipment: 'machine', icon: 'Cable', color: '#65a30d', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },

  // Arms
  { id: 'ex-curl', name: 'Barbell Curl', muscle_group: 'biceps', equipment: 'barbell', icon: 'Dumbbell', color: '#f472b6', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-hammer-curl', name: 'Hammer Curl', muscle_group: 'biceps', equipment: 'dumbbell', icon: 'Dumbbell', color: '#ec4899', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-tricep-pushdown', name: 'Tricep Pushdown', muscle_group: 'triceps', equipment: 'cable', icon: 'Cable', color: '#f43f5e', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-skullcrusher', name: 'Skull Crusher', muscle_group: 'triceps', equipment: 'barbell', icon: 'Dumbbell', color: '#fb7185', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },

  // Core / Cardio
  { id: 'ex-plank', name: 'Plank (seconds)', muscle_group: 'core', equipment: 'bodyweight', icon: 'Timer', color: '#facc15', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-treadmill', name: 'Treadmill Run (minutes)', muscle_group: 'cardio', equipment: 'machine', icon: 'HeartPulse', color: '#ef4444', is_default: true, created_at: '2026-01-01T00:00:00.000Z' }
];

// ---------------------------------------------------------------------------
// Default routines — the equivalent of the ledger app's default accounts.
// ---------------------------------------------------------------------------
export const DEFAULT_ROUTINES: Routine[] = [
  {
    id: 'routine-push',
    name: 'Push Day',
    description: 'Chest, shoulders and triceps',
    color: '#f97316',
    icon: 'ArrowBigUp',
    day_hint: 'Monday',
    is_archived: false,
    created_at: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'routine-pull',
    name: 'Pull Day',
    description: 'Back and biceps',
    color: '#38bdf8',
    icon: 'ArrowBigDown',
    day_hint: 'Tuesday',
    is_archived: false,
    created_at: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'routine-legs',
    name: 'Leg Day',
    description: 'Quads, hamstrings and calves',
    color: '#4ade80',
    icon: 'Footprints',
    day_hint: 'Thursday',
    is_archived: false,
    created_at: '2026-01-01T00:00:00.000Z'
  }
];

export const DEFAULT_ROUTINE_EXERCISES: RoutineExercise[] = [
  { id: 'rex-1', routine_id: 'routine-push', exercise_id: 'ex-bench', order: 1, target_sets: 4, target_reps: 6 },
  { id: 'rex-2', routine_id: 'routine-push', exercise_id: 'ex-incline-db', order: 2, target_sets: 3, target_reps: 10 },
  { id: 'rex-3', routine_id: 'routine-push', exercise_id: 'ex-ohp', order: 3, target_sets: 3, target_reps: 8 },
  { id: 'rex-4', routine_id: 'routine-push', exercise_id: 'ex-lateral-raise', order: 4, target_sets: 3, target_reps: 12 },
  { id: 'rex-5', routine_id: 'routine-push', exercise_id: 'ex-tricep-pushdown', order: 5, target_sets: 3, target_reps: 12 },

  { id: 'rex-6', routine_id: 'routine-pull', exercise_id: 'ex-deadlift', order: 1, target_sets: 3, target_reps: 5 },
  { id: 'rex-7', routine_id: 'routine-pull', exercise_id: 'ex-pullup', order: 2, target_sets: 3, target_reps: 8 },
  { id: 'rex-8', routine_id: 'routine-pull', exercise_id: 'ex-barbell-row', order: 3, target_sets: 3, target_reps: 8 },
  { id: 'rex-9', routine_id: 'routine-pull', exercise_id: 'ex-curl', order: 4, target_sets: 3, target_reps: 10 },

  { id: 'rex-10', routine_id: 'routine-legs', exercise_id: 'ex-squat', order: 1, target_sets: 4, target_reps: 6 },
  { id: 'rex-11', routine_id: 'routine-legs', exercise_id: 'ex-leg-press', order: 2, target_sets: 3, target_reps: 10 },
  { id: 'rex-12', routine_id: 'routine-legs', exercise_id: 'ex-rdl', order: 3, target_sets: 3, target_reps: 8 },
  { id: 'rex-13', routine_id: 'routine-legs', exercise_id: 'ex-calf-raise', order: 4, target_sets: 4, target_reps: 15 }
];

/** Exercises visible in pickers: defaults plus anything the user added. */
export function selectableExercises(exercises: Exercise[]): Exercise[] {
  return exercises.filter((e) => !e.is_archived);
}

/**
 * Generates ~6 weeks of realistic demo history so charts and PRs have data on
 * first launch. Weights progress slowly week over week, like a real log.
 */
export function generateSampleSessions(): { sessions: WorkoutSession[]; sets: SetLog[] } {
  const sessions: WorkoutSession[] = [];
  const allSets: SetLog[] = [];

  const plan: { routineId: string; baseWeights: Record<string, number> }[] = [
    { routineId: 'routine-push', baseWeights: { 'ex-bench': 70, 'ex-incline-db': 24, 'ex-ohp': 40, 'ex-lateral-raise': 8, 'ex-tricep-pushdown': 25 } },
    { routineId: 'routine-pull', baseWeights: { 'ex-deadlift': 100, 'ex-pullup': 0, 'ex-barbell-row': 60, 'ex-curl': 30 } },
    { routineId: 'routine-legs', baseWeights: { 'ex-squat': 90, 'ex-leg-press': 140, 'ex-rdl': 80, 'ex-calf-raise': 60 } }
  ];

  const routineLines = DEFAULT_ROUTINE_EXERCISES;
  let seq = 0;
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 42); // 6 weeks of history

  for (let dayOffset = 0; dayOffset < 42; dayOffset += 2) {
    const sessionDate = new Date(startDate);
    sessionDate.setDate(sessionDate.getDate() + dayOffset);
    const planEntry = plan[(dayOffset / 2) % plan.length];
    const routine = DEFAULT_ROUTINES.find((r) => r.id === planEntry.routineId)!;
    const weekProgression = dayOffset / 42; // 0 -> 1 over six weeks

    const sessionId = `session-sample-${dayOffset}`;
    sessions.push({
      id: sessionId,
      name: routine.name,
      date: toDateString(sessionDate),
      routine_id: routine.id,
      duration_minutes: 55 + Math.round(Math.random() * 20),
      body_weight: 76,
      notes: '',
      created_at: sessionDate.toISOString()
    });

    const lines = routineLines
      .filter((l) => l.routine_id === routine.id)
      .sort((a, b) => a.order - b.order);

    for (const line of lines) {
      const base = planEntry.baseWeights[line.exercise_id] ?? 0;
      // Round progression to 2.5 kg steps like real plate math.
      const workingWeight = base > 0 ? roundTo(base * (1 + weekProgression * 0.15), 2.5) : 0;
      const targetSets = line.target_sets;
      for (let s = 1; s <= targetSets; s++) {
        seq++;
        allSets.push({
          id: `set-sample-${seq}`,
          session_id: sessionId,
          exercise_id: line.exercise_id,
          set_number: s,
          weight: s === 1 && targetSets > 2 && workingWeight > 0 ? workingWeight - 10 : workingWeight,
          reps: Math.max(4, line.target_reps - Math.floor(Math.random() * 2)),
          is_warmup: s === 1 && targetSets > 2,
          notes: '',
          created_at: sessionDate.toISOString()
        });
      }
    }
  }

  return { sessions, sets: allSets };
}

function toDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
