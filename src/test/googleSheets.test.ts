import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildGoogleSheetsPayload,
  buildSyncParts,
  assembleParts,
  sliceBySize,
  isBackupDue,
  testGoogleSheetsConnection,
  syncToGoogleSheets,
  fetchFromGoogleSheets,
  APPS_SCRIPT_PROTOCOL_VERSION,
  GOOGLE_APPS_SCRIPT_TEMPLATE,
  SYNC_PART_CHARS
} from '../lib/googleSheets';
import { sanitizeSettings, containsSecrets, mergeRestoredSettings } from '../lib/sanitize';
import { SetLog } from '../types';
import {
  SHEETS_SETTINGS,
  ALL_EXERCISES,
  ALL_ROUTINES,
  ALL_ROUTINE_EXERCISES,
  ALL_SESSIONS,
  ALL_SETS,
  SHEET_PAYLOAD
} from './fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sanitizeSettings', () => {
  it('strips the secret key from the sync config', () => {
    const clean = sanitizeSettings(SHEETS_SETTINGS);
    expect(clean.google_sheets?.secretKey).toBeUndefined();
    expect(clean.google_sheets?.webAppUrl).toBe(SHEETS_SETTINGS.google_sheets!.webAppUrl);
    expect(clean.google_sheets?.enabled).toBe(true);
    expect(clean.weight_unit).toBe('kg');
  });

  it('leaves settings without sync config untouched', () => {
    const clean = sanitizeSettings({ id: 'general', weight_unit: 'lb', weekly_goal: 3, default_rest_seconds: 120 });
    expect(clean.google_sheets).toBeUndefined();
  });
});

describe('containsSecrets', () => {
  it('detects a secret key', () => {
    expect(containsSecrets(SHEETS_SETTINGS)).toBe(true);
  });

  it('passes clean settings', () => {
    expect(containsSecrets(sanitizeSettings(SHEETS_SETTINGS))).toBe(false);
    expect(containsSecrets(undefined)).toBe(false);
  });
});

describe('mergeRestoredSettings', () => {
  it('keeps the local secret when the backup has none', () => {
    const restored = sanitizeSettings(SHEETS_SETTINGS);
    const merged = mergeRestoredSettings(restored, SHEETS_SETTINGS);
    expect(merged.google_sheets?.secretKey).toBe('super-secret-key');
    expect(merged.google_sheets?.webAppUrl).toBe(restored.google_sheets?.webAppUrl);
  });

  it('keeps local sync config when the backup has none', () => {
    const merged = mergeRestoredSettings(
      { id: 'general', weight_unit: 'kg', weekly_goal: 5, default_rest_seconds: 60 },
      SHEETS_SETTINGS
    );
    expect(merged.google_sheets?.enabled).toBe(true);
    expect(merged.google_sheets?.secretKey).toBe('super-secret-key');
    expect(merged.weekly_goal).toBe(5);
  });
});

describe('buildGoogleSheetsPayload', () => {
  it('carries the secret at top level only, never inside settings', () => {
    const payload = buildGoogleSheetsPayload([], [], [], [], [], SHEETS_SETTINGS, 'sync', 'my-key');
    expect(payload.secretKey).toBe('my-key');
    expect(payload.action).toBe('sync');
    expect(payload.settings.google_sheets?.secretKey).toBeUndefined();
  });

  it('omits the secret entirely when not supplied', () => {
    const payload = buildGoogleSheetsPayload([], [], [], [], [], SHEETS_SETTINGS, 'test');
    expect(payload.secretKey).toBeUndefined();
  });
});

