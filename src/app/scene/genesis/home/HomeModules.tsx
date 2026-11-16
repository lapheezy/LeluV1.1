/**
 * ==========================================================
 * LÉLU HOME — THE EIGHT LIVE MODULES
 *
 * The Home's surfaces, each a self-contained component that
 * reads its own data from the system that owns it (executive,
 * notifications, projects, weather, HomeStore). Any composition
 * — the live Home or a Design Studio preview — renders these
 * same components, so a prototype shows real content.
 *
 * `preview` disables side effects that must exist once only:
 * the LÉLU hero host (the companion paints her 3D face into the
 * one `[data-lelu-hero-host]`), and launching panels.
 * ==========================================================
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity, AppWindow, Aperture, BarChart3, Bell, BookOpen, Box, Brain, Check, ChevronDown, ChevronRight, ChevronUp,
  Circle, CircleAlert, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudOff, CloudRain, CloudSnow, CloudSun, Code2,
  Compass, Copy, Crown, Eye, EyeOff, FileText, Film, Fingerprint, Flower2, Folder, Gauge, Globe2, GripVertical, History,
  Home, Layers, Layers3, LayoutGrid, Lightbulb, Lock, LockOpen, MapPin, Maximize2, Menu, MessageCircle, Minimize2, Minus,
  Monitor, Moon, Navigation, Newspaper, Orbit, PanelBottom, PenLine, Pencil, Pin, Plus, Redo2, RotateCcw, ScrollText,
  Search, Settings, Settings2, Smartphone, Sparkles, Sun, Tablet, Undo2, UserRound, Workflow, X,
  Wand2, Palette, Type, Shuffle, Combine, GitMerge, BookMarked, NotebookPen, Flame, Droplets, Snowflake, Save, Trash2, Star,
} from "lucide-react";
import { useGenesis, type GenesisPanel } from "../GenesisCore";
import { useLeluActivity, ACTIVITY_ACCENT, type LeluActivity } from "../avatar/leluActivity";
import { APPS, GROUPS, PRIMARY, appFor, type AppGroup } from "./homeCatalog";
import { useExecutive, useHomeStore, useNotifications, useProjects, useWeather } from "./useHomeLive";
import { describeWeather } from "./homeWeather";
import { launch, restoreLayout } from "./homeActions";
import PlaceInWorldButton from "../spatial/PlaceInWorldButton";
import type { HomeModuleId } from "./homeComposition";

/*
 * Only the icons the Home can actually ask for — a named set a bundler can
 * shake (a namespace import once put all of lucide, 733 KB, on the boot path).
 * Mission 15: the set now includes every name the Home really uses; before,
 * Menu, X, Search, ChevronRight and all the weather icons fell back to Circle.
 */
const HOME_ICONS = {
  Activity, AppWindow, Aperture, BarChart3, Bell, BookOpen, Box, Brain, Check, ChevronDown, ChevronRight, ChevronUp,
  Circle, CircleAlert, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudOff, CloudRain, CloudSnow, CloudSun, Code2,
  Compass, Copy, Crown, Eye, EyeOff, FileText, Film, Fingerprint, Flower2, Folder, Gauge, Globe2, GripVertical, History,
  Home, Layers, Layers3, LayoutGrid, Lightbulb, Lock, LockOpen, MapPin, Maximize2, Menu, MessageCircle, Minimize2, Minus,
  Monitor, Moon, Navigation, Newspaper, Orbit, PanelBottom, PenLine, Pencil, Pin, Plus, Redo2, RotateCcw, ScrollText,
  Search, Settings, Settings2, Smartphone, Sparkles, Sun, Tablet, Undo2, UserRound, Workflow, X,
  Wand2, Palette, Type, Shuffle, Combine, GitMerge, BookMarked, NotebookPen, Flame, Droplets, Snowflake, Save, Trash2, Star,
} as const;

type IconName = keyof typeof HOME_ICONS;

export function HomeIcon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  const Icon = (HOME_ICONS[name as IconName] ?? Circle) as unknown as (props: { size?: number; style?: CSSProperties; strokeWidth?: number; "aria-hidden"?: boolean }) => ReactNode;
  return <Icon size={size} style={style} strokeWidth={1.7} aria-hidden />;
}

export const ACTIVITY_WORDS: Record<LeluActivity, string> = {
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

export function weatherIcon(code: number, isDay: boolean): string {
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

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 40);
  }
}

const NOTE_ICON: Record<string, string> = {
  question: "MessageCircle",
  reply: "MessageCircle",
  failure: "CircleAlert",
  approval: "Check",
  proactive: "Sparkles",
  info: "FileText",
};

