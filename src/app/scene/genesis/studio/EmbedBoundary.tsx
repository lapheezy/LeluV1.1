/**
 * LÉLU — a boundary for one embedded viewer (an inline card or a Studio window).
 *
 * The viewers (Excalidraw, three.js, Mermaid, the film encoder) are lazy
 * chunks. Measured on the production build: a sketch made while offline
 * rendered its card, the editor's chunk could not be fetched, and the
 * failure reached the Genesis boundary — "GENESIS CRASH: Unable to preload
 * CSS for …/DrawingEditor.css" over the whole interface. A viewer that cannot
 * load now fails inside its own card: the artifact is saved (it lives in the
 * Studio store, not in the viewer), the person reads why, and Retry mounts
 * the viewer again once the code can be fetched.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode; label?: string }
interface State { error: string | null; attempt: number }

export default class EmbedBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn("[LÉLU] an embedded viewer failed to load", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error === null) return <div key={this.state.attempt} style={{ display: "contents" }}>{this.props.children}</div>;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const chunk = /preload|dynamically imported|Failed to fetch|Importing a module script/i.test(this.state.error);
    return (
      <div className="lst-note" role="status" data-lelu-embed-unavailable>
        {chunk
          ? `The ${this.props.label ?? "viewer"} isn't on this device yet${offline ? " and you're offline" : ""}. The artifact is saved; it opens once its viewer can load.`
          : `The ${this.props.label ?? "viewer"} hit an error: ${this.state.error.slice(0, 160)}. The artifact is saved.`}{" "}
        <button type="button" className="lst-btn ghost" onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>Retry</button>
      </div>
    );
  }
}