describe('isBackupDue', () => {
  it('is due when never synced', () => {
    expect(isBackupDue(undefined)).toBe(true);
  });

  it('is due for an unparseable timestamp', () => {
    expect(isBackupDue('not-a-date')).toBe(true);
  });

  it('is not due within 12 hours', () => {
    expect(isBackupDue(new Date(Date.now() - 60 * 60 * 1000).toISOString(), 12)).toBe(false);
  });

  it('is due after 12 hours', () => {
    expect(isBackupDue(new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(), 12)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Partitioning — the fix for Apps Script's ~50 KB POST ceiling
// ---------------------------------------------------------------------------

describe('sliceBySize (deep)', () => {
  const makeSets = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `set-${i}`,
      session_id: 's1',
      exercise_id: 'ex-bench',
      set_number: (i % 5) + 1,
      weight: 80,
      reps: 5,
      is_warmup: false,
      notes: '',
      created_at: '2026-09-01T10:00:00.000Z'
    }));

  it('returns a single part when everything fits', () => {
    const parts = sliceBySize(makeSets(3), 'sets', 10000);
    expect(parts).toHaveLength(1);
    expect((parts[0] as any).items).toHaveLength(3);
  });

  it('returns no parts for an empty list', () => {
    expect(sliceBySize([], 'sets')).toEqual([]);
  });

  it('keeps every item exactly once, in order', () => {
    const sets = makeSets(200);
    const parts = sliceBySize(sets, 'sets', 2000);
    expect(parts.length).toBeGreaterThan(1);

    const flattened = parts.flatMap((p) => (p as any).items as typeof sets);
    expect(flattened).toHaveLength(200);
    expect(flattened.map((s) => s.id)).toEqual(sets.map((s) => s.id));
  });

  it('keeps every part within the character budget', () => {
    const parts = sliceBySize(makeSets(300), 'sets', 4000);
    for (const part of parts) {
      expect(JSON.stringify(part).length).toBeLessThanOrEqual(4000);
    }
  });

  it('gives an oversized single item its own part rather than dropping it', () => {
    const big = { id: 'huge', blob: 'x'.repeat(5000) };
    const parts = sliceBySize([makeSets(1)[0] as any, big, makeSets(1)[0] as any], 'sets', 500);
    expect(parts).toHaveLength(3);
    expect((parts[1] as any).items[0].id).toBe('huge');
  });

  it('never exceeds the default budget on realistic data', () => {
    const parts = sliceBySize(makeSets(500), 'sets');
    for (const part of parts) {
      expect(JSON.stringify(part).length).toBeLessThanOrEqual(SYNC_PART_CHARS);
    }
  });
});

describe('buildSyncParts + assembleParts (deep)', () => {
  it('round-trips a full snapshot without losing or reordering rows', () => {
    const parts = buildSyncParts(
      ALL_EXERCISES,
      ALL_ROUTINES,
      ALL_ROUTINE_EXERCISES,
      ALL_SESSIONS,
      ALL_SETS,
      SHEETS_SETTINGS
    );
    const rebuilt = assembleParts(parts);

    expect(rebuilt.exercises.map((e) => e.id)).toEqual(ALL_EXERCISES.map((e) => e.id));
    expect(rebuilt.routines.map((r) => r.id)).toEqual(ALL_ROUTINES.map((r) => r.id));
    expect(rebuilt.routine_exercises.map((r) => r.id)).toEqual(ALL_ROUTINE_EXERCISES.map((r) => r.id));
    expect(rebuilt.sessions.map((s) => s.id)).toEqual(ALL_SESSIONS.map((s) => s.id));
    expect(rebuilt.sets.map((s) => s.id)).toEqual(ALL_SETS.map((s) => s.id));
  });

  it('always emits the meta part first', () => {
    const parts = buildSyncParts([], [], [], [], [], SHEETS_SETTINGS);
    expect(parts[0].k).toBe('meta');
  });

  it('strips the secret from the meta part', () => {
    const parts = buildSyncParts([], [], [], [], [], SHEETS_SETTINGS);
    const meta = parts[0] as any;
    expect(meta.settings.google_sheets?.secretKey).toBeUndefined();
    expect(JSON.stringify(parts)).not.toContain('super-secret-key');
  });

  it('keeps every part inside the cell/POST budget for a large history', () => {
    // ~1200 sets, far beyond a year of typical training.
    const bigSets: SetLog[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `big-${i}`,
      session_id: `sess-${i % 100}`,
      exercise_id: 'ex-bench',
      set_number: (i % 5) + 1,
      weight: 100,
      reps: 5,
      is_warmup: false,
      notes: '',
      created_at: '2026-09-01T10:00:00.000Z'
    }));
    const parts = buildSyncParts(ALL_EXERCISES, ALL_ROUTINES, ALL_ROUTINE_EXERCISES, ALL_SESSIONS, bigSets, SHEETS_SETTINGS);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      const size = JSON.stringify(part).length;
      expect(size).toBeLessThanOrEqual(SYNC_PART_CHARS);
      // A spreadsheet cell caps at 50,000 characters; the script also guards 49k.
      expect(size).toBeLessThanOrEqual(49000);
    }
    expect(assembleParts(parts).sets).toHaveLength(1200);
  });

  it('emits no data parts for empty tables', () => {
    const parts = buildSyncParts([], [], [], [], [], SHEETS_SETTINGS);
    expect(parts).toHaveLength(1); // meta only
  });
});

