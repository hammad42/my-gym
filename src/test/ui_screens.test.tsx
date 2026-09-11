import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { db, initializeDatabase, resetDatabaseWithSampleData, saveWorkout } from '../lib/db';
import { DEFAULT_SETTINGS, DEFAULT_EXERCISES, DEFAULT_ROUTINES, DEFAULT_ROUTINE_EXERCISES } from '../lib/sampleData';
import { HomeScreen } from '../screens/HomeScreen';
import { LogWorkoutScreen } from '../screens/LogWorkoutScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { RoutinesScreen } from '../screens/RoutinesScreen';
import { ProgressScreen } from '../screens/ProgressScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { WorkoutSession, SetLog, Settings, GoogleSheetsSyncConfig } from '../types';

afterEach(() => cleanup());

const settingsWith = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

function session(id: string, date: string, name = 'Push Day'): WorkoutSession {
  return { id, name, date, routine_id: null, duration_minutes: 55, body_weight: 80, notes: '', created_at: `${date}T10:00:00.000Z` };
}
function setRow(id: string, sessionId: string, exerciseId: string, n: number, weight: number, reps: number, warmup = false): SetLog {
  return { id, session_id: sessionId, exercise_id: exerciseId, set_number: n, weight, reps, is_warmup: warmup, notes: '', created_at: `${sessionId}T10:00:00.000Z` };
}

const TODAY = new Date();
const todayKey = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;

