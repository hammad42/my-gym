import React from 'react';
import { Exercise, Routine, WorkoutSession, SetLog, Settings } from '../types';
import { ScreenType } from '../components/BottomNav';
import { ExerciseIcon } from '../components/ExerciseIcon';
import {
  summarizeWeek,
  resolveSessions,
  summarizeSession
} from '../lib/workout';
import { formatVolume, formatDuration, formatDisplayDate } from '../lib/formatters';
import { Flame, Target, Clock, Dumbbell, ChevronRight, Plus } from 'lucide-react';

interface Props {
  routines: Routine[];
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: SetLog[];
  settings: Settings;
  onNavigate: (screen: ScreenType) => void;
  onQuickLog: () => void;
  onStartRoutine: (routineId: string) => void;
}

export const HomeScreen: React.FC<Props> = ({
  routines,
  exercises,
  sessions,
  sets,
  settings,
  onNavigate,
  onQuickLog,
  onStartRoutine
}) => {
  const week = summarizeWeek(sessions, sets, settings.weekly_goal);
  const resolved = resolveSessions(sessions, sets, exercises);
  const recent = resolved.slice(0, 5);
  const activeRoutines = routines.filter((r) => !r.is_archived);

  const goalPct = Math.min(100, Math.round((week.sessionsThisWeek / Math.max(1, week.weeklyGoal)) * 100));

  return (
    <div className="pb-safe px-4 pt-4 space-y-5">
      {/* This week summary */}
      <section className="rounded-3xl bg-gradient-to-br from-slate-800 to-slate-800/40 border border-slate-700/60 p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">This Week</p>
            <h2 className="text-3xl font-bold text-white mt-1 tnum">
              {week.sessionsThisWeek}
              <span className="text-lg text-slate-400 font-medium"> / {week.weeklyGoal} workouts</span>
            </h2>
          </div>
          {week.streakWeeks > 0 && (
            <div className="flex items-center gap-1 bg-orange-950/60 border border-orange-800/50 text-orange-300 px-2.5 py-1.5 rounded-xl">
              <Flame className="w-4 h-4" />
              <span className="text-xs font-bold tnum">{week.streakWeeks}w streak</span>
            </div>
          )}
        </div>

        <div className="h-2.5 bg-slate-900 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-600 to-amber-400 rounded-full transition-all"
            style={{ width: `${goalPct}%` }}
          />
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-slate-900/70 rounded-xl p-3">
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Dumbbell className="w-3.5 h-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wide">Sets</span>
            </div>
            <p className="text-lg font-bold text-white tnum">{week.totalSets}</p>
          </div>
          <div className="bg-slate-900/70 rounded-xl p-3">
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Target className="w-3.5 h-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wide">Volume</span>
            </div>
            <p className="text-lg font-bold text-white tnum">
              {formatVolume(week.totalVolume, settings.weight_unit)}
            </p>
          </div>
          <div className="bg-slate-900/70 rounded-xl p-3">
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Clock className="w-3.5 h-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wide">Time</span>
            </div>
            <p className="text-lg font-bold text-white tnum">{formatDuration(week.totalMinutes)}</p>
          </div>
        </div>
      </section>

      {/* Start a routine */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white">Start a routine</h3>
          <button
            onClick={() => onNavigate('routines')}
            className="flex items-center text-[11px] text-orange-400 hover:text-orange-300 font-semibold"
          >
            Manage <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {activeRoutines.length === 0 ? (
          <button
            onClick={() => onNavigate('routines')}
            className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-600 rounded-2xl py-4 text-sm text-slate-400 hover:text-orange-400 hover:border-orange-500/60 transition"
          >
            <Plus className="w-4 h-4" /> Create your first routine
          </button>
        ) : (
          <div className="grid gap-2.5">
            {activeRoutines.map((routine) => (
              <button
                key={routine.id}
                onClick={() => onStartRoutine(routine.id)}
                className="w-full flex items-center gap-3 bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 text-left hover:border-orange-500/50 transition active:scale-[0.99]"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-lg font-bold shrink-0 border"
                  style={{ backgroundColor: `${routine.color}22`, borderColor: `${routine.color}55`, color: routine.color }}
                >
                  {routine.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{routine.name}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {routine.day_hint ? `${routine.day_hint} · ` : ''}
                    {routine.description}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-orange-400 text-xs font-bold shrink-0">
                  Start <ChevronRight className="w-4 h-4" />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Quick log */}
      <button
        onClick={onQuickLog}
        className="w-full flex items-center justify-center gap-2 border border-orange-500/40 bg-orange-500/10 rounded-2xl py-3 text-sm font-bold text-orange-300 hover:bg-orange-500/20 transition"
      >
        <Plus className="w-4 h-4" /> Log a free workout
      </button>

      {/* Recent sessions */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white">Recent sessions</h3>
          <button
            onClick={() => onNavigate('history')}
            className="flex items-center text-[11px] text-orange-400 hover:text-orange-300 font-semibold"
          >
            View all <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            No workouts logged yet. Time to lift!
          </div>
        ) : (
          <div className="grid gap-2.5">
            {recent.map(({ session, sets: resolvedSets, exercises: sessionExercises }) => {
              const summary = summarizeSession({ session, sets: resolvedSets, exercises: sessionExercises });
              return (
                <div
                  key={session.id}
                  className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-white">{session.name}</p>
                    <p className="text-[11px] text-slate-400">{formatDisplayDate(session.date)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {sessionExercises.slice(0, 5).map((ex) => (
                      <ExerciseIcon key={ex.id} exercise={ex} size="sm" />
                    ))}
                    {sessionExercises.length > 5 && (
                      <span className="text-[10px] text-slate-400">+{sessionExercises.length - 5} more</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2.5 text-[11px] text-slate-400 tnum">
                    <span>{summary.totalSets} sets</span>
                    <span>·</span>
                    <span>{formatVolume(summary.totalVolume, settings.weight_unit)}</span>
                    <span>·</span>
                    <span>{formatDuration(session.duration_minutes)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
