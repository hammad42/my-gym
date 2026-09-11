import React, { useState } from 'react';
import { Exercise, Routine, RoutineExercise } from '../types';
import { db, saveRoutineExercises } from '../lib/db';
import { selectableExercises } from '../lib/sampleData';
import { ExerciseIcon } from './ExerciseIcon';
import { Plus, Trash2, Check, X, ChevronUp, ChevronDown } from 'lucide-react';

interface Props {
  routine: Routine;
  exercises: Exercise[];
  lines: RoutineExercise[];
  onDone: () => void;
}

interface DraftLine {
  exercise_id: string;
  target_sets: string;
  target_reps: string;
}

export const RoutineEditor: React.FC<Props> = ({ routine, exercises, lines, onDone }) => {
  const [name, setName] = useState(routine.name);
  const [description, setDescription] = useState(routine.description);
  const [dayHint, setDayHint] = useState(routine.day_hint);
  const [draft, setDraft] = useState<DraftLine[]>(
    [...lines]
      .sort((a, b) => a.order - b.order)
      .map((l) => ({
        exercise_id: l.exercise_id,
        target_sets: String(l.target_sets),
        target_reps: String(l.target_reps)
      }))
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const available = selectableExercises(exercises);
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const availableIds = new Set(available.map((e) => e.id));

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setDraft((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const removeLine = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const moveLine = (index: number, dir: -1 | 1) => {
    setDraft((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const addLine = () => {
    const firstAvailable = available.find((e) => !draft.some((l) => l.exercise_id === e.id));
    setDraft((prev) => [
      ...prev,
      {
        exercise_id: firstAvailable?.id || available[0]?.id || '',
        target_sets: '3',
        target_reps: '10'
      }
    ]);
  };

  const handleSave = async () => {
    setError(null);

    if (!name.trim()) {
      setError('Give the routine a name.');
      return;
    }

    const cleanLines = draft
      .filter((l) => l.exercise_id)
      .map((l) => ({
        exercise_id: l.exercise_id,
        target_sets: Math.max(1, parseInt(l.target_sets, 10) || 1),
        target_reps: Math.max(1, parseInt(l.target_reps, 10) || 1)
      }));

    if (new Set(cleanLines.map((l) => l.exercise_id)).size !== cleanLines.length) {
      setError('Each exercise should only appear once in the routine.');
      return;
    }

    setIsSaving(true);
    try {
      await db.routines.update(routine.id, {
        name: name.trim(),
        description: description.trim(),
        day_hint: dayHint.trim(),
        updated_at: new Date().toISOString()
      });
      await saveRoutineExercises(routine.id, cleanLines);
      onDone();
    } catch (err) {
      console.error('Failed to save routine:', err);
      setError('Could not save the routine. Please try again.');
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1">Routine name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
            placeholder="e.g. Push Day A"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={60}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
              placeholder="Chest, shoulders, triceps"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Day hint</label>
            <input
              type="text"
              value={dayHint}
              onChange={(e) => setDayHint(e.target.value)}
              maxLength={20}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500"
              placeholder="Monday"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Planned exercises</h3>
          <span className="text-[11px] text-slate-400">{draft.length} exercise(s)</span>
        </div>

        {draft.map((line, index) => {
          const exercise = exerciseById.get(line.exercise_id);
          return (
            <div
              key={index}
              className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 flex items-center gap-3"
            >
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveLine(index, -1)}
                  disabled={index === 0}
                  className="text-slate-500 hover:text-white disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => moveLine(index, 1)}
                  disabled={index === draft.length - 1}
                  className="text-slate-500 hover:text-white disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              <select
                value={line.exercise_id}
                onChange={(e) => updateLine(index, { exercise_id: e.target.value })}
                className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                {exercise && !availableIds.has(exercise.id) && (
                  <option value={exercise.id}>{exercise.name} (archived)</option>
                )}
                {available.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={line.target_sets}
                  onChange={(e) => updateLine(index, { target_sets: e.target.value })}
                  className="w-12 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-2 text-xs text-center text-white focus:outline-none focus:border-orange-500"
                  aria-label="Target sets"
                />
                <span className="text-[10px] text-slate-500">sets</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={line.target_reps}
                  onChange={(e) => updateLine(index, { target_reps: e.target.value })}
                  className="w-12 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-2 text-xs text-center text-white focus:outline-none focus:border-orange-500"
                  aria-label="Target reps"
                />
                <span className="text-[10px] text-slate-500">reps</span>
              </div>

              {exercise && <ExerciseIcon exercise={exercise} size="sm" />}

              <button
                onClick={() => removeLine(index)}
                className="text-slate-500 hover:text-rose-400 transition shrink-0"
                aria-label="Remove exercise"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}

        <button
          onClick={addLine}
          disabled={available.length === 0}
          className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-600 rounded-2xl py-3 text-sm text-slate-400 hover:text-orange-400 hover:border-orange-500/60 transition disabled:opacity-40"
        >
          <Plus className="w-4 h-4" /> Add exercise
        </button>
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={onDone}
          className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl py-3 text-sm font-semibold transition"
        >
          <X className="w-4 h-4" /> Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 flex items-center justify-center gap-1.5 bg-gradient-to-tr from-orange-600 to-amber-500 text-white rounded-xl py-3 text-sm font-bold shadow-lg shadow-orange-500/25 transition hover:scale-[1.02] active:scale-95 disabled:opacity-60"
        >
          <Check className="w-4 h-4" /> {isSaving ? 'Saving…' : 'Save routine'}
        </button>
      </div>
    </div>
  );
};
