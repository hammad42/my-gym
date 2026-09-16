import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, renderHook } from '@testing-library/react';
import {
  db,
  initializeDatabase,
  resetDatabaseWithSampleData,
  clearAllLogs,
  restoreFromBackup,
  applyUnitChange,
  saveWorkout,
  LB_PER_KG
} from '../lib/db';
import {
  saveWorkoutDraft,
  getWorkoutDraft
} from '../lib/drafts';
import { DEFAULT_SETTINGS, DEFAULT_EXERCISES } from '../lib/sampleData';
import { LogWorkoutScreen } from '../screens/LogWorkoutScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { ProgressScreen } from '../screens/ProgressScreen';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useGoogleSheetsAutoSync } from '../hooks/useGoogleSheetsAutoSync';
import {
  summarizeSession,
  computePersonalRecords
} from '../lib/workout';
import { sliceBySize } from '../lib/googleSheets';
import { estimateOneRepMax, Exercise, WorkoutSession, SetLog, Settings } from '../types';

beforeAll(async () => {
  await initializeDatabase();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

function session(id = 's1', date = '2026-04-10'): WorkoutSession {
  return {
    id,
    name: 'Push Day',
    date,
    duration_minutes: 60,
    body_weight: 80,
    notes: '',
    created_at: `${date}T10:00:00.000Z`
  };
}

describe('A1: Stale draft cleared on data replacement & sanitized on load', () => {
  beforeEach(async () => {
    await db.drafts.clear();
    await db.sessions.clear();
    await db.sets.clear();
    await db.settings.put(DEFAULT_SETTINGS);
  });

  it('restoreFromBackup clears active workout draft', async () => {
    await saveWorkoutDraft({
      routineId: null,
      name: 'Unfinished',
      date: '2026-04-10',
      duration: '45',
      bodyWeight: '75',
      notes: '',
      blocks: [{ exercise_id: 'ex-bench', sets: [{ weight: '80', reps: '5', is_warmup: false }] }]
    });
    expect(await getWorkoutDraft()).toBeDefined();

    await restoreFromBackup({
      exercises: DEFAULT_EXERCISES,
      sessions: [],
      sets: []
    });

    expect(await getWorkoutDraft()).toBeUndefined();
  });

  it('resetDatabaseWithSampleData clears active workout draft', async () => {
    await saveWorkoutDraft({
      routineId: null,
      name: 'Unfinished',
      date: '2026-04-10',
      duration: '45',
      bodyWeight: '75',
      notes: '',
      blocks: [{ exercise_id: 'ex-bench', sets: [{ weight: '80', reps: '5', is_warmup: false }] }]
    });
    expect(await getWorkoutDraft()).toBeDefined();

    await resetDatabaseWithSampleData();
    expect(await getWorkoutDraft()).toBeUndefined();
  });

  it('clearAllLogs clears active workout draft', async () => {
    await saveWorkoutDraft({
      routineId: null,
      name: 'Unfinished',
      date: '2026-04-10',
      duration: '45',
      bodyWeight: '75',
      notes: '',
      blocks: [{ exercise_id: 'ex-bench', sets: [{ weight: '80', reps: '5', is_warmup: false }] }]
    });
    expect(await getWorkoutDraft()).toBeDefined();

    await clearAllLogs();
    expect(await getWorkoutDraft()).toBeUndefined();
  });

  it('LogWorkoutScreen filters out draft blocks referencing unknown exercises and displays notice', async () => {
    await saveWorkoutDraft({
      routineId: null,
      name: 'Stale draft',
      date: '2026-04-10',
      duration: '45',
      bodyWeight: '75',
      notes: '',
      blocks: [
        { exercise_id: 'ex-deleted-custom', sets: [{ weight: '80', reps: '5', is_warmup: false }] },
        { exercise_id: 'ex-bench', sets: [{ weight: '90', reps: '3', is_warmup: false }] }
      ]
    });

    render(
      <LogWorkoutScreen
        routines={[]}
        routineExercises={[]}
        exercises={DEFAULT_EXERCISES}
        settings={DEFAULT_SETTINGS}
        onDone={() => {}}
      />
    );

    expect(
      await screen.findByText(/Some exercises in your draft no longer exist and were removed/)
    ).toBeInTheDocument();
  });
});

describe('A2: Atomic unit conversion with idempotency guard', () => {
  beforeEach(async () => {
    await db.sessions.clear();
    await db.sets.clear();
    await db.settings.put({ id: 'general', weight_unit: 'kg', weekly_goal: 4, default_rest_seconds: 90 });
  });

  it('converts sets and body weight and updates settings in one transaction', async () => {
    await saveWorkout(session('s1'), [
      { id: 'set-1', exercise_id: 'ex-bench', set_number: 1, weight: 100, reps: 5, is_warmup: false, notes: '' }
    ]);

    const result = await applyUnitChange('lb');
    expect(result.sets).toBe(1);
    expect(result.sessions).toBe(1);

    const updatedSet = await db.sets.get('set-1');
    expect(updatedSet?.weight).toBeCloseTo(100 * LB_PER_KG, 2);

    const updatedSession = await db.sessions.get('s1');
    expect(updatedSession?.body_weight).toBeCloseTo(80 * LB_PER_KG, 2);

    const updatedSettings = await db.settings.get('general');
    expect(updatedSettings?.weight_unit).toBe('lb');
  });

  it('second call with the same target unit is an idempotent no-op', async () => {
    await saveWorkout(session('s1'), [
      { id: 'set-1', exercise_id: 'ex-bench', set_number: 1, weight: 100, reps: 5, is_warmup: false, notes: '' }
    ]);

    const first = await applyUnitChange('lb');
    expect(first.sets).toBe(1);

    const second = await applyUnitChange('lb');
    expect(second.sets).toBe(0);
    expect(second.sessions).toBe(0);

    const updatedSet = await db.sets.get('set-1');
    expect(updatedSet?.weight).toBeCloseTo(100 * LB_PER_KG, 2);
  });
});

describe('A3: Auto-sync effect stability', () => {
  it('does not re-register listeners or recreate timers when query array references change', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    const settings: Settings = {
      id: 'general',
      weight_unit: 'kg',
      weekly_goal: 4,
      default_rest_seconds: 90,
      google_sheets: {
        enabled: true,
        webAppUrl: 'https://example.com/exec',
        autoSyncTwiceDaily: true,
        lastSyncTime: new Date().toISOString()
      }
    };

    const { rerender } = renderHook(
      ({ exercises }) =>
        useGoogleSheetsAutoSync(
          exercises,
          [],
          [],
          [],
          [],
          settings,
          false
        ),
      { initialProps: { exercises: [...DEFAULT_EXERCISES] } }
    );

    const initialIntervalCalls = setIntervalSpy.mock.calls.length;
    const initialListenerCalls = addEventListenerSpy.mock.calls.filter((c) => c[0] === 'online').length;

    // Simulate Dexie useLiveQuery returning a new array instance on every write
    rerender({ exercises: [...DEFAULT_EXERCISES] });
    rerender({ exercises: [...DEFAULT_EXERCISES] });

    expect(setIntervalSpy.mock.calls.length).toBe(initialIntervalCalls);
    expect(addEventListenerSpy.mock.calls.filter((c) => c[0] === 'online').length).toBe(initialListenerCalls);
  });
});

describe('A4: Offline guard for manual syncs', () => {
  beforeEach(async () => {
    await db.settings.put({
      id: 'general',
      weight_unit: 'kg',
      weekly_goal: 4,
      default_rest_seconds: 90,
      google_sheets: {
        enabled: true,
        webAppUrl: 'https://example.com/exec',
        autoSyncTwiceDaily: true,
        lastSyncStatus: 'success'
      }
    });
  });

  it('SetupScreen shows offline message when offline without marking error status', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    render(
      <SetupScreen
        exercises={DEFAULT_EXERCISES}
        routines={[]}
        routineExercises={[]}
        sessions={[]}
        sets={[]}
        settings={(await db.settings.get('general'))!}
      />
    );

    const syncButton = screen.getByRole('button', { name: /^Sync now$/i });
    fireEvent.click(syncButton);

    expect(await screen.findByText(/You're offline — this device will sync when you're back online/)).toBeInTheDocument();

    const storedSettings = await db.settings.get('general');
    expect(storedSettings?.google_sheets?.lastSyncStatus).toBe('success');
  });
});

