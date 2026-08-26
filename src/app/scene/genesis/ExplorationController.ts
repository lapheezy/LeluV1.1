/**
 * ==========================================================
 * LÉLUVERSE
 * EXPLORATION CONTROLLER
 *
 * A lightweight controller that dispatches `planet-navigate`
 * CustomEvents to the Genesis camera, allowing LÉLU to
 * naturally explore the Infinite Cosmos during conversation.
 *
 * Works entirely through the existing camera dispatch system
 * used by GPS/Atlantis/Space buttons in PlanetExplorerHUD —
 * no new 3D plumbing required.
 *
 * States:
 *   FOCUSED_CHAT    → camera stays still, no exploration
 *   PRESENTATION    → camera holds a specific target
 *   EXPLORATION     → slow ambient navigation
 *   AMBIENT         → very gentle drift
 *   IDLE            → no active exploration
 * ==========================================================
 */

import KvStore from "../../../core/storage/KvStore";
import EarthCore from "../../../core/earth/EarthCore";
import AgentEventBus from "../../../core/agent/AgentEvents";
import { dispatchBrowserGoto } from "./GenesisChatSurface";
import {
  flyCosmosScale,
  scaleFromPhrase,
} from "./cosmos/CosmosScales";

export type ExplorationMode =
  | "FOCUSED_CHAT"
  | "PRESENTATION"
  | "EXPLORATION"
  | "AMBIENT"
  | "IDLE";

const EXPLORATION_KEY = "lelu.exploration.v1";

interface ExplorationPrefs {
  mode: ExplorationMode;
  /** Whether user has explicitly disabled exploration */
  disabled: boolean;
}

function readPrefs(): ExplorationPrefs {
  try {
    const stored = KvStore.getInstance().get<Partial<ExplorationPrefs>>(
      EXPLORATION_KEY,
    );
    return { mode: "IDLE", disabled: false, ...(stored ?? {}) };
  } catch {
    return { mode: "IDLE", disabled: false };
  }
}

function persistPrefs(prefs: ExplorationPrefs): void {
  try {
    KvStore.getInstance().set(EXPLORATION_KEY, prefs);
  } catch {
    // persistence must never break exploration
  }
}

/** Directions the camera can explore toward */
interface Waypoint {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  label: string;
}

/* A curated set of visually interesting locations in the cosmos */
const WAYPOINTS: Waypoint[] = [
  { x: 0, y: 3.5, z: 8, lookX: 0, lookY: 1.15, lookZ: 0, label: "Orbit view" },
  { x: 6, y: 2.5, z: 4, lookX: 0, lookY: 1.15, lookZ: 0, label: "Eastern approach" },
  { x: -5, y: 3, z: 5, lookX: 0, lookY: 1.15, lookZ: 0, label: "Western approach" },
  { x: 0, y: 6, z: 0.5, lookX: 0, lookY: 1.15, lookZ: 0, label: "High orbit" },
  { x: 3, y: 2, z: 6.5, lookX: 0, lookY: 1.15, lookZ: 0, label: "Southeast" },
  { x: -3, y: 1.5, z: 7, lookX: 0, lookY: 1.15, lookZ: 0, label: "Low approach" },
  { x: 0, y: 1.5, z: 5, lookX: 0, lookY: 1.15, lookZ: 0, label: "Near surface" },
  { x: 4, y: 4, z: -3, lookX: 0, lookY: 1.15, lookZ: 0, label: "Far side" },
  { x: 0, y: 0.9, z: 3.2, lookX: 0, lookY: 1.15, lookZ: 0, label: "Close-up" },
];


/**
 * ExplorationController — a module-level singleton.
 * Call `getInstance()` to access.
 */
export default class ExplorationController {
  private static instance: ExplorationController | null = null;

  private prefs: ExplorationPrefs;
  private currentWaypoint = 0;
  private exploreTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.prefs = readPrefs();

