import { Settings } from '../types';

/**
 * Outbound-payload scrubbing.
 *
 * Backups get emailed, dropped in cloud storage, and handed to whoever is helping
 * you restore. Anything secret that rides along in one is effectively public, so
 * credentials are removed from every payload that leaves the device: JSON export
 * and the Google Sheets sync body — including the copy of the settings written
 * into the very sheet the secret protects.
 *
 * The sync request still carries the secret key as its own top-level auth field;
 * what is stripped is the *stored* copy inside `settings`.
 */

/**
 * Returns a copy of settings with the Google Sheets secret key removed.
 * Everything non-secret (unit, goals, sync destination and status) is preserved
 * so a restore still works.
 */
export function sanitizeSettings(settings: Settings): Settings {
  const clone: Settings = { ...settings };

  if (clone.google_sheets) {
    const { secretKey: _secretKey, ...safeSheets } = clone.google_sheets;
    clone.google_sheets = safeSheets;
  }

  return clone;
}

/**
 * True when a settings object still carries a credential. Used by tests and by
 * the import validator to refuse to write secrets back into the database.
 */
export function containsSecrets(settings: Partial<Settings> | undefined | null): boolean {
  if (!settings) return false;
  return Boolean(settings.google_sheets?.secretKey);
}

/**
 * Builds the settings row to write when restoring a backup.
 *
 * The inverse of `sanitizeSettings`: a backup never contains credentials, so
 * restoring must not be allowed to delete the ones this device holds. Everything
 * that *is* backed up comes from the incoming copy; the local Sheets secret
 * always wins.
 */
export function mergeRestoredSettings(
  incoming: Partial<Settings> | undefined,
  current: Settings
): Settings {
  const merged: Settings = {
    ...current,
    ...(incoming ?? {}),
    id: current.id
  };

  // Keep the device's Sheets secret. An incoming secret key is never trusted —
  // this device's own value (or none) always wins. When the incoming settings
  // carry no sync config at all, keep the local one rather than dropping it.
  merged.google_sheets = incoming?.google_sheets
    ? { ...incoming.google_sheets, secretKey: current.google_sheets?.secretKey }
    : current.google_sheets;

  return merged;
}