describe('A5: Exercise archiving and un-archiving', () => {
  beforeEach(async () => {
    await db.exercises.put({
      id: 'ex-custom',
      name: 'Custom Curl',
      muscle_group: 'biceps',
      equipment: 'dumbbell',
      icon: 'Dumbbell',
      color: '#f97316',
      is_default: false,
      created_at: new Date().toISOString()
    });
    await db.settings.put(DEFAULT_SETTINGS);
  });

  it('can archive an exercise, view it in Archived section, and restore it', async () => {
    const ex = await db.exercises.get('ex-custom');
    expect(ex?.is_archived).toBeFalsy();

    const { rerender } = render(
      <SetupScreen
        exercises={[ex!]}
        routines={[]}
        routineExercises={[]}
        sessions={[]}
        sets={[]}
        settings={DEFAULT_SETTINGS}
      />
    );

    // Archive it
    const archiveBtn = screen.getByTitle('Archive exercise');
    fireEvent.click(archiveBtn);

    await waitFor(async () => {
      const updated = await db.exercises.get('ex-custom');
      expect(updated?.is_archived).toBe(true);
    });

    const archivedEx = (await db.exercises.get('ex-custom'))!;
    rerender(
      <SetupScreen
        exercises={[archivedEx]}
        routines={[]}
        routineExercises={[]}
        sessions={[]}
        sets={[]}
        settings={DEFAULT_SETTINGS}
      />
    );

    // Expand archived
    const toggleArchived = screen.getByRole('button', { name: /Archived \(1\)/i });
    fireEvent.click(toggleArchived);

    // Restore
    const restoreBtn = await screen.findByRole('button', { name: /Restore/i });
    fireEvent.click(restoreBtn);

    await waitFor(async () => {
      const restored = await db.exercises.get('ex-custom');
      expect(restored?.is_archived).toBe(false);
    });
  });
});

