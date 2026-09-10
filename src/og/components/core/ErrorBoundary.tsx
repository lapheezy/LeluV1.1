import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportLovableError } from "@og/lib/lovable-error-reporting";

type Props = {
  children: ReactNode;
  fallback?: (err: Error, reset: () => void) => ReactNode;
  label?: string;
};
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportLovableError(error, {
      boundary: this.props.label ?? "ErrorBoundary",
      componentStack: info.componentStack,
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="m-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
        <div className="font-medium">Something broke here.</div>
        <div className="mt-1 opacity-80">{error.message}</div>
        <button
          onClick={this.reset}
          className="mt-3 rounded bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] hover:bg-white/20"
        >
          Try again
        </button>
      </div>
    );
  }
}