describe('HomeScreen', () => {
  it('shows this week totals and recent sessions', () => {
    const sessions = [session('s1', todayKey)];
    const sets = [setRow('a', 's1', 'ex-bench', 1, 100, 5), setRow('b', 's1', 'ex-bench', 2, 100, 5)];
    render(
      <HomeScreen
        routines={DEFAULT_ROUTINES}
        exercises={DEFAULT_EXERCISES}
        sessions={sessions}
        sets={sets}
        settings={settingsWith()}
        onNavigate={() => {}}
        onQuickLog={() => {}}
        onStartRoutine={() => {}}
      />
    );

    expect(screen.getByText('This Week')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // sessions this week
    expect(screen.getByText(/\/ 4 workouts/)).toBeInTheDocument();
    // Volume appears in both the week summary and the session row.
    expect(screen.getAllByText('1,000 kg').length).toBeGreaterThan(0);
    // "Push Day" is both a routine card and the logged session name.
    expect(screen.getAllByText('Push Day').length).toBeGreaterThan(0);
  });

  it('renders an empty state when there is no history', () => {
    render(
      <HomeScreen
        routines={DEFAULT_ROUTINES} exercises={DEFAULT_EXERCISES} sessions={[]} sets={[]}
        settings={settingsWith()} onNavigate={() => {}} onQuickLog={() => {}} onStartRoutine={() => {}}
      />
    );
    expect(screen.getByText(/No workouts logged yet/)).toBeInTheDocument();
  });

  it('calls onStartRoutine with the tapped routine id', () => {
    const onStartRoutine = vi.fn();
    render(
      <HomeScreen
        routines={DEFAULT_ROUTINES} exercises={DEFAULT_EXERCISES} sessions={[]} sets={[]}
        settings={settingsWith()} onNavigate={() => {}} onQuickLog={() => {}} onStartRoutine={onStartRoutine}
      />
    );
    fireEvent.click(screen.getByText('Pull Day'));
    expect(onStartRoutine).toHaveBeenCalledWith('routine-pull');
  });

  it('offers a free-workout entry point', () => {
    const onQuickLog = vi.fn();
    render(
      <HomeScreen
        routines={DEFAULT_ROUTINES} exercises={DEFAULT_EXERCISES} sessions={[]} sets={[]}
        settings={settingsWith()} onNavigate={() => {}} onQuickLog={onQuickLog} onStartRoutine={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Log a free workout'));
    expect(onQuickLog).toHaveBeenCalled();
  });

  it('prompts to create a routine when none exist', () => {
    const onNavigate = vi.fn();
    render(
      <HomeScreen
        routines={[]} exercises={DEFAULT_EXERCISES} sessions={[]} sets={[]}
        settings={settingsWith()} onNavigate={onNavigate} onQuickLog={() => {}} onStartRoutine={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Create your first routine'));
    expect(onNavigate).toHaveBeenCalledWith('routines');
  });

  it('hides an archived routine from the start list', () => {
    const archived = [{ ...DEFAULT_ROUTINES[0], is_archived: true }];
    render(
      <HomeScreen
        routines={archived} exercises={DEFAULT_EXERCISES} sessions={[]} sets={[]}
        settings={settingsWith()} onNavigate={() => {}} onQuickLog={() => {}} onStartRoutine={() => {}}
      />
    );
    expect(screen.queryByText('Push Day')).not.toBeInTheDocument();
  });

  it('respects the lb unit setting in the volume display', () => {
    const sessions = [session('s1', todayKey)];
    const sets = [setRow('a', 's1', 'ex-bench', 1, 100, 5)];
    render(
      <HomeScreen
        routines={[]} exercises={DEFAULT_EXERCISES} sessions={sessions} sets={sets}
        settings={settingsWith({ weight_unit: 'lb' })} onNavigate={() => {}} onQuickLog={() => {}} onStartRoutine={() => {}}
      />
    );
    expect(screen.getAllByText('500 lb').length).toBeGreaterThan(0);
  });
});

describe('LogWorkoutScreen', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });
  beforeEach(async () => {
    await db.sessions.clear();
    await db.sets.clear();
  });

  const baseProps = {
    routines: DEFAULT_ROUTINES,
    routineExercises: DEFAULT_ROUTINE_EXERCISES,
    exercises: DEFAULT_EXERCISES,
    settings: settingsWith(),
    initialRoutineId: null,
    onDone: () => {}
  };

  it('pre-fills the plan when started from a routine', () => {
    render(<LogWorkoutScreen {...baseProps} initialRoutineId="routine-push" />);

    // Push Day plans 5 exercises, each with its own set rows.
    const selects = screen.getAllByLabelText('Exercise') as HTMLSelectElement[];
    expect(selects).toHaveLength(5);
    // The name input is prefilled from the routine ("Push Day" also appears as
    // an option in the routine picker, hence the plural query).
    expect(screen.getAllByDisplayValue('Push Day').length).toBeGreaterThan(0);
  });

  it('seeds each exercise with its own target reps from the routine', () => {
    // Pull Day: deadlift 3x5, pull-up 3x8, row 3x8, curl 3x10 -> 4 blocks, 12 rows.
    render(<LogWorkoutScreen {...baseProps} initialRoutineId="routine-pull" />);
    expect(screen.getAllByLabelText('Exercise')).toHaveLength(4);

    const reps = (screen.getAllByLabelText('Reps') as HTMLInputElement[]).map((i) => i.value);
    expect(reps).toEqual(['5', '5', '5', '8', '8', '8', '8', '8', '8', '10', '10', '10']);
  });

  it('refuses to save a workout with no sets', async () => {
    const onDone = vi.fn();
    render(<LogWorkoutScreen {...baseProps} onDone={onDone} />);

    fireEvent.click(screen.getByText('Save workout'));

    expect(await screen.findByText(/Log at least one set/)).toBeInTheDocument();
    expect(await db.sessions.count()).toBe(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('saves a free workout to the database and shows confirmation', async () => {
    render(<LogWorkoutScreen {...baseProps} />);

    fireEvent.click(screen.getByText('Add exercise'));
    const weight = screen.getAllByLabelText('Weight')[0];
    const reps = screen.getAllByLabelText('Reps')[0];
    fireEvent.change(weight, { target: { value: '80' } });
    fireEvent.change(reps, { target: { value: '5' } });

    fireEvent.click(screen.getByText('Save workout'));

    expect(await screen.findByText('Workout saved!')).toBeInTheDocument();

    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    const sets = await db.sets.where('session_id').equals(sessions[0].id).toArray();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ weight: 80, reps: 5, set_number: 1 });
  });

  it('adds sets and carries the previous weight forward', async () => {
    render(<LogWorkoutScreen {...baseProps} />);
    fireEvent.click(screen.getByText('Add exercise'));

    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '82.5' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '6' } });
    fireEvent.click(screen.getByText('Add set'));

    const weights = screen.getAllByLabelText('Weight') as HTMLInputElement[];
    const reps = screen.getAllByLabelText('Reps') as HTMLInputElement[];
    expect(weights).toHaveLength(2);
    expect(weights[1].value).toBe('82.5');
    expect(reps[1].value).toBe('6');
  });

  it('starting the rest timer from Add set shows a countdown', async () => {
    render(<LogWorkoutScreen {...baseProps} />);
    fireEvent.click(screen.getByText('Add exercise'));
    expect(screen.queryByText('Rest')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Add set'));

    expect(screen.getByText('Rest')).toBeInTheDocument();
    expect(screen.getByText('1:30')).toBeInTheDocument(); // default 90s
    fireEvent.click(screen.getByText('Skip'));
    expect(screen.queryByText('Rest')).not.toBeInTheDocument();
  });

  it('marks a set as a warmup and excludes it from nothing but flags it', async () => {
    render(<LogWorkoutScreen {...baseProps} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '60' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '10' } });
    fireEvent.click(screen.getByTitle('Toggle warmup set'));

    fireEvent.click(screen.getByText('Save workout'));
    await screen.findByText('Workout saved!');

    const sets = await db.sets.toArray();
    expect(sets[0].is_warmup).toBe(true);
  });

  it('ignores empty set rows on save', async () => {
    render(<LogWorkoutScreen {...baseProps} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.click(screen.getByText('Add set')); // second, empty row
    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '70' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '5' } });

    fireEvent.click(screen.getByText('Save workout'));
    await screen.findByText('Workout saved!');

    expect(await db.sets.count()).toBe(1);
  });

  it('removes a set row', async () => {
    render(<LogWorkoutScreen {...baseProps} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.click(screen.getByText('Add set'));
    expect(screen.getAllByLabelText('Weight')).toHaveLength(2);

    fireEvent.click(screen.getAllByLabelText('Remove set')[0]);
    expect(screen.getAllByLabelText('Weight')).toHaveLength(1);
  });

  it('renumbers sets per exercise when several are logged', async () => {
    render(<LogWorkoutScreen {...baseProps} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '60' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '8' } });
    fireEvent.click(screen.getByText('Add set'));
    fireEvent.change(screen.getAllByLabelText('Weight')[1], { target: { value: '65' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[1], { target: { value: '6' } });

    fireEvent.click(screen.getByText('Save workout'));
    await screen.findByText('Workout saved!');

    const sets = (await db.sets.toArray()).sort((a, b) => a.set_number - b.set_number);
    expect(sets.map((s) => s.set_number)).toEqual([1, 2]);
    expect(sets.map((s) => s.weight)).toEqual([60, 65]);
  });

  it('records the chosen date and duration', async () => {
    render(<LogWorkoutScreen {...baseProps} />);
    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '50' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '10' } });
    const duration = screen.getByDisplayValue('60');
    fireEvent.change(duration, { target: { value: '75' } });

    fireEvent.click(screen.getByText('Save workout'));
    await screen.findByText('Workout saved!');

    const session = (await db.sessions.toArray())[0];
    expect(session.duration_minutes).toBe(75);
  });
});

