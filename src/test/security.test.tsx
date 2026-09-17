import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SetupScreen } from '../screens/SetupScreen';
import { db, saveWorkout } from '../lib/db';
import {
  DEFAULT_SETTINGS,
  DEFAULT_EXERCISES,
  DEFAULT_ROUTINES,
  DEFAULT_ROUTINE_EXERCISES
} from '../lib/sampleData';
import {
  createPinCredentials,
  isPinConfigured,
  verifyPin,
  validateNewPin,
  generateSalt,
  hashPin,
  PIN_MIN_LENGTH
} from '../lib/security';
import { sanitizeSettings, mergeRestoredSettings } from '../lib/sanitize';
import { isSyncInProgress, syncToGoogleSheets } from '../lib/googleSheets';
import { APP_VERSION } from '../lib/version';
import { WorkoutSession, Settings } from '../types';

function session(id: string, date: string, name = 'Push Day'): WorkoutSession {
  return {
    id,
    name,
    date,
    routine_id: null,
    duration_minutes: 50,
    body_weight: 80,
    notes: '',
    created_at: `${date}T10:00:00.000Z`
  };
}

async function settingsWithPin(pin: string): Promise<Settings> {
  const credentials = await createPinCredentials(pin);
  return { ...DEFAULT_SETTINGS, ...credentials };
}