export interface HomeModuleProps {
  preview?: boolean;
  onOpenLibrary?: (group?: AppGroup) => void;
  onOpenWindows?: () => void;
}

/** Open a panel — the one launcher the Home always used; inert in previews. */
function useOpen(preview?: boolean) {
  const genesis = useGenesis();
  return (id: GenesisPanel, from?: Element | null) => {
    if (!preview) launch(genesis, id, from ?? null);
  };
}

/** The live signals the Home needs (work, approvals) — one place, shared. */
export function useHomeSignals() {
  const exec = useExecutive();
  const notes = useNotifications();
  const home = useHomeStore();
  const working = exec.taskStatus === "running" && Boolean(exec.currentTask);
  return {
    working,
    unread: notes.unread,
    approvals: exec.pendingApprovals,
    openWindows: home.layout ? Object.keys(home.layout.modules).length : 0,
  };
}

function WeatherModule({ preview }: HomeModuleProps) {
  const { weather, error, needsPlace, locate } = useWeather();
  return (
    <button type="button" className="lch-glass lch-weather" onClick={needsPlace && !preview ? locate : undefined} aria-label={weather ? `${weather.place}, ${weather.temperatureC} degrees, ${describeWeather(weather.code)}` : "Weather"}>
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
          <span className="lch-weather-line">{error ? "Unavailable right now" : "Loading…"}</span>
        </>
      )}
    </button>
  );
}

/** LÉLU herself. Live: the companion's 3D face lands on the hero host; a
    CSS presence (no WebGL) shows until — or instead of — it. */
function LeluModule({ preview }: HomeModuleProps) {
  const activity = useLeluActivity();
  const accent = ACTIVITY_ACCENT[activity];
  return (
    <div className="lch-lelu" style={{ ["--accent" as string]: accent }}>
      <span className="lch-lelu-aura" aria-hidden />
      <span className="lch-lelu-orb" aria-hidden />
      {preview ? null : <div className="lch-hero-lelu" data-lelu-hero-host aria-hidden />}
      <span className="lch-lelu-name">
        LÉLU <small>{ACTIVITY_WORDS[activity]}</small>
      </span>
    </div>
  );
}

function NowModule({ preview }: HomeModuleProps) {
  const exec = useExecutive();
  const activity = useLeluActivity();
  const accent = ACTIVITY_ACCENT[activity];
  const open = useOpen(preview);
  const working = exec.taskStatus === "running" && exec.currentTask;
  const nowTitle = working ? exec.currentTask!.label : exec.currentGoal || ACTIVITY_WORDS[activity];
  const nowLine = working ? exec.currentAction || "Working on it" : exec.ambientBehavior || (exec.previousTask ? `Last: ${exec.previousTask.label}` : "Ready when you are");
  return (
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
  );
}

function AppsModule({ preview, onOpenWindows }: HomeModuleProps) {
  const genesis = useGenesis();
  const open = useOpen(preview);
  const primary = useMemo(() => PRIMARY.map((id) => (id === "workspaces" ? { id, label: "Workspaces", icon: "Layers" } : { id, label: appFor(id)!.label, icon: appFor(id)!.icon })), []);
  return (
    <nav className="lch-glass lch-apps" aria-label="Apps">
      {primary.map((app) => (
        <button
          key={app.id}
          type="button"
          className="lch-app"
          data-primary={app.id === "chat" ? "true" : "false"}
          data-open={app.id !== "workspaces" && genesis.state.activePanel === app.id ? "true" : "false"}
          onClick={(e) => (preview ? undefined : app.id === "workspaces" ? onOpenWindows?.() : open(app.id as GenesisPanel, e.currentTarget))}
        >
          <HomeIcon name={app.icon} size={24} />
          <span>{app.label}</span>
        </button>
      ))}
    </nav>
  );
}

