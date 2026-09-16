import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React render error:', error, errorInfo);
  }

  private handleResetToHome = () => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('mygym_active_screen');
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  };

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mb-4 border border-rose-500/30">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
          <p className="text-xs text-slate-400 max-w-xs mb-6 leading-relaxed">
            An unexpected error occurred while rendering this screen. Your logged workouts in IndexedDB are safe.
          </p>
          <div className="w-full max-w-xs space-y-2.5">
            <button
              onClick={this.handleResetToHome}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-tr from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-lg shadow-orange-500/20"
            >
              <Home className="w-4 h-4" /> Go to Home Screen
            </button>
            <button
              onClick={this.handleReload}
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold py-2.5 px-4 rounded-xl text-xs transition"
            >
              <RotateCcw className="w-4 h-4" /> Reload Page
            </button>
          </div>
          {this.state.error && (
            <div className="mt-6 p-3 bg-slate-900 border border-slate-800 rounded-xl text-left max-w-xs w-full overflow-hidden">
              <p className="text-[10px] font-mono text-rose-400 truncate">
                {this.state.error.name}: {this.state.error.message}
              </p>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
