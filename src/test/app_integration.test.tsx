import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { App } from '../App';
import { db, initializeDatabase, resetDatabaseWithSampleData } from '../lib/db';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('App integration (deep)', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  beforeEach(async () => {
    await resetDatabaseWithSampleData();
    await db.settings.update('general', { google_sheets: undefined });
  });

  it('boots from the database and shows the dashboard', async () => {
    render(<App />);

    // The loading gate resolves into the real shell.
    expect(await screen.findByText('MyGym')).toBeInTheDocument();
    expect(screen.getByText('This Week')).toBeInTheDocument();
    expect(screen.queryByText(/Loading MyGym/)).not.toBeInTheDocument();
  });

  it('seeds demo data that the dashboard actually reflects', async () => {
    render(<App />);
    await screen.findByText('This Week');

    // The seed writes ~3 sessions/week; with a goal of 3 the streak badge appears,
    // which proves the summary is computed from the stored rows rather than faked.
    await db.settings.update('general', { weekly_goal: 3 });
    await waitFor(() => {
      expect(screen.getByText(/streak/)).toBeInTheDocument();
    });
  });

  it('navigates to every screen from the bottom nav', async () => {
    render(<App />);
    await screen.findByText('This Week');

    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByRole('heading', { name: 'Workout History' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Routines'));
    expect(await screen.findByRole('heading', { name: 'Routines' })).toBeInTheDocument();
    expect(await screen.findByText('Push Day')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Progress'));
    expect(await screen.findByRole('heading', { name: 'Progress' })).toBeInTheDocument();
    expect(await screen.findByText('Sessions per week')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Settings'));
    expect(await screen.findByRole('heading', { name: 'Settings & Data' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Home'));
    expect(await screen.findByText('This Week')).toBeInTheDocument();
  });

  it('opens the settings screen from the header gear', async () => {
    render(<App />);
    await screen.findByText('This Week');

    fireEvent.click(screen.getByTitle('Settings & Data'));
    expect(await screen.findByText('Settings & Data')).toBeInTheDocument();
  });

  it('persists the active screen so a reload returns to the same tab', async () => {
    render(<App />);
    await screen.findByText('This Week');

    fireEvent.click(screen.getByText('Progress'));
    await screen.findByText('Sessions per week');
    expect(localStorage.getItem('mygym_active_screen')).toBe('progress');
  });

  it('logs a workout end-to-end and it appears in history', async () => {
    render(<App />);
    await screen.findByText('This Week');

    // Log tab -> add an exercise and fill a set.
    fireEvent.click(screen.getByLabelText('Log Workout'));
    expect(await screen.findByText('Log Workout')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Add exercise'));
    fireEvent.change(screen.getAllByLabelText('Weight')[0], { target: { value: '102.5' } });
    fireEvent.change(screen.getAllByLabelText('Reps')[0], { target: { value: '4' } });
    fireEvent.click(screen.getByText('Save workout'));

    expect(await screen.findByText('Workout saved!')).toBeInTheDocument();

    // The row really landed in IndexedDB.
    const sessions = await db.sessions.toArray();
    const logged = sessions.find((s) => s.name === 'Workout');
    expect(logged).toBeDefined();
    const sets = await db.sets.where('session_id').equals(logged!.id).toArray();
    expect(sets[0]).toMatchObject({ weight: 102.5, reps: 4 });

    // And it is visible on the History tab.
    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('Workout')).toBeInTheDocument();
  });

  it('starts a routine from Home and lands on a prefilled log screen', async () => {
    render(<App />);
    await screen.findByText('This Week');

    // The routine cards carry the first letter avatar plus the name.
    const startButtons = screen.getAllByText('Start');
    fireEvent.click(startButtons[0]);

    expect(await screen.findByText('Log Workout')).toBeInTheDocument();
    // Pull/Push/Leg plan lines were pulled in as set rows.
    expect(screen.getAllByLabelText('Weight').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Exercise').length).toBeGreaterThan(0);
  });

  it('reflects a settings change on the dashboard', async () => {
    render(<App />);
    await screen.findByText('This Week');
    expect(screen.getByText(/\/ 4 workouts/)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Settings & Data'));
    await screen.findByText('Settings & Data');
    fireEvent.click(screen.getByText('+')); // weekly goal 4 -> 5

    fireEvent.click(screen.getByText('Home'));
    await waitFor(() => {
      expect(screen.getByText(/\/ 5 workouts/)).toBeInTheDocument();
    });
  });

  it('deletes a workout from history and the dashboard updates', async () => {
    render(<App />);
    await screen.findByText('This Week');

    fireEvent.click(screen.getByText('History'));
    await screen.findByText('Workout History');

    const before = await db.sessions.count();

    // Open the newest session and delete it.
    fireEvent.click(screen.getAllByText('Push Day')[0]);
    fireEvent.click(screen.getByText('Delete session'));
    fireEvent.click(screen.getByText('Delete permanently'));

    await waitFor(async () => {
      expect(await db.sessions.count()).toBe(before - 1);
    });
  });
});
