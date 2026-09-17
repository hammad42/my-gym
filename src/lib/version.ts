/**
 * Application version and build metadata.
 * Injected at build time via Vite's `define` configuration.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';

export const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '2026-09-17T00:00:00.000Z';