describe('A6: Epley 1RM rep ceiling', () => {
  it('caps 1RM calculation at maxReps (default 15)', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 10)).toBe(133);
    expect(estimateOneRepMax(100, 15)).toBe(150);
    expect(estimateOneRepMax(100, 16)).toBe(0);
    expect(estimateOneRepMax(60, 40)).toBe(0);
  });

  it('computePersonalRecords excludes sets with >15 reps from 1RM personal records', () => {
    const customEx: Exercise = {
      id: 'ex-highrep',
      name: 'High Rep Press',
      muscle_group: 'chest',
      equipment: 'barbell',
      icon: 'Dumbbell',
      color: '#f97316',
      is_default: false,
      created_at: '2026-01-01T00:00:00.000Z'
    };

    const testSets: SetLog[] = [
      {
        id: 'set-high',
        session_id: 's1',
        exercise_id: 'ex-highrep',
        set_number: 1,
        weight: 50,
        reps: 30, // > 15
        is_warmup: false,
        notes: '',
        created_at: '2026-04-10T10:00:00.000Z'
      }
    ];

    const records = computePersonalRecords([session('s1')], testSets, [customEx]);
    expect(records.length).toBe(1);
    expect(records[0].bestOneRepMax).toBe(0);
  });
});

describe('A7: Time-based exercise metrics', () => {
  const plank: Exercise = {
    id: 'ex-plank',
    name: 'Plank',
    muscle_group: 'core',
    equipment: 'bodyweight',
    icon: 'Timer',
    color: '#facc15',
    is_default: true,
    metric: 'seconds',
    created_at: '2026-01-01T00:00:00.000Z'
  };

  const treadmill: Exercise = {
    id: 'ex-treadmill',
    name: 'Treadmill',
    muscle_group: 'cardio',
    equipment: 'machine',
    icon: 'HeartPulse',
    color: '#ef4444',
    is_default: true,
    metric: 'minutes',
    created_at: '2026-01-01T00:00:00.000Z'
  };

  it('summarizeSession keeps seconds/minutes out of totalReps and populates totalSeconds', () => {
    const summary = summarizeSession({
      session: session('s1'),
      sets: [
        {
          set: { id: '1', session_id: 's1', exercise_id: 'ex-plank', set_number: 1, weight: 0, reps: 60, is_warmup: false, notes: '', created_at: '' },
          exercise: plank
        },
        {
          set: { id: '2', session_id: 's1', exercise_id: 'ex-treadmill', set_number: 1, weight: 0, reps: 15, is_warmup: false, notes: '', created_at: '' },
          exercise: treadmill
        },
        {
          set: { id: '3', session_id: 's1', exercise_id: 'ex-bench', set_number: 1, weight: 100, reps: 5, is_warmup: false, notes: '', created_at: '' },
          exercise: DEFAULT_EXERCISES[0]
        }
      ],
      exercises: [plank, treadmill, DEFAULT_EXERCISES[0]]
    });

    expect(summary.totalReps).toBe(5); // Only the bench reps
    expect(summary.totalSeconds).toBe(60 + 15 * 60); // 60s plank + 15min treadmill
  });

  it('computePersonalRecords skips time-based exercises', () => {
    const sets: SetLog[] = [
      { id: '1', session_id: 's1', exercise_id: 'ex-plank', set_number: 1, weight: 0, reps: 90, is_warmup: false, notes: '', created_at: '2026-04-10T10:00:00.000Z' }
    ];

    const prs = computePersonalRecords([session('s1')], sets, [plank]);
    expect(prs.length).toBe(0);
  });
});

