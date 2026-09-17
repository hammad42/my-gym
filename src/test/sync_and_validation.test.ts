import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateBackupJson,
  isRealDate,
  downloadBackup,
  BackupPayload
} from '../lib/exportImport';
import { mergeRestoredSettings } from '../lib/sanitize';
import {
  APPS_SCRIPT_PROTOCOL_VERSION,
  GOOGLE_APPS_SCRIPT_TEMPLATE,
  syncToGoogleSheets
} from '../lib/googleSheets';
import { Settings, Exercise, WorkoutSession, SetLog } from '../types';
import { DEFAULT_SETTINGS, DEFAULT_EXERCISES, DEFAULT_ROUTINES } from '../lib/sampleData';

describe('Real date validation (preventing JS Date rollover)', () => {
  it('identifies real vs impossible calendar dates', () => {
    expect(isRealDate(2026, 2, 28)).toBe(true);
    expect(isRealDate(2026, 2, 29)).toBe(false); // 2026 is not a leap year
    expect(isRealDate(2024, 2, 29)).toBe(true);  // 2024 is a leap year
    expect(isRealDate(2026, 4, 30)).toBe(true);
    expect(isRealDate(2026, 4, 31)).toBe(false); // April has 30 days
    expect(isRealDate(2026, 13, 1)).toBe(false); // Month 13 invalid
    expect(isRealDate(2026, 0, 1)).toBe(false);  // Month 0 invalid
  });
});

describe('validateBackupJson row-level and referential validation', () => {
  const validExercise: Exercise = {
    id: 'ex-1',
    name: 'Bench Press',
    muscle_group: 'chest',
    equipment: 'barbell',
    icon: 'Dumbbell',
    color: '#f97316',
    is_default: false,
    created_at: '2026-09-01T00:00:00.000Z'
  };

  const validSession: WorkoutSession = {
    id: 's-1',
    name: 'Push Day',
    date: '2026-09-01',
    duration_minutes: 60,
    routine_id: null,
    body_weight: 80,
    notes: 'Good',
    created_at: '2026-09-01T00:00:00.000Z'
  };

  const validSet: SetLog = {
    id: 'set-1',
    session_id: 's-1',
    exercise_id: 'ex-1',
    set_number: 1,
    weight: 100,
    reps: 5,
    is_warmup: false,
    notes: '',
    created_at: '2026-09-01T00:00:00.000Z'
  };

  it('rejects sessions with impossible dates (e.g. Feb 31)', () => {
    const backup = {
      app: 'mygym',
      version: 1,
      exercises: [validExercise],
      routines: [],
      routine_exercises: [],
      sessions: [
        { ...validSession, id: 's-good', date: '2026-02-28' },
        { ...validSession, id: 's-bad', date: '2026-02-31' } // impossible date
      ],
      sets: [
        { ...validSet, session_id: 's-good' }
      ]
    };

    const res = validateBackupJson(backup);
    expect(res.valid).toBe(true);
    expect(res.data?.sessions.length).toBe(1);
    expect(res.data?.sessions[0].id).toBe('s-good');
    expect(res.data?.warnings.some((w) => w.includes('impossible dates'))).toBe(true);
  });

  it('coerces unknown muscle_group and equipment to "other" without dropping exercise', () => {
    const backup = {
      app: 'mygym',
      version: 1,
      exercises: [
        {
          id: 'ex-unknown',
          name: 'Neck Flexion',
          muscle_group: 'neck', // unknown enum
          equipment: 'resistance_band', // unknown enum
          icon: 'Dumbbell',
          color: '#f97316'
        }
      ],
      routines: [],
      routine_exercises: [],
      sessions: [validSession],
      sets: [{ ...validSet, exercise_id: 'ex-unknown' }]
    };

    const res = validateBackupJson(backup);
    expect(res.valid).toBe(true);
    expect(res.data?.exercises.length).toBe(1);
    expect(res.data?.exercises[0].muscle_group).toBe('other');
    expect(res.data?.exercises[0].equipment).toBe('other');
    // Because the exercise was preserved as 'other', the referencing set was NOT dropped
    expect(res.data?.sets.length).toBe(1);
    expect(res.data?.warnings.some((w) => w.includes('coerced to "other"'))).toBe(true);
  });

  it('handles missing routine_exercises gracefully with a warning', () => {
    const backup = {
      app: 'mygym',
      version: 1,
      exercises: [validExercise],
      routines: DEFAULT_ROUTINES,
      // routine_exercises intentionally omitted
      sessions: [validSession],
      sets: [validSet]
    };

    const res = validateBackupJson(backup);
    expect(res.valid).toBe(true);
    expect(res.data?.routine_exercises).toEqual([]);
    expect(res.data?.warnings.some((w) => w.includes('routine exercise plans'))).toBe(true);
  });

  it('enforces referential integrity by dropping orphaned sets', () => {
    const backup = {
      app: 'mygym',
      version: 1,
      exercises: [validExercise],
      routines: [],
      routine_exercises: [],
      sessions: [validSession],
      sets: [
        validSet, // valid
        { ...validSet, id: 'orphan-session', session_id: 'non-existent' },
        { ...validSet, id: 'orphan-ex', exercise_id: 'non-existent' }
      ]
    };

    const res = validateBackupJson(backup);
    expect(res.valid).toBe(true);
    expect(res.data?.sets.length).toBe(1);
    expect(res.data?.sets[0].id).toBe('set-1');
    expect(res.data?.warnings.some((w) => w.includes('referenced deleted sessions/exercises'))).toBe(true);
  });

  it('extracts incoming Google Sheets destination into pendingSheetsUrl and produces warning', () => {
    const backup = {
      app: 'mygym',
      version: 1,
      exercises: [validExercise],
      sessions: [validSession],
      sets: [validSet],
      settings: {
        weight_unit: 'lb',
        google_sheets: {
          enabled: true,
          webAppUrl: 'https://script.google.com/macros/s/ATTACKER/exec',
          autoSyncTwiceDaily: true
        }
      }
    };

    const res = validateBackupJson(backup);
    expect(res.valid).toBe(true);
    expect(res.data?.pendingSheetsUrl).toBe('https://script.google.com/macros/s/ATTACKER/exec');
    expect(res.data?.warnings.some((w) => w.includes('NOT applied'))).toBe(true);
  });
});

