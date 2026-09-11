import React, { useEffect, useRef, useState } from 'react';
import { Exercise, Routine, RoutineExercise, WorkoutSession, SetLog, Settings } from '../types';
import { saveWorkout } from '../lib/db';
import {
  WorkoutDraft,
  clearWorkoutDraft,
  draftHasContent,
  getWorkoutDraft,
  saveWorkoutDraft
} from '../lib/drafts';
import { selectableExercises } from '../lib/sampleData';
import { estimateOneRepMax } from '../types';
import { formatWeight, formatClock, getTodayString } from '../lib/formatters';
import { ExerciseIcon } from '../components/ExerciseIcon';
import {
  Dumbbell,
  Calendar,
  Check,
  Timer,
  Plus,
  Trash2,
  Flame,
  AlertCircle,
  Zap,
  RotateCcw
} from 'lucide-react';

interface Props {
  routines: Routine[];
  routineExercises: RoutineExercise[];
  exercises: Exercise[];
  settings: Settings;
  initialRoutineId?: string | null;
  onDone: () => void;
  /** Reports whether there is unsaved work, so navigation can warn. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** One exercise and its logged sets in the in-progress workout. */
interface ExerciseBlock {
  exercise_id: string;
  sets: { weight: string; reps: string; is_warmup: boolean }[];
}

/** Parses a non-negative number from a partially typed input, decimals intact. */
function num(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export const LogWorkoutScreen: React.FC<Props> = ({
  routines,
  routineExercises,
  exercises,
  settings,
  initialRoutineId = null,
  onDone,
  onDirtyChange
}) => {
  const activeRoutines = routines.filter((r) => !r.is_archived);
  const available = selectableExercises(exercises);
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  const [routineId, setRoutineId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [date, setDate] = useState<string>(getTodayString());
  const [duration, setDuration] = useState<string>('60');
  const [bodyWeight, setBodyWeight] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [blocks, setBlocks] = useState<ExerciseBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftReady, setDraftReady] = useState(false);

  // Rest timer. Held as an absolute deadline rather than a decrementing counter:
  // mobile browsers throttle background timers and pause them on screen sleep,
  // so a counter drifts or stops while a deadline always resolves correctly.
  const [restRemaining, setRestRemaining] = useState<number>(0);
  const [restDeadline, setRestDeadline] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<number | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    deadlineRef.current = null;
    setRestDeadline(null);
    setRestRemaining(0);
  };

  const tick = () => {
    const deadline = deadlineRef.current;
    if (deadline === null) return;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setRestRemaining(remaining);
    if (remaining <= 0) {
      stopTimer();
      signalRestComplete();
    }
  };

  const startTimerAt = (deadline: number) => {
    deadlineRef.current = deadline;
    setRestDeadline(deadline);
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setRestRemaining(remaining);
    if (timerRef.current) clearInterval(timerRef.current);
    if (remaining <= 0) {
      deadlineRef.current = null;
      return;
    }
    timerRef.current = setInterval(tick, 500);
  };

  const startRestTimer = () => {
    startTimerAt(Date.now() + settings.default_rest_seconds * 1000);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Restore an unfinished workout (or seed from a routine when there is none).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let draft: WorkoutDraft | undefined;
      try {
        draft = await getWorkoutDraft();
      } catch {
        draft = undefined;
      }
      if (cancelled) return;

      if (draft && draftHasContent(draft)) {
        setRoutineId(draft.routineId ?? '');
        setName(draft.name);
        setDate(draft.date);
        setDuration(draft.duration);
        setBodyWeight(draft.bodyWeight);
        setNotes(draft.notes);
        setBlocks(
          draft.blocks.map((b) => ({
            exercise_id: b.exercise_id,
            sets: b.sets.map((s) => ({ ...s }))
          }))
        );
        setDraftRestored(true);
        // A rest that expired while away should not silently resume or beep.
        if (draft.restDeadline && draft.restDeadline > Date.now()) {
          startTimerAt(draft.restDeadline);
        }
      } else if (initialRoutineId) {
        applyRoutine(initialRoutineId);
      }

      setDraftReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save the draft on every change so a tab switch is never data loss.
  useEffect(() => {
    if (!draftReady || isSuccess) return;
    const payload = {
      routineId: routineId || null,
      name,
      date,
      duration,
      bodyWeight,
      notes,
      blocks,
      restDeadline
    };
    (async () => {
      try {
        if (draftHasContent(payload)) await saveWorkoutDraft(payload);
        else await clearWorkoutDraft();
      } catch {
        // A failed draft write must never break logging.
      }
    })();
  }, [draftReady, isSuccess, routineId, name, date, duration, bodyWeight, notes, blocks, restDeadline]);

  // Tell the shell when there is unsaved work, so it can warn before navigating.
  useEffect(() => {
    if (!onDirtyChange) return;
    const dirty =
      !isSuccess && draftHasContent({ routineId: routineId || null, name, date, duration, bodyWeight, notes, blocks, restDeadline });
    onDirtyChange(dirty);
  }, [onDirtyChange, isSuccess, routineId, name, date, duration, bodyWeight, notes, blocks, restDeadline]);

  const discardDraft = async () => {
    await clearWorkoutDraft();
    setDraftRestored(false);
    setRoutineId('');
    setName('');
    setDate(getTodayString());
    setDuration('60');
    setBodyWeight('');
    setNotes('');
    setBlocks([]);
    stopTimer();
  };

  // Seed the form from the chosen routine.
  const applyRoutine = (id: string | null) => {
    setRoutineId(id || '');
    setDraftRestored(false);
    if (!id) {
      setName('');
      setBlocks([]);
      return;
    }
    const routine = routines.find((r) => r.id === id);
    if (routine) {
      setName(routine.name);
      const lines = routineExercises
        .filter((l) => l.routine_id === id)
        .sort((a, b) => a.order - b.order);
      setBlocks(
        lines.map((line) => ({
          exercise_id: line.exercise_id,
          sets: Array.from({ length: line.target_sets }, () => ({
            weight: '',
            reps: String(line.target_reps),
            is_warmup: false
          }))
        }))
      );
    }
  };

  // Pre-fill from a "Start routine" tap that arrives after mount.
  useEffect(() => {
    if (initialRoutineId && draftReady && !draftRestored) {
      applyRoutine(initialRoutineId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoutineId, draftReady]);

  // 0 is legitimate for a cardio-only entry; the field simply records minutes.
  const parsedDuration = Math.min(900, Math.max(0, Math.round(num(duration))));
  const parsedBodyWeight = num(bodyWeight) || null;
  const today = getTodayString();

  const updateBlock = (blockIndex: number, patch: Partial<ExerciseBlock>) => {
    setBlocks((prev) => prev.map((b, i) => (i === blockIndex ? { ...b, ...patch } : b)));
  };

  const updateSet = (blockIndex: number, setIndex: number, patch: Partial<ExerciseBlock['sets'][number]>) => {
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIndex
          ? { ...b, sets: b.sets.map((s, j) => (j === setIndex ? { ...s, ...patch } : s)) }
          : b
      )
    );
  };

  const addSet = (blockIndex: number) => {
    setBlocks((prev) =>
      prev.map((b, i) => {
        if (i !== blockIndex) return b;
        // Carry the previous set's weight/reps forward — the common case is a
        // repeat of the last working set.
        const last = b.sets[b.sets.length - 1];
        return {
          ...b,
          sets: [
            ...b.sets,
            { weight: last?.weight || '', reps: last?.reps || '', is_warmup: false }
          ]
        };
      })
    );
    startRestTimer();
  };

  const removeSet = (blockIndex: number, setIndex: number) => {
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIndex ? { ...b, sets: b.sets.filter((_, j) => j !== setIndex) } : b
      )
    );
  };

