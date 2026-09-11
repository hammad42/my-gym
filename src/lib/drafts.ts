import { db } from './db';

/**
 * An in-progress workout, captured exactly as the logging form holds it.
 *
 * The strings are the raw input values: restoring "82.5" as a string puts the
 * caret back where the user left it, and avoids persisting half-parsed state.
 */
export interface WorkoutDraft {
  id: 'active';
  updatedAt: string;
  routineId: string | null;
  name: string;
  date: string;
  duration: string;
  bodyWeight: string;
  notes: string;
  blocks: { exercise_id: string; sets: { weight: string; reps: string; is_warmup: boolean }[] }[];
  /** Epoch ms of an in-flight rest, so the countdown survives a tab switch. */
  restDeadline?: number | null;
}

export type WorkoutDraftInput = Omit<WorkoutDraft, 'id' | 'updatedAt'>;

/** A draft only matters once something has actually been typed or logged. */
export function draftHasContent(d: WorkoutDraftInput | WorkoutDraft | null | undefined): boolean {
  if (!d) return false;
  if (d.name.trim() || d.notes.trim()) return true;
  if (d.blocks.length > 0) return true;
  // A routine was picked (pre-filled blocks) — that counts as intent too.
  return Boolean(d.routineId);
}

export async function saveWorkoutDraft(draft: WorkoutDraftInput): Promise<void> {
  if (!draftHasContent(draft)) return;
  const row: WorkoutDraft = { ...draft, id: 'active', updatedAt: new Date().toISOString() };
  await db.drafts.put(row);
}

export async function getWorkoutDraft(): Promise<WorkoutDraft | undefined> {
  return db.drafts.get('active');
}

export async function clearWorkoutDraft(): Promise<void> {
  await db.drafts.delete('active');
}