// ---------------------------------------------------------------------------
// Network flow
// ---------------------------------------------------------------------------

function mockFetchSequence(responses: any[]) {
  const calls: any[] = [];
  let i = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
    calls.push(JSON.parse(init.body));
    const body = responses[Math.min(i, responses.length - 1)];
    i++;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

describe('syncToGoogleSheets (partitioned protocol)', () => {
  const URL_OK = 'https://script.google.com/macros/s/abc/exec';

  it('rejects a non-Apps-Script URL without making a request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await syncToGoogleSheets('https://evil.example.com/x', [], [], [], [], [], SHEETS_SETTINGS, 'k');
    expect(res.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('sends start, one part per slice, then commit', async () => {
    const calls = mockFetchSequence([
      { status: 'success' },
      { status: 'success' },
      { status: 'success' },
      { status: 'success', message: 'Backup saved!', timestamp: '2026-09-11T10:00:00.000Z', counts: { sessions: 2, sets: 3, exercises: 2 } }
    ]);

    const res = await syncToGoogleSheets(
      URL_OK, ALL_EXERCISES, ALL_ROUTINES, ALL_ROUTINE_EXERCISES, ALL_SESSIONS, ALL_SETS, SHEETS_SETTINGS, 'secret'
    );

    expect(res.success).toBe(true);
    expect(res.counts).toEqual({ sessions: 2, sets: 3, exercises: 2 });
    expect(res.timestamp).toBe('2026-09-11T10:00:00.000Z');

    const actions = calls.map((c) => c.action);
    expect(actions[0]).toBe('sync-start');
    expect(actions[actions.length - 1]).toBe('sync-commit');
    expect(actions.filter((a) => a === 'sync-part').length).toBe(calls.length - 2);
  });

  it('carries a stable syncId across every request', async () => {
    const calls = mockFetchSequence([{ status: 'success' }, { status: 'success' }]);
    await syncToGoogleSheets(URL_OK, [], [], [], [], [], SHEETS_SETTINGS, 'secret');

    const ids = new Set(calls.map((c) => c.syncId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^sync-/);
  });

  it('sends every row exactly once across the parts', async () => {
    const manySets: SetLog[] = Array.from({ length: 300 }, (_, i) => ({
      ...ALL_SETS[0],
      id: `s-${i}`,
      set_number: i
    }));
    const calls = mockFetchSequence([{ status: 'success' }]);

    await syncToGoogleSheets(URL_OK, ALL_EXERCISES, [], [], ALL_SESSIONS, manySets, SHEETS_SETTINGS, 'k');

    const sentSets = calls
      .filter((c) => c.action === 'sync-part' && c.part.k === 'sets')
      .flatMap((c) => c.part.items as SetLog[]);
    expect(sentSets).toHaveLength(300);
    expect(new Set(sentSets.map((s) => s.id)).size).toBe(300);
  });

  it('never sends the secret inside the payload parts', async () => {
    const calls = mockFetchSequence([{ status: 'success' }, { status: 'success' }]);
    await syncToGoogleSheets(URL_OK, [], [], [], [], [], SHEETS_SETTINGS, 'the-real-key');

    for (const call of calls) {
      if (call.part) {
        expect(JSON.stringify(call.part)).not.toContain('the-real-key');
      }
    }
    // The auth field itself is expected at the top level of each request.
    expect(calls.every((c) => c.secretKey === 'the-real-key' || c.action === 'test')).toBe(true);
  });

  it('stops and reports an error when start fails', async () => {
    const calls = mockFetchSequence([{ status: 'error', message: 'Webhook is not secured.' }]);
    const res = await syncToGoogleSheets(URL_OK, [], [], [], [], [], SHEETS_SETTINGS, 'k');

    expect(res.success).toBe(false);
    expect(res.message).toBe('Webhook is not secured.');
    expect(calls).toHaveLength(1);
  });

  it('stops mid-upload and reports the failing part', async () => {
    const calls = mockFetchSequence([
      { status: 'success' },
      { status: 'error', message: 'Payload part is too large for a spreadsheet cell.' }
    ]);
    const res = await syncToGoogleSheets(URL_OK, ALL_EXERCISES, [], [], ALL_SESSIONS, ALL_SETS, SHEETS_SETTINGS, 'k');

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/too large/);
    expect(calls.filter((c) => c.action === 'sync-commit')).toHaveLength(0);
  });

  it('reports an error when commit fails', async () => {
    mockFetchSequence([{ status: 'success' }, { status: 'error', message: 'Sync session expired.' }]);
    const res = await syncToGoogleSheets(URL_OK, [], [], [], [], [], SHEETS_SETTINGS, 'k');
    expect(res.success).toBe(false);
    expect(res.message).toBe('Sync session expired.');
  });

  it('surfaces a network failure instead of pretending success', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await syncToGoogleSheets(URL_OK, [], [], [], [], [], SHEETS_SETTINGS, 'k');
    expect(res.success).toBe(false);
    expect(res.message).toBe('Failed to fetch');
  });

  it('reports a non-200 response with its status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const res = await syncToGoogleSheets(URL_OK, [], [], [], [], [], SHEETS_SETTINGS, 'k');
    expect(res.success).toBe(false);
    expect(res.message).toBe('Google Sheets returned HTTP 500');
  });
});

describe('testGoogleSheetsConnection', () => {
  it('rejects a non-Apps-Script URL before any request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await testGoogleSheetsConnection('https://example.com/hook', 'k');
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Invalid URL/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports success from the script', async () => {
    mockFetchSequence([{ status: 'success', message: 'Authenticated and connected!' }]);
    const res = await testGoogleSheetsConnection('https://script.google.com/macros/s/a/exec', 'k');
    expect(res).toEqual({ success: true, message: 'Authenticated and connected!' });
  });

  it('propagates a rejection from the script', async () => {
    mockFetchSequence([{ status: 'error', message: 'Unauthorized: Invalid Secret Key.' }]);
    const res = await testGoogleSheetsConnection('https://script.google.com/macros/s/a/exec', 'wrong');
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Unauthorized/);
  });

  it('reports a network failure clearly', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await testGoogleSheetsConnection('https://script.google.com/macros/s/a/exec', 'k');
    expect(res.success).toBe(false);
    expect(res.message).toBe('Failed to fetch');
  });
});

