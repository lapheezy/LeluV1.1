/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS CORE
 *
 * Living interface + universe state bridge.
 *
 * Controls:
 * - UI state
 * - chat
 * - panels
 * - cognition
 * - universe simulation state
 *
 * Optimized:
 * - live engine mutation ref
 * - reactive universe snapshots
 * - simulation friendly updates
 * ==========================================================
 */


import {

  createContext,

  useContext,

  useEffect,

  useMemo,

  useCallback,

  useState,

  useRef,

  type ReactNode,

} from "react";


import EventBus from "../../../core/EventBus";

import EngineRuntime from "./engines/EngineRuntime";

import type { EngineStatus } from "./engines/EngineRegistry";

import {

  defaultGenesisState,

  type GenesisState as UniverseState,

} from "./state/GenesisState";


import type {

  GenesisAction,

  GenesisActionStatus,

} from "./GenesisActions";

import type { GenesisTarget } from "./GenesisNavigator";

import type { VoicePhase } from "../../../core/voice/VoiceEngine";

import MultiChatStore, {

  type ChatConversation,

  type ConversationSearchScope,

  type ConversationSearchHit,

} from "../../../core/multichat/MultiChatStore";

import CrossChatResolver from "../../../core/multichat/CrossChatResolver";

import NotificationProvider from "../../../core/notifications/NotificationProvider";

import VisualEngine from "../../../core/visual/VisualEngine";





const multiChat =

  MultiChatStore.getInstance();

const crossChat =

  CrossChatResolver.getInstance();


/* Singleton guard — there must be exactly ONE GenesisCore (one LÉLU
   runtime, one chat, one cognition). Development-only: if a second
   instance ever mounts, it is a duplicate-runtime bug and gets flagged
   immediately instead of silently racing the first. StrictMode's
   mount→unmount→mount dev cycle keeps the count at 1, so only genuine
   simultaneous duplicates trigger the warning. */
let genesisCoreMountCount = 0;



export type GenesisMode =

  | "chat"

  | "engineering"

  | "creative"

  | "research";





export type GenesisPanel =

  | "none"

  | "chat"

  | "history"

  | "logs"

  | "workspaces"

  | "agents"

  | "reasoning"

  | "diagnostics"

  | "executive"

  | "memory"

  | "providers"

  | "device"

  | "browser"

  | "visual"

  | "genesisv2"

  // LÉLU V1 creative expansion — dedicated workspaces.

  | "sketch"

  | "render"

  | "video"

  | "avatar"

  // Self-improvement proposals + notifications

  | "notifications"  // Unified Visual Studio — sketch + render + avatar in one environment
  | "visualstudio"

  // Earth Core — LÉLU's native spatial intelligence surface (capability,
  // not a separate app: reachable from chat/voice/palette, no dock tab)
  | "earth"

  | "projects"

  | "settings"

  | "knowledge"

  // Autonomous cognition + engineering layer — persistent mind

  // and the isolated development sandbox.

  | "cognition"

  // Per-turn cognitive evidence chain (recall → inject → route →
  // provider → memory write), read live from CognitiveTrace.
  | "cognitive-trace"

  | "engineering"

  // Self-development engine — architecture map, capability registry,
  // improvement queue, sandbox-first UI evolution.
  | "evolution"
  // Self Evolution — visible research/proposals/experiments dashboard
  | "self-evolution"
  // Cosmos — infinite cosmos map + navigation
  | "cosmos";


/**
 * Unified-module presentation model: every environment (Earth, Browser,
 * Render, …) is ONE instance that can be shown in different presentations.
 * Changing presentation never duplicates the underlying singleton runtime.
 */
export type ModulePresentation =
  | "closed"      // not rendered anywhere
  | "inline"      // floating window alongside the persistent Chat
  | "expanded"    // primary visual area; Chat remains accessible
  | "minimized";   // compact persistent chip strip (module keeps running)

export type ModuleStatus = "idle" | "active" | "loading" | "complete" | "attention" | "failed";

export interface ModuleState {
  presentation: ModulePresentation;
  status: ModuleStatus;
  updatedAt: number;
  /** Floating-window geometry — persisted per module so move/resize
      survives presentation changes (inline ↔ expanded ↔ minimized). */
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  /** Stacking order among floating windows (raise = top-most). */
  zIndex?: number;
}

