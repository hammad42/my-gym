import { Exercise, Routine, RoutineExercise, WorkoutSession, SetLog, Settings } from '../types';

/** Settings carrying a live Sheets credential — the thing that must not leak. */
export const SHEETS_SETTINGS: Settings = {
  id: 'general',
  weight_unit: 'kg',
  weekly_goal: 4,
  default_rest_seconds: 90,
  google_sheets: {
    enabled: true,
    webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    secretKey: 'super-secret-key',
    autoSyncTwiceDaily: true,
    lastSyncStatus: 'success'
  }
};

export const ALL_EXERCISES: Exercise[] = [
  { id: 'ex-bench', name: 'Barbell Bench Press', muscle_group: 'chest', equipment: 'barbell', icon: 'Dumbbell', color: '#f97316', is_default: true, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'ex-squat', name: 'Barbell Back Squat', muscle_group: 'quads', equipment: 'barbell', icon: 'Dumbbell', color: '#4ade80', is_default: true, created_at: '2026-01-01T00:00:00.000Z' }
];

export const ALL_ROUTINES: Routine[] = [
  { id: 'routine-push', name: 'Push Day', description: 'Chest and arms', color: '#f97316', icon: 'ClipboardList', day_hint: 'Monday', is_archived: false, created_at: '2026-01-01T00:00:00.000Z' }
];

export const ALL_ROUTINE_EXERCISES: RoutineExercise[] = [
  { id: 'rex-1', routine_id: 'routine-push', exercise_id: 'ex-bench', order: 1, target_sets: 4, target_reps: 6 }
];

export const ALL_SESSIONS: WorkoutSession[] = [
  { id: 'sess-1', name: 'Push Day', date: '2026-09-09', routine_id: 'routine-push', duration_minutes: 58, body_weight: 76, notes: 'strong', created_at: '2026-09-09T10:00:00.000Z' },
  { id: 'sess-2', name: 'Leg Day', date: '2026-09-11', routine_id: null, duration_minutes: 62, body_weight: 76, notes: '', created_at: '2026-09-11T10:00:00.000Z' }
];

export const ALL_SETS: SetLog[] = [
  { id: 'set-1', session_id: 'sess-1', exercise_id: 'ex-bench', set_number: 1, weight: 60, reps: 6, is_warmup: true, notes: '', created_at: '2026-09-09T10:05:00.000Z' },
  { id: 'set-2', session_id: 'sess-1', exercise_id: 'ex-bench', set_number: 2, weight: 80, reps: 5, is_warmup: false, notes: '', created_at: '2026-09-09T10:10:00.000Z' },
  { id: 'set-3', session_id: 'sess-2', exercise_id: 'ex-squat', set_number: 1, weight: 100, reps: 5, is_warmup: false, notes: '', created_at: '2026-09-11T10:05:00.000Z' }
];

/** What the webhook returns for a fetch. */
export const SHEET_PAYLOAD = {
  version: '1.0.0',
  exported_at: '2026-09-11T10:00:00.000Z',
  exercises: ALL_EXERCISES,
  routines: ALL_ROUTINES,
  routine_exercises: ALL_ROUTINE_EXERCISES,
  sessions: ALL_SESSIONS,
  sets: ALL_SETS,
  settings: {
    id: 'general',
    weight_unit: 'kg' as const,
    weekly_goal: 5,
    default_rest_seconds: 90,
    google_sheets: {
      enabled: true,
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      autoSyncTwiceDaily: true
    }
  }
};
