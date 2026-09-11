import React, { useMemo, useState } from 'react';
import { Exercise, WorkoutSession, SetLog, Settings } from '../types';
import { resolveSessions, summarizeSession } from '../lib/workout';
import { deleteSession } from '../lib/db';
import { ExerciseIcon } from '../components/ExerciseIcon';
import { formatVolume, formatDuration, formatDisplayDate, formatWeight } from '../lib/formatters';
import { ChevronDown, ChevronUp, Trash2, Search, Dumbbell } from 'lucide-react';

interface Props {
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: SetLog[];
  settings: Settings;
}

export const HistoryScreen: React.FC<Props> = ({ exercises, sessions, sets, settings }) => {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const resolved = useMemo(() => resolveSessions(sessions, sets, exercises), [sessions, sets, exercises]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resolved;
    return resolved.filter(
      ({ session, exercises: exs }) =>
        session.name.toLowerCase().includes(q) ||
        session.notes.toLowerCase().includes(q) ||
        exs.some((e) => e.name.toLowerCase().includes(q))
    );
  }, [resolved, query]);

  // Group by date string for section headers.
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const list = groups.get(item.session.date);
      if (list) list.push(item);
      else groups.set(item.session.date, [item]);
    }
    return [...groups.entries()];
  }, [filtered]);

  const handleDelete = async (sessionId: string) => {
    await deleteSession(sessionId);
    setConfirmDelete(null);
    setExpanded(null);
  };

  return (
    <div className="pb-safe px-4 pt-4 space-y-4">
      <h2 className="text-lg font-bold text-white">Workout History</h2>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={60}
          className="w-full bg-slate-800/60 border border-slate-700/60 rounded-2xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
          placeholder="Search workouts, exercises, notes…"
        />
      </div>

      {grouped.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-40" />
          {query ? 'No workouts match your search.' : 'No workouts logged yet.'}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([date, items]) => (
            <section key={date}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 px-1">
                {formatDisplayDate(date)}
              </h3>
              <div className="space-y-2.5">
                {items.map(({ session, sets: resolvedSets, exercises: sessionExercises }) => {
                  const summary = summarizeSession({ session, sets: resolvedSets, exercises: sessionExercises });
                  const isOpen = expanded === session.id;
                  return (
                    <div
                      key={session.id}
                      className="bg-slate-800/60 border border-slate-700/60 rounded-2xl overflow-hidden"
                    >
                      <button
                        onClick={() => setExpanded(isOpen ? null : session.id)}
                        className="w-full p-3.5 text-left"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-bold text-white">{session.name}</p>
                          {isOpen ? (
                            <ChevronUp className="w-4 h-4 text-slate-500" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-500" />
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 tnum">
                          <span>{sessionExercises.length} exercises</span>
                          <span>·</span>
                          <span>{summary.totalSets} sets</span>
                          <span>·</span>
                          <span>{formatVolume(summary.totalVolume, settings.weight_unit)}</span>
                          <span>·</span>
                          <span>{formatDuration(session.duration_minutes)}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t border-slate-700/60 px-3.5 py-3 space-y-3">
                          {sessionExercises.map((ex) => {
                            const exSets = resolvedSets.filter((r) => r.exercise.id === ex.id);
                            const best = exSets.reduce((m, r) => Math.max(m, r.set.weight), 0);
                            return (
                              <div key={ex.id} className="flex items-start gap-2.5">
                                <ExerciseIcon exercise={ex} size="sm" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <p className="text-xs font-bold text-white truncate">{ex.name}</p>
                                    <p className="text-[10px] text-orange-400 shrink-0">
                                      best {formatWeight(best, settings.weight_unit)}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {exSets.map(({ set }) => (
                                      <span
                                        key={set.id}
                                        className={`text-[10px] tnum px-1.5 py-0.5 rounded-md border ${
                                          set.is_warmup
                                            ? 'bg-sky-950/40 border-sky-800/40 text-sky-300'
                                            : 'bg-slate-900 border-slate-700 text-slate-300'
                                        }`}
                                      >
                                        {set.weight > 0 ? `${set.weight}×${set.reps}` : `${set.reps} reps`}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {session.notes && (
                            <p className="text-xs text-slate-400 bg-slate-900/60 rounded-xl px-3 py-2">
                              {session.notes}
                            </p>
                          )}

                          {confirmDelete === session.id ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleDelete(session.id)}
                                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white rounded-xl py-2 text-xs font-bold transition"
                              >
                                Delete permanently
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl py-2 text-xs font-bold transition"
                              >
                                Keep it
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(session.id)}
                              className="flex items-center gap-1.5 text-xs text-rose-400/80 hover:text-rose-400 font-semibold transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete session
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