/** Who decides module presentation: LÉLU (auto), LÉLU+approval (assisted), or the user (manual). */
export type UiControlMode = "auto" | "assisted" | "manual";





/**
 * The interaction phase of the invisible dialogue layer. The ONE Core
 * reads this every frame to express the conversation state through its
 * existing breathing/rotation behavior — no second chat state machine.
 */
export type DialoguePhase =

  | "idle"

  | "listening"

  | "typing"

  | "processing"

  | "responding"

  | "complete";





export interface GenesisMessage {

  id:string;

  role:

    | "user"

    | "assistant";

  text:string;

  timestamp:number;

  source:

    | "ai"

    | "local";

  provider?:string;

  confidence?:number;

  reasoning?:unknown;

  plan?:unknown;

}





export interface GenesisNotification {

  id:string;

  title:string;

  description?:string;

  created:number;

}





export interface GenesisCognitionState {

  agents:unknown[];

  workspaces:unknown[];

  nodes:unknown[];

  reasoning?:unknown;

  plan?:unknown;

}





export interface GenesisEcosystemState {

  biodiversity:number;

  vegetation:number;

  biomass:number;

  stability:number;

  adaptation:number;

  extinction:number;

}





export interface GenesisUIState {

  initialized:boolean;

  thinking:boolean;

  speaking:boolean;

  listening:boolean;

  online:boolean;

  mode:GenesisMode;

  /** Invisible-dialogue interaction phase (see DialoguePhase). */
  dialogue:DialoguePhase;

  /** App-level voice conversation phase (see VoicePhase). */
  voice:VoicePhase;

  messages:GenesisMessage[];

  /** Per-conversation workspace (the active chat's messages mirror `messages`). */
  conversations:ChatConversation[];

  activeConversationId:string;

  notifications:GenesisNotification[];

  activePanel:GenesisPanel;

  /** The active workspace scene — independent of which panel is open inside it.
      Scene changes are presentation only: the unified interface (chat, dock,
      side panel, modules) stays mounted above the scene switch, so opening
      chat or a module never tears down the current scene. */
  activeScene:"genesis"|"genesisv2";

  minimized:boolean;

  activeWorkspace:string | null;  activeDestination:string | null;
  cognition:GenesisCognitionState | null;
  actions:GenesisAction[];
  ecosystem:GenesisEcosystemState;
  engineStatuses:EngineStatus[];
  runtimeReady:boolean;
  /** Whether Self Exploration (autonomous LÉLU attention) is enabled. */
  selfExplorationEnabled:boolean;

  /** Unified modules — the authoritative "what is open / minimized / detached" state LÉLU reads. */
  modules:Record<string, ModuleState>;

  /** AUTO / ASSISTED / MANUAL presentation control. */
  uiControl:UiControlMode;


}





export interface GenesisContextValue {


  state:GenesisUIState;


  universe:UniverseState;

  /**
   * Read the mutable simulation snapshot from animation-frame code without
   * waiting for the throttled React publication used by the interface.
   */
  getLiveUniverse:()=>UniverseState;

  engineRuntime:EngineRuntime | null;

  engineStatuses:EngineStatus[];

  runtimeReady:boolean;

  activeDestination:string | null;

  eventBus:EventBus;

  dispatch(event:string, payload?:unknown):void;

  selectDestination(destination:GenesisTarget):void;


  updateUniverse(

    updater:

    (

      state:UniverseState,

    )=>void,

  ):void;



  setMode(

    mode:GenesisMode,

  ):void;



  addMessage(

    message:GenesisMessage,

  ):void;



  /** Replace-by-id or append — used for streaming assistant output. */

  upsertMessage(

    message:GenesisMessage,

  ):void;



  clearConversation():void;


  /** Multi-Chat workspace — one LÉLU cognition, many conversations. */
  createConversation(title?:string):string;

  switchConversation(id:string):void;

  renameConversation(id:string,title:string):void;

  closeConversation(id:string):void;

  archiveConversation(id:string):void;

  unarchiveConversation(id:string):void;

  duplicateConversation(id:string):void;

  pinConversation(id:string):void;

  linkConversations(a:string,b:string):void;