describe('mergeRestoredSettings destination hijack defense', () => {
  it('completely preserves current device google_sheets settings when restoring', () => {
    const currentDeviceSettings: Settings = {
      id: 'general',
      weight_unit: 'kg',
      weekly_goal: 4,
      default_rest_seconds: 90,
      google_sheets: {
        enabled: true,
        webAppUrl: 'https://script.google.com/macros/s/LEGITIMATE_USER/exec',
        secretKey: 'my-private-secret',
        autoSyncTwiceDaily: true,
        connectionVerifiedAt: '2026-09-10T12:00:00.000Z',
        lastSyncTime: '2026-09-15T10:00:00.000Z'
      }
    };

    const incomingUntrustedSettings: Partial<Settings> = {
      weight_unit: 'lb',
      google_sheets: {
        enabled: true,
        webAppUrl: 'https://script.google.com/macros/s/ATTACKER/exec',
        autoSyncTwiceDaily: true,
        lastSyncTime: '2020-01-01T00:00:00.000Z'
      }
    };

    const merged = mergeRestoredSettings(incomingUntrustedSettings, currentDeviceSettings);

    // Non-credential settings like weight_unit update
    expect(merged.weight_unit).toBe('lb');
    // google_sheets is completely preserved from currentDeviceSettings
    expect(merged.google_sheets?.webAppUrl).toBe('https://script.google.com/macros/s/LEGITIMATE_USER/exec');
    expect(merged.google_sheets?.secretKey).toBe('my-private-secret');
    expect(merged.google_sheets?.connectionVerifiedAt).toBe('2026-09-10T12:00:00.000Z');
    expect(merged.google_sheets?.lastSyncTime).toBe('2026-09-15T10:00:00.000Z');
  });
});

