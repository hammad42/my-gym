import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, initializeDatabase } from './lib/db';
import { Header } from './components/Header';
import { BottomNav, ScreenType } from './components/BottomNav';
import { HomeScreen } from './screens/HomeScreen';
import { LogWorkoutScreen } from './screens/LogWorkoutScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { RoutinesScreen } from './screens/RoutinesScreen';
import { ProgressScreen } from './screens/ProgressScreen';
import { SetupScreen } from './screens/SetupScreen';
import { DEFAULT_SETTINGS } from './lib/sampleData';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useGoogleSheetsAutoSync } from './hooks/useGoogleSheetsAutoSync';
import { syncToGoogleSheets, updateSheetsStatus } from './lib/googleSheets';

export const App: React.FC = () => {
  const [activeScreen, setActiveScreenState] = useState<ScreenType>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mygym_active_screen');
      if (saved && ['home', 'history', 'add', 'routines', 'progress', 'setup'].includes(saved)) {
        return saved as ScreenType;
      }
    }
    return 'home';
  });

  const setActiveScreen = (screen: ScreenType) => {
    setActiveScreenState(screen);
    if (typeof window !== 'undefined') {
      localStorage.setItem('mygym_active_screen', screen);
    }
  };

  const [pendingRoutineId, setPendingRoutineId] = useState<string | null>(null);
  const [isDbReady, setIsDbReady] = useState(false);
  const [isHeaderSyncing, setIsHeaderSyncing] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [logDirty, setLogDirty] = useState(false);

  // Initialize Dexie database on first launch
  useEffect(() => {
    initializeDatabase()
      .then(() => setIsDbReady(true))
      .catch((err) => {
        console.error('Failed to initialize database:', err);
        // Private browsing / disabled storage: the app still renders, but every
        // write silently fails, so say so instead of pretending to save.
        setStorageFailed(true);
        setIsDbReady(true);
      });
  }, []);

  // Reactive Dexie queries
  const exercises = useLiveQuery(() => db.exercises.toArray(), [], []);
  const routines = useLiveQuery(() => db.routines.toArray(), [], []);
  const routineExercises = useLiveQuery(() => db.routine_exercises.toArray(), [], []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), [], []);
  const sets = useLiveQuery(() => db.sets.toArray(), [], []);
  const settingsData = useLiveQuery(() => db.settings.get('general'), []);

  const settings = settingsData || DEFAULT_SETTINGS;

  // Background 2x daily automated backup to Google Sheets. Deferred while a
  // workout is being logged so a sync cannot fire mid-session.
  useGoogleSheetsAutoSync(
    exercises || [],
    routines || [],
    routineExercises || [],
    sessions || [],
    sets || [],
    settings,
    activeScreen === 'add'
  );

  const handleHeaderQuickSync = async () => {
    const config = settings.google_sheets;
    if (!config?.enabled || !config.webAppUrl || isHeaderSyncing) return;

    setIsHeaderSyncing(true);
    try {
      const res = await syncToGoogleSheets(
        config.webAppUrl,
        exercises || [],
        routines || [],
        routineExercises || [],
        sessions || [],
        sets || [],
        settings,
        config.secretKey
      );
      if (res.success) {
        await updateSheetsStatus(settings.id, {
          lastSyncTime: res.timestamp || new Date().toISOString(),
          lastSyncStatus: 'success',
          lastSyncError: undefined,
          lastRecordCount: (sessions || []).length
        });
      } else {
        await updateSheetsStatus(settings.id, {
          lastSyncStatus: 'error',
          lastSyncError: res.message
        });
      }
    } catch (err: any) {
      console.error('Quick sync failed:', err);
    } finally {
      setIsHeaderSyncing(false);
    }
  };

  const handleStartRoutine = (routineId: string) => {
    setPendingRoutineId(routineId);
    setActiveScreen('add');
  };

  const handleQuickLog = () => {
    setPendingRoutineId(null);
    setActiveScreen('add');
  };

  /**
   * Navigating away mid-workout is safe — the draft is in IndexedDB — but the
   * user should know that, so an accidental tap is not a scare.
   */
  const navigateWithGuard = (screen: ScreenType) => {
    if (logDirty && activeScreen === 'add' && screen !== 'add') {
      const proceed = window.confirm(
        'Leave this workout? Your progress is saved as a draft and you can resume it from the Log tab.'
      );
      if (!proceed) return;
    }
    if (screen === 'add') setPendingRoutineId(null);
    setActiveScreen(screen);
  };

  if (!isDbReady || !exercises || !routines || !routineExercises || !sessions || !sets) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-2xl bg-orange-500/20 text-orange-400 flex items-center justify-center animate-pulse mb-3">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
        <p className="text-sm font-semibold text-white">Loading MyGym...</p>
        <p className="text-xs text-slate-400 mt-1">Starting offline IndexedDB log</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex justify-center">
      <div className="w-full max-w-md min-h-screen flex flex-col bg-slate-900 border-x border-slate-800/80 shadow-2xl relative">
        {/* Header */}
        <Header
          activeScreen={activeScreen}
          onOpenSettings={() => navigateWithGuard('setup')}
          googleSheetsConfig={settings.google_sheets}
          onQuickSync={handleHeaderQuickSync}
          isSyncing={isHeaderSyncing}
        />

        {storageFailed && (
          <div className="mx-4 mt-3 flex items-start gap-2 bg-rose-950/50 border border-rose-800/60 rounded-2xl px-3.5 py-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-200">
              Local storage is unavailable — this browser is probably in private mode. Workouts
              cannot be saved on this device.
            </p>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto">
          {activeScreen === 'home' && (
            <HomeScreen
              routines={routines}
              exercises={exercises}
              sessions={sessions}
              sets={sets}
              settings={settings}
              onNavigate={(screen) => setActiveScreen(screen)}
              onQuickLog={handleQuickLog}
              onStartRoutine={handleStartRoutine}
            />
          )}

          {activeScreen === 'add' && (
            <LogWorkoutScreen
              routines={routines}
              routineExercises={routineExercises}
              exercises={exercises}
              settings={settings}
              initialRoutineId={pendingRoutineId}
              onDirtyChange={setLogDirty}
              onDone={() => {
                setPendingRoutineId(null);
                setLogDirty(false);
                setActiveScreen('home');
              }}
            />
          )}

          {activeScreen === 'history' && (
            <HistoryScreen
              exercises={exercises}
              sessions={sessions}
              sets={sets}
              settings={settings}
            />
          )}

          {activeScreen === 'routines' && (
            <RoutinesScreen
              routines={routines}
              routineExercises={routineExercises}
              exercises={exercises}
              sessions={sessions}
              onStartRoutine={handleStartRoutine}
            />
          )}

          {activeScreen === 'progress' && (
            <ProgressScreen
              exercises={exercises}
              sessions={sessions}
              sets={sets}
              settings={settings}
            />
          )}

          {activeScreen === 'setup' && (
            <SetupScreen
              exercises={exercises}
              routines={routines}
              routineExercises={routineExercises}
              sessions={sessions}
              sets={sets}
              settings={settings}
            />
          )}
        </main>

        {/* Fixed Mobile Bottom Navigation */}
        <BottomNav activeScreen={activeScreen} onChangeScreen={navigateWithGuard} />
      </div>
    </div>
  );
};
