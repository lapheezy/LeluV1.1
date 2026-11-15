/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS BROWSER PANEL
 *
 * LÉLU's in-app browser layer. A web application cannot launch
 * the user's native Chrome/Firefox from inside a browser sandbox,
 * so this is the honest equivalent the environment permits:
 *
 *   - Navigate: the page renders in an embedded frame.
 *   - Read for Lélu: the page's readable content is extracted via
 *     BrowserTool and pushed through the EXISTING chat/cognition
 *     pipeline (AIService.chat) — the same providers, fallback
 *     chain, memory retrieval and consolidation as any message.
 *     The result is stored through addMessage so it also lands in
 *     History and the invisible dialogue replay.
 *
 * No second browser, no second runtime, no duplicate chat.
 * ==========================================================
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { LayoutGroup, motion } from "framer-motion";
import { chatWindowId, useGenesis, useGenesisState } from "./GenesisCore";
import KvStore from "../../../core/storage/KvStore";
import WorkspaceStewardStore from "../../../core/interface/WorkspaceStewardStore";
import { arrangeWorkspace } from "./layout/stewardActions";
import { addSourceToBoard } from "./chat/stage/boardSources";
import "./browser/browser.css";
import AIService from "../../../core/AIService";
import MultiChatStore from "../../../core/multichat/MultiChatStore";
import { bindMessage, ownerForTask } from "../../../core/multichat/TurnOwnership";
import BrowserTool from "../../../core/browser/BrowserTool";
import { getEnvironment } from "../../../core/Environment";
import AgentEventBus, { type AgentEvent, type AgentResultItem } from "../../../core/agent/AgentEvents";

const ai = AIService.getInstance();

interface GenesisBrowserPanelProps {
  onClose: () => void;
}

interface LiveResearch {
  taskId: string;
  query: string;
  provider: string;
  status: "running" | "complete" | "blocked" | "error";
  results: AgentResultItem[];
  message?: string;
}

function researchFromEvent(event: AgentEvent): LiveResearch | null {
  if (event.type === "tool_selected" || event.type === "tool_started") {
    if (event.tool !== "research") return null;
    return {
      taskId: event.taskId,
      query: event.label?.replace(/^Searching\s+/i, "") ?? "",
      provider: "research providers",
      status: "running",
      results: [],
    };
  }
  if (event.type === "tool_result" && event.tool === "research") {
    return {
      taskId: event.taskId,
      query: event.query ?? "",
      provider: event.provider ?? "research providers",
      status: event.status === "error" ? "error" : "complete",
      results: event.results ?? [],
      message: event.result,
    };
  }
  return null;
}

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  history: string[];
  index: number;
  view: "page" | "reader";
  nonce: number;
  loaded?: boolean;
  slow?: boolean;
  hintDismissed?: boolean;
  /** Restored from a previous session: shown as a resume card, nothing mounted until tapped. */
  dormant?: boolean;
  /** The reader's verdict: true/false, null = no reader available to ask, undefined = not asked yet. */
  embeddable?: boolean | null;
  reader?: { status: "loading" | "read" | "failed"; title: string; text: string; error?: string };
}

