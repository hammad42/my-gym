import React, { useEffect, useRef, useState } from 'react';
import { Exercise, Routine, RoutineExercise, WorkoutSession, SetLog, Settings } from '../types';
import { saveWorkout } from '../lib/db';
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
  Zap
} from 'lucide-react';

interface Props {
  routines: Routine[];
  routineExercises: RoutineExercise[];
  exercises: Exercise[];
  settings: Settings;
  initialRoutineId?: string | null;
  onDone: () => void;
}

/** One exercise and its logged sets in the in-progress workout. */
interface ExerciseBlock {
  exercise_id: string;
  sets: { weight: string; reps: string; is_warmup: boolean }[];
}

export const LogWorkoutScreen: React.FC<Props> = ({
  routines,
  routineExercises,
  exercises,
  settings,
  initialRoutineId = null,
  onDone
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

  // Rest timer
  const [restRemaining, setRestRemaining] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (restRemaining <= 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        setRestRemaining((r) => r - 1);
      }, 1000);
    }
  }, [restRemaining]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRestTimer = () => {
    setRestRemaining(settings.default_rest_seconds);
  };

  // Seed the form from the chosen routine.
  const applyRoutine = (id: string | null) => {
    setRoutineId(id || '');
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

  // Pre-fill from a "Start routine" tap on the Home screen.
  useEffect(() => {
    if (initialRoutineId) {
      applyRoutine(initialRoutineId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoutineId]);

  const parsedDuration = Math.max(1, parseInt(duration, 10) || 0);
  const parsedBodyWeight = parseFloat(bodyWeight) || null;

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
      b.sets.reduce((s, set) => s + Math.max(0, parseFloat(set.weight) || 0) * Math.max(0, parseInt(set.reps, 10) || 0), 0),
    0
  );
  const totalSets = blocks.reduce((sum, b) => sum + b.sets.length, 0);

  const handleSubmit = async () => {
    setError(null);

    if (isSubmitting || isSuccess) return;

    const filledBlocks = blocks
      .map((b) => ({
        exercise_id: b.exercise_id,
        sets: b.sets.filter((s) => (parseFloat(s.weight) || 0) > 0 || (parseInt(s.reps, 10) || 0) > 0)
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
          weight: Math.max(0, parseFloat(s.weight) || 0),
          reps: Math.max(0, parseInt(s.reps, 10) || 0),
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
      setIsSuccess(true);
      if (timerRef.current) clearInterval(timerRef.current);
      setTimeout(() => onDone(), 1200);
    } catch (err) {
      console.error('Failed to save workout:', err);
      setError('Could not save the workout. Please try again.');
      setIsSubmitting(false);
    }
  };

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
              min={1}
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
            onClick={() => setRestRemaining(0)}
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
              const weight = parseFloat(set.weight) || 0;
              const reps = parseInt(set.reps, 10) || 0;
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
                    inputMode="numeric"
                    min={0}
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
