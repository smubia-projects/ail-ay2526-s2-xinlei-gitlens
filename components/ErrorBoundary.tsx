import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-neutral-900 border border-red-500/20 rounded-3xl p-8 text-center shadow-2xl">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="text-red-500" size={32} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">Something went wrong</h2>
            <p className="text-neutral-400 text-sm mb-8 leading-relaxed">
              The application encountered an unexpected error. This might be due to a data parsing issue or a temporary service interruption.
            </p>
            <div className="bg-neutral-950/50 rounded-xl p-4 mb-8 text-left border border-white/10">
              <div className="text-[10px] font-bold text-neutral-500 uppercase mb-2 tracking-widest">Error Details</div>
              <div className="text-xs mono text-red-400/80 break-all">
                {this.state.error?.message || 'Unknown error'}
              </div>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-white hover:bg-neutral-200 text-black rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-white/20"
            >
              <RefreshCw size={18} />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