describe('fetchFromGoogleSheets', () => {
  it('returns the assembled payload', async () => {
    mockFetchSequence([{ status: 'success', data: { ...SHEET_PAYLOAD } }]);
    const res = await fetchFromGoogleSheets('https://script.google.com/macros/s/a/exec', 'k');
    expect(res.success).toBe(true);
    expect(res.data?.sessions).toHaveLength(2);
    expect(res.data?.sets).toHaveLength(3);
  });

  it('requests the fetch action with the key', async () => {
    const calls = mockFetchSequence([{ status: 'success', data: { ...SHEET_PAYLOAD } }]);
    await fetchFromGoogleSheets('https://script.google.com/macros/s/a/exec', 'my-key');
    expect(calls[0]).toMatchObject({ action: 'fetch', secretKey: 'my-key' });
  });

  it('rejects a payload missing required tables', async () => {
    mockFetchSequence([{ status: 'success', data: { exercises: [], routines: [] } }]);
    const res = await fetchFromGoogleSheets('https://script.google.com/macros/s/a/exec', 'k');
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/missing required tables/);
  });

  it('reports "no backup" from the script', async () => {
    mockFetchSequence([{ status: 'error', message: 'No backup found in this Google Sheet yet.' }]);
    const res = await fetchFromGoogleSheets('https://script.google.com/macros/s/a/exec', 'k');
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/No backup found/);
  });

  it('rejects an invalid url before any request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const res = await fetchFromGoogleSheets('https://nope.example.com', 'k');
    expect(res.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('GOOGLE_APPS_SCRIPT_TEMPLATE', () => {
  it('defaults to the placeholder key so it fails closed until configured', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('CHANGE_THIS_TO_YOUR_PASSWORD');
  });

  it('embeds the current protocol version', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain(`SCRIPT_VERSION = ${APPS_SCRIPT_PROTOCOL_VERSION}`);
  });

  it('names its own backup sheet rather than a foreign app one', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('_MyGymBackup');
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).not.toContain('_PaisaBackup');
  });

  it('implements the partitioned upload actions the client calls', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain("action === 'sync-start'");
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain("action === 'sync-part'");
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain("action === 'sync-commit'");
  });

  it('guards against storing a part too large for a spreadsheet cell', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('49000');
  });

  it('stores the backup as rows of parts, never one giant cell', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('function readParts');
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('function slicePart');
  });
});