describe('HistoryScreen', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });
  beforeEach(async () => {
    await resetDatabaseWithSampleData();
  });

  const props = () => ({ exercises: DEFAULT_EXERCISES, sessions: [], sets: [], settings: settingsWith() });

  it('renders an empty state with no history', () => {
    render(<HistoryScreen {...props()} />);
    expect(screen.getByText(/No workouts logged yet/)).toBeInTheDocument();
  });

  it('groups sessions under a date heading and expands to show sets', () => {
    const sessions = [session('s1', todayKey)];
    const sets = [setRow('a', 's1', 'ex-bench', 1, 100, 5), setRow('b', 's1', 'ex-bench', 2, 100, 4)];
    render(<HistoryScreen {...props()} sessions={sessions} sets={sets} />);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('2 sets')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Push Day'));
    expect(screen.getByText('100×5')).toBeInTheDocument();
    expect(screen.getByText('100×4')).toBeInTheDocument();
  });

  it('filters by session name, exercise name and notes', () => {
    const sessions = [
      session('s1', todayKey, 'Push Day'),
      { ...session('s2', todayKey, 'Leg Day'), notes: 'knee felt odd' }
    ];
    render(<HistoryScreen {...props()} sessions={sessions} sets={[]} />);

    fireEvent.change(screen.getByPlaceholderText(/Search workouts/), { target: { value: 'Leg' } });
    expect(screen.getByText('Leg Day')).toBeInTheDocument();
    expect(screen.queryByText('Push Day')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Search workouts/), { target: { value: 'knee' } });
    expect(screen.getByText('Leg Day')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Search workouts/), { target: { value: 'zzz' } });
    expect(screen.getByText(/No workouts match your search/)).toBeInTheDocument();
  });

  it('shows a confirmation before deleting, and the cancel keeps the session', async () => {
    const sessions = [session('s1', todayKey)];
    await db.sessions.bulkPut(sessions);

    render(<HistoryScreen {...props()} sessions={sessions} sets={[]} />);
    fireEvent.click(screen.getByText('Push Day'));

    fireEvent.click(screen.getByText('Delete session'));
    fireEvent.click(screen.getByText('Keep it'));

    expect(screen.queryByText('Delete permanently')).not.toBeInTheDocument();
    expect(await db.sessions.get('s1')).toBeDefined();
  });

  it('deletes a session and its sets only after confirmation', async () => {
    const sessions = [session('s1', todayKey)];
    const sets = [setRow('a', 's1', 'ex-bench', 1, 100, 5)];
    await db.sessions.bulkPut(sessions);
    await db.sets.bulkPut(sets);

    render(<HistoryScreen {...props()} sessions={sessions} sets={sets} />);
    fireEvent.click(screen.getByText('Push Day'));
    fireEvent.click(screen.getByText('Delete session'));
    fireEvent.click(screen.getByText('Delete permanently'));

    await waitFor(async () => {
      expect(await db.sessions.get('s1')).toBeUndefined();
    });
    expect(await db.sets.where('session_id').equals('s1').toArray()).toHaveLength(0);
  });

  it('marks warmup sets differently from working sets', () => {
    const sessions = [session('s1', todayKey)];
    const sets = [setRow('a', 's1', 'ex-bench', 1, 40, 10, true), setRow('b', 's1', 'ex-bench', 2, 100, 5)];
    render(<HistoryScreen {...props()} sessions={sessions} sets={sets} />);
    fireEvent.click(screen.getByText('Push Day'));

    expect(screen.getByText('40×10')).toBeInTheDocument();
    expect(screen.getByText('100×5')).toBeInTheDocument();
  });
});