describe('downloadBackup async delayed revocation & mobile share', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delays URL.revokeObjectURL by 10s on desktop/Android downloads', () => {
    const revokeSpy = vi.fn();
    const createSpy = vi.fn().mockReturnValue('blob:mock-url');
    globalThis.URL.createObjectURL = createSpy;
    globalThis.URL.revokeObjectURL = revokeSpy;

    const payload: BackupPayload = {
      app: 'mygym',
      version: 1,
      exported_at: '2026-09-16T00:00:00.000Z',
      exercises: DEFAULT_EXERCISES,
      routines: [],
      routine_exercises: [],
      sessions: [],
      sets: [],
      settings: DEFAULT_SETTINGS
    };

    downloadBackup(payload);

    expect(createSpy).toHaveBeenCalled();
    // Synchronously right after downloadBackup, revokeObjectURL MUST NOT have been called yet
    expect(revokeSpy).not.toHaveBeenCalled();

    // Fast-forward 9 seconds
    vi.advanceTimersByTime(9000);
    expect(revokeSpy).not.toHaveBeenCalled();

    // Fast-forward to 10 seconds
    vi.advanceTimersByTime(1000);
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('uses navigator.share on iOS devices when available', () => {
    const originalUserAgent = navigator.userAgent;
    const shareSpy = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      configurable: true
    });
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(true),
      configurable: true
    });

    const payload: BackupPayload = {
      app: 'mygym',
      version: 1,
      exported_at: '2026-09-16T00:00:00.000Z',
      exercises: DEFAULT_EXERCISES,
      routines: [],
      routine_exercises: [],
      sessions: [],
      sets: [],
      settings: DEFAULT_SETTINGS
    };

    downloadBackup(payload);

    expect(shareSpy).toHaveBeenCalled();
    const callArgs = shareSpy.mock.calls[0][0];
    expect(callArgs.files).toBeDefined();
    expect(callArgs.files[0].name).toMatch(/^mygym-backup-\d{4}-\d{2}-\d{2}\.json$/);

    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true
    });
  });
});

describe('Google Apps Script Template protocol v4 hardening', () => {
  it('exports protocol version 4', () => {
    expect(APPS_SCRIPT_PROTOCOL_VERSION).toBe(4);
  });

  it('template contains safeText formula injection escaping', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('function safeText(value)');
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('/^[=+\\-@\\t\\r]/');
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain("return \"'\" + s;");
  });

  it('template uses per-session staging sheets _MyGymBackupNew_<syncId>', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain("var stagingName = '_MyGymBackupNew_' + syncId;");
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('LockService.getScriptLock()');
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('staging.setName(BACKUP_SHEET)');
  });

  it('template uses tryLock rather than waitLock and defines readBackup', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('lock.tryLock(30000)');
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).not.toContain('lock.waitLock(30000)');
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('function readBackup()');
  });
});

describe('Protocol version compatibility in syncToGoogleSheets', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses partitioned upload for both v2 and v3 deployments', async () => {
    const postCalls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
      if (opts?.method === 'GET' || String(url).includes('action=ping')) {
        return new Response(JSON.stringify({ status: 'success', scriptVersion: 2 }), { status: 200 });
      }
      const body = JSON.parse(opts.body);
      postCalls.push(body);
      return new Response(JSON.stringify({ status: 'success', scriptVersion: 2 }), { status: 200 });
    });

    const res = await syncToGoogleSheets(
      'https://script.google.com/macros/s/test/exec',
      DEFAULT_EXERCISES,
      [],
      [],
      [],
      [],
      DEFAULT_SETTINGS,
      'password123'
    );

    expect(res.success).toBe(true);
    // Even though deployed version is 2 (< 3), it uses partitioned upload (sync-start, sync-part, sync-commit)
    expect(postCalls.some((c) => c.action === 'sync-start')).toBe(true);
    expect(postCalls.some((c) => c.action === 'sync-commit')).toBe(true);
  });

  it('falls back to single-request syncWholePayloadToScript only for v1 (< 2)', async () => {
    const postCalls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
      if (opts?.method === 'GET' || String(url).includes('action=ping')) {
        return new Response(JSON.stringify({ status: 'success', scriptVersion: 1 }), { status: 200 });
      }
      const body = JSON.parse(opts.body);
      postCalls.push(body);
      return new Response(JSON.stringify({ status: 'success', scriptVersion: 1 }), { status: 200 });
    });

    const res = await syncToGoogleSheets(
      'https://script.google.com/macros/s/test/exec',
      DEFAULT_EXERCISES,
      [],
      [],
      [],
      [],
      DEFAULT_SETTINGS,
      'password123'
    );

    expect(res.success).toBe(true);
    // Legacy v1 receives single 'sync' action
    expect(postCalls.some((c) => c.action === 'sync')).toBe(true);
    expect(postCalls.some((c) => c.action === 'sync-start')).toBe(false);
  });
});