  unlinkConversations(a:string,b:string):void;

  setConversationProject(id:string,projectId:string|null):void;

  reorderConversations(ids:string[]):void;

  searchConversations(query:string,scope?:ConversationSearchScope):ConversationSearchHit[];

  /** Compact cross-chat context for the current conversation/query. */
  crossChatContext(query:string):string;



  setThinking(

    value:boolean,

  ):void;



  setSpeaking(

    value:boolean,

  ):void;



  setListening(

    value:boolean,

  ):void;



  setDialogue(

    phase:DialoguePhase,

  ):void;  setVoice(
    phase:VoicePhase,
  ):void;


  setSelfExploration(
    enabled:boolean,
  ):void;


  openPanel(
    panel:GenesisPanel,
  ):void;

  /** Unified module presentation control — one instance, many presentations. */
  setModulePresentation(id:string, presentation:ModulePresentation):void;
  openModule(id:string):void;
  expandModule(id:string):void;
  minimizeModule(id:string):void;
  closeModule(id:string):void;
  restoreModule(id:string):void;
  setModuleStatus(id:string, status:ModuleStatus):void;
  setUiControl(mode:UiControlMode):void;

  /** Window geometry + z-order for floating module windows — the canonical
      move/resize/stack operations LÉLU and the user share. */
  moveModule(id:string, position:{x:number;y:number}):void;
  resizeModule(id:string, size:{width:number;height:number}):void;
  raiseModule(id:string):void;

  /** Switch the workspace SCENE without touching open panels/chat — scene
      changes are presentation only (v1 ↔ Gen V2), same LÉLU runtime. */
  setActiveScene(scene:"genesis"|"genesisv2"):void;



  minimize():void;



  expand():void;



  focusWorkspace(

    id:string,

  ):void;



  updateCognition(

    cognition:GenesisCognitionState,

  ):void;



  updateEcosystem(

    ecosystem:GenesisEcosystemState,

  ):void;



  addAction(

    action:GenesisAction,

  ):void;



  updateAction(

    id:string,

    status:GenesisActionStatus,

  ):void;



  notify(

    title:string,

    description?:string,

  ):void;


  dismissNotification(

    id:string,

  ):void;


}





export const GenesisContext =

  createContext<GenesisContextValue | null>(

    null,

  );





export function useGenesis(){


  const context =

    useContext(

      GenesisContext,

    );


  if(!context){

    throw new Error(

      "useGenesis must be used inside GenesisCore",

    );

  }


  return context;

}





interface GenesisCoreProps {

  children?:ReactNode;

}





export default function GenesisCore({

  children,

}:GenesisCoreProps){

/* ------- workspace persistence (survives mobile tab minimize/reload) ------- */

const WORKSPACE_KEY = "lelu.workspace";

/**
 * Workspace persistence across THREE backends, in order:
 *   1. localStorage   — survives reload and tab close/reopen
 *   2. sessionStorage — survives reload in the same tab even when
 *      localStorage is blocked (sandboxed preview iframes)
 *   3. window.name    — survives reload even when both storages are
 *      blocked (WebContainer preview iframes, strict private modes)
 * Each backend is independently try/caught, so one blocked backend
 * can never take the app down — and the value is read FRESH at mount,
 * never captured once at module load.
 */
function readStoredWorkspace(): "genesisv2" | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(WORKSPACE_KEY);
    if (v === "genesisv2") return "genesisv2";
  } catch {
    /* backend blocked — try the next one */
  }
  try {
    const v = window.sessionStorage.getItem(WORKSPACE_KEY);
    if (v === "genesisv2") return "genesisv2";
  } catch {
    /* backend blocked — try the next one */
  }
  try {
    if (window.name === `lelu:${WORKSPACE_KEY}:genesisv2`) return "genesisv2";
  } catch {
    /* backend blocked */
  }
  return null;
}

