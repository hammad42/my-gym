import React from 'react';
import {
  Home,
  ListOrdered,
  Plus,
  ClipboardList,
  TrendingUp,
  Settings
} from 'lucide-react';

export type ScreenType = 'home' | 'history' | 'add' | 'routines' | 'progress' | 'setup';

interface TabItem {
  id: ScreenType;
  label: string;
  icon: React.ElementType;
  isAction?: boolean;
}

interface Props {
  activeScreen: ScreenType;
  onChangeScreen: (screen: ScreenType) => void;
}

export const BottomNav: React.FC<Props> = ({ activeScreen, onChangeScreen }) => {
  const tabs: TabItem[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'history', label: 'History', icon: ListOrdered },
    { id: 'add', label: 'Log', icon: Plus, isAction: true },
    { id: 'routines', label: 'Routines', icon: ClipboardList },
    { id: 'progress', label: 'Progress', icon: TrendingUp },
    { id: 'setup', label: 'Settings', icon: Settings }
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] pt-1.5 shadow-2xl">
      <div className="max-w-md mx-auto grid grid-cols-6 items-center px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeScreen === tab.id;

          if (tab.isAction) {
            return (
              <div key={tab.id} className="flex justify-center -mt-5">
                <button
                  onClick={() => onChangeScreen('add')}
                  className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-orange-600 to-amber-400 text-white flex items-center justify-center shadow-lg shadow-orange-500/30 hover:scale-105 active:scale-95 transition"
                  aria-label="Log Workout"
                >
                  <Plus className="w-6 h-6 stroke-[2.5]" />
                </button>
              </div>
            );
          }

          return (
            <button
              key={tab.id}
              onClick={() => onChangeScreen(tab.id)}
              className={`flex flex-col items-center justify-center py-1 rounded-xl transition ${
                isActive
                  ? 'text-orange-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
              <span className="text-[10px] mt-0.5 tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
