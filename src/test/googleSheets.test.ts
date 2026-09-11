import { describe, it, expect } from 'vitest';
import {
  buildGoogleSheetsPayload,
  isBackupDue,
  APPS_SCRIPT_PROTOCOL_VERSION,
  GOOGLE_APPS_SCRIPT_TEMPLATE
} from '../lib/googleSheets';
import { sanitizeSettings, containsSecrets, mergeRestoredSettings } from '../lib/sanitize';
import { Settings } from '../types';

const baseSettings: Settings = {
  id: 'general',
  weight_unit: 'kg',
  weekly_goal: 4,
  default_rest_seconds: 90,
  google_sheets: {
    enabled: true,
    webAppUrl: 'https://script.google.com/macros/s/abc/exec',
    secretKey: 'super-secret-key',
    autoSyncTwiceDaily: true,
    lastSyncStatus: 'success'
  }
};

describe('sanitizeSettings', () => {
  it('strips the secret key from the sync config', () => {
    const clean = sanitizeSettings(baseSettings);
    expect(clean.google_sheets?.secretKey).toBeUndefined();
    // Non-secret config survives so a restore still knows where to sync.
    expect(clean.google_sheets?.webAppUrl).toBe(baseSettings.google_sheets!.webAppUrl);
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
    expect(containsSecrets(baseSettings)).toBe(true);
  });

  it('passes clean settings', () => {
    expect(containsSecrets(sanitizeSettings(baseSettings))).toBe(false);
    expect(containsSecrets(undefined)).toBe(false);
  });
});

describe('mergeRestoredSettings', () => {
  it('keeps the local secret when the backup has none', () => {
    const restored = sanitizeSettings(baseSettings); // what a backup contains
    const merged = mergeRestoredSettings(restored, baseSettings);
    expect(merged.google_sheets?.secretKey).toBe('super-secret-key');
    expect(merged.google_sheets?.webAppUrl).toBe(restored.google_sheets?.webAppUrl);
  });

  it('keeps local sync config when backup has none', () => {
    const merged = mergeRestoredSettings(
      { id: 'general', weight_unit: 'kg', weekly_goal: 5, default_rest_seconds: 60 },
      baseSettings
    );
    expect(merged.google_sheets?.enabled).toBe(true);
    expect(merged.google_sheets?.secretKey).toBe('super-secret-key');
    expect(merged.weekly_goal).toBe(5);
  });
});

describe('buildGoogleSheetsPayload', () => {
  it('carries the secret at top level only, never inside settings', () => {
    const payload = buildGoogleSheetsPayload([], [], [], [], [], baseSettings, 'sync', 'my-key');
    expect(payload.secretKey).toBe('my-key');
    expect(payload.action).toBe('sync');
    expect(payload.settings.google_sheets?.secretKey).toBeUndefined();
    expect(Array.isArray(payload.sessions)).toBe(true);
    expect(Array.isArray(payload.sets)).toBe(true);
  });

  it('omits the secret entirely when not supplied', () => {
    const payload = buildGoogleSheetsPayload([], [], [], [], [], baseSettings, 'test');
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
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    expect(isBackupDue(recent, 12)).toBe(false);
  });

  it('is due after 12 hours', () => {
    const stale = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    expect(isBackupDue(stale, 12)).toBe(true);
  });
});

describe('GOOGLE_APPS_SCRIPT_TEMPLATE', () => {
  it('defaults to the placeholder key so it fails closed until configured', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('CHANGE_THIS_TO_YOUR_PASSWORD');
  });

  it('embeds the current protocol version', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain(`SCRIPT_VERSION = ${APPS_SCRIPT_PROTOCOL_VERSION}`);
  });

  it('writes a MyGym raw backup sheet, not a foreign app name', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain('_MyGymBackup');
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).not.toContain('_PaisaBackup');
  });

  it('strips the secret from the raw backup it stores', () => {
    expect(GOOGLE_APPS_SCRIPT_TEMPLATE).toContain(
      "if (k === 'secretKey' || k === 'action') continue;"
    );
  });
});