describe('A9: Duplicate exercise prevention in LogWorkoutScreen', () => {
  it('disables already selected exercises in subsequent block selectors', () => {
    render(
      <LogWorkoutScreen
        routines={[]}
        routineExercises={[]}
        exercises={DEFAULT_EXERCISES}
        settings={DEFAULT_SETTINGS}
        onDone={() => {}}
      />
    );

    // Add first block
    const addBtn = screen.getByRole('button', { name: /Add exercise/i });
    fireEvent.click(addBtn);

    // Add second block
    fireEvent.click(addBtn);

    const selects = screen.getAllByLabelText('Exercise');
    expect(selects.length).toBe(2);

    const firstBlockValue = (selects[0] as HTMLSelectElement).value;
    const secondBlockOptions = (selects[1] as HTMLSelectElement).querySelectorAll('option');

    const matchingOption = Array.from(secondBlockOptions).find((opt) => opt.value === firstBlockValue);
    expect(matchingOption?.disabled).toBe(true);
  });
});

describe('A10: React ErrorBoundary', () => {
  it('renders recovery screen with home and reload buttons on uncaught render error', () => {
    const BrokenComponent = () => {
      throw new Error('Test render explosion');
    };

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go to Home Screen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload Page/i })).toBeInTheDocument();

    spy.mockRestore();
  });
});

describe('A11: SetLog.notes handling', () => {
  beforeEach(async () => {
    await db.sessions.clear();
    await db.sets.clear();
    await db.settings.put(DEFAULT_SETTINGS);
  });

  it('saves set notes and displays them in HistoryScreen', async () => {
    await saveWorkout(session('s1'), [
      {
        id: 'set-notes-1',
        exercise_id: 'ex-bench',
        set_number: 1,
        weight: 100,
        reps: 5,
        is_warmup: false,
        notes: 'paused reps'
      }
    ]);

    const savedSet = await db.sets.get('set-notes-1');
    expect(savedSet?.notes).toBe('paused reps');

    render(
      <HistoryScreen
        exercises={DEFAULT_EXERCISES}
        sessions={[session('s1')]}
        sets={[savedSet!]}
        settings={DEFAULT_SETTINGS}
      />
    );

    // Expand session
    fireEvent.click(screen.getByText('Push Day'));

    expect(await screen.findByText('(paused reps)')).toBeInTheDocument();
  });
});

describe('A12: Non-log screen state persistence in sessionStorage', () => {
  it('HistoryScreen query persists across unmount and remount', () => {
    const { unmount } = render(
      <HistoryScreen
        exercises={DEFAULT_EXERCISES}
        sessions={[session('s1')]}
        sets={[]}
        settings={DEFAULT_SETTINGS}
      />
    );

    const input = screen.getByPlaceholderText(/Search workouts/i);
    fireEvent.change(input, { target: { value: 'bench' } });

    expect(sessionStorage.getItem('mygym_history_query')).toBe('bench');

    unmount();

    // Remount
    render(
      <HistoryScreen
        exercises={DEFAULT_EXERCISES}
        sessions={[session('s1')]}
        sets={[]}
        settings={DEFAULT_SETTINGS}
      />
    );

    expect((screen.getByPlaceholderText(/Search workouts/i) as HTMLInputElement).value).toBe('bench');
  });

  it('ProgressScreen selected exercise persists across unmount and remount', () => {
    const { unmount } = render(
      <ProgressScreen
        exercises={DEFAULT_EXERCISES}
        sessions={[session('s1')]}
        sets={[{ id: '1', session_id: 's1', exercise_id: 'ex-bench', set_number: 1, weight: 100, reps: 5, is_warmup: false, notes: '', created_at: '' }]}
        settings={DEFAULT_SETTINGS}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'ex-bench' } });

    expect(sessionStorage.getItem('mygym_progress_selected_exercise')).toBe('ex-bench');

    unmount();

    // Remount
    render(
      <ProgressScreen
        exercises={DEFAULT_EXERCISES}
        sessions={[session('s1')]}
        sets={[{ id: '1', session_id: 's1', exercise_id: 'ex-bench', set_number: 1, weight: 100, reps: 5, is_warmup: false, notes: '', created_at: '' }]}
        settings={DEFAULT_SETTINGS}
      />
    );

    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('ex-bench');
  });
});

describe('A13: sliceBySize discriminated union typing', () => {
  it('slices exercises items and preserves discriminated union kind', () => {
    const parts = sliceBySize(DEFAULT_EXERCISES, 'exercises', 500);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      expect(part.k).toBe('exercises');
      expect(Array.isArray(part.items)).toBe(true);
    }
  });
});

describe('A8: Dexie populate handler', () => {
  it('database populates sample data on fresh initialization', async () => {
    await db.delete();
    await initializeDatabase();
    expect(await db.exercises.count()).toBeGreaterThan(0);
    expect(await db.sessions.count()).toBeGreaterThan(0);
    expect(await db.sets.count()).toBeGreaterThan(0);
  });
});
