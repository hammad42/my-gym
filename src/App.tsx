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
import { Loader2 } from 'lucide-react';

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

  // Initialize Dexie database on first launch
  useEffect(() => {
    initializeDatabase()
      .then(() => setIsDbReady(true))
      .catch((err) => {
        console.error('Failed to initialize database:', err);
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

  const handleStartRoutine = (routineId: string) => {
    setPendingRoutineId(routineId);
    setActiveScreen('add');
  };

  const handleQuickLog = () => {
    setPendingRoutineId(null);
    setActiveScreen('add');
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
        <Header activeScreen={activeScreen} onOpenSettings={() => setActiveScreen('setup')} />

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
              onDone={() => setActiveScreen('home')}
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
        <BottomNav
          activeScreen={activeScreen}
          onChangeScreen={(screen) => {
            if (screen === 'add') {
              setPendingRoutineId(null);
            }
            setActiveScreen(screen);
          }}
        />
      </div>
    </div>
  );
};
