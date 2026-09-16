import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, renderHook } from '@testing-library/react';
import { db, initializeDatabase, resetDatabaseWithSampleData, saveWorkout, convertStoredWeights, applyUnitChange, LB_PER_KG } from '../lib/db';
import {
  clearWorkoutDraft,
  draftHasContent,
  getWorkoutDraft,
  saveWorkoutDraft
} from '../lib/drafts';
import { DEFAULT_SETTINGS, DEFAULT_EXERCISES, DEFAULT_ROUTINES, DEFAULT_ROUTINE_EXERCISES } from '../lib/sampleData';
import { LogWorkoutScreen } from '../screens/LogWorkoutScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { App } from '../App';
import { useGoogleSheetsAutoSync } from '../hooks/useGoogleSheetsAutoSync';
import { summarizeSession, summarizeWeek, volumeByMuscleGroup } from '../lib/workout';
import { resolveSessions } from '../lib/workout';
import { WorkoutSession, SetLog, Settings } from '../types';

afterEach(() => {
  cleanup();
  // The shell persists the active tab, so tests would otherwise inherit each
  // other's screen.
  localStorage.clear();
});

const settingsWith = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

function session(id: string, date = '2026-09-01'): WorkoutSession {
  return { id, name: 'Test', date, routine_id: null, duration_minutes: 60, body_weight: null, notes: '', created_at: `${date}T10:00:00.000Z` };
}
function setRow(id: string, sessionId: string, n: number, weight: number, reps: number, warmup = false): SetLog {
  return { id, session_id: sessionId, exercise_id: 'ex-bench', set_number: n, weight, reps, is_warmup: warmup, notes: '', created_at: '2026-09-01T10:00:00.000Z' };
}

const TODAY = new Date();
const todayKey = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// BUG-01 / BUG-05 — draft persistence
// ---------------------------------------------------------------------------

