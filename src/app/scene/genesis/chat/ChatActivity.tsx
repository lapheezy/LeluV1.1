/**
 * ==========================================================
 * LÉLU — ACTIVITY CARD (in the conversation)
 *
 * "🔎 Web research · 3 searches · 12 sources found · 2 of 3
 * pages read" with the step running right now, and — expanded
 * — every step, the page she is reading in a small browser
 * view, and the sources. Everything comes from the turn's
 * recorded events (chatActivity.ts); nothing is animated that
 * did not happen.
 * ==========================================================
 */

import { memo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ExternalLink, Globe, Loader2, Lock, PanelRight } from "lucide-react";
import { dispatchBrowserGoto } from "../GenesisChatSurface";
import { summarizeActivity, type ActivityPage, type ActivityStep, type ChatActivity } from "../../../../core/multichat/TurnActivity";

const STEP_ICON: Record<ActivityStep["kind"], string> = {
  search: "🔎",
  browse: "🌐",
  memory: "🧠",
  tool: "⚙️",
  agent: "🤝",
  narration: "💬",
  steer: "↪️",
  provider: "🔁",
  reference: "🔗",
};

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function StepStatus({ status }: { status: ActivityStep["status"] }) {
  if (status === "running") return <Loader2 size={14} className="lelu-cc-spin" aria-label="in progress" />;
  if (status === "failed") return <AlertTriangle size={14} className="lelu-cc-act-failed" aria-label="failed" />;
  if (status === "done") return <Check size={14} className="lelu-cc-act-done" aria-label="done" />;
  return <span aria-hidden className="lelu-cc-act-dot" />;
}

/** The page LÉLU opened, as she read it: address, title, extracted text. */
function BrowserView({ page }: { page: ActivityPage }) {
  const [more, setMore] = useState(false);
  return (
    <figure className="lelu-cc-browser" aria-label={`Page: ${page.title ?? page.url}`} data-lelu-browser-view={page.status}>
      <div className="lelu-cc-browser-bar">
        <span className="lelu-cc-browser-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="lelu-cc-browser-address" title={page.url}>
          <Lock size={11} aria-hidden /> {page.url.replace(/^https?:\/\//, "")}
        </span>
        <span className={`lelu-cc-browser-state is-${page.status}`}>
          {page.status === "loading" ? "Opening…" : page.status === "read" ? "Read" : page.status === "blocked" ? "Blocked" : "Failed"}
        </span>
      </div>
      {page.status === "loading" ? <div className="lelu-cc-browser-progress" aria-hidden /> : null}
      <div className="lelu-cc-browser-body">
        <strong>{page.title?.trim() || host(page.url)}</strong>
        {page.excerpt ? (
          <p className={more ? "" : "is-clamped"}>{page.excerpt}</p>
        ) : page.status === "loading" ? (
          <p className="is-muted">Reading the page…</p>
        ) : page.error ? (
          <p className="is-muted">{page.error}</p>
        ) : null}
        <div className="lelu-cc-browser-actions">
          {page.excerpt && page.excerpt.length > 260 ? (
            <button type="button" className="lelu-cc-chip" onClick={() => setMore((v) => !v)} aria-expanded={more}>
              {more ? "Less" : "More of what she read"}
            </button>
          ) : null}
          <button type="button" className="lelu-cc-chip" onClick={() => dispatchBrowserGoto(page.url)} title="Open this page in LÉLU's browser panel">
            <PanelRight size={13} aria-hidden /> Open in LÉLU's browser
          </button>
          <a className="lelu-cc-chip" href={page.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} aria-hidden /> Original
          </a>
        </div>
      </div>
    </figure>
  );
}

function ChatActivityCardImpl({ activity }: { activity: ChatActivity }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeActivity(activity);
  const running = activity.status === "running";
  // The page being read right now is shown even when collapsed: watching
  // her browse should not need a click.
  const livePage = running ? [...activity.pages].reverse().find((page) => page.status === "loading" || page.status === "read") : undefined;
  const lastPage = activity.pages.at(-1);

  return (
    <section className="lelu-cc-activity-card" data-lelu-activity={activity.status} aria-label={`${summary.title}: ${summary.facts.join(", ")}`}>
      <button type="button" className="lelu-cc-activity-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="lelu-cc-activity-icon" aria-hidden>
          {summary.icon}
        </span>
        <span className="lelu-cc-activity-title">
          <strong>{summary.title}</strong>
          <span>{summary.facts.length ? summary.facts.join(" · ") : running ? "starting…" : "no tools used"}</span>
        </span>
        <span className={`lelu-cc-activity-state is-${activity.status}`}>
          {running ? <Loader2 size={14} className="lelu-cc-spin" aria-hidden /> : activity.status === "failed" || summary.issues ? <AlertTriangle size={14} aria-hidden /> : <Check size={14} aria-hidden />}
          {running ? "Working" : summary.issues ? `${summary.issues} issue${summary.issues === 1 ? "" : "s"}` : "Done"}
        </span>
        <ChevronDown size={16} className="lelu-cc-activity-chevron" style={{ transform: open ? "rotate(180deg)" : undefined }} aria-hidden />
      </button>

      {!open && running && summary.current ? (
        <div className="lelu-cc-activity-now" role="status" aria-live="polite">
          <Loader2 size={13} className="lelu-cc-spin" aria-hidden /> {summary.current}
        </div>
      ) : null}
      {!open && livePage ? <BrowserView page={livePage} /> : null}

      {open ? (
        <div className="lelu-cc-activity-body">
          <ol className="lelu-cc-activity-steps">
            {activity.steps.map((step) => (
              <li key={step.id} className={`is-${step.status} kind-${step.kind}`}>
                <span className="lelu-cc-activity-step-icon" aria-hidden>
                  {STEP_ICON[step.kind]}
                </span>
                <span className="lelu-cc-activity-step-text">
                  <span>{step.label}</span>
                  {step.count !== undefined && step.kind === "search" ? <em>{step.count} result{step.count === 1 ? "" : "s"}</em> : null}
                  {step.detail && step.status === "failed" ? <small>{step.detail}</small> : null}
                  {step.url ? (
                    <a href={step.url} target="_blank" rel="noopener noreferrer">
                      {host(step.url)}
                    </a>
                  ) : null}
                </span>
                <StepStatus status={step.status} />
              </li>
            ))}
          </ol>
          {lastPage ? <BrowserView page={livePage ?? lastPage} /> : null}
          {activity.pages.length > 1 ? (
            <div className="lelu-cc-activity-pages">
              {activity.pages.map((page) => (
                <a key={page.url} href={page.url} target="_blank" rel="noopener noreferrer" className={`is-${page.status}`}>
                  <Globe size={12} aria-hidden /> {page.title?.trim() || host(page.url)}
                </a>
              ))}
            </div>
          ) : null}
          {activity.sources.length ? (
            <details className="lelu-cc-activity-sources">
              <summary>Sources ({activity.sources.length})</summary>
              <ul>
                {activity.sources.map((source, index) => (
                  <li key={`${source.url ?? source.title}-${index}`}>
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noopener noreferrer">
                        {source.title}
                      </a>
                    ) : (
                      <span>{source.title}</span>
                    )}
                    {source.source ? <em>{source.source}</em> : null}
                    {source.excerpt ? <p>{source.excerpt}</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const ChatActivityCard = memo(ChatActivityCardImpl);
export default ChatActivityCard;