function persistWorkspace(workspace: "genesisv2" | null): void {
  if (typeof window === "undefined") return;
  try {
    if (workspace === null) {
      window.localStorage.removeItem(WORKSPACE_KEY);
    } else {
      window.localStorage.setItem(WORKSPACE_KEY, workspace);
    }
  } catch {
    /* backend blocked */
  }
  try {
    if (workspace === null) {
      window.sessionStorage.removeItem(WORKSPACE_KEY);
    } else {
      window.sessionStorage.setItem(WORKSPACE_KEY, workspace);
    }
  } catch {
    /* backend blocked */
  }
  try {
    window.name = workspace === null ? "" : `lelu:${WORKSPACE_KEY}:genesisv2`;
  } catch {
    /* backend blocked */
  }
}

  /* Duplicate-runtime assertion — see genesisCoreMountCount above. */
  useEffect(() => {
    genesisCoreMountCount += 1;
    if (genesisCoreMountCount > 1) {
      console.warn(
        `[GenesisCore] DUPLICATE RUNTIME: ${genesisCoreMountCount} GenesisCore instances mounted. ` +
        "There must be exactly ONE LÉLU runtime — this is a duplicate-system bug.",
      );
    }
    return () => {
      genesisCoreMountCount -= 1;
    };
  }, []);

  const initialWorkspace = multiChat.restoreWorkspace();

  const [

    state,

    setState,

  ] = useState<GenesisUIState>({


    initialized:true,

    thinking:false,

    speaking:false,

    listening:false,

    online:true,

    mode:"chat",

    dialogue:"idle",

    voice:"idle",

    messages:initialWorkspace.messages,

    conversations:initialWorkspace.conversations,

    activeConversationId:initialWorkspace.activeId,

    notifications:[],

    // Restore the last immersive workspace (Genesis v2) so a mobile
    // tab minimize / page reload returns there instead of v1.
    activePanel:"none",

    // The workspace scene is independent of the open panel: entering
    // Gen V2 changes the scene, but opening chat/earth/modules keeps
    // the current scene and floats the panel above it — one interface,
    // many scenes.
    activeScene:readStoredWorkspace() === "genesisv2" ? "genesisv2" : "genesis",

    // The interface is tap-gated: the scene/runtime may initialize, but
    // chat must remain closed until the user taps the Core/Genesis control.
    // A restored Genesis v2 workspace still respects that gate.
    minimized:true,

    activeWorkspace:null,

    activeDestination:null,    engineStatuses:[],
    runtimeReady:false,
    selfExplorationEnabled:true,

    modules:{},

    // MANUAL by default: nothing opens or moves unless the user (or an
    // explicit command) says so. AUTO lets LÉLU's orchestrator choose.
    uiControl:"manual",




    cognition:{


      agents:[

        {

          id:"lelu",

          name:"Lélu",

          role:"Primary companion",

        },

      ],


      workspaces:[

        {

          id:"core",

          name:"Genesis Core",

        },


        {

          id:"research",

          name:"Research Lab",

        },


        {

          id:"creation",

          name:"Creation Studio",

        },

      ],


      nodes:[

        {

          id:"node-core",

          name:"Core node",

        },

      ],

    },


    actions:[],


    ecosystem:{


      biodiversity:0.1,

      vegetation:0.1,

      biomass:0.1,

      stability:0.8,

      adaptation:0,

      extinction:0,


    },


  });







  const universeRef =

    useRef<UniverseState>(

      structuredClone(

        defaultGenesisState,

      ),

    );

  const eventBusRef = useRef(new EventBus());

  const runtimeRef = useRef<EngineRuntime | null>(null);  const [

    universeVersion,

    setUniverseVersion,

  ] = useState(0);
  const lastUniversePublishRef = useRef(0);
  const publishUniverseRef = useRef<() => void>(() => undefined);

  useEffect(() => {

    let disposed = false;
    const runtime = new EngineRuntime();
    runtimeRef.current = runtime;

    void runtime.initialize()
      .then(() => {
        if (disposed) {
          return;
        }

        setState(current => ({
          ...current,
          online: true,
          runtimeReady: true,
          engineStatuses: runtime.getRegistry().getStatus(),
        }));

        if (!disposed) {
          void runtime.dispatch("genesis:ready", { state: universeRef.current });
        }
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }

        setState(current => ({
          ...current,
          online: false,
          runtimeReady: false,
          engineStatuses: runtime.getRegistry().getStatus(),
        }));
        console.error("Genesis runtime initialization failed", error);
      });

    const statusTimer = typeof window === "undefined"
      ? undefined
      : window.setInterval(() => {
        if (disposed) {
          return;
        }

        setState(current => ({
          ...current,
          engineStatuses: runtime.getRegistry().getStatus(),
        }));
      }, 1000);

    return () => {
      disposed = true;
      if (statusTimer !== undefined) {
        window.clearInterval(statusTimer);
      }
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
      runtime.getRegistry().clear();
    };

  }, []);







  /*
   * Reactive snapshot.
   *
   * Engines mutate universeRef.
   * React receives fresh data.
   */


  /*
   * Notification provider integration — one abstraction for dedup,
   * history, and deep-linking:
   *   1. in-app surface: route every notification into the existing
   *      state.notifications list (rendered by the notification center);
   *   2. deep-link: a proactive notification for a specific conversation
   *      opens that chat — never the wrong conversation.
   */
  useEffect(() => {
    const provider = NotificationProvider.getInstance();

    const removeNotifications = provider.subscribe((record) => {
      setState((current) => ({
        ...current,
        notifications: [
          ...current.notifications,
          {
            id: record.id,
            title: record.title,
            description: record.body,
            created: record.timestamp,
          },
        ],
      }));
    });

    const removeDeepLink = provider.subscribeDeepLink((link) => {
      if (link.conversationId) {
        multiChat.switchActive(link.conversationId);
      }
      setState((current) => {
        const active = multiChat.get(link.conversationId ?? current.activeConversationId);
        return {
          ...current,
          activeConversationId: link.conversationId ?? current.activeConversationId,
          messages: active ? active.messages : current.messages,
          conversations: multiChat.list(),
          activePanel: link.openChat ? "chat" : current.activePanel,
          minimized: link.openChat ? false : current.minimized,
        };
      });
    });

    return () => {
      removeNotifications();
      removeDeepLink();
    };
  }, []);


  const universe =

    useMemo(()=>({


      ...universeRef.current,


      astrology:{

        ...universeRef.current.astrology,

      },


      celestial:{

        ...universeRef.current.celestial,

      },


      ocean:{

        ...universeRef.current.ocean,

      },


      evolutionSystem:{

        ...universeRef.current.evolutionSystem,

      },


      memory:{

        ...universeRef.current.memory,

      },


      timeline:{

        ...universeRef.current.timeline,

      },


      coreTransform:{

        ...universeRef.current.coreTransform,

        history:

          universeRef.current.coreTransform.history.map(

            entry => ({ ...entry }),

          ),

      },


      pulse:{

        ...universeRef.current.pulse,

      },


    }),


    [

      universeVersion,

    ],


  );







  const updateUniverse = useCallback(
    (
      updater: (state: UniverseState) => void,
    ) => {
      updater(universeRef.current);
      publishUniverseRef.current();
    },
    [],
  );







  publishUniverseRef.current = () => {
    const now = Date.now();
    if (now - lastUniversePublishRef.current < 100) {
      return;
    }

    lastUniversePublishRef.current = now;
    setUniverseVersion(value => value + 1);
  };


  const dispatch = useCallback((event:string, payload?:unknown) => {
    void eventBusRef.current.emit(event, payload);

    if (runtimeRef.current) {
      void runtimeRef.current.dispatch(event, payload);
    }
  }, []);


  const selectDestination = useCallback((destination:GenesisTarget) => {
    setState(current => ({
      ...current,
      activeDestination: destination.id,
      activeWorkspace: destination.type === "workspace"
        ? destination.id
        : current.activeWorkspace,
    }));

    dispatch("genesis:destination-selected", destination);
    dispatch("genesis:navigation-request", destination);
    dispatch("genesis:interaction", {
      kind: "destination",
      target: destination,
    });
  }, [dispatch]);


  const value =

    useMemo<GenesisContextValue>(

      ()=>({        state,


        universe,

        getLiveUniverse: () => universeRef.current,

        engineRuntime: runtimeRef.current,

        engineStatuses: state.engineStatuses,

        runtimeReady: state.runtimeReady,

        activeDestination: state.activeDestination,

        eventBus: eventBusRef.current,

        dispatch,

        selectDestination,


        updateUniverse,



        setMode(mode){


          setState(current=>({


            ...current,


            mode,


          }));


        },



        addMessage(message){


          multiChat.addMessage(state.activeConversationId, message);


          setState(current=>{


            const active = multiChat.get(current.activeConversationId);


            return {


              ...current,


              messages: active ? active.messages : current.messages,


              conversations: multiChat.list(),


            };


          });


        },



        upsertMessage(message){


          multiChat.upsertMessage(state.activeConversationId, message);


          setState(current=>{


            const active = multiChat.get(current.activeConversationId);


            return {


              ...current,


              messages: active ? active.messages : current.messages,


              conversations: multiChat.list(),


            };


          });


        },



        clearConversation(){


          multiChat.clear(state.activeConversationId);


          setState(current=>({


            ...current,


            messages:[],


            conversations:multiChat.list(),


          }));


        },


        createConversation(title){


          const conversation = multiChat.create(title);


          setState(current=>({


            ...current,


            activeConversationId:conversation.id,


            messages:conversation.messages,


            conversations:multiChat.list(),


          }));


          return conversation.id;


        },


        switchConversation(id){


          const conversation = multiChat.switchActive(id);


          if(conversation){


            setState(current=>({


              ...current,


              activeConversationId:id,


              messages:conversation.messages,


              conversations:multiChat.list(),


            }));


          }


        },


        renameConversation(id,title){


          multiChat.rename(id,title);


          setState(current=>({ ...current, conversations:multiChat.list() }));


        },


        closeConversation(id){


          const nextActiveId = multiChat.remove(id);


          setState(current=>{


            const active = multiChat.get(nextActiveId);


            return {


              ...current,


              activeConversationId:nextActiveId,


              messages:active ? active.messages : [],


              conversations:multiChat.list(),


            };


          });


        },


        archiveConversation(id){


          const nextActiveId = multiChat.archive(id);


          setState(current=>{


            const active = multiChat.get(nextActiveId);


            return {


              ...current,


              activeConversationId:nextActiveId,


              messages:active ? active.messages : [],


              conversations:multiChat.list(),


            };


          });


        },


        unarchiveConversation(id){


          multiChat.unarchive(id);


          setState(current=>({ ...current, conversations:multiChat.list() }));


        },


        duplicateConversation(id){


          const conversation = multiChat.duplicate(id);


          if(conversation){


            setState(current=>({


              ...current,


              activeConversationId:conversation.id,


              messages:conversation.messages,


              conversations:multiChat.list(),


            }));


          }


        },


        pinConversation(id){


          multiChat.pin(id);


          setState(current=>({ ...current, conversations:multiChat.list() }));


        },


        linkConversations(a,b){


          multiChat.link(a,b);


          setState(current=>({ ...current, conversations:multiChat.list() }));


        },


        unlinkConversations(a,b){


          multiChat.unlink(a,b);


          setState(current=>({ ...current, conversations:multiChat.list() }));


        },


        setConversationProject(id,projectId){


          multiChat.setProject(id,projectId);


          setState(current=>({ ...current, conversations:multiChat.list() }));


        },


        reorderConversations(ids){


          multiChat.reorder(ids);


          setState(current=>({ ...current, conversations:multiChat.list() }));


        },


        searchConversations(query,scope){


          return multiChat.search(query,scope);


        },


        crossChatContext(query){


          return crossChat.buildContext(state.activeConversationId, query);


        },



        setThinking(value){


          setState(current=>({


            ...current,


            thinking:value,


          }));


        },



        setSpeaking(value){


          setState(current=>({


            ...current,


            speaking:value,


          }));


        },



        setListening(value){


          setState(current=>({


            ...current,


            listening:value,


          }));


        },



        setDialogue(phase){


          setState(current=>({


            ...current,


            dialogue:phase,


          }));


        },



        setVoice(phase){


          setState(current=>({


            ...current,


            voice:phase,


          }));


        },


        setSelfExploration(enabled){

          setState(current=>({

            ...current,

            selfExplorationEnabled:enabled,

          }));

        },



        openPanel(panel){

          dispatch("genesis:panel-open", { panel });

          // Closing everything ("none") clears the module set, returns to
          // the Genesis (v1) scene, and forgets the restored v2 workspace.
          if (panel === "none") {
            persistWorkspace(null);
            setState(current=>({
              ...current,
              activePanel:"none",
              modules:{},
              activeScene: current.activeScene === "genesisv2" ? "genesis" : current.activeScene,
            }));
            return;
          }

          // Entering Gen V2 changes the SCENE, not just a panel: the v2
          // workspace owns the viewport while the unified interface (chat,
          // dock, side panel, modules) stays mounted above it. The System
          // environment focus is cleared so v2 wins and returning to the
          // Genesis scene goes home, not into System.
          if (panel === "genesisv2") {
            persistWorkspace("genesisv2");
            VisualEngine.getInstance().setInterfaceFocus("genesis");
            setState(current=>{
              const existing = current.modules[panel];
              return {
                ...current,
                activeScene:"genesisv2",
                activePanel:panel,
                minimized:false,
                modules:{
                  ...current.modules,
                  [panel]: {
                    presentation:
                      existing && existing.presentation !== "closed"
                        ? existing.presentation
                        : ("inline" as ModulePresentation),
                    status: existing?.status ?? "idle",
                    updatedAt: Date.now(),
                  },
                },
              };
            });
            return;
          }

          setState(current=>{
            const existing = current.modules[panel];
            return {
              ...current,
              activePanel:panel,
              minimized:false,
              modules:{
                ...current.modules,
                [panel]: {
                  // Preserve an existing presentation (a detached Earth
                  // stays detached when a chat command drives it — the
                  // same single instance just updates its state). On
                  // phones a freshly opened tool becomes the primary
                  // expanded surface so it can never overlap the chat
                  // or the composer (see openModule for the same rule).
                  presentation:
                    existing && existing.presentation !== "closed"
                      ? existing.presentation
                      : typeof window !== "undefined" && window.innerWidth < 768
                        ? ("expanded" as ModulePresentation)
                        : ("inline" as ModulePresentation),
                  status: existing?.status ?? "idle",
                  updatedAt: Date.now(),
                },
              },
            };
          });

        },

        /* -------- unified module presentation (one instance per module) -------- */

        setModulePresentation(id, presentation){
          setState(current=>{
            // Persisted/legacy callers may still send the retired detached
            // mode. Collapse it into the canonical inline window instead of
            // allowing a second tab presentation to reappear.
            const normalizedPresentation = presentation === ("detached" as ModulePresentation) ? "inline" : presentation;
            const modules = {
              ...current.modules,
              [id]: {
                presentation: normalizedPresentation,
                status: current.modules[id]?.status ?? "idle",
                updatedAt: Date.now(),
              },
            };
            const anyOpen = Object.values(modules).some(m=>m.presentation !== "closed");
            return {
              ...current,
              modules,
              minimized:false,
              activePanel: normalizedPresentation === "closed"
                ? (anyOpen ? current.activePanel : "none")
                : (id as GenesisPanel),
            };
          });
        },

        openModule(id){
          setState(current=>{
            const currentPresentation = current.modules[id]?.presentation;
            const presentation: ModulePresentation =
              currentPresentation === "minimized"
                ? "expanded"
                : currentPresentation && currentPresentation !== "closed"
                  ? currentPresentation
                  : typeof window !== "undefined" && window.innerWidth < 768
                    ? "expanded"
                    : "inline";
            const modules = {
              ...current.modules,
              [id]: { presentation, status: current.modules[id]?.status ?? "idle", updatedAt: Date.now() },
            };
            return { ...current, modules, minimized:false, activePanel:id as GenesisPanel };
          });
        },

        expandModule(id){
          setState(current=>{
            const modules = {
              ...current.modules,
              [id]: { presentation:"expanded" as ModulePresentation, status: current.modules[id]?.status ?? "idle", updatedAt: Date.now() },
            };
            return { ...current, modules, minimized:false, activePanel:id as GenesisPanel };
          });
        },

        minimizeModule(id){
          setState(current=>{
            const modules = {
              ...current.modules,
              [id]: { presentation:"minimized" as ModulePresentation, status: current.modules[id]?.status ?? "idle", updatedAt: Date.now() },
            };
            return { ...current, modules, activePanel:id as GenesisPanel };
          });
        },

        closeModule(id){
          setState(current=>{
            const modules = { ...current.modules };
            delete modules[id];
            const anyOpen = Object.values(modules).some(m=>m.presentation !== "closed");
            return { ...current, modules, activePanel:anyOpen ? current.activePanel : "none" };
          });
        },

        restoreModule(id){
          setState(current=>{
            const modules = {
              ...current.modules,
              [id]: { presentation:"expanded" as ModulePresentation, status: current.modules[id]?.status ?? "idle", updatedAt: Date.now() },
            };
            return { ...current, modules, minimized:false, activePanel:id as GenesisPanel };
          });
        },

        setModuleStatus(id, status){
          setState(current=>{
            const existing = current.modules[id];
            if (!existing) return current;
            return {
              ...current,
              modules: {
                ...current.modules,
                [id]: { ...existing, status, updatedAt: Date.now() },
              },
            };
          });
        },

        setUiControl(mode){
          setState(current=>({ ...current, uiControl:mode }));
        },

        moveModule(id, position){
          setState(current=>{
            const existing = current.modules[id];
            if (!existing) return current;
            return {
              ...current,
              modules: {
                ...current.modules,
                [id]: { ...existing, position, updatedAt: Date.now() },
              },
            };
          });
        },

        resizeModule(id, size){
          setState(current=>{
            const existing = current.modules[id];
            if (!existing) return current;
            return {
              ...current,
              modules: {
                ...current.modules,
                [id]: { ...existing, size, updatedAt: Date.now() },
              },
            };
          });
        },

        raiseModule(id){
          setState(current=>{
            const existing = current.modules[id];
            if (!existing) return current;
            const top = Math.max(30, ...Object.values(current.modules)
              .map(m => m.zIndex ?? 30)) + 1;
            return {
              ...current,
              modules: {
                ...current.modules,
                [id]: { ...existing, zIndex: top, updatedAt: Date.now() },
              },
            };
          });
        },

        setActiveScene(scene){
          dispatch("genesis:scene-change", { scene });
          persistWorkspace(scene === "genesisv2" ? "genesisv2" : null);
          // Entering v2 also clears the System environment focus so v2
          // owns the viewport cleanly.
          if (scene === "genesisv2") {
            VisualEngine.getInstance().setInterfaceFocus("genesis");
          }
          setState(current=>({
            ...current,
            activeScene:scene,
            minimized:false,
          }));
        },



        minimize(){


          setState(current=>({


            ...current,


            // Minimizing hides the ENTIRE interface: the active panel
            // (chat dialogue, memory, browser, …) must unmount too, or
            // it stays floating over the scene after collapse.
            activePanel:"none",


            minimized:true,


            modules:{},


          }));


        },        expand(){



          setState(current=>({



            ...current,



            minimized:false,

            // Tapping the Core/Genesis chip opens the interface AND
            // shows the chat — the user expects the chat to appear
            // when they open the interface, not just the bare scene.
            activePanel:"chat",

          }));



        },



        focusWorkspace(id){

          dispatch("genesis:workspace-focused", { id });

          setState(current=>({


            ...current,


            activeWorkspace:id,


          }));


        },



        updateCognition(cognition){


          setState(current=>({


            ...current,


            cognition,


          }));


        },



        updateEcosystem(ecosystem){


          setState(current=>({


            ...current,


            ecosystem,


          }));


        },



        addAction(action){


          setState(current=>({


            ...current,


            actions:[

              ...current.actions,

              action,

            ],


          }));


        },



        updateAction(id,status){


          setState(current=>({


            ...current,


            actions:

              current.actions.map(

                action =>


                  action.id === id


                    ? {


                      ...action,

                      status,


                    }


                    :


                      action,


              ),


          }));


        },



        notify(title,description){


          setState(current=>({


            ...current,


            notifications:[


              ...current.notifications,


              {


                id:

                  crypto.randomUUID(),


                title,


                description,


                created:

                  Date.now(),


              },


            ],


          }));


        },


        dismissNotification(id){

          setState(current=>({

            ...current,

            notifications:
              current.notifications.filter(
                notification => notification.id !== id,
              ),

          }));

        },


      }),


      [
        state,
        universe,
        dispatch,
        selectDestination,
        updateUniverse,
      ],


    );







  return (

    <GenesisContext.Provider

      value={value}

    >

      {children}

    </GenesisContext.Provider>

  );

}