describe('workout drafts (BUG-01, BUG-05)', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });
  beforeEach(async () => {
    await db.sessions.clear();
    await db.sets.clear();
    await db.drafts.clear();
  });

  const props = {
    routines: DEFAULT_ROUTINES,
    routineExercises: DEFAULT_ROUTINE_EXERCISES,
    exercises: DEFAULT_EXERCISES,
    settings: settingsWith(),
    initialRoutineId: null,
    onDone: () => {}
  };

  it('draftHasContent ignores an untouched form', () => {
    expect(draftHasContent(null)).toBe(false);
    expect(
      draftHasContent({ routineId: null, name: '', date: todayKey, duration: '60', bodyWeight: '', notes: '', blocks: [] })
    ).toBe(false);
  });

  it('draftHasContent recognises typed content and a chosen routine', () => {
    expect(
      draftHasContent({ routineId: null, name: 'Push', date: todayKey, duration: '60', bodyWeight: '', notes: '', blocks: [] })
    ).toBe(true);
    expect(
      draftHasContent({ routineId: 'routine-push', name: '', date: todayKey, duration: '60', bodyWeight: '', notes: '', blocks: [] })
    ).toBe(true);
  });

  it('auto-saves typed sets to IndexedDB', async () => {
    render(<LogWorkoutScreen {...props} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '87.5' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '6' } });

    await waitFor(async () => {
      const draft = await getWorkoutDraft();
      expect(draft?.blocks[0]?.sets[0]).toMatchObject({ weight: '87.5', reps: '6' });
    });
  });

  it('restores the draft on a fresh mount — the tab-switch data-loss case', async () => {
    await saveWorkoutDraft({
      routineId: null,
      name: 'Leg Day',
      date: todayKey,
      duration: '75',
      bodyWeight: '80',
      notes: 'knee fine',
      blocks: [{ exercise_id: 'ex-squat', sets: [{ weight: '120', reps: '5', is_warmup: false }] }]
    });

    render(<LogWorkoutScreen {...props} />);

    expect(await screen.findByText(/Resumed your unfinished workout/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Leg Day')).toBeInTheDocument();
    expect(screen.getByDisplayValue('knee fine')).toBeInTheDocument();
    await waitFor(() => {
      expect((screen.getAllByLabelText('Weight')[0] as HTMLInputElement).value).toBe('120');
    });
  });

  it('"Start fresh" clears the draft', async () => {
    await saveWorkoutDraft({
      routineId: null, name: 'Old', date: todayKey, duration: '60', bodyWeight: '', notes: '',
      blocks: [{ exercise_id: 'ex-squat', sets: [{ weight: '100', reps: '5', is_warmup: false }] }]
    });

    render(<LogWorkoutScreen {...props} />);
    fireEvent.click(await screen.findByText('Start fresh'));

    await waitFor(async () => {
      expect(await getWorkoutDraft()).toBeUndefined();
    });
    expect(screen.queryByText(/Resumed your unfinished workout/)).not.toBeInTheDocument();
  });

  it('clears the draft once the workout is saved', async () => {
    render(<LogWorkoutScreen {...props} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '60' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '10' } });

    await waitFor(async () => expect(await getWorkoutDraft()).toBeDefined());
    fireEvent.click(screen.getByText('Save workout'));
    await screen.findByText('Workout saved!');

    expect(await getWorkoutDraft()).toBeUndefined();
  });

  it('reports dirtiness so navigation can warn', async () => {
    const onDirtyChange = vi.fn();
    render(<LogWorkoutScreen {...props} onDirtyChange={onDirtyChange} />);
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(false));

    fireEvent.click(screen.getByText('Add exercise'));
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
  });

  it('does not resurrect a finished workout as a draft', async () => {
    await clearWorkoutDraft();
    render(<LogWorkoutScreen {...props} />);
    await waitFor(async () => expect(await getWorkoutDraft()).toBeUndefined());
    expect(screen.queryByText(/Resumed your unfinished workout/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BUG-02 — unit conversion
// ---------------------------------------------------------------------------

describe('weight unit conversion (BUG-02)', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });
  beforeEach(async () => {
    await db.sessions.clear();
    await db.sets.clear();
    await db.settings.update('general', { weight_unit: 'kg' });
  });

  it('converts every working set into the target unit', async () => {
    await saveWorkout(session('c1'), [
      { id: 'a', exercise_id: 'ex-bench', set_number: 1, weight: 100, reps: 5, is_warmup: false, notes: '' },
      { id: 'b', exercise_id: 'ex-bench', set_number: 2, weight: 60, reps: 8, is_warmup: true, notes: '' }
    ]);

    const report = await convertStoredWeights('lb');

    const sets = (await db.sets.toArray()).sort((x, y) => x.set_number - y.set_number);
    expect(sets[0].weight).toBeCloseTo(100 * LB_PER_KG, 1);
    // Warmups are real logged weights too, so they convert as well.
    expect(sets[1].weight).toBeCloseTo(60 * LB_PER_KG, 1);
    expect(report.sets).toBe(2);
  });

  it('converts session body weight', async () => {
    await saveWorkout({ ...session('c2'), body_weight: 80 }, []);
    const report = await convertStoredWeights('lb');
    expect((await db.sessions.get('c2'))?.body_weight).toBeCloseTo(80 * LB_PER_KG, 1);
    expect(report.sessions).toBe(1);
  });

  it('leaves bodyweight-only sets at zero', async () => {
    await saveWorkout(session('c3'), [
      { id: 'a', exercise_id: 'ex-pullup', set_number: 1, weight: 0, reps: 12, is_warmup: false, notes: '' }
    ]);
    await convertStoredWeights('lb');
    expect((await db.sets.get('a'))?.weight).toBe(0);
  });

  it('round-trips kg -> lb -> kg within a hundredth', async () => {
    await saveWorkout(session('c4'), [
      { id: 'a', exercise_id: 'ex-bench', set_number: 1, weight: 82.5, reps: 5, is_warmup: false, notes: '' }
    ]);
    await convertStoredWeights('lb');
    await convertStoredWeights('kg');
    expect((await db.sets.get('a'))?.weight).toBeCloseTo(82.5, 1);
  });

  it('does not double-convert when the same unit is applied twice via applyUnitChange', async () => {
    await db.settings.put({ id: 'general', weight_unit: 'kg', weekly_goal: 4, default_rest_seconds: 90 });
    await saveWorkout(session('c5'), [
      { id: 'a', exercise_id: 'ex-bench', set_number: 1, weight: 50, reps: 5, is_warmup: false, notes: '' }
    ]);
    const first = await applyUnitChange('lb');
    const second = await applyUnitChange('lb');
    expect(first.sets).toBe(1);
    expect(second.sets).toBe(0);
    // Second call is an idempotent no-op — weights are not multiplied twice
    expect((await db.sets.get('a'))?.weight).toBeCloseTo(50 * LB_PER_KG, 1);
    expect((await db.settings.get('general'))?.weight_unit).toBe('lb');
  });
});

// ---------------------------------------------------------------------------
// BUG-04 — rest timer
// ---------------------------------------------------------------------------

describe('rest timer (BUG-04)', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });
  beforeEach(async () => {
    await db.drafts.clear();
    await db.sessions.clear();
    await db.sets.clear();
  });

  const props = {
    routines: DEFAULT_ROUTINES,
    routineExercises: DEFAULT_ROUTINE_EXERCISES,
    exercises: DEFAULT_EXERCISES,
    settings: settingsWith({ default_rest_seconds: 90 }),
    initialRoutineId: null,
    onDone: () => {}
  };

  it('counts down from the configured rest time and can be skipped', async () => {
    render(<LogWorkoutScreen {...props} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.click(screen.getByText('Add set'));

    expect(screen.getByText('Rest')).toBeInTheDocument();
    expect(screen.getByText('1:30')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Skip'));
    expect(screen.queryByText('Rest')).not.toBeInTheDocument();
  });

  it('resumes a rest that was still running when the screen was left', async () => {
    // A deadline 60s in the future, as an abandoned-but-active rest would leave it.
    await saveWorkoutDraft({
      routineId: null, name: 'In progress', date: todayKey, duration: '60', bodyWeight: '', notes: '',
      blocks: [{ exercise_id: 'ex-bench', sets: [{ weight: '80', reps: '5', is_warmup: false }] }],
      restDeadline: Date.now() + 60_000
    });

    render(<LogWorkoutScreen {...props} />);

    // It comes back with roughly the remaining time, not reset to 90s.
    await waitFor(() => {
      const clock = screen.getByText(/^\d:\d{2}$/);
      const [m, s] = clock.textContent!.split(':').map(Number);
      const seconds = m * 60 + s;
      expect(seconds).toBeGreaterThan(50);
      expect(seconds).toBeLessThanOrEqual(60);
    });
  });

  it('does not resume a rest that already expired while away', async () => {
    await saveWorkoutDraft({
      routineId: null, name: 'In progress', date: todayKey, duration: '60', bodyWeight: '', notes: '',
      blocks: [{ exercise_id: 'ex-bench', sets: [{ weight: '80', reps: '5', is_warmup: false }] }],
      restDeadline: Date.now() - 5_000
    });

    render(<LogWorkoutScreen {...props} />);
    await screen.findByText(/Resumed your unfinished workout/);
    expect(screen.queryByText('Rest')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BUG-06 — warmup sets must not skew volume
// ---------------------------------------------------------------------------

describe('warmup volume consistency (BUG-06)', () => {
  it('excludes warmups from session volume but still counts the set', () => {
    const sessions = [session('w1')];
    const sets = [setRow('a', 'w1', 1, 40, 10, true), setRow('b', 'w1', 2, 100, 5)];
    const resolved = resolveSessions(sessions, sets, DEFAULT_EXERCISES);
    const summary = summarizeSession(resolved[0]);

    expect(summary.totalSets).toBe(2); // both were performed
    expect(summary.totalReps).toBe(5); // working reps only
    expect(summary.totalVolume).toBe(500); // 100x5, the 40x10 warmup excluded
  });

  it('excludes warmups from weekly volume', () => {
    const sessions = [session('w1', todayKey)];
    const sets = [setRow('a', 'w1', 1, 40, 10, true), setRow('b', 'w1', 2, 100, 5)];
    const week = summarizeWeek(sessions, sets, 4);
    expect(week.totalVolume).toBe(500);
    expect(week.totalSets).toBe(2);
  });

  it('excludes warmups from muscle-group volume', () => {
    const sets = [setRow('a', 'w1', 1, 40, 10, true), setRow('b', 'w1', 2, 100, 5)];
    const groups = volumeByMuscleGroup(sets, DEFAULT_EXERCISES);
    expect(groups).toEqual([{ group: 'chest', volume: 500 }]);
  });

  it('agrees between session, week and muscle-group totals', () => {
    const sessions = [session('w1', todayKey)];
    const sets = [
      setRow('a', 'w1', 1, 40, 10, true),
      setRow('b', 'w1', 2, 100, 5),
      setRow('c', 'w1', 3, 100, 5)
    ];
    const resolved = resolveSessions(sessions, sets, DEFAULT_EXERCISES);
    const sessionVolume = summarizeSession(resolved[0]).totalVolume;
    const weekVolume = summarizeWeek(sessions, sets, 4).totalVolume;
    const groupVolume = volumeByMuscleGroup(sets, DEFAULT_EXERCISES)[0].volume;
    expect(sessionVolume).toBe(weekVolume);
    expect(weekVolume).toBe(groupVolume);
    expect(sessionVolume).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// BUG-07 / BUG-11 — input guards
// ---------------------------------------------------------------------------

describe('logging input guards (BUG-07, BUG-11)', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });
  beforeEach(async () => {
    await db.drafts.clear();
    await db.sessions.clear();
    await db.sets.clear();
  });

  const props = {
    routines: DEFAULT_ROUTINES,
    routineExercises: DEFAULT_ROUTINE_EXERCISES,
    exercises: DEFAULT_EXERCISES,
    settings: settingsWith(),
    initialRoutineId: null,
    onDone: () => {}
  };

  it('rejects a future date', async () => {
    render(<LogWorkoutScreen {...props} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '50' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '5' } });

    const future = new Date();
    future.setDate(future.getDate() + 7);
    const futureKey = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    fireEvent.change(screen.getByDisplayValue(todayKey), { target: { value: futureKey } });

    fireEvent.click(screen.getByText('Save workout'));

    expect(await screen.findByText(/date is in the future/)).toBeInTheDocument();
    expect(await db.sessions.count()).toBe(0);
  });

  it('accepts an explicit zero duration instead of forcing one minute', async () => {
    render(<LogWorkoutScreen {...props} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '50' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '5' } });
    fireEvent.change(screen.getByDisplayValue('60'), { target: { value: '0' } });

    fireEvent.click(screen.getByText('Save workout'));
    await screen.findByText('Workout saved!');

    const stored = (await db.sessions.toArray())[0];
    expect(stored.duration_minutes).toBe(0);
  });

  it('keeps decimal reps instead of silently truncating them', async () => {
    render(<LogWorkoutScreen {...props} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '60' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '7.5' } });

    fireEvent.click(screen.getByText('Save workout'));
    await screen.findByText('Workout saved!');

    expect((await db.sets.toArray())[0].reps).toBe(7.5);
  });
});