describe('RoutinesScreen', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });
  beforeEach(async () => {
    await resetDatabaseWithSampleData();
  });

  const props = (over = {}) => ({
    routines: DEFAULT_ROUTINES,
    routineExercises: DEFAULT_ROUTINE_EXERCISES,
    exercises: DEFAULT_EXERCISES,
    sessions: [],
    onStartRoutine: vi.fn(),
    ...over
  });

  it('lists active routines with their planned exercises', () => {
    render(<RoutinesScreen {...props()} />);
    expect(screen.getByText('Push Day')).toBeInTheDocument();
    expect(screen.getByText('Pull Day')).toBeInTheDocument();
    expect(screen.getByText('Leg Day')).toBeInTheDocument();
    // Planned lines render as sets x reps chips (4x6 appears on two routines).
    expect(screen.getAllByText('4×6').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3×8').length).toBeGreaterThan(0);
  });

  it('starts a routine from the play button', () => {
    const onStartRoutine = vi.fn();
    render(<RoutinesScreen {...props({ onStartRoutine })} />);
    fireEvent.click(screen.getAllByTitle('Start this routine')[0]);
    expect(onStartRoutine).toHaveBeenCalledWith('routine-push');
  });

  it('creates a new routine in the database', async () => {
    render(<RoutinesScreen {...props()} />);
    fireEvent.click(screen.getByText('New routine'));

    await waitFor(async () => {
      const all = await db.routines.toArray();
      expect(all.some((r) => r.name === 'New Routine')).toBe(true);
    });
  });

  it('opens the routine editor, renames the routine and saves the plan', async () => {
    render(<RoutinesScreen {...props()} />);
    fireEvent.click(screen.getAllByTitle('Edit routine')[0]);

    expect(screen.getByText('Planned exercises')).toBeInTheDocument();
    // Push Day ships with 5 planned lines.
    expect(screen.getAllByLabelText('Target reps')).toHaveLength(5);

    fireEvent.change(screen.getByDisplayValue('Push Day'), { target: { value: 'Push A' } });
    fireEvent.click(screen.getByText('Save routine'));

    await waitFor(async () => {
      expect((await db.routines.get('routine-push'))?.name).toBe('Push A');
    });
  });

  it('removes a planned exercise in the editor and persists the new plan', async () => {
    render(<RoutinesScreen {...props()} />);
    fireEvent.click(screen.getAllByTitle('Edit routine')[0]);
    expect(screen.getAllByLabelText('Target reps')).toHaveLength(5);

    // "Remove exercise" (aria-label) — drop the first planned line.
    fireEvent.click(screen.getAllByLabelText('Remove exercise')[0]);
    expect(screen.getAllByLabelText('Target reps')).toHaveLength(4);

    fireEvent.click(screen.getByText('Save routine'));

    await waitFor(async () => {
      const lines = await db.routine_exercises.where('routine_id').equals('routine-push').toArray();
      expect(lines).toHaveLength(4);
      expect(lines.every((l) => l.exercise_id !== 'ex-bench')).toBe(true);
      expect(lines.map((l) => l.order).sort()).toEqual([1, 2, 3, 4]);
    });
  });

  it('rejects an editor save with a duplicate exercise', async () => {
    render(<RoutinesScreen {...props()} />);
    fireEvent.click(screen.getAllByTitle('Edit routine')[0]);

    // Force the first two lines to the same exercise via their selects.
    const selects = screen.getAllByLabelText('Exercise') as HTMLSelectElement[];
    fireEvent.change(selects[1], { target: { value: selects[0].value } });
    fireEvent.click(screen.getByText('Save routine'));

    expect(await screen.findByText(/only appear once/)).toBeInTheDocument();
  });

  it('archives a routine and reveals it behind the archived toggle', async () => {
    render(<RoutinesScreen {...props()} />);
    fireEvent.click(screen.getAllByTitle('Archive routine')[0]);

    await waitFor(async () => {
      const found = await db.routines.get('routine-push');
      expect(found?.is_archived).toBe(true);
    });

    // The live app feeds routines from a reactive query, so re-render with the
    // updated row to observe what the user would see.
    cleanup();
    const archivedPush = { ...DEFAULT_ROUTINES[0], is_archived: true };
    render(<RoutinesScreen {...props({ routines: [archivedPush, ...DEFAULT_ROUTINES.slice(1)] })} />);

    expect(screen.queryByText('Push Day')).not.toBeInTheDocument();
    expect(screen.getByText(/Archived \(1\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Archived \(1\)/));
    expect(screen.getByText('Push Day')).toBeInTheDocument();
    expect(screen.getByText(/Hide archived/)).toBeInTheDocument();
  });

  it('shows the last performed date for a routine with history', () => {
    render(
      <RoutinesScreen
        {...props({ sessions: [{ ...session('s1', '2026-09-05', 'Push Day'), routine_id: 'routine-push' }] })}
      />
    );
    expect(screen.getByText(/last/)).toBeInTheDocument();
  });
});

