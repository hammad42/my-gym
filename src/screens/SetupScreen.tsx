import React, { useRef, useState } from 'react';
import { Exercise, Routine, RoutineExercise, WorkoutSession, SetLog, Settings, MuscleGroup, Equipment } from '../types';
import { db, clearAllLogs, resetDatabaseWithSampleData } from '../lib/db';
import { buildBackup, isBackupPayload, downloadBackup } from '../lib/exportImport';
import { selectableExercises } from '../lib/sampleData';
import { ExerciseIcon } from '../components/ExerciseIcon';
import {
  Scale,
  Target,
  Timer,
  Download,
  Upload,
  Trash2,
  RotateCcw,
  Plus,
  AlertCircle,
  Check,
  Dumbbell
} from 'lucide-react';

interface Props {
  exercises: Exercise[];
  routines: Routine[];
  routineExercises: RoutineExercise[];
  sessions: WorkoutSession[];
  sets: SetLog[];
  settings: Settings;
}

const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'forearms', 'traps', 'cardio', 'full_body'
];

const EQUIPMENT: Equipment[] = [
  'barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'other'
];

export const SetupScreen: React.FC<Props> = ({
  exercises,
  routines,
  routineExercises,
  sessions,
  sets,
  settings
}) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMuscle, setNewMuscle] = useState<MuscleGroup>('chest');
  const [newEquipment, setNewEquipment] = useState<Equipment>('barbell');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const library = selectableExercises(exercises);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const updateSettings = async (patch: Partial<Settings>) => {
    await db.settings.update('general', patch);
  };

  const handleExport = () => {
    downloadBackup(buildBackup(exercises, routines, routineExercises, sessions, sets, settings));
    flash('Backup downloaded.');
  };

  const handleImportFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!isBackupPayload(parsed)) {
        flash('That file is not a MyGym backup.');
        return;
      }
      await db.transaction(
        'rw',
        [db.exercises, db.routines, db.routine_exercises, db.sessions, db.sets, db.settings],
        async () => {
          await db.exercises.clear();
          await db.routines.clear();
          await db.routine_exercises.clear();
          await db.sessions.clear();
          await db.sets.clear();
          await db.settings.clear();

          await db.exercises.bulkAdd(parsed.exercises);
          await db.routines.bulkAdd(parsed.routines);
          await db.routine_exercises.bulkAdd(parsed.routine_exercises || []);
          await db.sessions.bulkAdd(parsed.sessions);
          await db.sets.bulkAdd(parsed.sets);
          await db.settings.put(parsed.settings);
        }
      );
      flash('Backup restored.');
    } catch (err) {
      console.error('Import failed:', err);
      flash('Could not read that backup file.');
    }
  };

  const handleAddExercise = async () => {
    if (!newName.trim()) return;
    await db.exercises.add({
      id: `ex-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: newName.trim(),
      muscle_group: newMuscle,
      equipment: newEquipment,
      icon: 'Dumbbell',
      color: '#f97316',
      is_default: false,
      created_at: new Date().toISOString()
    });
    setNewName('');
    setShowAddExercise(false);
    flash('Exercise added to your library.');
  };

  const usedExerciseIds = new Set([
    ...sets.map((s) => s.exercise_id),
    ...routineExercises.map((l) => l.exercise_id)
  ]);

  const handleArchiveExercise = async (exercise: Exercise) => {
    // Archive rather than delete whenever anything still references it.
    await db.exercises.update(exercise.id, { is_archived: true });
    flash(`${exercise.name} hidden from pickers.`);
  };

  return (
    <div className="pb-safe px-4 pt-4 space-y-5">
      <h2 className="text-lg font-bold text-white">Settings & Data</h2>

      {message && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 rounded-xl px-3 py-2">
          <Check className="w-3.5 h-3.5 shrink-0" /> {message}
        </p>
      )}

      {/* Preferences */}
      <section className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 space-y-4">
        <h3 className="text-sm font-bold text-white">Preferences</h3>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <Scale className="w-4 h-4 text-orange-400" />
            <span className="text-sm">Weight unit</span>
          </div>
          <div className="flex rounded-xl overflow-hidden border border-slate-700">
            {(['kg', 'lb'] as const).map((unit) => (
              <button
                key={unit}
                onClick={() => updateSettings({ weight_unit: unit })}
                className={`px-4 py-1.5 text-xs font-bold uppercase transition ${
                  settings.weight_unit === unit
                    ? 'bg-orange-600 text-white'
                    : 'bg-slate-900 text-slate-400'
                }`}
              >
                {unit}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <Target className="w-4 h-4 text-orange-400" />
            <span className="text-sm">Weekly goal</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateSettings({ weekly_goal: Math.max(1, settings.weekly_goal - 1) })}
              className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 text-lg leading-none"
            >
              −
            </button>
            <span className="text-sm font-bold text-white tnum w-6 text-center">
              {settings.weekly_goal}
            </span>
            <button
              onClick={() => updateSettings({ weekly_goal: Math.min(14, settings.weekly_goal + 1) })}
              className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 text-lg leading-none"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <Timer className="w-4 h-4 text-orange-400" />
            <span className="text-sm">Rest timer (seconds)</span>
          </div>
          <input
            type="number"
            min={15}
            max={600}
            step={15}
            value={settings.default_rest_seconds}
            onChange={(e) =>
              updateSettings({
                default_rest_seconds: Math.min(600, Math.max(15, parseInt(e.target.value, 10) || 90))
              })
            }
            className="w-20 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-center text-white tnum focus:outline-none focus:border-orange-500"
          />
        </div>
      </section>

      {/* Exercise library */}
      <section className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Dumbbell className="w-4 h-4 text-orange-400" /> Exercise library
          </h3>
          <button
            onClick={() => setShowAddExercise(!showAddExercise)}
            className="flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 font-semibold"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {showAddExercise && (
          <div className="space-y-2 bg-slate-900/70 border border-slate-700/60 rounded-xl p-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={40}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              placeholder="Exercise name"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newMuscle}
                onChange={(e) => setNewMuscle(e.target.value as MuscleGroup)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
              >
                {MUSCLE_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g.replace('_', ' ')}
                  </option>
                ))}
              </select>
              <select
                value={newEquipment}
                onChange={(e) => setNewEquipment(e.target.value as Equipment)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
              >
                {EQUIPMENT.map((eq) => (
                  <option key={eq} value={eq}>
                    {eq}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleAddExercise}
              disabled={!newName.trim()}
              className="w-full bg-gradient-to-tr from-orange-600 to-amber-500 text-white rounded-lg py-2 text-xs font-bold transition disabled:opacity-50"
            >
              Add exercise
            </button>
          </div>
        )}

        <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
          {library.map((ex) => (
            <div key={ex.id} className="flex items-center gap-2.5">
              <ExerciseIcon exercise={ex} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white truncate">{ex.name}</p>
                <p className="text-[10px] text-slate-500">
                  {ex.muscle_group.replace('_', ' ')} · {ex.equipment}
                </p>
              </div>
              {!usedExerciseIds.has(ex.id) && (
                <button
                  onClick={() => handleArchiveExercise(ex)}
                  className="text-slate-600 hover:text-rose-400 transition"
                  title="Hide from pickers"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Data management */}
      <section className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-white">Data</h3>
        <p className="text-[11px] text-slate-400">
          Everything lives in this browser's IndexedDB — nothing leaves your device.
          {sessions.length > 0 && ` ${sessions.length} session(s), ${sets.length} set(s) stored.`}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleExport}
            className="flex items-center justify-center gap-1.5 bg-slate-900 border border-slate-700 hover:border-orange-500/60 text-slate-200 rounded-xl py-2.5 text-xs font-bold transition"
          >
            <Download className="w-4 h-4" /> Export JSON
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1.5 bg-slate-900 border border-slate-700 hover:border-orange-500/60 text-slate-200 rounded-xl py-2.5 text-xs font-bold transition"
          >
            <Upload className="w-4 h-4" /> Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = '';
            }}
          />
        </div>

        {confirmClear ? (
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                await clearAllLogs();
                setConfirmClear(false);
                flash('All logged workouts deleted.');
              }}
              className="flex-1 bg-rose-600 hover:bg-rose-500 text-white rounded-xl py-2 text-xs font-bold transition"
            >
              Delete all logs
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl py-2 text-xs font-bold transition"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmClear(true)}
            className="w-full flex items-center justify-center gap-1.5 text-rose-400/80 hover:text-rose-400 border border-rose-900/50 hover:border-rose-700/50 rounded-xl py-2.5 text-xs font-bold transition"
          >
            <Trash2 className="w-4 h-4" /> Clear all logged workouts
          </button>
        )}

        {confirmReset ? (
          <div className="space-y-2">
            <p className="flex items-start gap-1.5 text-[11px] text-amber-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              This replaces everything (including routines and your library) with the demo data.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  await resetDatabaseWithSampleData();
                  setConfirmReset(false);
                  flash('Demo data reloaded.');
                }}
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white rounded-xl py-2 text-xs font-bold transition"
              >
                Reload demo data
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl py-2 text-xs font-bold transition"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmReset(true)}
            className="w-full flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-600 rounded-xl py-2.5 text-xs font-bold transition"
          >
            <RotateCcw className="w-4 h-4" /> Reset to demo data
          </button>
        )}
      </section>
    </div>
  );
};
