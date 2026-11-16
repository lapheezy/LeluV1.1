/**
 * ==========================================================
 * LÉLU — THE ACTION QUEUE (in the conversation)
 *
 * A compact row of what this turn actually did, with the orb
 * sitting on the step that is running right now:
 *
 *   ✓ Search → ✓ Inspect → ● LÉLU → ○ Code
 *
 * Tapping it opens the execution view: every step, its real
 * status, how long it took, what it returned, the page it read,
 * and — while it is blocked — that it is waiting for YOU.
 *
 * Everything is read from the conversation's own queue
 * (ActionQueueStore), which is folded from real AgentEventBus
 * events routed by TurnOwnership. Switching conversations
 * switches the queue, because each one is keyed by its chat.
 *
 * Motion is CSS only and lives on the running node, so an idle
 * queue costs nothing; prefers-reduced-motion drops the orb's
 * pulse to a plain state change.
 * ==========================================================
 */

import { useSyncExternalStore, useState } from "react";
import { ChevronDown, ExternalLink, Loader2, X } from "lucide-react";
import ActionQueueStore from "../../../../core/multichat/ActionQueueStore";
import {
  ACTION_GLYPH,
  ACTION_KIND_LABEL,
  elapsedLabel,
  queueView,
  type QueueAction,
} from "../../../../core/multichat/ActionQueue";
import { dispatchBrowserGoto } from "../GenesisChatSurface";
import "./actionQueue.css";

const store = ActionQueueStore.getInstance();

function NodeMark({ action }: { action: QueueAction }) {
  if (action.status === "running" || action.status === "retrying") {
    // The orb: where LÉLU is in the queue, right now.
    return <span className="lelu-aq-orb" aria-hidden />;
  }
  if (action.status === "asking") {
    return <span className="lelu-aq-ask" aria-hidden>?</span>;
  }
  return (
    <span className="lelu-aq-mark" aria-hidden>
      {ACTION_GLYPH[action.status]}
    </span>
  );
}

export interface ChatActionQueueProps {
  conversationId: string;
}

export default function ChatActionQueue({ conversationId }: ChatActionQueueProps) {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const [open, setOpen] = useState(false);

  const queue = store.queueFor(conversationId);
  if (!queue) return null;
  const view = queueView(queue);
  const now = Date.now();

  return (
    <section
      className="lelu-aq"
      data-lelu-action-queue={queue.status}
      aria-label={`LÉLU's actions: ${view.headline}`}
    >
      <button
        type="button"
        className="lelu-aq-row"
        data-lelu-action-queue-toggle
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`lelu-aq-state is-${queue.status}`} data-lelu-action-queue-state>
          {view.live ? <Loader2 size={12} className="lelu-aq-spin" aria-hidden /> : null}
          {view.headline}
        </span>

        <span className="lelu-aq-track">
          {view.consumed > 0 ? <span className="lelu-aq-more">+{view.consumed}</span> : null}
          {view.trail.map((action) => (
            <span
              key={action.id}
              className={`lelu-aq-node is-${action.status} kind-${action.kind}`}
              data-lelu-action={action.id}
              data-lelu-action-status={action.status}
              data-lelu-action-kind={action.kind}
              title={`${action.label}${action.detail ? ` — ${action.detail}` : ""}`}
            >
              <NodeMark action={action} />
              <span className="lelu-aq-label">{action.label}</span>
            </span>
          ))}
          {view.live ? (
            // There is more work coming, but its name is not known yet — so it
            // is a placeholder, never a fabricated step.
            <span className="lelu-aq-next" aria-hidden>···</span>
          ) : null}
        </span>

        <ChevronDown size={14} className="lelu-aq-chevron" style={{ transform: open ? "rotate(180deg)" : undefined }} aria-hidden />
      </button>

      {open ? (
        <div className="lelu-aq-body" data-lelu-action-queue-detail>
          <ol className="lelu-aq-list">
            {queue.actions.map((action) => (
              <li key={action.id} className={`is-${action.status}`} data-lelu-action-row={action.id}>
                <span className="lelu-aq-row-mark">
                  <NodeMark action={action} />
                </span>
                <span className="lelu-aq-row-text">
                  <span className="lelu-aq-row-label">
                    <em>{ACTION_KIND_LABEL[action.kind]}</em>
                    {action.label}
                  </span>
                  {action.detail ? <small>{action.detail}</small> : null}
                  <span className="lelu-aq-row-meta">
                    {action.status === "asking" ? "waiting for your answer" : action.status}
                    {action.count !== undefined ? ` · ${action.count} result${action.count === 1 ? "" : "s"}` : ""}
                    {action.progress !== undefined ? ` · ${Math.round(action.progress)}%` : ""}
                    {action.startedAt ? ` · ${elapsedLabel(action, now)}` : ""}
                  </span>
                  {action.url ? (
                    <button
                      type="button"
                      className="lelu-aq-link"
                      onClick={() => dispatchBrowserGoto(action.url as string)}
                      title="Open this page in LÉLU's browser panel"
                    >
                      <ExternalLink size={11} aria-hidden /> {action.url.replace(/^https?:\/\//, "")}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
          <div className="lelu-aq-foot">
            <span>
              {view.completed} done{view.failed ? ` · ${view.failed} failed` : ""}
            </span>
            {!view.live ? (
              <button
                type="button"
                className="lelu-aq-dismiss"
                aria-label="Hide this action trail"
                onClick={() => {
                  store.clear(conversationId);
                  setOpen(false);
                }}
              >
                <X size={12} aria-hidden /> Hide
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
