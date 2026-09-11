import React from 'react';
import {
  ShieldCheck,
  WifiOff,
  Settings as SettingsIcon,
  Cloud,
  CloudCheck,
  RefreshCw,
  Dumbbell
} from 'lucide-react';
import { GoogleSheetsSyncConfig } from '../types';

interface Props {
  onOpenSettings: () => void;
  activeScreen: string;
  googleSheetsConfig?: GoogleSheetsSyncConfig;
  onQuickSync?: () => void;
  isSyncing?: boolean;
}

export const Header: React.FC<Props> = ({
  onOpenSettings,
  googleSheetsConfig,
  onQuickSync,
  isSyncing
}) => {
  return (
    <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 px-4 pt-safe pb-3">
      <div className="max-w-md mx-auto flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-orange-400 p-0.5 shadow-lg shadow-orange-950/40 flex items-center justify-center">
            <div className="w-full h-full bg-slate-900 rounded-[10px] flex items-center justify-center">
              <Dumbbell className="w-4.5 h-4.5 text-orange-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg tracking-tight text-white leading-tight">MyGym</h1>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-orange-400 bg-orange-950/70 border border-orange-800/50 px-1.5 py-0.5 rounded-full">
                <ShieldCheck className="w-3 h-3" /> Offline PWA
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Plan & log every session</p>
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1.5">
          {googleSheetsConfig?.enabled && (
            <button
              onClick={onQuickSync || onOpenSettings}
              disabled={isSyncing}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition ${
                isSyncing
                  ? 'bg-orange-950/70 border-orange-500 text-orange-300 animate-pulse'
                  : googleSheetsConfig.lastSyncStatus === 'error'
                  ? 'bg-rose-950/50 border-rose-700/60 text-rose-300'
                  : 'bg-slate-800/60 border-slate-700/50 text-slate-300 hover:text-orange-400'
              }`}
              title={
                isSyncing
                  ? 'Syncing with Google Sheets...'
                  : googleSheetsConfig.lastSyncTime
                  ? `Google Sheets synced: ${new Date(googleSheetsConfig.lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Sync with Google Sheets'
              }
            >
              {isSyncing ? (
                <RefreshCw className="w-3 h-3 text-orange-400 animate-spin" />
              ) : googleSheetsConfig.lastSyncStatus === 'success' ? (
                <CloudCheck className="w-3 h-3 text-orange-400" />
              ) : (
                <Cloud className="w-3 h-3 text-slate-400" />
              )}
              <span className="text-[10px]">
                {isSyncing ? 'Syncing' : 'Sheets'}
              </span>
            </button>
          )}

          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-700/50 text-[11px] text-slate-300">
            <WifiOff className="w-3 h-3 text-orange-400" />
            <span>0 ms</span>
          </div>
          <button
            onClick={onOpenSettings}
            className="w-8 h-8 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition"
            title="Settings & Data"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
