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

  delete clone.security_pin_hash;
  delete clone.security_pin_salt;

  return clone;
}

/**
 * True when a settings object still carries a credential. Used by tests and by
 * the import validator to refuse to write secrets back into the database.
 */
export function containsSecrets(settings: Partial<Settings> | undefined | null): boolean {
  if (!settings) return false;
  return Boolean(
    settings.google_sheets?.secretKey ||
    settings.security_pin_hash ||
    settings.security_pin_salt
  );
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Builds the settings row to write when restoring a backup.
 *
 * The inverse of `sanitizeSettings`, and load-bearing for the same reason: a
 * backup never contains credentials, so restoring must not be allowed to delete
 * the ones this device holds.
 *
 * Field-by-field semantics:
 *  - `google_sheets`: the device's own credential always wins; an incoming
 *    secret is never trusted. When the incoming settings carry no sync config at
 *    all, keep the local one rather than dropping it.
 *  - `weight_unit`: the BACKUP wins — the unit describes the incoming weight
 *    data, so keeping the device's label would mislabel every restored set.
 *  - `weekly_goal` / `default_rest_seconds`: the DEVICE wins — these are
 *    preferences of the person holding this phone, not properties of the data.
 *    Both are clamped to their UI ranges so a hand-edited backup cannot smuggle
 *    in a zero goal or a one-second rest timer.
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

  // Google Sheets sync destination and credentials NEVER travel with a backup.
  // The local device's configuration is kept completely intact so a restored file
  // cannot silently hijack the sync destination or smuggle in altered sync flags.
  merged.google_sheets = current.google_sheets;

  // The device's security PIN/password is preserved; incoming backups cannot overwrite it.
  merged.security_pin_hash = current.security_pin_hash;
  merged.security_pin_salt = current.security_pin_salt;

  // The unit travels with the data; the preferences travel with the device.
  merged.weight_unit = incoming?.weight_unit === 'lb' || incoming?.weight_unit === 'kg'
    ? incoming.weight_unit
    : current.weight_unit;
  merged.weekly_goal = clamp(current.weekly_goal, 1, 14, 4);
  merged.default_rest_seconds = clamp(current.default_rest_seconds, 15, 600, 90);

  return merged;
}
