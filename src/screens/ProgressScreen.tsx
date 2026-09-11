import React, { useMemo, useState } from 'react';
import { Exercise, WorkoutSession, SetLog, Settings } from '../types';
import {
  computePersonalRecords,
  exerciseProgressSeries,
  sessionsPerWeek,
  volumeByMuscleGroup
} from '../lib/workout';
import { formatWeight, formatDisplayDate } from '../lib/formatters';
import { ExerciseIcon } from '../components/ExerciseIcon';
import { Trophy, TrendingUp, Dumbbell, ChevronRight } from 'lucide-react';

interface Props {
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: SetLog[];
  settings: Settings;
}

const MUSCLE_LABELS: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
  forearms: 'Forearms',
  traps: 'Traps',
  cardio: 'Cardio',
  full_body: 'Full Body'
};

export const ProgressScreen: React.FC<Props> = ({ exercises, sessions, sets, settings }) => {
  const [selectedExercise, setSelectedExercise] = useState<string>('');

  const records = useMemo(
    () => computePersonalRecords(sessions, sets, exercises),
    [sessions, sets, exercises]
  );
  const weekly = useMemo(() => sessionsPerWeek(sessions, 8), [sessions]);
  const muscleVolume = useMemo(() => volumeByMuscleGroup(sets, exercises), [sets, exercises]);

  const trackedExercises = useMemo(() => {
    const ids = new Set(sets.map((s) => s.exercise_id));
    return exercises.filter((e) => ids.has(e.id));
  }, [exercises, sets]);

  const progressSeries = useMemo(
    () =>
      selectedExercise
        ? exerciseProgressSeries(sessions, sets, selectedExercise)
        : [],
    [sessions, sets, selectedExercise]
  );

  const maxWeeklyCount = Math.max(1, ...weekly.map((w) => w.count));
  const maxMuscleVolume = Math.max(1, ...muscleVolume.map((m) => m.volume));
  const progressExercise = exercises.find((e) => e.id === selectedExercise);

  return (
    <div className="pb-safe px-4 pt-4 space-y-5">
      <h2 className="text-lg font-bold text-white">Progress</h2>

      {/* Sessions per week */}
      <section className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-orange-400" /> Sessions per week
        </h3>
        <div className="flex items-end justify-between gap-1.5 h-28">
          {weekly.map(({ week, count }) => (
            <div key={week} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-slate-400 tnum">{count || ''}</span>
              <div
                className={`w-full rounded-t-md transition-all ${
                  count >= settings.weekly_goal
                    ? 'bg-gradient-to-t from-orange-600 to-amber-400'
                    : 'bg-slate-700'
                }`}
                style={{ height: `${Math.max(4, (count / maxWeeklyCount) * 80)}px` }}
                title={`${week}: ${count} session(s)`}
              />
              <span className="text-[9px] text-slate-500">{week.slice(-3)}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-2 text-center">
          Goal: {settings.weekly_goal} sessions/week · highlighted bars hit the goal
        </p>
      </section>

      {/* Volume by muscle group */}
      {muscleVolume.length > 0 && (
        <section className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-1.5">
            <Dumbbell className="w-4 h-4 text-orange-400" /> Volume by muscle group
          </h3>
          <div className="space-y-2">
            {muscleVolume.slice(0, 6).map(({ group, volume }) => (
              <div key={group} className="flex items-center gap-2.5">
                <span className="w-20 text-[11px] text-slate-400 truncate">
                  {MUSCLE_LABELS[group] || group}
                </span>
                <div className="flex-1 h-2.5 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-orange-600 to-amber-400 rounded-full"
                    style={{ width: `${(volume / maxMuscleVolume) * 100}%` }}
                  />
                </div>
                <span className="w-20 text-right text-[10px] text-slate-500 tnum">
                  {Math.round(volume).toLocaleString('en-US')} {settings.weight_unit}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Exercise progress chart */}
      {trackedExercises.length > 0 && (
        <section className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-1.5">
            <ChevronRight className="w-4 h-4 text-orange-400" /> Exercise progression
          </h3>
          <select
            value={selectedExercise}
            onChange={(e) => setSelectedExercise(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-orange-500 mb-3"
          >
            <option value="">Choose an exercise…</option>
            {trackedExercises.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}
              </option>
            ))}
          </select>

          {selectedExercise && progressSeries.length > 0 && (
            <>
              <div className="flex items-end justify-between gap-1 h-24 overflow-x-auto">
                {(() => {
                  const maxWeight = Math.max(1, ...progressSeries.map((p) => p.weight));
                  return progressSeries.slice(-12).map((point) => (
                    <div
                      key={point.date}
                      className="flex flex-col items-center gap-1 min-w-[18px] flex-1"
                      title={`${formatDisplayDate(point.date)}: ${formatWeight(point.weight, settings.weight_unit)} × ${point.reps}`}
                    >
                      <span className="text-[9px] text-slate-400 tnum">{point.weight || 'BW'}</span>
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-orange-600 to-amber-400"
                        style={{ height: `${Math.max(4, (point.weight / maxWeight) * 64)}px` }}
                      />
                      <span className="text-[8px] text-slate-500">{point.date.slice(5)}</span>
                    </div>
                  ));
                })()}
              </div>
              <p className="text-[10px] text-slate-500 mt-2 text-center">
                {progressExercise?.name} — heaviest working set per session
              </p>
            </>
          )}
          {selectedExercise && progressSeries.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-4">No working sets logged yet.</p>
          )}
        </section>
      )}

      {/* Personal records */}
      <section>
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-1.5">
          <Trophy className="w-4 h-4 text-amber-400" /> Personal records
        </h3>
        {records.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            Log some working sets to start collecting records.
          </p>
        ) : (
          <div className="space-y-2">
            {records.slice(0, 12).map((pr) => (
              <div
                key={pr.exercise.id}
                className="flex items-center gap-3 bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3"
              >
                <ExerciseIcon exercise={pr.exercise} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{pr.exercise.name}</p>
                  <p className="text-[10px] text-slate-400">
                    best e1RM {pr.bestOneRepMax} {settings.weight_unit} ·{' '}
                    {pr.bestWeight > 0
                      ? `${pr.bestWeight} ${settings.weight_unit} × ${pr.bestWeightReps}`
                      : 'bodyweight'}
                    {' · '}
                    {formatDisplayDate(pr.bestWeightDate).toLowerCase()}
                  </p>
                </div>
                <span className="text-xs font-bold text-amber-400 tnum shrink-0">
                  {pr.bestOneRepMax}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