const TABS_KEY = "lelu.browser.tabs.v1";
const QUICK = [
  { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Bioluminescence" },
  { label: "NASA", url: "https://www.nasa.gov" },
  { label: "OpenStreetMap", url: "https://www.openstreetmap.org" },
  { label: "arXiv", url: "https://arxiv.org" },
];

function blankTab(): BrowserTab {
  return { id: `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, url: "", title: "", history: [], index: -1, view: "page", nonce: 0 };
}

function hostOf(url: string): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return url;
  }
}

function loadTabs(): BrowserTab[] {
  try {
    const saved = KvStore.getInstance().get<{ tabs?: BrowserTab[] }>(TABS_KEY);
    const tabs = (saved?.tabs ?? []).filter((t) => t && typeof t.id === "string").map((t) => ({ ...t, view: "page" as const, nonce: t.nonce ?? 0, dormant: Boolean(t.url) }));
    return tabs.length ? tabs : [blankTab()];
  } catch {
    return [blankTab()];
  }
}

function loadActive(tabs: BrowserTab[]): string {
  try {
    const id = KvStore.getInstance().get<{ activeId?: string }>(TABS_KEY)?.activeId;
    return id && tabs.some((t) => t.id === id) ? id : tabs[0].id;
  } catch {
    return tabs[0].id;
  }
}

export default function GenesisBrowserPanel({ onClose: _onClose }: GenesisBrowserPanelProps) {
  const { addMessage, notify } = useGenesisState();
  // Neko (m1k1o/neko) self-hosted virtual browser: when VITE_NEKO_URL is
  // configured the panel can switch the embedded surface to the LIVE Neko
  // web client — a real, rendered browser session (WebRTC), not an iframe
  // of the target page. The join password stays server-side; the client
  // embeds the public client URL as-is.
  const nekoUrl = getEnvironment().nekoUrl.trim();
  const [mode, setMode] = useState<"inline" | "neko">("inline");
  const [nekoStatus, setNekoStatus] = useState<"checking" | "reachable" | "unavailable" | "unconfigured">(
    nekoUrl ? "checking" : "unconfigured",
  );
  // Nothing is fetched until someone navigates. The panel used to mount a
  // live wikipedia.org frame on open, so every arrival in the Cosmos carried
  // a third-party page, its network retries and its own renderer into a
  // spatial transition — measured: the renderer died during the next scene
  // change with the embedded page mounted.
  const [address, setAddress] = useState("");
  /*
   * Tabs: several real browsing sessions, each with its own back/forward
   * history and its own view (the page, or LÉLU's reader of it). Persisted,
   * so a reload — or the Workspace Steward folding this window into a tab —
   * never loses what was open.
   */
  const [tabs, setTabs] = useState<BrowserTab[]>(loadTabs);
  const [activeId, setActiveId] = useState<string>(() => loadActive(tabs));
  const [notice, setNotice] = useState<string | null>(null);
  const genesis = useGenesis();
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const current = activeTab?.url ?? "";
  useEffect(() => {
    try {
      KvStore.getInstance().set(TABS_KEY, { tabs: tabs.map(({ reader: _r, slow: _s, embeddable: _e, hintDismissed: _h, dormant: _d, ...t }) => t), activeId });
    } catch {
      /* best-effort */
    }
  }, [tabs, activeId]);
  const patchTab = useCallback((id: string, patch: Partial<BrowserTab> | ((t: BrowserTab) => Partial<BrowserTab>)) => {
    setTabs((all) => all.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)));
  }, []);
  /** Navigate the active tab (pushes its history). */
  const setCurrent = useCallback((url: string) => {
    setTabs((all) => {
      const id = all.some((t) => t.id === activeIdRef.current) ? activeIdRef.current : all[0]?.id;
      return all.map((t) => {
        if (t.id !== id || t.history[t.index] === url) return t;
        const history = [...t.history.slice(0, t.index + 1), url];
        return { ...t, url, title: hostOf(url), history, index: history.length - 1, view: "page", reader: undefined, slow: false, loaded: false, embeddable: undefined, dormant: false, nonce: t.nonce + 1 };
      });
    });
  }, []);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const selectTab = (id: string) => {
    setActiveId(id);
    setAddress(tabs.find((t) => t.id === id)?.url ?? "");
  };
  const newTab = (url?: string) => {
    const tab = blankTab();
    setTabs((all) => [...all, tab]);
    setActiveId(tab.id);
    activeIdRef.current = tab.id;
    setAddress("");
    if (url) setTimeout(() => go(url), 0);
  };
  const closeTab = (id: string) => {
    setTabs((all) => {
      const rest = all.filter((t) => t.id !== id);
      const next = rest.length ? rest : [blankTab()];
      if (id === activeIdRef.current) {
        setActiveId(next[next.length - 1].id);
        setAddress(next[next.length - 1].url);
      }
      return next;
    });
  };
  const step = (delta: number) => {
    if (!activeTab) return;
    const index = Math.max(0, Math.min(activeTab.history.length - 1, activeTab.index + delta));
    const url = activeTab.history[index];
    patchTab(activeTab.id, { index, url, title: hostOf(url), view: "page", reader: undefined, slow: false, loaded: false, embeddable: undefined, dormant: false, nonce: activeTab.nonce + 1 });
    setAddress(url);
  };
  const reload = () => activeTab && patchTab(activeTab.id, (t) => ({ nonce: t.nonce + 1, loaded: false, slow: false, dormant: false }));
  const markLoaded = (id: string) => {
    patchTab(id, { loaded: true, slow: false });
    // The "blank?" hint is a moment's offer, not a fixture over the page.
    setTimeout(() => patchTab(id, { hintDismissed: true }), 7000);
  };
  // Before trusting the frame, ask the reader whether this site may be
  // embedded at all. A refusal switches the tab to Reader with the text
  // already fetched; no answer (no reader here) leaves the hint strip.
  useEffect(() => {
    const tab = activeTab;
    if (!tab?.url || tab.dormant || tab.embeddable !== undefined || mode === "neko") return;
    let cancelled = false;
    const { id, url } = tab;
    void BrowserTool.probe(url).then((verdict) => {
      if (cancelled) return;
      if (!verdict) {
        patchTab(id, (t) => (t.url === url ? { embeddable: null } : {}));
        return;
      }
      patchTab(id, (t) =>
        t.url !== url
          ? {}
          : verdict.embeddable
            ? { embeddable: true }
            : { embeddable: false, view: "reader", title: verdict.title || t.title, reader: { status: verdict.text ? "read" : "failed", title: verdict.title, text: verdict.text, error: "The site refuses to be embedded and returned no readable text." } },
      );
      if (!verdict.embeddable) {
        setNotice(`${hostOf(url)} refuses to be embedded — showing LÉLU's reader`);
        setTimeout(() => setNotice(null), 4000);
      }
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the tab's identity and URL, not on every change to the tab object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id, activeTab?.url, activeTab?.embeddable, mode, patchTab]);

  // A page that never reports loading is most often a site refusing to be
  // embedded: say so and offer the reader instead of a blank white box.
  useEffect(() => {
    if (!activeTab?.url || activeTab.dormant || activeTab.loaded || activeTab.view !== "page") return;
    const id = activeTab.id;
    const timer = setTimeout(() => patchTab(id, (t) => (t.loaded ? {} : { slow: true })), 9000);
    return () => clearTimeout(timer);
  }, [activeTab?.id, activeTab?.url, activeTab?.nonce, activeTab?.loaded, activeTab?.view, activeTab?.dormant, patchTab]);
  const toggleReader = async () => {
    if (!activeTab?.url) return;
    if (activeTab.view === "reader") {
      patchTab(activeTab.id, { view: "page" });
      return;
    }
    const id = activeTab.id;
    patchTab(id, { view: "reader", slow: false, reader: activeTab.reader ?? { status: "loading", title: "", text: "" } });
    if (activeTab.reader && activeTab.reader.status !== "loading") return;
    const page = await BrowserTool.visit(activeTab.url);
    patchTab(id, {
      title: page.title || hostOf(page.url),
      reader: page.status === "read" ? { status: "read", title: page.title, text: page.text } : { status: "failed", title: page.title, text: "", error: page.error ?? "The page could not be read." },
    });
  };
  /** Browser beside the conversation: the Workspace Steward's split, locally. */
  const besideChat = () => {
    const conversationId = genesis.state.activeConversationId;
    const result = arrangeWorkspace(
      {
        modules: () => genesis.state.modules,
        openModule: genesis.openModule,
        setModulePresentation: genesis.setModulePresentation,
        raiseModule: genesis.raiseModule,
        activeConversationId: () => conversationId ?? null,
      },
      "split",
      ["browser", ...(conversationId ? [chatWindowId(conversationId)] : [])],
      "user",
    );
    setNotice(result.ok ? "Beside the chat" : result.detail);
    setTimeout(() => setNotice(null), 2500);
  };
  /** Browser → canvas: this page becomes a source on the conversation's research board. */
  const toBoard = () => {
    const conversationId = genesis.state.activeConversationId;
    if (!activeTab?.url || !conversationId) return;
    addSourceToBoard(conversationId, { title: activeTab.title || hostOf(activeTab.url), href: activeTab.url });
    WorkspaceStewardStore.setStage(conversationId, "board");
    besideChat();
    setNotice("Added to the research board");
    setTimeout(() => setNotice(null), 2500);
  };
  const [reading, setReading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [research, setResearch] = useState<LiveResearch | null>(null);

  useEffect(() => {
    if (!nekoUrl) return;
    let cancelled = false;
    void fetch("/api/neko/status", { signal: AbortSignal.timeout(7000) })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { reachable?: boolean };
        if (!cancelled) setNekoStatus(response.ok && payload.reachable ? "reachable" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setNekoStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [nekoUrl]);

  // Hydrate from the real event history, then follow the same live bus so
  // a fast request cannot disappear between tool completion and mount.
  useEffect(() => {
    const bus = AgentEventBus.getInstance();
    const recent = bus.recent(60);
    for (const event of recent) {
      const next = researchFromEvent(event);
      if (next) setResearch((current) => current?.taskId === next.taskId
        ? { ...current, ...next }
        : next);
      if (event.type === "browser_result") {
        setAddress(event.url);
        setCurrent(event.url);
        setSummary(event.excerpt ?? event.error ?? null);
      }
    }
    return bus.subscribe((event) => {
      // Another conversation's page is not this view's to show: following
      // it navigated this panel (and its iframe) to whatever any chat's
      // turn was reading.
      const owner = ownerForTask(event.taskId);
      if (owner && owner !== MultiChatStore.getInstance().getActiveId()) return;
      const next = researchFromEvent(event);
      if (next) setResearch((current) => current?.taskId === next.taskId
        ? { ...current, ...next }
        : next);
      if (event.type === "browser_result") {
        setAddress(event.url);
        setCurrent(event.url);
        setSummary(event.excerpt ?? event.error ?? null);
      }
    });
  }, [setCurrent]);

  // Real navigation → real event: the canonical bus records it, the
  // surface controller opens this panel, and chat renders the browser
  // surface inline — one execution state, many views.
  const go = useCallback((raw?: string) => {
    const target = BrowserTool.normalizeUrl(raw ?? address);
    if (!target) {
      return;
    }
    setAddress(target);
    setCurrent(target);
    setSummary(null);
    AgentEventBus.getInstance().emit({
      type: "browser_opened",
      taskId: `browser-${Date.now()}`,
      url: target,
    });
  }, [address, setCurrent]);

  // Chat surfaces (search results, page cards) navigate this panel by
  // dispatching genesis-browser-goto — the same surface the user sees.
  useEffect(() => {
    function onGoto(event: Event) {
      const detail = (event as CustomEvent).detail as { url?: string } | null;
      const url = detail?.url;
      if (url && BrowserTool.normalizeUrl(url)) {
        setAddress(url);
        setCurrent(url);
        setSummary(null);
        AgentEventBus.getInstance().emit({
          type: "browser_opened",
          taskId: `browser-${Date.now()}`,
          url: BrowserTool.normalizeUrl(url)!,
        });
      }
    }
    window.addEventListener("genesis-browser-goto", onGoto);
    return () => window.removeEventListener("genesis-browser-goto", onGoto);
  }, [setCurrent]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      go();
    }
  };

  /*
   * Read the page and push it through the ONE chat pipeline: the
   * extracted content becomes a message to LÉLU, providers/fallback/
   * cognition/memory run exactly as in chat, and the reply is stored
   * through addMessage (History + dialogue replay) and shown here.
   */
  const readForLelu = useCallback(async () => {
    if (reading) {
      return;
    }
    if (!current) {
      notify("Lélu Browser", "Navigate to a page first.");
      return;
    }
    setReading(true);
    setSummary(null);
    try {
      const result = await BrowserTool.visit(current);
      const taskId = `browser-${Date.now()}`;
      AgentEventBus.getInstance().emit({
        type: "browser_result",
        taskId,
        url: result.url,
        title: result.title,
        excerpt: result.excerpt,
        status: result.status,
        error: result.error,
      });
      if (result.status !== "read") {
        setSummary(result.error ?? "I couldn't read that page.");
        return;
      }

      const request = [
        `I opened a page in my in-app browser. Read it and tell me what it's about in a few sentences.`,
        ``,
        `Page: ${result.title}`,
        `URL: ${result.url}`,
        ``,
        result.excerpt,
      ].join("\n");

      // The REAL page result is emitted on the canonical bus so the chat
      // exchange renders the actual read inline (same event the timeline
      // and workspace layer consume).
      AgentEventBus.getInstance().emit({
        type: "tool_result",
        taskId,
        tool: "browser",
        result: result.excerpt.slice(0, 1200),
        results: [{ title: result.title, url: result.url, type: "page", content: result.excerpt }],
      });

      // The conversation this read was asked from owns its record and the
      // reply, even if the user switches before it arrives.
      const conversationId = MultiChatStore.getInstance().getActiveId();
      const userId = crypto.randomUUID();
      bindMessage(userId, conversationId);
      addMessage({
        id: userId,
        role: "user",
        text: `[Browser] Read ${result.url}`,
        timestamp: Date.now(),
        source: "local",
      });
      const response = await ai.chat(request, undefined, undefined, { conversationId });
      const reply = response.text.trim();
      // The reply was already emitted (and stored) under its own id; writing
      // a second copy under a new id showed it twice.
      if (typeof response.metadata?.messageId !== "string") {
        const replyId = crypto.randomUUID();
        bindMessage(replyId, conversationId);
        addMessage({
          id: replyId,
          role: "assistant",
          text: reply,
          timestamp: Date.now(),
          source: response.provider === "brain" || response.provider === "offline" ? "local" : "ai",
          provider: response.provider,
        });
      }

      setSummary(reply);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setSummary(text);
      notify("Lélu Error", text);
    } finally {
      setReading(false);
    }
  }, [addMessage, current, notify, reading]);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const host = (() => {
    try {
      return active?.url ? new URL(active.url).hostname.replace(/^www\./, "") : "";
    } catch {
      return active?.url ?? "";
    }
  })();

  return (
    <div className="lbr" data-lelu-browser data-view={active?.view ?? "page"}>
      {/* Tabs: real sessions, each with its own history; kept across reloads. */}
      <LayoutGroup id="lbr-tabs">
        <div className="lbr-tabs" role="tablist" aria-label="Browser tabs">
          {tabs.map((t) => (
            <motion.div layout key={t.id} className="lbr-tab" data-on={t.id === active?.id} role="tab" aria-selected={t.id === active?.id} onClick={() => selectTab(t.id)}>
              {t.id === active?.id ? <motion.span layoutId="lbr-tab-glow" className="lbr-tab-glow" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
              <span className="lbr-fav" aria-hidden>{(t.title || hostOf(t.url) || "N").slice(0, 1).toUpperCase()}</span>
              <span className="lbr-tab-title">{t.title || hostOf(t.url) || "New tab"}</span>
              {tabs.length > 1 ? (
                <button type="button" className="lbr-x" aria-label={`Close tab ${t.title || hostOf(t.url) || "New tab"}`} onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>×</button>
              ) : null}
            </motion.div>
          ))}
          <button type="button" className="lbr-new" aria-label="New tab" onClick={() => newTab()}>+</button>
        </div>
      </LayoutGroup>

      <div className="lbr-bar">
        <button type="button" className="lbr-ico" aria-label="Back" disabled={!active || active.index <= 0} onClick={() => step(-1)}>‹</button>
        <button type="button" className="lbr-ico" aria-label="Forward" disabled={!active || active.index >= active.history.length - 1} onClick={() => step(1)}>›</button>
        <button type="button" className="lbr-ico" aria-label="Reload" disabled={!active?.url} onClick={reload}>⟳</button>
        <div className="lbr-address">
          <span aria-hidden className="lbr-lock">{active?.url.startsWith("https://") ? "🔒" : "◌"}</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={(e) => e.currentTarget.select()}
            enterKeyHint="go"
            spellCheck={false}
            aria-label="Browser address"
            placeholder="Search or enter a web address"
          />
          <button type="button" className="lbr-go" onClick={() => go()} aria-label="Go">→</button>
        </div>
      </div>
      <div className="lbr-actions">
        <button type="button" className="lbr-chip" data-on={active?.view === "reader"} aria-pressed={active?.view === "reader"} disabled={!active?.url || mode === "neko"} onClick={toggleReader}>
          ☰ Reader
        </button>
        <button type="button" className="lbr-chip" onClick={readForLelu} disabled={reading || mode === "neko"} title="Extract this page's content and have Lélu read it through her chat pipeline">
          {reading ? "Reading…" : "✦ Read for Lélu"}
        </button>
        <button type="button" className="lbr-chip" onClick={besideChat} title="Put this browser beside the conversation">◫ Beside chat</button>
        <button type="button" className="lbr-chip" onClick={toBoard} disabled={!active?.url} title="Add this page to the conversation's research board">⌘ To board</button>
        {nekoStatus === "reachable" ? (
          <button type="button" className="lbr-chip" data-on={mode === "neko"} onClick={() => setMode((m) => (m === "neko" ? "inline" : "neko"))} title="Switch to the verified live Neko (m1k1o/neko) virtual browser session">
            {mode === "neko" ? "◉ Neko live" : "Neko live browser"}
          </button>
        ) : null}
        {notice ? <span className="lbr-notice" role="status">{notice}</span> : null}
      </div>

      {research ? (
        <details className="lbr-research" data-lelu-live-research open={research.status === "running"}>
          <summary>
            <strong>LÉLU · Research</strong>
            <span data-status={research.status}>{research.status === "running" ? "live" : research.status}</span>
            <span className="lbr-research-q">{research.query || "current request"} · {research.provider}</span>
          </summary>
          {research.results.length > 0 ? (
            <div className="lbr-results">
              {research.results.slice(0, 10).map((item, index) => (
                <div key={`${item.url ?? item.title ?? "result"}-${index}`} className="lbr-result">
                  <div>
                    <span>{item.type ?? "result"}</span>
                    <strong>{item.title ?? "Untitled result"}</strong>
                    {item.url ? <button type="button" onClick={() => newTab(item.url!)}>Open</button> : null}
                  </div>
                  {item.content ? <p>{item.content.slice(0, 280)}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="lbr-muted">{research.status === "running" ? "Waiting for the real provider response..." : research.message ?? "No structured results were returned."}</p>
          )}
        </details>
      ) : null}

      {/* The page. NEKO mode is the LIVE Neko virtual browser session (m1k1o/neko). */}
      <div className="lbr-page" data-mode={mode}>
        {mode === "neko" && nekoUrl ? (
          <iframe src={nekoUrl} title="Neko virtual browser (m1k1o/neko)" allow="clipboard-read; clipboard-write; fullscreen; autoplay; camera; microphone" />
        ) : active?.url && active.dormant ? (
          <div className="lbr-idle" data-lelu-browser-idle data-dormant>
            <h2>{active.title || host}</h2>
            <p>Kept from your last session. Nothing is loaded until you resume it.</p>
            <div className="lbr-quick">
              <button type="button" className="lbr-chip" onClick={reload}>Resume {host}</button>
            </div>
          </div>
        ) : active?.url ? (
          <>
            <iframe
              key={`${active.id}:${active.url}:${active.nonce}`}
              src={active.url}
              title="Lélu in-app browser"
              referrerPolicy="no-referrer-when-downgrade"
              loading="lazy"
              onLoad={() => markLoaded(active.id)}
              style={{ visibility: active.view === "reader" ? "hidden" : "visible" }}
            />
            {active.view === "reader" ? (
              <article className="lbr-reader" data-lelu-browser-reader data-status={active.reader?.status ?? "loading"}>
                {!active.reader || active.reader.status === "loading" ? (
                  <p className="lbr-muted">Reading {host} with LÉLU's page reader…</p>
                ) : active.reader.status === "read" ? (
                  <>
                    <span className="lbr-eyebrow">{host} · reader view</span>
                    <h1>{active.reader.title}</h1>
                    {active.reader.text.split(/\n{2,}/).slice(0, 80).map((para, i) => <p key={i}>{para}</p>)}
                  </>
                ) : (
                  <>
                    <span className="lbr-eyebrow">{host}</span>
                    <h1>This page couldn't be read here</h1>
                    <p>{active.reader.error}</p>
                    <p className="lbr-muted">The page view above may still show it; sites that refuse embedding and reading can be opened in your own browser.</p>
                    <a href={active.url} target="_blank" rel="noreferrer" className="lbr-chip">Open {host} in a new browser tab ↗</a>
                  </>
                )}
              </article>
            ) : null}
            {active.view === "page" && !active.slow && active.embeddable === null && active.loaded && !active.hintDismissed ? (
              <div className="lbr-hint" role="note">
                Blank?
                <button type="button" className="lbr-chip" onClick={toggleReader}>Reader</button>
                <a className="lbr-chip" href={active.url} target="_blank" rel="noreferrer">Open ↗</a>
                <button type="button" className="lbr-x" aria-label="Dismiss" onClick={() => patchTab(active.id, { hintDismissed: true })}>×</button>
              </div>
            ) : null}
            {active.view === "page" && active.slow ? (
              <div className="lbr-slow" role="status">
                {host} hasn't finished showing — some sites refuse to be embedded.
                <button type="button" className="lbr-chip" onClick={toggleReader}>Open Reader</button>
                <a className="lbr-chip" href={active.url} target="_blank" rel="noreferrer">Open externally ↗</a>
              </div>
            ) : null}
          </>
        ) : (
          <div className="lbr-idle" data-lelu-browser-idle>
            <h2>Where to?</h2>
            <p>Type an address or a search. Nothing loads until you do.</p>
            <div className="lbr-quick">
              {QUICK.map((q) => <button key={q.url} type="button" className="lbr-chip" onClick={() => go(q.url)}>{q.label}</button>)}
            </div>
          </div>
        )}
      </div>

      {summary ? (
        <div className="lbr-summary">
          <strong>Lélu read it</strong>
          <div>{summary}</div>
        </div>
      ) : null}

      <p className="lbr-foot">
        {mode === "neko" && nekoUrl && nekoStatus === "reachable"
          ? `Verified Neko web client at ${nekoUrl}. WebRTC still requires Neko's UDP 52000–52100 ports and NAT address to be reachable.`
          : nekoUrl && nekoStatus === "unavailable"
            ? "Neko is configured but its web client is not reachable; the live mode is disabled until the separate service responds."
            : nekoUrl && nekoStatus === "checking"
              ? "Checking the configured Neko web client…"
              : BrowserTool.nativeLaunchAvailable()
                ? "Native browser launch detected."
                : "In-app layer: some sites block embedding or direct reading — Reader and “Read for Lélu” report exactly what happened."}
      </p>
    </div>
  );
}

