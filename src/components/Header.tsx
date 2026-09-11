import React from 'react';
import {
  ShieldCheck,
  WifiOff,
  Settings as SettingsIcon,
  Dumbbell
} from 'lucide-react';

interface Props {
  onOpenSettings: () => void;
  activeScreen: string;
}

export const Header: React.FC<Props> = ({ onOpenSettings }) => {
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