describe('Security PIN & Data Protection', () => {
  beforeEach(async () => {
    await db.open();
    await db.settings.clear();
    await db.settings.add(DEFAULT_SETTINGS);
    await db.exercises.clear();
    await db.exercises.bulkAdd(DEFAULT_EXERCISES);
    await db.routines.clear();
    await db.routines.bulkAdd(DEFAULT_ROUTINES);
    await db.routine_exercises.clear();
    await db.routine_exercises.bulkAdd(DEFAULT_ROUTINE_EXERCISES);
    await db.sessions.clear();
    await db.sets.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Cryptographic & Validation Primitives', () => {
    it('generates a 16-byte random hex salt (32 chars)', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).toHaveLength(32);
      expect(salt2).toHaveLength(32);
      expect(salt1).not.toBe(salt2);
    });

    it('hashes PIN deterministically with the same salt', async () => {
      const salt = generateSalt();
      const hash1 = await hashPin('4321', salt);
      const hash2 = await hashPin('4321', salt);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // 256 bits = 64 hex chars
    });

    it('produces different hashes for different PINs or salts', async () => {
      const salt = generateSalt();
      const hashA = await hashPin('1111', salt);
      const hashB = await hashPin('2222', salt);
      expect(hashA).not.toBe(hashB);
    });

    it('validates PIN length and confirmation match', () => {
      expect(validateNewPin('123', '123')).toContain(`${PIN_MIN_LENGTH} characters`);
      expect(validateNewPin('1234', '5678')).toBe('PIN/password and confirmation do not match.');
      expect(validateNewPin('1234', '1234')).toBeNull();
    });

    it('verifies candidate PIN against stored credentials', async () => {
      const creds = await createPinCredentials('9876');
      expect(isPinConfigured(creds)).toBe(true);
      expect(await verifyPin('9876', creds)).toBe(true);
      expect(await verifyPin('1234', creds)).toBe(false);
      expect(await verifyPin('9876', undefined)).toBe(false);
    });
  });

  describe('Sanitization & Export Security', () => {
    it('strips security_pin_hash and security_pin_salt from exports', async () => {
      const settings = await settingsWithPin('8888');
      const sanitized = sanitizeSettings(settings);
      expect((sanitized as any).security_pin_hash).toBeUndefined();
      expect((sanitized as any).security_pin_salt).toBeUndefined();
    });

    it('preserves local PIN credentials when merging restored backup', async () => {
      const currentDevice = await settingsWithPin('5555');
      const incomingBackup = { ...DEFAULT_SETTINGS, weight_unit: 'lb' as const };

      const merged = mergeRestoredSettings(incomingBackup, currentDevice);
      expect(merged.security_pin_hash).toBe(currentDevice.security_pin_hash);
      expect(merged.security_pin_salt).toBe(currentDevice.security_pin_salt);
      expect(merged.weight_unit).toBe('lb');
    });
  });

  describe('UI: App Version & Build Time Display', () => {
    it('renders the visible App Version and Build Time in the footer', () => {
      render(
        <SetupScreen
          exercises={DEFAULT_EXERCISES}
          routines={DEFAULT_ROUTINES}
          routineExercises={DEFAULT_ROUTINE_EXERCISES}
          sessions={[]}
          sets={[]}
          settings={DEFAULT_SETTINGS}
        />
      );

      expect(screen.getByText(`v${APP_VERSION}`)).toBeInTheDocument();
      expect(screen.getByText(/Build:/)).toBeInTheDocument();
      expect(screen.getByText(/100% Offline-First/)).toBeInTheDocument();
    });
  });

  describe('UI: Security & PIN Management Section', () => {
    it('renders UNPROTECTED badge and Set PIN button when unconfigured', () => {
      render(
        <SetupScreen
          exercises={DEFAULT_EXERCISES}
          routines={DEFAULT_ROUTINES}
          routineExercises={DEFAULT_ROUTINE_EXERCISES}
          sessions={[]}
          sets={[]}
          settings={DEFAULT_SETTINGS}
        />
      );

      expect(screen.getByText('Security & PIN Protection')).toBeInTheDocument();
      expect(screen.getByText('UNPROTECTED')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /set pin/i })).toBeInTheDocument();
    });

    it('allows user to set a new Security PIN', async () => {
      render(
        <SetupScreen
          exercises={DEFAULT_EXERCISES}
          routines={DEFAULT_ROUTINES}
          routineExercises={DEFAULT_ROUTINE_EXERCISES}
          sessions={[]}
          sets={[]}
          settings={DEFAULT_SETTINGS}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /set pin/i }));
      expect(screen.getByRole('heading', { name: 'Set Security PIN' })).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText(/At least 4 digits/i), {
        target: { value: '2468' }
      });
      fireEvent.change(screen.getByPlaceholderText(/Re-enter new PIN/i), {
        target: { value: '2468' }
      });
      fireEvent.click(screen.getByRole('button', { name: /save pin/i }));

      await waitFor(async () => {
        const saved = await db.settings.get('general');
        expect(saved?.security_pin_hash).toBeTruthy();
        expect(saved?.security_pin_salt).toBeTruthy();
      });
    });

    it('renders LOCKED badge, Change PIN and Remove PIN buttons when configured', async () => {
      const configured = await settingsWithPin('1234');
      render(
        <SetupScreen
          exercises={DEFAULT_EXERCISES}
          routines={DEFAULT_ROUTINES}
          routineExercises={DEFAULT_ROUTINE_EXERCISES}
          sessions={[]}
          sets={[]}
          settings={configured}
        />
      );

      expect(screen.getByText('LOCKED')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /change pin/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
    });

    it('allows changing PIN after verifying current PIN', async () => {
      const configured = await settingsWithPin('1234');
      await db.settings.update('general', configured);

      render(
        <SetupScreen
          exercises={DEFAULT_EXERCISES}
          routines={DEFAULT_ROUTINES}
          routineExercises={DEFAULT_ROUTINE_EXERCISES}
          sessions={[]}
          sets={[]}
          settings={configured}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /change pin/i }));

      // Test wrong current PIN
      fireEvent.change(screen.getByPlaceholderText(/Enter current PIN/i), {
        target: { value: 'wrong' }
      });
      fireEvent.change(screen.getByPlaceholderText(/At least 4 digits/i), {
        target: { value: '9999' }
      });
      fireEvent.change(screen.getByPlaceholderText(/Re-enter new PIN/i), {
        target: { value: '9999' }
      });
      fireEvent.click(screen.getByRole('button', { name: /update pin/i }));

      expect(await screen.findByText(/Current PIN does not match/i)).toBeInTheDocument();

      // Test correct current PIN
      fireEvent.change(screen.getByPlaceholderText(/Enter current PIN/i), {
        target: { value: '1234' }
      });
      fireEvent.click(screen.getByRole('button', { name: /update pin/i }));

      await waitFor(async () => {
        const saved = await db.settings.get('general');
        expect(await verifyPin('9999', saved!)).toBe(true);
      });
    });

    it('allows removing PIN after verifying current PIN', async () => {
      const configured = await settingsWithPin('1234');
      await db.settings.update('general', configured);

      render(
        <SetupScreen
          exercises={DEFAULT_EXERCISES}
          routines={DEFAULT_ROUTINES}
          routineExercises={DEFAULT_ROUTINE_EXERCISES}
          sessions={[]}
          sets={[]}
          settings={configured}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /remove/i }));
      fireEvent.change(screen.getByPlaceholderText(/Enter current PIN/i), {
        target: { value: '1234' }
      });
      fireEvent.click(screen.getByRole('button', { name: /remove pin/i }));

      await waitFor(async () => {
        const saved = await db.settings.get('general');
        expect(saved?.security_pin_hash).toBeUndefined();
        expect(saved?.security_pin_salt).toBeUndefined();
      });
    });
  });

  describe('UI: Destructive Action Protection', () => {
    it('prompts to Set PIN First when unconfigured and Clear is clicked', () => {
      render(
        <SetupScreen
          exercises={DEFAULT_EXERCISES}
          routines={DEFAULT_ROUTINES}
          routineExercises={DEFAULT_ROUTINE_EXERCISES}
          sessions={[]}
          sets={[]}
          settings={DEFAULT_SETTINGS}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /clear all logged workouts/i }));
      expect(screen.getByText(/No Security PIN is set/i)).toBeInTheDocument();

      // Clicking "Set PIN First" opens the PIN configuration modal
      fireEvent.click(screen.getByRole('button', { name: /set pin first/i }));
      expect(screen.getByRole('heading', { name: 'Set Security PIN' })).toBeInTheDocument();
    });

    it('rejects incorrect PIN when clearing logs and preserves workouts', async () => {
      await saveWorkout(session('session-1', '2026-09-17'), []);
      expect(await db.sessions.count()).toBe(1);

      const configured = await settingsWithPin('7777');
      await db.settings.update('general', configured);

      render(
        <SetupScreen
          exercises={DEFAULT_EXERCISES}
          routines={DEFAULT_ROUTINES}
          routineExercises={DEFAULT_ROUTINE_EXERCISES}
          sessions={[session('session-1', '2026-09-17')]}
          sets={[]}
          settings={configured}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /clear all logged workouts/i }));
      expect(screen.getByText('Enter PIN to Clear Logs')).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText('Security PIN'), {
        target: { value: 'wrong-pin' }
      });
      fireEvent.click(screen.getByRole('button', { name: /verify & clear/i }));

      expect(await screen.findByText(/Incorrect Security PIN/i)).toBeInTheDocument();
      expect(await db.sessions.count()).toBe(1);
    });

    it('accepts correct PIN and deletes logs while preserving library and routines', async () => {
      await saveWorkout(session('session-1', '2026-09-17'), []);
      expect(await db.sessions.count()).toBe(1);

      const configured = await settingsWithPin('7777');
      await db.settings.update('general', configured);

      render(
        <SetupScreen
          exercises={DEFAULT_EXERCISES}
          routines={DEFAULT_ROUTINES}
          routineExercises={DEFAULT_ROUTINE_EXERCISES}
          sessions={[session('session-1', '2026-09-17')]}
          sets={[]}
          settings={configured}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /clear all logged workouts/i }));
      fireEvent.change(screen.getByPlaceholderText('Security PIN'), {
        target: { value: '7777' }
      });
      fireEvent.click(screen.getByRole('button', { name: /verify & clear/i }));

      await waitFor(async () => {
        expect(await db.sessions.count()).toBe(0);
      });
      expect(await db.exercises.count()).toBeGreaterThan(0);
      expect(await db.routines.count()).toBeGreaterThan(0);
    });

    it('requires PIN when Reset to demo data is clicked if PIN is configured', async () => {
      const configured = await settingsWithPin('8888');
      await db.settings.update('general', configured);

      render(
        <SetupScreen
          exercises={DEFAULT_EXERCISES}
          routines={DEFAULT_ROUTINES}
          routineExercises={DEFAULT_ROUTINE_EXERCISES}
          sessions={[]}
          sets={[]}
          settings={configured}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /reset to demo data/i }));
      expect(screen.getByText(/Reset to Demo Data\?/i)).toBeInTheDocument();

      // Wrong PIN
      fireEvent.change(screen.getByPlaceholderText(/Enter Security PIN to authorize/i), {
        target: { value: '0000' }
      });
      fireEvent.click(screen.getByRole('button', { name: /reload demo data/i }));

      expect(await screen.findByText(/Incorrect Security PIN/i)).toBeInTheDocument();

      // Correct PIN
      fireEvent.change(screen.getByPlaceholderText(/Enter Security PIN to authorize/i), {
        target: { value: '8888' }
      });
      fireEvent.click(screen.getByRole('button', { name: /reload demo data/i }));

      await waitFor(async () => {
        expect(screen.queryByText(/Reset to Demo Data\?/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Google Sheets Sync Mutex & Lock Prevention', () => {
    it('disallows concurrent sync attempts and reports mutex message', async () => {
      let resolveFetch: (value: any) => void;
      const delayedFetch = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        await delayedFetch;
        return new Response(JSON.stringify({ status: 'success', scriptVersion: 3 }), { status: 200 });
      });

      const url = 'https://script.google.com/macros/s/test/exec';
      const sync1Promise = syncToGoogleSheets(
        url,
        DEFAULT_EXERCISES,
        DEFAULT_ROUTINES,
        DEFAULT_ROUTINE_EXERCISES,
        [],
        [],
        DEFAULT_SETTINGS
      );

      // Now syncInProgress is true
      expect(isSyncInProgress()).toBe(true);

      // Second sync attempted immediately while first is in flight
      const sync2Result = await syncToGoogleSheets(
        url,
        DEFAULT_EXERCISES,
        DEFAULT_ROUTINES,
        DEFAULT_ROUTINE_EXERCISES,
        [],
        [],
        DEFAULT_SETTINGS
      );

      expect(sync2Result.success).toBe(false);
      expect(sync2Result.message).toContain('A sync is already in progress');

      // Finish first fetch
      resolveFetch!(new Response(JSON.stringify({ status: 'success' }), { status: 200 }));
      await sync1Promise;

      expect(isSyncInProgress()).toBe(false);
    });
  });
});