// ---------------------------------------------------------------------------
// BUG-03 — destructive import must ask first
// ---------------------------------------------------------------------------

describe('import confirmation (BUG-03)', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });
  beforeEach(async () => {
    await resetDatabaseWithSampleData();
    await db.settings.update('general', { google_sheets: undefined });
  });

  const backupFile = (sessions: number) => {
    const payload = {
      app: 'mygym',
      version: 1,
      exported_at: '2026-09-01T00:00:00.000Z',
      exercises: DEFAULT_EXERCISES,
      routines: [],
      routine_exercises: [],
      sessions: Array.from({ length: sessions }, (_, i) => session(`imp-${i}`, '2026-09-02')),
      sets: [],
      settings: { id: 'general', weight_unit: 'kg', weekly_goal: 4, default_rest_seconds: 90 }
    };
    return new File([JSON.stringify(payload)], 'mygym-backup.json', { type: 'application/json' });
  };

  const props = {
    exercises: DEFAULT_EXERCISES,
    routines: DEFAULT_ROUTINES,
    routineExercises: DEFAULT_ROUTINE_EXERCISES,
    sessions: [],
    sets: [],
    settings: settingsWith()
  };

  it('asks for confirmation and names what will be replaced', async () => {
    const before = await db.sessions.count();
    const { container } = render(<SetupScreen {...props} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [backupFile(2)] } });

    expect(await screen.findByText(/mygym-backup\.json holds 2 session/)).toBeInTheDocument();
    // Nothing has been written yet.
    expect(await db.sessions.count()).toBe(before);
  });

  it('cancelling leaves the existing data untouched', async () => {
    const before = await db.sessions.count();
    const { container } = render(<SetupScreen {...props} />);
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [backupFile(2)] }
    });

    fireEvent.click(await screen.findByText('Cancel'));

    expect(await db.sessions.count()).toBe(before);
    expect(screen.queryByText(/holds 2 session/)).not.toBeInTheDocument();
  });

  it('confirming performs the restore', async () => {
    const { container } = render(<SetupScreen {...props} />);
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [backupFile(3)] }
    });

    fireEvent.click(await screen.findByText('Replace with this backup'));

    await waitFor(async () => {
      expect(await db.sessions.count()).toBe(3);
    });
    expect((await db.sessions.toArray())[0].id).toMatch(/^imp-/);
  });

  it('rejects a file that is not a MyGym backup without offering to restore it', async () => {
    const before = await db.sessions.count();
    const { container } = render(<SetupScreen {...props} />);
    const junk = new File([JSON.stringify({ app: 'other', sessions: [] })], 'junk.json', { type: 'application/json' });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [junk] }
    });

    expect(await screen.findByText(/not a MyGym backup/)).toBeInTheDocument();
    expect(await db.sessions.count()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// BUG-09 / BUG-10 / BUG-13 — shell behaviour
// ---------------------------------------------------------------------------

describe('auto-sync deferral while logging (BUG-09)', () => {
  const sheetSettings: Settings = {
    ...DEFAULT_SETTINGS,
    google_sheets: {
      enabled: true,
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      secretKey: 'k',
      autoSyncTwiceDaily: true,
      connectionVerifiedAt: '2026-09-01T00:00:00.000Z'
    }
  };

  it('does not touch the network at all while deferred', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderHook(() => useGoogleSheetsAutoSync([], [], [], [], [], sheetSettings, true));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks first-upload sync when connectionVerifiedAt is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const unverified: Settings = {
      ...DEFAULT_SETTINGS,
      google_sheets: {
        enabled: true,
        webAppUrl: 'https://script.google.com/macros/s/abc/exec',
        secretKey: 'k',
        autoSyncTwiceDaily: true
      }
    };
    renderHook(() => useGoogleSheetsAutoSync([], [], [], [], [], unverified, false));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('runs the sync when not deferred', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', scriptVersion: 2 }), { status: 200 })
    );
    renderHook(() => useGoogleSheetsAutoSync([], [], [], [], [], sheetSettings, false));
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
  });

  it('does nothing when syncing is disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const disabled: Settings = { ...DEFAULT_SETTINGS, google_sheets: { ...sheetSettings.google_sheets!, enabled: false } };
    renderHook(() => useGoogleSheetsAutoSync([], [], [], [], [], disabled, false));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('navigation guard for unsaved work (BUG-05)', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });
  beforeEach(async () => {
    await resetDatabaseWithSampleData();
    await db.drafts.clear();
    await db.settings.update('general', { google_sheets: undefined });
  });

  it('asks before leaving a workout in progress', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    await screen.findByText('This Week');

    fireEvent.click(screen.getByRole('button', { name: 'Log Workout' }));
    await screen.findByRole('heading', { name: 'Log Workout' });

    fireEvent.click(screen.getByText('Add exercise'));
    await waitFor(() => expect(screen.getAllByLabelText('Weight').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText('History'));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    // Declining keeps the user on the logging screen.
    expect(screen.getByRole('heading', { name: 'Log Workout' })).toBeInTheDocument();
  });

  it('leaves immediately when nothing is unsaved', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    await screen.findByText('This Week');

    fireEvent.click(screen.getByText('History'));

    expect(await screen.findByRole('heading', { name: 'Workout History' })).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
