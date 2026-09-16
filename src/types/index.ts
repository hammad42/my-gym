export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'forearms'
  | 'traps'
  | 'cardio'
  | 'full_body'
  | 'other';

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'kettlebell'
  | 'other';

export type ExerciseMetric = 'reps' | 'seconds' | 'minutes';

/**
 * A single entry in the exercise library (mirrors Category in the ledger app).
 * Exercises are archived rather than deleted whenever a logged set still
 * references them.
 */
export interface Exercise {
  id: string;
  name: string;
  muscle_group: MuscleGroup;
  equipment: Equipment;
  icon: string; // lucide icon name, resolved by ExerciseIcon
  color: string; // tailwind-friendly hex used for chips and accents
  is_default: boolean;
  /** Hidden from pickers but kept so history keeps rendering. */
  is_archived?: boolean;
  /** Unit of measurement for the second column ('reps' by default). */
  metric?: ExerciseMetric;
  created_at: string;
}

/**
 * A workout plan / template (mirrors Account in the ledger app). Routines hold
 * ordered planned exercises with target sets and reps.
 */
export interface Routine {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  /** Planned day hint, e.g. "Monday" or "Push A" — purely informational. */
  day_hint: string;
  is_archived: boolean;
  created_at: string;
  updated_at?: string;
}

/** One planned line inside a routine. */
export interface RoutineExercise {
  id: string;
  routine_id: string;
  exercise_id: string;
  order: number;
  target_sets: number;
  target_reps: number;
}

/**
 * A logged training session (mirrors Transaction in the ledger app). Sessions
 * may be started from a routine or logged free-form without one.
 */
export interface WorkoutSession {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  routine_id?: string | null;
  duration_minutes: number;
  body_weight?: number | null;
  notes: string;
  created_at: string;
}

/** One logged working set (mirrors the per-transaction detail rows). */
export interface SetLog {
  id: string;
  session_id: string;
  exercise_id: string;
  set_number: number;
  weight: number; // in the user's configured unit, 0 for bodyweight
  reps: number;
  is_warmup: boolean;
  notes?: string;
  created_at: string;
}

export type WeightUnit = 'kg' | 'lb';

export interface GoogleSheetsSyncConfig {
  enabled: boolean;
  webAppUrl: string;
  /**
   * Private passphrase shared with the Apps Script. This is a credential:
   * it is stripped from every export and from the settings embedded in the
   * sync payload (see `sanitizeSettings`). It is only ever sent as the
   * top-level auth field of a request.
   */
  secretKey?: string;
  autoSyncTwiceDaily: boolean; // 2 times a day schedule (every 12 hours)
  lastSyncTime?: string; // ISO string
  lastSyncStatus?: 'success' | 'error' | 'syncing' | 'idle';
  lastSyncError?: string;
  lastRecordCount?: number;
  connectionVerifiedAt?: string;
  scriptVersion?: number;
}

export interface Settings {
  id: string; // 'general'
  weight_unit: WeightUnit;
  /** Target number of workout sessions per week, used on the Home screen. */
  weekly_goal: number;
  /** Default rest between sets in seconds, used by the rest timer. */
  default_rest_seconds: number;
  google_sheets?: GoogleSheetsSyncConfig;
}

/** A set resolved against its exercise, for rendering history and stats. */
export interface ResolvedSet {
  set: SetLog;
  exercise: Exercise;
}

/** A session resolved with all of its sets, for history rendering. */
export interface ResolvedSession {
  session: WorkoutSession;
  sets: ResolvedSet[];
  exercises: Exercise[]; // unique exercises in the order they appear
}

export interface SessionSummary {
  totalSets: number;
  totalReps: number;
  /** Sum of weight * reps across working sets (weight 0 counts as 0 volume). */
  totalVolume: number;
  exerciseCount: number;
  /** Sum of seconds performed across working sets for time-based exercises. */
  totalSeconds?: number;
}

export interface WeekSummary {
  sessionsThisWeek: number;
  weeklyGoal: number;
  totalSets: number;
  totalVolume: number;
  totalMinutes: number;
  /** Consecutive weeks (ending this week) that met the goal. */
  streakWeeks: number;
}

export interface PersonalRecord {
  exercise: Exercise;
  bestWeight: number;
  bestWeightReps: number;
  bestWeightDate: string;
  bestOneRepMax: number;
  bestOneRepMaxDate: string;
  bestSetCount: number;
  lastPerformed?: string;
}

/** Epley estimated 1RM — capped at maxReps (default 15) to prevent endurance sets from skewing PRs. */
export function estimateOneRepMax(weight: number, reps: number, maxReps = 15): number {
  if (reps <= 0 || weight <= 0 || reps > maxReps) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

export function volumeOf(weight: number, reps: number): number {
  return Math.max(0, weight) * Math.max(0, reps);
}