  const addBlock = () => {
    const firstAvailable = available.find((e) => !blocks.some((b) => b.exercise_id === e.id));
    setBlocks((prev) => [
      ...prev,
      {
        exercise_id: firstAvailable?.id || available[0]?.id || '',
        sets: [{ weight: '', reps: '', is_warmup: false }]
      }
    ]);
  };

  const removeBlock = (blockIndex: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== blockIndex));
  };

  const totalVolume = blocks.reduce(
    (sum, b) =>
      sum +
      b.sets.reduce((s, set) => (set.is_warmup ? s : s + num(set.weight) * num(set.reps)), 0),
    0
  );
  const totalSets = blocks.reduce((sum, b) => sum + b.sets.length, 0);

  const handleSubmit = async () => {
    setError(null);

    if (isSubmitting || isSuccess) return;

    // A future date would count toward a week that has not happened yet.
    if (date > today) {
      setError('That date is in the future. Pick today or an earlier date.');
      return;
    }

    const filledBlocks = blocks
      .map((b) => ({
        exercise_id: b.exercise_id,
        sets: b.sets.filter((s) => num(s.weight) > 0 || num(s.reps) > 0)
      }))
      .filter((b) => b.sets.length > 0);

    if (filledBlocks.length === 0) {
      setError('Log at least one set before saving the workout.');
      return;
    }

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const session: WorkoutSession = {
      id: sessionId,
      name: name.trim() || 'Workout',
      date,
      routine_id: routineId || null,
      duration_minutes: parsedDuration,
      body_weight: parsedBodyWeight,
      notes: notes.trim(),
      created_at: new Date().toISOString()
    };

    const setRows: Omit<SetLog, 'session_id' | 'created_at'>[] = [];
    for (const block of filledBlocks) {
      block.sets.forEach((s) => {
        setRows.push({
          id: `set-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          exercise_id: block.exercise_id,
          set_number: 0, // rewritten below
          // Round to 2dp: readable for plate math while keeping entered decimals.
          weight: Math.round(num(s.weight) * 100) / 100,
          reps: Math.round(num(s.reps) * 100) / 100,
          is_warmup: s.is_warmup,
          notes: ''
        });
      });
    }
    // Renumber sets 1..N per exercise, counting warmups too.
    const counters = new Map<string, number>();
    for (const row of setRows) {
      const next = (counters.get(row.exercise_id) || 0) + 1;
      counters.set(row.exercise_id, next);
      row.set_number = next;
    }

    setIsSubmitting(true);
    try {
      await saveWorkout(session, setRows);
      // The workout is committed — the draft has done its job.
      await clearWorkoutDraft().catch(() => {});
      stopTimer();
      setIsSuccess(true);
      setTimeout(() => onDone(), 1200);
    } catch (err) {
      console.error('Failed to save workout:', err);
      setError('Could not save the workout. Please try again.');
      setIsSubmitting(false);
    }
  };

/** Audible + haptic cue so a finished rest is noticed from across the gym. */
function signalRestComplete(): void {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Vibration unsupported (iOS Safari) — the tone still fires.
  }
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    setTimeout(() => {
      void ctx.close?.();
    }, 900);
  } catch {
    // Audio is blocked until the first user gesture; the timer still resets.
  }
}

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-orange-500/20 text-orange-400 flex items-center justify-center mb-4">
          <Check className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-bold text-white">Workout saved!</h2>
        <p className="text-sm text-slate-400 mt-1">
          {totalSets} sets · {formatWeight(totalVolume, settings.weight_unit).replace('Bodyweight', '0')} volume
        </p>
      </div>
    );
  }

  return (
    <div className="pb-safe px-4 pt-4 space-y-4">
      <h2 className="text-lg font-bold text-white">Log Workout</h2>

      {draftRestored && (
        <div className="flex items-center justify-between gap-2 bg-sky-950/50 border border-sky-800/50 rounded-2xl px-3.5 py-2.5">
          <p className="text-[11px] text-sky-200">
            Resumed your unfinished workout — nothing was lost.
          </p>
          <button
            onClick={discardDraft}
            className="flex items-center gap-1 text-[11px] font-semibold text-sky-300/80 hover:text-sky-100 shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Start fresh
          </button>
        </div>
      )}

      {/* Session meta */}
      <section className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Workout name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
              placeholder="e.g. Push Day"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-xs font-semibold text-slate-400 mb-1">
              <Calendar className="w-3 h-3" /> Date
            </label>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1">
            Routine (optional — fills the plan for you)
          </label>
          <select
            value={routineId}
            onChange={(e) => applyRoutine(e.target.value || null)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
          >
            <option value="">Free workout (no routine)</option>
            {activeRoutines.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="flex items-center gap-1 text-xs font-semibold text-slate-400 mb-1">
              <Timer className="w-3 h-3" /> Duration (min)
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={900}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white tnum focus:outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <label className="flex items-center gap-1 text-xs font-semibold text-slate-400 mb-1">
              <Flame className="w-3 h-3" /> Body weight ({settings.weight_unit})
            </label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.5"
              value={bodyWeight}
              onChange={(e) => setBodyWeight(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white tnum focus:outline-none focus:border-orange-500"
              placeholder="Optional"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 resize-none"
            placeholder="How did it feel?"
          />
        </div>
      </section>

      {/* Rest timer */}
      {restRemaining > 0 && (
        <div className="flex items-center justify-between bg-orange-950/50 border border-orange-700/50 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-2 text-orange-300">
            <Zap className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Rest</span>
          </div>
          <p className="text-2xl font-bold text-white tnum">{formatClock(restRemaining)}</p>
          <button
            onClick={stopTimer}
            className="text-xs text-orange-300/70 hover:text-orange-200 font-semibold"
          >
            Skip
          </button>
        </div>
      )}

      {/* Exercise blocks */}
      {blocks.map((block, blockIndex) => {
        const exercise = exerciseById.get(block.exercise_id);
        return (
          <section
            key={blockIndex}
            className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-2.5"
          >
            <div className="flex items-center gap-2.5">
              {exercise && <ExerciseIcon exercise={exercise} size="sm" />}
              <select
                value={block.exercise_id}
                onChange={(e) => updateBlock(blockIndex, { exercise_id: e.target.value })}
                className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-sm font-semibold text-white focus:outline-none focus:border-orange-500"
                aria-label="Exercise"
              >
                {available.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeBlock(blockIndex)}
                className="text-slate-500 hover:text-rose-400 transition shrink-0"
                aria-label="Remove exercise"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {block.sets.map((set, setIndex) => {
              const weight = num(set.weight);
              const reps = num(set.reps);
              const oneRm = estimateOneRepMax(weight, reps);
              return (
                <div
                  key={setIndex}
                  className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${
                    set.is_warmup ? 'bg-slate-900/50' : 'bg-slate-900/80'
                  }`}
                >
                  <span className="w-6 text-[11px] font-bold text-slate-500 tnum">{setIndex + 1}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="2.5"
                    value={set.weight}
                    onChange={(e) => updateSet(blockIndex, setIndex, { weight: e.target.value })}
                    className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-center text-white tnum focus:outline-none focus:border-orange-500"
                    placeholder={`wt ${settings.weight_unit}`}
                    aria-label="Weight"
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={set.reps}
                    onChange={(e) => updateSet(blockIndex, setIndex, { reps: e.target.value })}
                    className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-center text-white tnum focus:outline-none focus:border-orange-500"
                    placeholder="reps"
                    aria-label="Reps"
                  />
                  <button
                    onClick={() => updateSet(blockIndex, setIndex, { is_warmup: !set.is_warmup })}
                    className={`text-[10px] font-bold px-2 py-1.5 rounded-lg border transition ${
                      set.is_warmup
                        ? 'bg-sky-950/60 border-sky-700/60 text-sky-300'
                        : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                    }`}
                    title="Toggle warmup set"
                  >
                    W
                  </button>
                  <span className="w-14 text-right text-[10px] text-slate-500 tnum">
                    {oneRm > 0 ? `~${oneRm} 1RM` : ''}
                  </span>
                  <button
                    onClick={() => removeSet(blockIndex, setIndex)}
                    className="text-slate-600 hover:text-rose-400 transition"
                    aria-label="Remove set"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}

            <button
              onClick={() => addSet(blockIndex)}
              className="w-full flex items-center justify-center gap-1.5 border border-dashed border-slate-600 rounded-xl py-2 text-xs text-slate-400 hover:text-orange-400 hover:border-orange-500/60 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add set
            </button>
          </section>
        );
      })}

      <button
        onClick={addBlock}
        disabled={available.length === 0}
        className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-600 rounded-2xl py-3.5 text-sm text-slate-400 hover:text-orange-400 hover:border-orange-500/60 transition disabled:opacity-40"
      >
        <Dumbbell className="w-4 h-4" /> Add exercise
      </button>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-xl px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </p>
      )}

      {/* Sticky save bar */}
      <div className="sticky bottom-24 bg-slate-800/95 backdrop-blur border border-slate-700/60 rounded-2xl p-3 flex items-center gap-3">
        <div className="flex-1 text-xs text-slate-400 tnum">
          {totalSets} sets · {Math.round(totalVolume).toLocaleString('en-US')} {settings.weight_unit} volume
        </div>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex items-center gap-1.5 bg-gradient-to-tr from-orange-600 to-amber-500 text-white rounded-xl px-5 py-2.5 text-sm font-bold shadow-lg shadow-orange-500/25 transition hover:scale-[1.02] active:scale-95 disabled:opacity-60"
        >
          <Check className="w-4 h-4" /> {isSubmitting ? 'Saving…' : 'Save workout'}
        </button>
      </div>
    </div>
  );
};
