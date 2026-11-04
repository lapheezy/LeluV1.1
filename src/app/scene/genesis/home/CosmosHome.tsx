/**
 * ==========================================================
 * LÉLU HOME — THE COSMOS WORKSPACE
 *
 * The home of the app, painted ON the live Cosmos (the scene keeps
 * rendering behind these glass surfaces; nothing here hides it):
 *
 *   header        menu · LÉLU identity · cloud · notifications · Cosmos
 *   hero          weather (Open-Meteo) · LÉLU herself (her 3D face, the
 *                 companion's hero presence) · what she is doing now
 *   apps          Chat · Browser · Studio · Workspaces · Agents · Files
 *   workspaces    the windows you left (resumable) and your projects
 *   notifications · app library (every registered panel, by group)
 *   activity      her live work: task, action, tool, voice
 *
 * Every entry opens an EXISTING panel through GenesisCore.openPanel;
 * every number and line is read from the system that owns it.
 * ==========================================================
 */

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import * as Icons from "lucide-react";
import { useGenesis, type GenesisPanel } from "../GenesisCore";
import { useLeluActivity, ACTIVITY_ACCENT, type LeluActivity } from "../avatar/leluActivity";
import { APPS, GROUPS, PRIMARY, appFor, type AppGroup } from "./homeCatalog";
import HomeStore from "./homeStore";
import { useCloud, useExecutive, useHomeStore, useNotifications, useProjects, useWeather } from "./useHomeLive";
import { describeWeather } from "./homeWeather";
import { launch, restoreLayout } from "./homeActions";
import "./cosmosHome.css";

type IconName = keyof typeof Icons;

export function HomeIcon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  const Icon = (Icons[name as IconName] ?? Icons.Circle) as unknown as (props: { size?: number; style?: CSSProperties; strokeWidth?: number; "aria-hidden"?: boolean }) => ReactNode;
  return <Icon size={size} style={style} strokeWidth={1.7} aria-hidden />;
}

const ACTIVITY_WORDS: Record<LeluActivity, string> = {
  IDLE: "Here with you",
  LISTENING: "Listening",
  THINKING: "Thinking",
  SPEAKING: "Speaking",
  PRESENTING: "Presenting",
  SEARCHING: "Researching",
  BROWSING: "Browsing",
  WORKING: "Working",
  BUILDING: "Building",
  RENDERING: "Rendering",
  EXPLORING: "Exploring",
  COMPLETED: "Finished",
  ERROR: "Hit a problem",
};

function weatherIcon(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? "Sun" : "Moon";
  if (code <= 2) return isDay ? "CloudSun" : "Cloud";
  if (code === 3) return "Cloud";
  if (code === 45 || code === 48) return "CloudFog";
  if (code >= 51 && code <= 57) return "CloudDrizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "CloudRain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "CloudSnow";
  if (code >= 95) return "CloudLightning";
  return "Cloud";
}