describe('ProgressScreen', () => {
  it('renders personal records and charts from logged data', () => {
    const sessions = [session('s1', '2026-09-01'), session('s2', '2026-09-08')];
    const sets = [
      setRow('a', 's1', 'ex-bench', 1, 80, 5),
      setRow('b', 's2', 'ex-bench', 1, 90, 5),
      setRow('c', 's1', 'ex-squat', 1, 120, 5)
    ];
    render(<ProgressScreen exercises={DEFAULT_EXERCISES} sessions={sessions} sets={sets} settings={settingsWith()} />);

    expect(screen.getByText('Progress')).toBeInTheDocument();
    expect(screen.getByText('Sessions per week')).toBeInTheDocument();
    expect(screen.getByText('Personal records')).toBeInTheDocument();
    // Exercise names also appear as options in the progression picker.
    expect(screen.getAllByText('Barbell Bench Press').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Barbell Back Squat').length).toBeGreaterThan(0);

    // Two exercises were logged -> two PR rows, sorted by estimated 1RM desc.
    // Squat 120x5 -> 140, Bench 90x5 -> 105.
    expect(screen.getAllByText(/best e1RM/)).toHaveLength(2);
    expect(screen.getByText('140')).toBeInTheDocument();
    expect(screen.getByText('105')).toBeInTheDocument();
  });

  it('shows the progression chart only after choosing an exercise', () => {
    const sessions = [session('s1', '2026-09-01')];
    const sets = [setRow('a', 's1', 'ex-bench', 1, 80, 5)];
    render(<ProgressScreen exercises={DEFAULT_EXERCISES} sessions={sessions} sets={sets} settings={settingsWith()} />);

    expect(screen.queryByText(/heaviest working set per session/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Choose an exercise…'), { target: { value: 'ex-bench' } });
    expect(screen.getByText(/heaviest working set per session/)).toBeInTheDocument();
  });

  it('prompts when there is nothing logged yet', () => {
    render(<ProgressScreen exercises={DEFAULT_EXERCISES} sessions={[]} sets={[]} settings={settingsWith()} />);
    expect(screen.getByText(/Log some working sets/)).toBeInTheDocument();
  });

  it('only offers exercises that actually appear in the log', () => {
    const sessions = [session('s1', '2026-09-01')];
    const sets = [setRow('a', 's1', 'ex-bench', 1, 80, 5)];
    render(<ProgressScreen exercises={DEFAULT_EXERCISES} sessions={sessions} sets={sets} settings={settingsWith()} />);

    const select = screen.getByDisplayValue('Choose an exercise…') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent).filter((t) => t !== 'Choose an exercise…');
    expect(options).toEqual(['Barbell Bench Press']);
  });
});

describe('SetupScreen', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });
  beforeEach(async () => {
    await resetDatabaseWithSampleData();
    // resetDatabaseWithSampleData deliberately preserves the Sheets credential,
    // so clear it explicitly to keep these cases isolated from each other.
    await db.settings.update('general', { google_sheets: undefined });
  });

  const props = (settings: Settings = settingsWith()) => ({
    exercises: DEFAULT_EXERCISES,
    routines: DEFAULT_ROUTINES,
    routineExercises: DEFAULT_ROUTINE_EXERCISES,
    sessions: [],
    sets: [],
    settings
  });

  it('changes the weight unit in the database', async () => {
    render(<SetupScreen {...props()} />);
    fireEvent.click(screen.getByText('lb'));
    await waitFor(async () => {
      expect((await db.settings.get('general'))?.weight_unit).toBe('lb');
    });
  });

  it('adjusts the weekly goal within bounds', async () => {
    render(<SetupScreen {...props()} />);
    fireEvent.click(screen.getByText('+'));
    await waitFor(async () => {
      expect((await db.settings.get('general'))?.weekly_goal).toBe(5);
    });
  });

  it('clamps the weekly goal at the upper bound', async () => {
    render(<SetupScreen {...props(settingsWith({ weekly_goal: 14 }))} />);
    fireEvent.click(screen.getByText('+'));
    await waitFor(async () => {
      expect((await db.settings.get('general'))?.weekly_goal).toBe(14);
    });
  });

  it('lists the exercise library and adds a custom exercise', async () => {
    render(<SetupScreen {...props()} />);
    expect(screen.getByText('Exercise library')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Add'));
    fireEvent.change(screen.getByPlaceholderText('Exercise name'), { target: { value: 'Face Pull' } });
    fireEvent.click(screen.getByText('Add exercise'));

    await waitFor(async () => {
      const found = await db.exercises.where('name').equals('Face Pull').toArray();
      expect(found).toHaveLength(1);
      expect(found[0].is_default).toBe(false);
    });
  });

  it('clears all logs behind a confirmation while keeping the library', async () => {
    await saveWorkout(session('keep-me', todayKey), []);
    render(<SetupScreen {...props()} />);

    fireEvent.click(screen.getByText(/Clear all logged workouts/));
    fireEvent.click(screen.getByText('Delete all logs'));

    await waitFor(async () => {
      expect(await db.sessions.count()).toBe(0);
    });
    expect(await db.exercises.count()).toBeGreaterThan(0);
  });

  it('keeps the sheets credential when reloading demo data', async () => {
    const cfg: GoogleSheetsSyncConfig = {
      enabled: true,
      webAppUrl: 'https://script.google.com/macros/s/abc/exec',
      secretKey: 'keep-this-secret',
      autoSyncTwiceDaily: true
    };
    await db.settings.update('general', { google_sheets: cfg });

    render(<SetupScreen {...props(settingsWith({ google_sheets: cfg }))} />);
    fireEvent.click(screen.getByText(/Reset to demo data/));
    fireEvent.click(screen.getByText('Reload demo data'));

    await waitFor(async () => {
      expect((await db.settings.get('general'))?.google_sheets?.secretKey).toBe('keep-this-secret');
    });
  });

  describe('Google Sheets', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('saves the URL and secret into settings', async () => {
      render(<SetupScreen {...props()} />);

      fireEvent.change(screen.getByPlaceholderText(/script\.google\.com/), {
        target: { value: 'https://script.google.com/macros/s/xyz/exec' }
      });
      fireEvent.change(screen.getByPlaceholderText(/private password/), {
        target: { value: 'a-good-secret' }
      });
      fireEvent.click(screen.getByText('Save'));

      await waitFor(async () => {
        const cfg = (await db.settings.get('general'))?.google_sheets;
        expect(cfg?.webAppUrl).toBe('https://script.google.com/macros/s/xyz/exec');
        expect(cfg?.secretKey).toBe('a-good-secret');
        expect(cfg?.enabled).toBe(true);
      });
    });

    it('tests a connection and reports success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'success', message: 'Authenticated and connected!' }), { status: 200 })
      );

      render(<SetupScreen {...props()} />);
      fireEvent.change(screen.getByPlaceholderText(/script\.google\.com/), {
        target: { value: 'https://script.google.com/macros/s/xyz/exec' }
      });
      fireEvent.click(screen.getByText('Test'));

      expect(await screen.findByText(/Authenticated and connected!/)).toBeInTheDocument();
    });

    it('reports a failed connection instead of pretending success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'error', message: 'Unauthorized: Invalid Secret Key.' }), { status: 200 })
      );

      render(<SetupScreen {...props()} />);
      fireEvent.change(screen.getByPlaceholderText(/script\.google\.com/), {
        target: { value: 'https://script.google.com/macros/s/xyz/exec' }
      });
      fireEvent.click(screen.getByText('Test'));

      expect(await screen.findByText(/Unauthorized/)).toBeInTheDocument();
    });

    it('refuses a non-Apps-Script URL without making a request', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      render(<SetupScreen {...props()} />);
      fireEvent.change(screen.getByPlaceholderText(/script\.google\.com/), {
        target: { value: 'https://evil.example.com/hook' }
      });
      fireEvent.click(screen.getByText('Test'));

      expect(await screen.findByText(/Invalid URL/)).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('loads data back from the sheet and replaces local state', async () => {
      const sheetPayload = {
        status: 'success',
        data: {
          exercises: DEFAULT_EXERCISES.slice(0, 3),
          routines: [],
          routine_exercises: [],
          sessions: [session('sheet-session', '2026-09-02', 'Sheet Workout')],
          sets: [setRow('sheet-set', 'sheet-session', 'ex-bench', 1, 110, 3)],
          settings: {
            id: 'general',
            weight_unit: 'kg',
            weekly_goal: 5,
            default_rest_seconds: 90,
            google_sheets: { enabled: true, webAppUrl: 'https://script.google.com/macros/s/xyz/exec', autoSyncTwiceDaily: true }
          }
        }
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(sheetPayload), { status: 200 })
      );

      const cfg: GoogleSheetsSyncConfig = {
        enabled: true,
        webAppUrl: 'https://script.google.com/macros/s/xyz/exec',
        secretKey: 'device-secret',
        autoSyncTwiceDaily: true
      };
      render(<SetupScreen {...props(settingsWith({ google_sheets: cfg }))} />);

      fireEvent.click(screen.getByText(/Load data from sheet/));
      fireEvent.click(screen.getByText('Yes, load from sheet'));

      expect(await screen.findByText(/Restored from sheet: 1 sessions, 1 sets, 3 exercises/)).toBeInTheDocument();

      await waitFor(async () => {
        const sessions = await db.sessions.toArray();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].id).toBe('sheet-session');
      });
      const storedSets = await db.sets.toArray();
      expect(storedSets).toHaveLength(1);
      expect(storedSets[0].weight).toBe(110);

      // The local credential survives the restore.
      const settings = await db.settings.get('general');
      expect(settings?.google_sheets?.secretKey).toBe('device-secret');
      expect(settings?.weekly_goal).toBe(5);
    });

    it('does not wipe local data when the sheet has no backup', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'error', message: 'No backup found in this Google Sheet yet.' }), { status: 200 })
      );
      await saveWorkout(session('local-only', todayKey), []);

      const cfg: GoogleSheetsSyncConfig = {
        enabled: true,
        webAppUrl: 'https://script.google.com/macros/s/xyz/exec',
        secretKey: 'device-secret',
        autoSyncTwiceDaily: true
      };
      render(<SetupScreen {...props(settingsWith({ google_sheets: cfg }))} />);

      fireEvent.click(screen.getByText(/Load data from sheet/));
      fireEvent.click(screen.getByText('Yes, load from sheet'));

      expect(await screen.findByText(/No backup found/)).toBeInTheDocument();
      expect(await db.sessions.get('local-only')).toBeDefined();
    });

    it('rejects a sheet payload missing required tables', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'success', data: { exercises: [], routines: [] } }), { status: 200 })
      );

      const cfg: GoogleSheetsSyncConfig = {
        enabled: true,
        webAppUrl: 'https://script.google.com/macros/s/xyz/exec',
        secretKey: 'device-secret',
        autoSyncTwiceDaily: true
      };
      render(<SetupScreen {...props(settingsWith({ google_sheets: cfg }))} />);

      fireEvent.click(screen.getByText(/Load data from sheet/));
      fireEvent.click(screen.getByText('Yes, load from sheet'));

      expect(await screen.findByText(/missing required tables/)).toBeInTheDocument();
    });
  });
});
