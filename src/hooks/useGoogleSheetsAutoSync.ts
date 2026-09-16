import { useEffect, useRef } from 'react';
import { Exercise, Routine, RoutineExercise, WorkoutSession, SetLog, Settings } from '../types';
import { syncToGoogleSheets, isBackupDue, updateSheetsStatus } from '../lib/googleSheets';

export function useGoogleSheetsAutoSync(
  exercises: Exercise[],
  routines: Routine[],
  routineExercises: RoutineExercise[],
  sessions: WorkoutSession[],
  sets: SetLog[],
  settings: Settings,
  /**
   * When true the sync is postponed — set while a workout is being logged, so a
   * background upload cannot interrupt the session the user is in the middle of.
   */
  defer = false
) {
  const isSyncingRef = useRef(false);
  const dataRef = useRef({ exercises, routines, routineExercises, sessions, sets, settings });
  dataRef.current = { exercises, routines, routineExercises, sessions, sets, settings };

  useEffect(() => {
    const config = settings.google_sheets;
    if (!config || !config.enabled || !config.webAppUrl || !config.autoSyncTwiceDaily) {
      return;
    }
    if (defer) return;

    const checkAndSync = async () => {
      // Guard against overlapping sync calls
      if (isSyncingRef.current) return;

      // Only sync if online
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return;
      }

      const currentData = dataRef.current;
      const currentConfig = currentData.settings.google_sheets;
      if (!currentConfig || !currentConfig.enabled || !currentConfig.webAppUrl) return;

      // Check if 12 hours have passed since last sync
      if (!isBackupDue(currentConfig.lastSyncTime, 12)) {
        return;
      }

      try {
        isSyncingRef.current = true;
        console.log('[GoogleSheetsAutoSync] Triggering scheduled 2x daily backup...');

        const result = await syncToGoogleSheets(
          currentConfig.webAppUrl,
          currentData.exercises,
          currentData.routines,
          currentData.routineExercises,
          currentData.sessions,
          currentData.sets,
          currentData.settings,
          currentConfig.secretKey
        );

        if (result.success) {
          await updateSheetsStatus(currentData.settings.id, {
            lastSyncTime: result.timestamp || new Date().toISOString(),
            lastSyncStatus: 'success',
            lastSyncError: undefined,
            lastRecordCount: currentData.sessions.length
          });
          console.log('[GoogleSheetsAutoSync] Scheduled backup successful.');
        } else {
          await updateSheetsStatus(currentData.settings.id, {
            lastSyncStatus: 'error',
            lastSyncError: result.message
          });
        }
      } catch (err: any) {
        console.error('[GoogleSheetsAutoSync] Sync error:', err);
      } finally {
        isSyncingRef.current = false;
      }
    };

    // Run check on mount or when config/defer updates
    checkAndSync();

    // Check on coming back online
    const handleOnline = () => {
      checkAndSync();
    };
    window.addEventListener('online', handleOnline);

    // Periodic check every 15 minutes while the app is active
    const interval = setInterval(checkAndSync, 15 * 60 * 1000);

    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
  }, [
    settings.google_sheets?.enabled,
    settings.google_sheets?.webAppUrl,
    settings.google_sheets?.autoSyncTwiceDaily,
    settings.google_sheets?.lastSyncTime,
    defer
  ]);
}
