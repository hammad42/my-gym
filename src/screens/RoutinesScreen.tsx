import React, { useState } from 'react';
import { Exercise, Routine, RoutineExercise, WorkoutSession } from '../types';
import { db } from '../lib/db';
import { RoutineEditor } from '../components/RoutineEditor';
import { ExerciseIcon } from '../components/ExerciseIcon';
import { formatDisplayDate } from '../lib/formatters';
import { Plus, Pencil, Play, Archive, ArchiveRestore, ClipboardList, X } from 'lucide-react';

interface Props {
  routines: Routine[];
  routineExercises: RoutineExercise[];
  exercises: Exercise[];
  sessions: WorkoutSession[];
  onStartRoutine: (routineId: string) => void;
}

export const RoutinesScreen: React.FC<Props> = ({
  routines,
  routineExercises,
  exercises,
  sessions,
  onStartRoutine
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  const handleCreate = async () => {
    const id = `routine-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await db.routines.add({
      id,
      name: 'New Routine',
      description: '',
      color: '#f97316',
      icon: 'ClipboardList',
      day_hint: '',
      is_archived: false,
      created_at: new Date().toISOString()
    });
    setCreatingId(id);
  };

  const toggleArchive = async (routine: Routine) => {
    await db.routines.update(routine.id, {
      is_archived: !routine.is_archived,
      updated_at: new Date().toISOString()
    });
  };

  const active = routines.filter((r) => !r.is_archived);
  const archived = routines.filter((r) => r.is_archived);

  const lastPerformedFor = (routineId: string): string | undefined => {
    const dates = sessions.filter((s) => s.routine_id === routineId).map((s) => s.date);
    return dates.length > 0 ? dates.sort().reverse()[0] : undefined;
  };

  const renderRoutineCard = (routine: Routine) => {
    const lines = routineExercises
      .filter((l) => l.routine_id === routine.id)
      .sort((a, b) => a.order - b.order);
    const last = lastPerformedFor(routine.id);

    return (
      <div
        key={routine.id}
        className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 space-y-3"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-lg font-bold shrink-0 border"
            style={{
              backgroundColor: `${routine.color}22`,
              borderColor: `${routine.color}55`,
              color: routine.color
            }}
          >
            {routine.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">{routine.name}</p>
            <p className="text-xs text-slate-400 truncate">
              {routine.day_hint ? `${routine.day_hint} · ` : ''}
              {routine.description || `${lines.length} exercises`}
              {last && ` · last ${formatDisplayDate(last).toLowerCase()}`}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setEditingId(editingId === routine.id ? null : routine.id)}
              className="w-8 h-8 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition"
              title="Edit routine"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => toggleArchive(routine)}
              className="w-8 h-8 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition"
              title={routine.is_archived ? 'Restore routine' : 'Archive routine'}
            >
              {routine.is_archived ? (
                <ArchiveRestore className="w-4 h-4" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
            </button>
            {!routine.is_archived && (
              <button
                onClick={() => onStartRoutine(routine.id)}
                className="w-8 h-8 rounded-lg bg-gradient-to-tr from-orange-600 to-amber-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/25 transition hover:scale-105 active:scale-95"
                title="Start this routine"
              >
                <Play className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {lines.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {lines.slice(0, 6).map((line) => {
              const ex = exerciseById.get(line.exercise_id);
              if (!ex) return null;
              return (
                <div
                  key={line.id}
                  className="flex items-center gap-1.5 bg-slate-900/70 border border-slate-700/50 rounded-lg pl-1 pr-2 py-1"
                >
                  <ExerciseIcon exercise={ex} size="sm" />
                  <span className="text-[10px] text-slate-300 tnum">
                    {line.target_sets}×{line.target_reps}
                  </span>
                </div>
              );
            })}
            {lines.length > 6 && (
              <span className="text-[10px] text-slate-500">+{lines.length - 6} more</span>
            )}
          </div>
        )}

        {(editingId === routine.id || creatingId === routine.id) && (
          <RoutineEditor
            routine={routine}
            exercises={exercises}
            lines={lines}
            onDone={() => {
              setEditingId(null);
              setCreatingId(null);
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div className="pb-safe px-4 pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Routines</h2>
        {archived.length > 0 && (
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="text-[11px] text-slate-400 hover:text-slate-200 font-semibold"
          >
            {showArchived ? 'Hide archived' : `Archived (${archived.length})`}
          </button>
        )}
      </div>

      {active.length === 0 && !creatingId ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-40" />
          No routines yet. Create one to plan your training week.
        </div>
      ) : (
        <div className="space-y-2.5">
          {(showArchived ? [...active, ...archived] : active).map(renderRoutineCard)}
        </div>
      )}

      {!creatingId && (
        <button
          onClick={handleCreate}
          className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-600 rounded-2xl py-3.5 text-sm text-slate-400 hover:text-orange-400 hover:border-orange-500/60 transition"
        >
          <Plus className="w-4 h-4" /> New routine
        </button>
      )}

      {creatingId && (
        <div className="flex justify-end">
          <button
            onClick={() => setCreatingId(null)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 font-semibold"
          >
            <X className="w-3.5 h-3.5" /> Cancel creating
          </button>
        </div>
      )}
    </div>
  );
};