describe('syncToGoogleSheets — legacy v1 deployment fallback', () => {
  const URL_OK = 'https://script.google.com/macros/s/abc/exec';

  it('falls back to the single-shot upload when the script does not know sync-start', async () => {
    const calls = mockFetchSequence([
      { status: 'error', message: 'Unknown action: sync-start' },
      { status: 'success', message: 'Backup saved successfully!', counts: { sessions: 2, sets: 3, exercises: 2 } }
    ]);

    const res = await syncToGoogleSheets(
      URL_OK, ALL_EXERCISES, ALL_ROUTINES, ALL_ROUTINE_EXERCISES, ALL_SESSIONS, ALL_SETS, SHEETS_SETTINGS, 'k'
    );

    expect(res.success).toBe(true);
    expect(calls.map((c) => c.action)).toEqual(['sync-start', 'sync']);
    // The legacy request still carries the whole dataset.
    expect(calls[1].sets).toHaveLength(3);
    expect(calls[1].sessions).toHaveLength(2);
    expect(calls[1].settings.google_sheets?.secretKey).toBeUndefined();
  });

  it('falls back when a later action is unknown too', async () => {
    const calls = mockFetchSequence([
      { status: 'success' },
      { status: 'error', message: 'Unknown action: sync-part' },
      { status: 'success', message: 'Backup saved!' }
    ]);

    const res = await syncToGoogleSheets(URL_OK, ALL_EXERCISES, [], [], ALL_SESSIONS, ALL_SETS, SHEETS_SETTINGS, 'k');
    expect(res.success).toBe(true);
    expect(calls[calls.length - 1].action).toBe('sync');
  });

  it('tells the user to update the script when a legacy upload exceeds the POST limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const res = await syncToGoogleSheets(URL_OK, ALL_EXERCISES, [], [], ALL_SESSIONS, ALL_SETS, SHEETS_SETTINGS, 'k');
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Failed to fetch/);
    expect(res.message).toMatch(/older Apps Script/);
  });

  it('does not nag about the script for an empty workout log', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await syncToGoogleSheets(URL_OK, ALL_EXERCISES, [], [], [], [], SHEETS_SETTINGS, 'k');
    expect(res.message).toBe('Failed to fetch');
  });
});