function WorkspacesModule({ preview }: HomeModuleProps) {
  const genesis = useGenesis();
  const home = useHomeStore();
  const projects = useProjects();
  const open = useOpen(preview);
  const left = home.layout ? Object.entries(home.layout.modules) : [];
  const activeProjects = projects.filter((p) => p.status === "active").sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const placeableName = activeProjects[0]?.name ?? (left[0] ? appFor(left[0][0])?.label ?? left[0][0] : "Workspace");
  const [slide, setSlide] = useState(0);
  const slides = left.length + activeProjects.length;
  return (
    <section className="lch-glass lch-workspaces" aria-label="Active workspaces">
      <div className="lch-section-head">
        <HomeIcon name="Layers" size={18} />
        <span>Active Workspaces</span>
        {preview ? null : (
          <PlaceInWorldButton
            name={placeableName}
            kind="box"
            color="#a78bfa"
            scale={0.8}
            label="Place in world"
            buttonStyle={{
              border: "1px solid rgba(185, 140, 255, 0.42)",
              background: "rgba(124, 92, 255, 0.22)",
              color: "#e9d5ff",
              borderRadius: 999,
              padding: "3px 9px",
              fontSize: 10.5,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          />
        )}
        {left.length && !preview ? (
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
              setSlide(Math.round((el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth)) * Math.max(0, slides - 1)));
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
                <span className="lch-chip lch-chip-muted">
                  {project.items.length} item{project.items.length === 1 ? "" : "s"}
                </span>
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
  );
}

function NotificationsModule({ preview }: HomeModuleProps) {
  const notes = useNotifications();
  const open = useOpen(preview);
  return (
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
  );
}

function LibraryModule({ preview, onOpenLibrary }: HomeModuleProps) {
  const go = (group?: AppGroup) => (preview ? undefined : onOpenLibrary?.(group));
  return (
    <section className="lch-glass lch-library" aria-label="Infinite Library">
      <button type="button" className="lch-section-head lch-link" onClick={() => go()}>
        <HomeIcon name="LayoutGrid" size={18} />
        <span>Infinite Library</span>
        <HomeIcon name="ChevronRight" size={16} style={{ marginLeft: "auto" }} />
      </button>
      <div className="lch-groups">
        {GROUPS.filter((g) => g.id !== "system").map((group) => (
          <button key={group.id} type="button" className="lch-group" data-group={group.id} onClick={() => go(group.id)}>
            <HomeIcon name={group.icon} size={22} />
            <span>{group.label}</span>
            <small>{APPS.filter((a) => a.group === group.id).length}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ActivityModule({ preview }: HomeModuleProps) {
  const exec = useExecutive();
  const activity = useLeluActivity();
  const accent = ACTIVITY_ACCENT[activity];
  const open = useOpen(preview);
  const working = exec.taskStatus === "running" && exec.currentTask;
  const activityTitle = working ? `LÉLU — ${exec.currentTask!.label}` : `LÉLU — ${ACTIVITY_WORDS[activity]}`;
  const activityLine = [
    exec.pendingApprovals > 0 ? `${exec.pendingApprovals} waiting for your approval` : null,
    exec.browserLastUrl && (activity === "BROWSING" || activity === "SEARCHING") ? safeHost(exec.browserLastUrl) : null,
    working ? exec.currentAction : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const voiceLive = activity === "SPEAKING" || activity === "LISTENING" || Boolean(working);
  return (
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
  );
}

/**
 * Ask LÉLU: a command/search field as a Home surface (command-bar,
 * search-first, chat-is-home and voice-first layouts). It hands the
 * words to the Chat Universe's composer — the person sends them there,
 * so nothing is sent from the Home on its own.
 */
function AskModule({ preview }: HomeModuleProps) {
  const [text, setText] = useState("");
  const submit = (value: string) => {
    if (preview) return;
    window.dispatchEvent(new CustomEvent("lelu-open-universe", value.trim() ? { detail: { draft: value.trim() } } : undefined));
    setText("");
  };
  return (
    <form
      className="lch-glass lch-ask"
      role="search"
      aria-label="Ask LÉLU"
      onSubmit={(e) => {
        e.preventDefault();
        submit(text);
      }}
    >
      <HomeIcon name="Sparkles" size={18} />
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask LÉLU, or type a command…" aria-label="Ask LÉLU" enterKeyHint="send" disabled={preview} />
      <button type="submit" aria-label="Open in the conversation" disabled={preview}>
        <HomeIcon name="MessageCircle" size={16} />
      </button>
    </form>
  );
}

export const HOME_MODULE_VIEWS: Record<HomeModuleId, (props: HomeModuleProps) => ReactNode> = {
  weather: WeatherModule,
  lelu: LeluModule,
  now: NowModule,
  apps: AppsModule,
  workspaces: WorkspacesModule,
  notifications: NotificationsModule,
  library: LibraryModule,
  activity: ActivityModule,
  ask: AskModule,
};

export function HomeModuleView({ id, ...props }: HomeModuleProps & { id: HomeModuleId }) {
  const View = HOME_MODULE_VIEWS[id];
  return <View {...props} />;
}