function ago(timestamp: number): string {
  const s = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

const NOTE_ICON: Record<string, string> = {
  question: "MessageCircle",
  reply: "MessageCircle",
  failure: "CircleAlert",
  approval: "Check",
  proactive: "Sparkles",
  info: "FileText",
};

export default function CosmosHome({ onOpenLibrary, onOpenWindows }: { onOpenLibrary: (group?: AppGroup) => void; onOpenWindows: () => void }) {
  const genesis = useGenesis();
  const activity = useLeluActivity();
  const accent = ACTIVITY_ACCENT[activity];
  const exec = useExecutive();
  const notes = useNotifications();
  const projects = useProjects();
  const cloud = useCloud();
  const home = useHomeStore();
  const { weather, error: weatherError, needsPlace, locate } = useWeather();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const open = (id: GenesisPanel, from?: Element | null) => launch(genesis, id, from ?? null);

  // Active workspaces: the windows you left (resumable), then your projects.
  const left = home.layout ? Object.entries(home.layout.modules) : [];
  const activeProjects = projects.filter((p) => p.status === "active").sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const [slide, setSlide] = useState(0);
  const slides = left.length + activeProjects.length;

  const working = exec.taskStatus === "running" && exec.currentTask;
  const nowTitle = working ? exec.currentTask!.label : exec.currentGoal || ACTIVITY_WORDS[activity];
  const nowLine = working ? exec.currentAction || "Working on it" : exec.ambientBehavior || (exec.previousTask ? `Last: ${exec.previousTask.label}` : "Ready when you are");
  const cloudOn = cloud.status === "connected" && Boolean(cloud.session);

  const activityTitle = working ? `LÉLU — ${exec.currentTask!.label}` : `LÉLU — ${ACTIVITY_WORDS[activity]}`;
  const activityLine = [
    exec.pendingApprovals > 0 ? `${exec.pendingApprovals} waiting for your approval` : null,
    exec.browserLastUrl && (activity === "BROWSING" || activity === "SEARCHING") ? safeHost(exec.browserLastUrl) : null,
    working ? exec.currentAction : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const voiceLive = activity === "SPEAKING" || activity === "LISTENING" || Boolean(working);

  const primary = useMemo(() => PRIMARY.map((id) => (id === "workspaces" ? { id, label: "Workspaces", icon: "Layers" } : { id, label: appFor(id)!.label, icon: appFor(id)!.icon })), []);

  return (
    <>
    {/* The Cosmos stays alive behind; this haze only quiets it, like the
        reference's atmosphere — no labels of the scene fighting the text. */}
    <div className="lch-scrim" aria-hidden />
    <div ref={rootRef} className="lch" data-lelu-home role="main" aria-label="LÉLU home">
      <header className="lch-header">
        <button type="button" className="lch-round" aria-label="Open the app library" onClick={() => onOpenLibrary()}>
          <HomeIcon name="Menu" />
        </button>
        <div className="lch-brand">
          <span className="lch-brand-name">
            LÉLU<sup>+</sup>
          </span>
          <span className="lch-brand-sub">Workspace</span>
        </div>
        <div className="lch-header-right">
          <button
            type="button"
            className="lch-round"
            aria-label={cloudOn ? `Cloud sync on${cloud.email ? ` — ${cloud.email}` : ""}` : "Cloud sync off — open settings"}
            title={cloudOn ? "Cloud sync on" : "Cloud sync off"}
            onClick={(e) => open("settings", e.currentTarget)}
          >
            <HomeIcon name={cloudOn ? "Cloud" : "CloudOff"} />
            <span className="lch-dot" data-on={cloudOn ? "true" : "false"} />
          </button>
          <button type="button" className="lch-round" aria-label={`Notifications${notes.unread ? `, ${notes.unread} unread` : ""}`} onClick={(e) => open("notifications", e.currentTarget)}>
            <HomeIcon name="Bell" />
            {notes.unread ? <span className="lch-badge">{notes.unread > 9 ? "9+" : notes.unread}</span> : null}
          </button>
          <button type="button" className="lch-round lch-cosmos" aria-label="Look at the Cosmos" title="Look at the Cosmos" onClick={() => HomeStore.setImmersive(true)}>
            <span className="lch-cosmos-core" />
          </button>
        </div>
      </header>

      <section className="lch-hero">
        <button type="button" className="lch-glass lch-weather" onClick={needsPlace ? locate : undefined} aria-label={weather ? `${weather.place}, ${weather.temperatureC} degrees, ${describeWeather(weather.code)}` : "Weather"}>
          {weather ? (
            <>
              <span className="lch-weather-place">
                {weather.place} <HomeIcon name="Navigation" size={12} />
              </span>
              <span className="lch-weather-temp">{weather.temperatureC}°</span>
              <span className="lch-weather-icon">
                <HomeIcon name={weatherIcon(weather.code, weather.isDay)} size={38} />
              </span>
              <span className="lch-weather-line">{weather.outlook}</span>
              <span className="lch-bars" aria-hidden>
                {Array.from({ length: 18 }, (_, i) => {
                  const p = weather.nextHours[Math.min(weather.nextHours.length - 1, Math.floor((i / 18) * weather.nextHours.length))] ?? 0;
                  return <i key={i} style={{ height: `${18 + p * 0.7}%`, opacity: 0.35 + p / 160 }} />;
                })}
              </span>
            </>
          ) : needsPlace ? (
            <>
              <span className="lch-weather-place">Weather</span>
              <span className="lch-weather-line">
                <HomeIcon name="MapPin" size={14} /> Use my location
              </span>
            </>
          ) : (
            <>
              <span className="lch-weather-place">Weather</span>
              <span className="lch-weather-line">{weatherError ? "Unavailable right now" : "Loading…"}</span>
            </>
          )}
        </button>

        {/* LÉLU herself: the companion paints her 3D face here (hero presence). */}
        <div className="lch-hero-lelu" data-lelu-hero-host aria-hidden />

        <button type="button" className="lch-glass lch-now" onClick={(e) => open("chat", e.currentTarget)} aria-label="What LÉLU is doing — open chat">
          <span className="lch-now-label">
            <span className="lch-live" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
            {working ? "Working on" : "Now"}
          </span>
          <span className="lch-now-title">{nowTitle}</span>
          <span className="lch-now-line">{nowLine}</span>
          <span className="lch-progress">
            <i style={{ width: working ? "62%" : exec.taskStatus === "completed" ? "100%" : "18%", background: accent }} data-running={working ? "true" : "false"} />
          </span>
        </button>
      </section>

      <nav className="lch-glass lch-apps" aria-label="Apps">
        {primary.map((app) => (
          <button
            key={app.id}
            type="button"
            className="lch-app"
            data-primary={app.id === "chat" ? "true" : "false"}
            data-open={app.id !== "workspaces" && genesis.state.activePanel === app.id ? "true" : "false"}
            onClick={(e) => (app.id === "workspaces" ? onOpenWindows() : open(app.id as GenesisPanel, e.currentTarget))}
          >
            <HomeIcon name={app.icon} size={24} />
            <span>{app.label}</span>
          </button>
        ))}
      </nav>

      <section className="lch-glass lch-workspaces" aria-label="Active workspaces">
        <div className="lch-section-head">
          <HomeIcon name="Layers" size={18} />
          <span>Active Workspaces</span>
          {left.length ? (
            <button type="button" className="lch-icon-btn" aria-label="Restore the windows you left" title="Restore windows" onClick={() => restoreLayout(genesis)}>
              <HomeIcon name="Maximize2" size={15} />
            </button>
          ) : null}
        </div>
        {slides ? (
          <>
            <div
              className="lch-cards"
              onScroll={(e) => {
                const el = e.currentTarget;
                setSlide(Math.round(el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth) * Math.max(0, slides - 1)));
              }}
            >
              {left.map(([id, mod]) => {
                const app = appFor(id);
                const live = mod.status === "active" || mod.status === "loading";
                return (
                  <button key={`w-${id}`} type="button" className="lch-card" data-kind="window" onClick={(e) => open(id as GenesisPanel, e.currentTarget)}>
                    <span className="lch-card-art" data-group={app?.group ?? "system"}>
                      <HomeIcon name={app?.icon ?? "AppWindow"} size={30} />
                    </span>
                    <span className="lch-card-name">{app?.label ?? id}</span>
                    {live ? <span className="lch-chip">Live</span> : <span className="lch-chip lch-chip-muted">{mod.status === "attention" ? "Needs you" : mod.status === "failed" ? "Failed" : "Resume"}</span>}
                  </button>
                );
              })}
              {activeProjects.map((project) => (
                <button key={`p-${project.id}`} type="button" className="lch-card" data-kind="project" onClick={(e) => open("projects", e.currentTarget)}>
                  <span className="lch-card-art" data-group="business">
                    <HomeIcon name="Folder" size={30} />
                  </span>
                  <span className="lch-card-name">{project.name}</span>
                  <span className="lch-chip lch-chip-muted">{project.items.length} item{project.items.length === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
            {slides > 1 ? (
              <div className="lch-pager" aria-hidden>
                {Array.from({ length: Math.min(slides, 6) }, (_, i) => (
                  <i key={i} data-on={i === Math.min(slide, 5) ? "true" : "false"} />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="lch-empty">Nothing open yet. Start in Chat, Browser or Studio — what you leave open comes back here.</p>
        )}
      </section>

      <div className="lch-pair">
        <section className="lch-glass lch-notes" aria-label="Notifications">
          <button type="button" className="lch-section-head lch-link" onClick={(e) => open("notifications", e.currentTarget)}>
            <HomeIcon name="Bell" size={18} />
            <span>Notifications</span>
            {notes.unread ? <span className="lch-count">{notes.unread}</span> : null}
            <HomeIcon name="ChevronRight" size={16} style={{ marginLeft: "auto" }} />
          </button>
          {notes.recent.length ? (
            <ul>
              {notes.recent.map((n) => (
                <li key={n.id} data-read={n.read ? "true" : "false"}>
                  <span className="lch-note-icon" data-type={n.type ?? "info"}>
                    <HomeIcon name={NOTE_ICON[n.type ?? "info"] ?? "FileText"} size={16} />
                  </span>
                  <span className="lch-note-text">
                    <strong>{n.title}</strong>
                    {n.body ? <small>{n.body}</small> : null}
                  </span>
                  <time>{ago(n.timestamp)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lch-empty">You're all caught up.</p>
          )}
        </section>

        <section className="lch-glass lch-library" aria-label="App library">
          <button type="button" className="lch-section-head lch-link" onClick={() => onOpenLibrary()}>
            <HomeIcon name="LayoutGrid" size={18} />
            <span>App Library</span>
            <HomeIcon name="ChevronRight" size={16} style={{ marginLeft: "auto" }} />
          </button>
          <div className="lch-groups">
            {GROUPS.filter((g) => g.id !== "system").map((group) => (
              <button key={group.id} type="button" className="lch-group" data-group={group.id} onClick={() => onOpenLibrary(group.id)}>
                <HomeIcon name={group.icon} size={22} />
                <span>{group.label}</span>
                <small>{APPS.filter((a) => a.group === group.id).length}</small>
              </button>
            ))}
          </div>
        </section>
      </div>

      <button type="button" className="lch-glass lch-activity" style={{ ["--accent" as string]: accent }} onClick={(e) => open(working ? "cognitive-trace" : "chat", e.currentTarget)} aria-label={`${activityTitle}${activityLine ? `. ${activityLine}` : ""}`}>
        <span className="lch-activity-orb" aria-hidden />
        <span className="lch-activity-text">
          <strong>{activityTitle}</strong>
          <small>{activityLine || exec.nextPlannedAction || (exec.currentMode === "ambient" ? "Tending her world" : "Ask her anything")}</small>
        </span>
        <span className="lch-wave" data-live={voiceLive ? "true" : "false"} aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${(i % 7) * 90}ms` }} />
          ))}
        </span>
      </button>
    </div>
    </>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 40);
  }
}