    // Pause autonomous waypoint cycling whenever the user is
    // manually dragging/zooming the camera, so they never fight
    // a programmatic recenter.
    if (typeof window !== "undefined") {
      window.addEventListener("genesis-user-camera-start", this.onUserCameraStart);
      window.addEventListener("genesis-user-camera-end", this.onUserCameraEnd);
    }
  }

  static getInstance(): ExplorationController {
    if (!ExplorationController.instance) {
      ExplorationController.instance = new ExplorationController();
    }
    return ExplorationController.instance;
  }

  /* ------------------------------------------------------------------
   * Public API
   * ------------------------------------------------------------------ */

  /** Set exploration mode. Persists preference. */
  setMode(mode: ExplorationMode): void {
    this.prefs.mode = mode;
    persistPrefs(this.prefs);
    this.applyMode();
  }

  /** User has explicitly disabled exploration. */
  disable(): void {
    this.prefs.disabled = true;
    persistPrefs(this.prefs);
    this.stopAll();
  }

  /** User has re-enabled exploration. */
  enable(): void {
    this.prefs.disabled = false;
    persistPrefs(this.prefs);
    this.applyMode();
  }

  /** Stop all camera movement immediately. */
  stopAll(): void {
    if (this.exploreTimer) {
      clearInterval(this.exploreTimer);
      this.exploreTimer = null;
    }
  }

  get isDisabled(): boolean {
    return this.prefs.disabled;
  }

  get mode(): ExplorationMode {
    return this.prefs.mode;
  }

  /**
   * Process a user message for voice commands.
   * Returns true if the message was consumed as a command.
   */
  parseCommand(text: string): boolean {
    // Normalize so "LÉLU" and "Lelu" match identically.
    const lower = text.trim().toLowerCase().replace(/[éèêë]/g, "e");

    // Stop / focus commands
    if (
      lower === "stop" ||
      lower === "stop moving" ||
      lower === "stay here" ||
      lower === "focus on chat" ||
      lower === "focus chat" ||
      lower === "hold still"
    ) {
      this.disable();
      return true;
    }

    // Resume exploration
    if (
      lower === "explore" ||
      lower === "keep exploring" ||
      lower === "start exploring" ||
      lower === "let me explore" ||
      lower === "look around" ||
      lower === "show me around"
    ) {
      this.enable();
      this.setMode("EXPLORATION");
      // In Gen V2 the camera is fully user-controlled — give the user a
      // wide vantage to move around from, then hands them the camera.
      this.dispatchV2Camera({ intent: "focus", target: "world" });
      return true;
    }

    // Bring the camera back to LÉLU.
    if (
      lower === "bring me back to you" ||
      lower === "come back to me" ||
      lower === "come back" ||
      lower === "focus on lelu" ||
      lower === "focus on you" ||
      lower === "back to lelu" ||
      lower === "show me yourself" ||
      lower === "bring me back"
    ) {
      this.dispatchV2Camera({ intent: "focus", target: "lelu" });
      return false;
    }

    // Whole-world view.
    if (
      lower === "show me the whole world" ||
      lower === "see the whole world" ||
      lower === "whole world view" ||
      lower === "take me to that planet" ||
      lower === "zoom out to the world"
    ) {
      this.dispatchV2Camera({ intent: "focus", target: "world" });
      return false;
    }

    /* ---------------- Earth Core commands ---------------- */
    // All of these execute REAL spatial actions through the canonical
    // EarthCore runtime — never fake "done" responses.

    // Open Earth.
    if (
      lower === "show earth" ||
      lower === "open earth" ||
      lower === "take me to earth" ||
      lower === "go to earth" ||
      lower === "show me the earth" ||
      lower === "show me earth" ||
      lower === "earth view" ||
      lower === "show the earth"
    ) {
      EarthCore.getInstance().activate();
      this.dispatchShowSurface("earth");
      return true;
    }

    const mapLayerWord = (w: string): string =>
      w === "planes" || w === "flights"
        ? "aircraft"
        : w === "quakes"
          ? "earthquakes"
          : w === "ships" || w === "boats"
            ? "vessels"
            : w;

    // "what's near/around <place>", "what's happening around <place>",
    // "show me what's around <place>" → navigate + query + enable layers.
    const nearPhrase =
      lower.match(/^(?:show me\s+)?what(?:'s| is)\s+(?:happening|going on)\s+(?:around|near|in|at)\s+(.+)$/) ||
      lower.match(/^(?:show me\s+)?what(?:'s| is)\s+(?:around|near)\s+(.+)$/);
    if (nearPhrase) {
      const place = nearPhrase[1].trim();
      void (async () => {
        const earth = EarthCore.getInstance();
        const isHere = /^(here|this location|this area|this region)$/i.test(place);
        const focus = earth.getState().camera;
        if (isHere && focus) {
          void earth.execute({ op: "query_radius", lat: focus.lat, lon: focus.lon, radiusKm: 150 });
        } else if (!isHere) {
          const nav = await earth.execute({ op: "navigate_to_location", query: place });
          if (nav.ok && nav.data) {
            const loc = nav.data as { lat: number; lon: number };
            void earth.execute({ op: "query_radius", lat: loc.lat, lon: loc.lon, radiusKm: 150 });
          }
        }
        for (const layer of ["aircraft", "vessels", "fires", "earthquakes"]) {
          const l = earth.getState().layers[layer];
          if (l && !l.enabled) void earth.execute({ op: "show", layer });
        }
      })();
      this.dispatchShowSurface("earth");
      return true;
    }

    // "show/find <layer> near <place>" and "what <layer> (are) near <place>"
    // → navigate to the place, enable that layer, then run a radius query.
    const layerNearMatch =
      lower.match(
        /^(?:show|find)\s+(?:me\s+)?(?:the\s+)?(?:active\s+)?(aircraft|planes|flights|vessels|ships|boats|fires|earthquakes|quakes|satellites)\s+(?:near|around|within|in)\s+(.+)$/,
      ) ||
      lower.match(/^what\s+(aircraft|planes|flights|vessels|ships|boats|fires|earthquakes|quakes|satellites)\s+(?:are|is)\s+(?:near|around|within|in)\s+(.+)$/);
    if (layerNearMatch) {
      const layer = mapLayerWord(layerNearMatch[1]);
      const place = layerNearMatch[2].trim();
      void (async () => {
        const earth = EarthCore.getInstance();
        const l = earth.getState().layers[layer];
        if (l && !l.enabled) void earth.execute({ op: "show", layer });
        const isHere = /^(here|this location|this area|this region)$/i.test(place);
        const focus = earth.getState().camera;
        if (isHere && focus) {
          void earth.execute({ op: "query_radius", lat: focus.lat, lon: focus.lon, radiusKm: 150 });
        } else if (!isHere) {
          const nav = await earth.execute({ op: "navigate_to_location", query: place });
          if (nav.ok && nav.data) {
            const loc = nav.data as { lat: number; lon: number };
            void earth.execute({ op: "query_radius", lat: loc.lat, lon: loc.lon, radiusKm: 150 });
          }
        }
      })();
      this.dispatchShowSurface("earth");
      return true;
    }

    // Layer toggles (real providers — aircraft, satellites, quakes, …).
    const layerMatch = lower.match(
      /^(?:show|hide|turn on|turn off|enable|disable)\s+(?:me\s+)?(?:the\s+)?(?:active\s+)?(aircraft|planes|flights|satellites|vessels|ships|boats|earthquakes|quakes|fires|weather)\b/,
    );
    if (layerMatch) {
      const wanted = layerMatch[1];
      const verb = lower.startsWith("hide") || lower.startsWith("turn off") || lower.startsWith("disable")
        ? "hide"
        : "show";
      const layer = mapLayerWord(wanted);
      void EarthCore.getInstance().execute(verb === "show" ? { op: "show", layer } : { op: "hide", layer });
      this.dispatchShowSurface("earth");
      return true;
    }

    // Tracking.
    if (
      lower === "track that" ||
      lower === "track it" ||
      lower === "track this" ||
      lower === "follow it" ||
      lower === "follow that" ||
      lower === "follow this"
    ) {
      void EarthCore.getInstance().execute({ op: "track_entity" });
      this.dispatchShowSurface("earth");
      return true;
    }
    if (lower === "stop tracking" || lower === "stop following" || lower === "untrack") {
      void EarthCore.getInstance().execute({ op: "stop_tracking" });
      this.dispatchShowSurface("earth");
      return true;
    }

    // Spatial questions against the current focus.
    if (lower === "what's around here" || lower === "what is around here" || lower === "what's happening here" || lower === "what is happening here") {
      const focus = EarthCore.getInstance().getState().camera;
      if (focus) {
        void EarthCore.getInstance().execute({ op: "query_radius", lat: focus.lat, lon: focus.lon, radiusKm: 150 });
      }
      this.dispatchShowSurface("earth");
      return true;
    }

    // Radius queries: "show everything within 50 miles/km of <place>…"
    const radiusMatch = lower.match(/(?:within|in|inside)\s+(\d+)\s*(km|miles?|mi)\b/);
    if (radiusMatch) {
      const radiusKm = radiusMatch[2].startsWith("km") ? Number(radiusMatch[1]) : Number(radiusMatch[1]) * 1.609;
      const remainder = lower.replace(radiusMatch[0], "");
      const placeMatch = remainder.match(/(?:of|around|near)\s+(.+)$/);
      const query = placeMatch?.[1]?.trim();
      if (query) {
        void (async () => {
          const nav = await EarthCore.getInstance().execute({ op: "navigate_to_location", query });
          if (nav.ok && nav.data) {
            const loc = nav.data as { lat: number; lon: number };
            void EarthCore.getInstance().execute({ op: "query_radius", lat: loc.lat, lon: loc.lon, radiusKm });
          }
        })();
      }
      this.dispatchShowSurface("earth");
      return true;
    }

    /* ---------------- Cosmos scale navigation ---------------- */
    // Fly the v1 camera through the PHYSICAL cosmos — planet → solar
    // system → stellar space → galaxy. Uses the same scale presets as
    // the CosmosScaleHUD; the camera controller applies the real fly
    // to the actual OrbitControls camera (never a mocked state).
    const cosmosScaleMatch = lower.match(
      /^(?:show me|take me to|take me through|go to|zoom (?:out )?to|fly (?:out )?to|bring me to|open|explore|enter)\s+(?:the\s+)?(solar system|sun|stars|stellar space|deep space|nebula|galaxy|milky way|intergalactic space|cosmos|universe|space|outer space)\b/,
    );
    if (cosmosScaleMatch) {
      const scale = scaleFromPhrase(cosmosScaleMatch[1]);
      if (scale && scale !== "planet") {
        // The physical cosmos camera lives in the Genesis (v1) scene — if
        // Gen V2 / System currently own the viewport, return to the Genesis
        // scene first (chat stays open — scene change is presentation only),
        // then fly after the canvas has mounted.
        this.dispatchSetScene("genesis");
        window.setTimeout(() => flyCosmosScale(scale), 160);
        return true;
      }
    }

    // Return to the planet / the Earth environment.
    if (
      lower === "back to earth" ||
      lower === "bring me back to earth" ||
      lower === "take me back to earth" ||
      lower === "go back to earth" ||
      lower === "zoom back to earth" ||
      lower === "return to earth"
    ) {
      this.dispatchSetScene("genesis");
      window.setTimeout(() => flyCosmosScale("planet"), 160);
      EarthCore.getInstance().activate();
      this.dispatchShowSurface("earth");
      return true;
    }

    // "Open System UI" — the System environment is another presentation
    // of the same runtime; the surface controller toggles it like the
    // dock's System tab (exiting Gen V2 first when needed).
    if (
      lower === "open system ui" ||
      lower === "open the system ui" ||
      lower === "open system" ||
      lower === "open the system environment" ||
      lower === "go to system ui" ||
      lower === "enter system ui" ||
      lower === "show me the system ui"
    ) {
      this.dispatchShowSurface("visual");
      return true;
    }

    // Show specific things
    if (lower.startsWith("show me ")) {
      const rest = lower.slice(8).trim();
      // "show me Tokyo" / "show me Paris" → REAL Earth navigation.
      // (Exact-match Earth phrases like "show me the earth" already
      // won above; cosmos-y remainders keep the ambient camera.)
      if (
        rest.length >= 2 &&
        !/^(yourself|your avatar|the avatar|around|the world|everything|the cosmos|the core|the studio|the lab|the vault|the interface|back|home)\b/.test(rest)
      ) {
        void EarthCore.getInstance().execute({ op: "navigate_to_location", query: rest });
        this.dispatchShowSurface("earth");
        return true;
      }
      this.setMode("PRESENTATION");
      // Navigate to a waypoint based on the request
      this.navigateToRelevant(rest);
      return false; // still let the message go through to LÉLU
    }

    /* ---------------- Unified module presentation commands ---------------- */
    // "minimize earth", "detach browser", "restore earth", "open earth as
    // a tab" — presentation changes over the SAME module instance. The
    // surface controller applies them to the canonical module state.

    const MODULE_IDS = [
      "earth", "browser", "render", "sketch", "avatar", "evolution",
      "projects", "settings", "memory", "reasoning", "cognition",
      "engineering", "notifications", "visualstudio", "history", "logs",
      "providers", "agents", "knowledge", "diagnostics", "executive",
      "device", "video", "workspaces",
    ];
    const moduleIdOf = (w: string): string | null => {
      const word = w.toLowerCase();
      if (word === "self development" || word === "self-development" || word === "evolution" || word === "selfdev") return "evolution";
      if (word === "api" || word === "apis" || word === "tools" || word === "api status" || word === "providers") return "providers";
      if (word === "projects" || word === "project") return "projects";
      if (MODULE_IDS.includes(word)) return word;
      return null;
    };

    const presentationMatch = lower.match(/^(minimize|detach|restore|close|expand|open)\s+(.+)$/);
    if (presentationMatch) {
      const verb = presentationMatch[1];
      const target = presentationMatch[2].trim();
      const targetId = moduleIdOf(target.replace(/^(the|a)\s+/, ""));
      // "open as a tab" / "open in a tab"
      const openTab = target.match(/^(.+?)\s+(?:as|in)\s+a tab$/);
      if (verb === "open" && openTab) {
        const id = moduleIdOf(openTab[1].trim().replace(/^(the|a)\s+/, ""));
        if (id) {
          this.dispatchModulePresentation(id, "detached");
          return true;
        }
      }
      if (targetId) {
        const presentation =
          verb === "minimize" ? "minimized"
          : verb === "detach" ? "detached"
          : verb === "restore" || verb === "expand" ? "expanded"
          : verb === "close" ? "closed"
          : null;
        if (presentation) {
          this.dispatchModulePresentation(targetId, presentation);
          return true;
        }
      }
    }

    // "auto mode" / "manual mode" / "assisted mode" — who controls
    // module presentation.
    const modeMatch = lower.match(/^(?:switch to|set to|go to|use|enable|enter)?\s*(auto|automatic|assisted|manual)\s*(?:mode|control)?$/);
    if (modeMatch) {
      const mode = modeMatch[1];
      const resolved =
        mode === "automatic" ? "auto"
        : mode === "assisted" ? "assisted"
        : mode === "manual" ? "manual"
        : "auto";
      this.dispatchUiControl(resolved);
      return true;
    }

    /* ---------------- Browser / search commands ---------------- */
    // Real web research: the in-app browser panel navigates to an actual
    // search page. The message STILL reaches LÉLU (return false) — her
    // ResearchResolver performs the real retrieval and emits tool_result
    // events that chat renders inline. The panel is the visible surface
    // of that same execution, never a fake "Searching…" card.

    // Open the browser itself.
    if (
      lower === "open the browser" ||
      lower === "open a browser" ||
      lower === "open browser" ||
      lower === "open the web browser" ||
      lower === "open a web browser"
    ) {
      const url = "https://lite.duckduckgo.com/lite/";
      AgentEventBus.getInstance().emit({
        type: "browser_opened",
        taskId: `browser-${Date.now()}`,
        url,
      });
      dispatchBrowserGoto(url);
      return false;
    }

    // Search the web / look something up / research something.
    const webSearch = lower.match(
      /^(?:open(?: a| the)? browser and search(?: for)?\s+|search (?:the web|the internet|online)\s+(?:for\s+)?|search for\s+|look up\s+|google\s+|web search(?: for)?\s+|research\s+)(.+)$/,
    );
    if (webSearch) {
      const q = webSearch[1].trim();
      // "research lab" is a cosmos destination, not a web query.
      if (q && q !== "lab" && q !== "the lab") {
        const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
        AgentEventBus.getInstance().emit({
          type: "browser_opened",
          taskId: `browser-${Date.now()}`,
          url,
        });
        dispatchBrowserGoto(url);
        return false; // LÉLU still retrieves + answers from real results
      }
    }

    /* ---------------- Gen V2 navigation & camera commands ---------------- */

    // "Take me into Gen V2" — open the explorable world automatically.
    if (
      lower === "take me into gen v2" ||
      lower === "take me to gen v2" ||
      lower === "go to gen v2" ||
      lower === "enter gen v2" ||
      lower === "genesis v2" ||
      lower === "open gen v2" ||
      lower === "take me into genesis v2"
    ) {
      this.dispatchShowSurface("genesisv2");
      return true;
    }

    // Fullscreen the explorable world.
    if (
      lower === "make it full screen" ||
      lower === "make this full screen" ||
      lower === "go fullscreen" ||
      lower === "fullscreen" ||
      lower === "make it fullscreen"
    ) {
      this.dispatchV2Camera({ intent: "fullscreen" });
      this.dispatchShowSurface("genesisv2");
      return false;
    }

    // Focus named world elements (Core / modules / planet). These live in
    // the Gen V2 scene — enter it first (the surface controller queues the
    // camera command until the v2 canvas mounts).
    const focusMatch = lower.match(
      /(?:take me to|focus on|show me|go to|zoom to)\s+(?:the\s+)?(core|studio|research lab|creation studio|genesis vault|vault|lab)\b/,
    );
    if (focusMatch) {
      this.dispatchShowSurface("genesisv2");
      const target = focusMatch[1];
      if (target.includes("lab") || target.includes("research")) {
        this.dispatchV2Camera({ intent: "focus", target: "lab" });
      } else if (target.includes("studio") || target.includes("creation")) {
        this.dispatchV2Camera({ intent: "focus", target: "studio" });
      } else if (target.includes("vault")) {
        this.dispatchV2Camera({ intent: "focus", target: "vault" });
      } else {
        this.dispatchV2Camera({ intent: "focus", target: "core" });
      }
      return false;
    }

    /* Navigation: "go to Miami", "find Mount Kilimanjaro", "take me to
       Tokyo"… Runs AFTER the cosmos focus phrases so "take me to the
       studio" still means the studio, and skips known non-place phrases. */
    const NON_PLACE = [
      "around", "yourself", "the world", "world", "everything", "the interface",
      "the cosmos", "cosmos", "gen v2", "genesis v2", "the planet", "the core",
      "the studio", "the lab", "the vault", "back", "home", "me home",
    ];
    const earthNav = lower.match(/^(?:take me to|go to|find|navigate to|zoom to|fly to|show)\s+(?:the\s+)?(.{2,60})$/);
    if (earthNav && !NON_PLACE.includes(earthNav[1].trim())) {
      const query = earthNav[1].trim();
      void EarthCore.getInstance().execute({ op: "navigate_to_location", query });
      this.dispatchShowSurface("earth");
      return true;
    }

    return false;
  }

  /* ------------------------------------------------------------------
   * Internal
   * ------------------------------------------------------------------ */

  private applyMode(): void {
    if (this.prefs.disabled) {
      this.stopAll();
      return;
    }

    this.stopAll();

    switch (this.prefs.mode) {
      case "IDLE":
      case "FOCUSED_CHAT":
        // No movement.
        break;

      case "PRESENTATION":
        // Camera holds the current target — set by navigateToRelevant.
        break;

      case "EXPLORATION":
        this.startExploration();
        break;

      case "AMBIENT":
        this.startAmbientDrift();
        break;
    }
  }

  private startExploration(): void {
    // Cycle through waypoints every 8-14 seconds
    this.currentWaypoint = Math.floor(Math.random() * WAYPOINTS.length);
    this.navigateToWaypoint(this.currentWaypoint);

    this.exploreTimer = setInterval(() => {
      // Pick a different waypoint
      let next: number;
      do {
        next = Math.floor(Math.random() * WAYPOINTS.length);
      } while (next === this.currentWaypoint && WAYPOINTS.length > 1);
      this.currentWaypoint = next;
      this.navigateToWaypoint(next);
    }, 8000 + Math.random() * 6000);
  }

  private startAmbientDrift(): void {
    // Gentle periodic waypoint navigation — dispatches a discrete
    // flyTo every 12-18 seconds, so the camera has plenty of time
    // to arrive and settle between moves. The user can freely
    // orbit/pan/zoom in between; flyCameraTo yields to the next
    // user interaction naturally (it's a lerp, not a lock).
    this.exploreTimer = setInterval(() => {
      let next: number;
      do {
        next = Math.floor(Math.random() * WAYPOINTS.length);
      } while (next === this.currentWaypoint && WAYPOINTS.length > 1);
      this.currentWaypoint = next;
      this.navigateToWaypoint(next);
    }, 12000 + Math.random() * 6000);

    // Start with an immediate gentle nudge to show the cosmos is alive.
    this.navigateToWaypoint(this.currentWaypoint);
  }

  private navigateToWaypoint(index: number): void {
    const wp = WAYPOINTS[index];
    if (!wp) return;
    this.dispatchNavigate(
      { x: wp.x, y: wp.y, z: wp.z },
      { x: wp.lookX, y: wp.lookY, z: wp.lookZ },
    );
  }

  /** Navigate to a waypoint relevant to the topic. */
  private navigateToRelevant(topic: string): void {
    // For now, pick a waypoint deterministically based on topic hash
    let hash = 0;
    for (let i = 0; i < topic.length; i++) {
      hash = (hash * 31 + topic.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % WAYPOINTS.length;
    this.navigateToWaypoint(idx);
  }

  private onUserCameraStart = (): void => {
    this.stopAll();
  };

  private onUserCameraEnd = (): void => {
    // Don't immediately resume — let the presence engine's
    // post-user cooldown gate kick in first.
  };

  private dispatchNavigate(
    pos: { x: number; y: number; z: number },
    lookAt: { x: number; y: number; z: number },
  ): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("planet-navigate", {
        detail: { pos, lookAt },
      }),
    );
  }

  /** Ask the surface controller to open a workspace/panel (e.g. Gen V2). */
  private dispatchShowSurface(panel: string): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("genesis-show-surface", {
        detail: { panel },
      }),
    );
  }

  /** Switch the workspace SCENE (v1 ↔ Gen V2) without touching open panels. */
  private dispatchSetScene(scene: "genesis" | "genesisv2"): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("genesis-set-scene", {
        detail: { scene },
      }),
    );
  }

  /** Change a module's presentation (inline/expanded/minimized/detached/closed). */
  private dispatchModulePresentation(id: string, presentation: string): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("genesis-module-presentation", {
        detail: { id, presentation },
      }),
    );
  }

  /** Switch AUTO / ASSISTED / MANUAL presentation control. */
  private dispatchUiControl(mode: "auto" | "assisted" | "manual"): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("genesis-ui-control", {
        detail: { mode },
      }),
    );
  }

  /** Send a camera command to the Gen V2 camera rig (via the bridge). */
  private dispatchV2Camera(command: {
    intent: "focus" | "fly" | "reset" | "fullscreen";
    target?: "lelu" | "core" | "studio" | "lab" | "vault" | "world";
    position?: [number, number, number];
    lookAt?: [number, number, number];
  }): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("genesis-v2-camera", {
        detail: command.intent === "focus" && command.target
          ? { intent: "focus", target: command.target }
          : command.intent === "fly"
            ? { intent: "fly", position: command.position ?? [0, 2, 8], lookAt: command.lookAt }
            : { intent: command.intent },
      }),
    );
  }
}