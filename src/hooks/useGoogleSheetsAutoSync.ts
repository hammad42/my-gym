import { useEffect, useRef } from 'react';
import { Exercise, Routine, RoutineExercise, WorkoutSession, SetLog, Settings } from '../types';
import { syncToGoogleSheets, isBackupDue, updateSheetsStatus } from '../lib/googleSheets';

export function useGoogleSheetsAutoSync(
  exercises: Exercise[],
  routines: Routine[],
  routineExercises: RoutineExercise[],
  sessions: WorkoutSession[],
  sets: SetLog[],
  settings: Settings
) {
  const isSyncingRef = useRef(false);

  useEffect(() => {
    const config = settings.google_sheets;
    if (!config || !config.enabled || !config.webAppUrl || !config.autoSyncTwiceDaily) {
      return;
    }

    const checkAndSync = async () => {
      // Guard against overlapping sync calls
      if (isSyncingRef.current) return;

      // Only sync if online
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return;
      }

      // Check if 12 hours have passed since last sync
      if (!isBackupDue(config.lastSyncTime, 12)) {
        return;
      }

      try {
        isSyncingRef.current = true;
        console.log('[GoogleSheetsAutoSync] Triggering scheduled 2x daily backup...');

        const result = await syncToGoogleSheets(
          config.webAppUrl,
          exercises,
          routines,
          routineExercises,
          sessions,
          sets,
          settings,
          config.secretKey
        );

        if (result.success) {
          await updateSheetsStatus(settings.id, {
            lastSyncTime: result.timestamp || new Date().toISOString(),
            lastSyncStatus: 'success',
            lastSyncError: undefined,
            lastRecordCount: sessions.length
          });
          console.log('[GoogleSheetsAutoSync] Scheduled backup successful.');
        } else {
          await updateSheetsStatus(settings.id, {
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

    // Run check on mount or when data updates
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
    exercises,
    routines,
    routineExercises,
    sessions,
    sets,
    settings
  ]);
}
