import { Exercise, Routine, RoutineExercise, WorkoutSession, SetLog, Settings } from '../types';
import { sanitizeSettings } from './sanitize';

export interface BackupPayload {
  app: 'mygym';
  version: 1;
  exported_at: string;
  exercises: Exercise[];
  routines: Routine[];
  routine_exercises: RoutineExercise[];
  sessions: WorkoutSession[];
  sets: SetLog[];
  settings: Settings;
}

/**
 * Builds the downloadable backup.
 *
 * Settings are sanitized first: an exported file is something people email to
 * themselves or drop in cloud storage, so the Sheets secret key must not ride
 * along in it. The sync destination and status are preserved so a restore still
 * knows where to sync.
 */
export function buildBackup(
  exercises: Exercise[],
  routines: Routine[],
  routineExercises: RoutineExercise[],
  sessions: WorkoutSession[],
  sets: SetLog[],
  settings: Settings
): BackupPayload {
  return {
    app: 'mygym',
    version: 1,
    exported_at: new Date().toISOString(),
    exercises,
    routines,
    routine_exercises: routineExercises,
    sessions,
    sets,
    settings: sanitizeSettings(settings)
  };
}

export function isBackupPayload(data: unknown): data is BackupPayload {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Partial<BackupPayload>;
  return (
    candidate.app === 'mygym' &&
    Array.isArray(candidate.exercises) &&
    Array.isArray(candidate.routines) &&
    Array.isArray(candidate.sessions) &&
    Array.isArray(candidate.sets)
  );
}

/** Trigger a JSON file download in the browser. */
export function downloadBackup(payload: BackupPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mygym-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
