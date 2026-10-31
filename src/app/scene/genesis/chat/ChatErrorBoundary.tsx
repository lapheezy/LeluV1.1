/**
 * LÉLU — the conversation's own error boundary.
 *
 * The generic Genesis boundary replaces whatever failed with a black
 * "GENESIS CRASH" box and nothing to press, which on a phone — where
 * the chat is the whole screen — is a dead app. A render error in the
 * chat is caught here instead: the real error is logged (console and
 * Sentinel, with the component stack), the user sees a plain sentence
 * and a way back, and "Reopen the conversation" mounts the chat fresh.
 * The conversation itself lives in MultiChatStore, so nothing is lost.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import Sentinel from "../../../../core/sentinel/Sentinel";
import { layer } from "../../../../core/ui/Layers";
import { thrownMessage } from "../thrownMessage";

interface Props {
  children: ReactNode;
  /** Leave the chat (go Home) instead of reopening it. */
  onLeave?: () => void;
}

interface State {
  failed: boolean;
  error: unknown;
  /** Bumped on reopen so the chat mounts fresh rather than re-rendering the broken tree. */
  generation: number;
}

export default class ChatErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null, generation: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[LÉLU chat] render error", error, info.componentStack);
    try {
      Sentinel.getInstance().error("chat_error", `Chat render error: ${thrownMessage(error)}`, "ChatErrorBoundary");
    } catch {
      // logging must not fail the fallback
    }
  }

  private reopen = (): void => {
    this.setState((current) => ({ failed: false, error: null, generation: current.generation + 1 }));
  };

  render(): ReactNode {
    if (!this.state.failed) {
      return <ChatGeneration key={this.state.generation}>{this.props.children}</ChatGeneration>;
    }
    return (
      <div
        role="alert"
        data-lelu-chat-error
        style={{
          position: "fixed",
          inset: 0,
          zIndex: layer("panel"),
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: "calc(env(safe-area-inset-top, 0px) + 24px) 24px calc(env(safe-area-inset-bottom, 0px) + 24px)",
          background: "linear-gradient(180deg, #1b1035, #2a1748)",
          color: "#f7f1ff",
          textAlign: "center",
          fontFamily: "inherit",
        }}
      >
        <strong style={{ fontSize: 17 }}>The conversation view hit a problem</strong>
        <span style={{ fontSize: 13.5, opacity: 0.75, maxWidth: 420 }}>
          Your messages are saved. Reopening the conversation rebuilds the view from them.
        </span>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={this.reopen} style={buttonStyle(true)}>
            Reopen the conversation
          </button>
          {this.props.onLeave ? (
            <button type="button" onClick={this.props.onLeave} style={buttonStyle(false)}>
              Go home
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}

/** A keyed wrapper, so a reopen is a fresh mount. */
function ChatGeneration({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function buttonStyle(primary: boolean) {
  return {
    border: "1px solid rgba(255,228,248,0.3)",
    borderRadius: 999,
    padding: "10px 18px",
    font: "inherit",
    fontSize: 14,
    color: "#f7f1ff",
    background: primary ? "rgba(168,120,255,0.35)" : "transparent",
    cursor: "pointer",
  } as const;
}
