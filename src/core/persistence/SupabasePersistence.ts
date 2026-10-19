import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "../env/publicEnv";
import AgentEventBus, { type AgentEvent } from "../agent/AgentEvents";
import AgentStore from "../agents/AgentStore";
import type { LeluAgent } from "../agents/AgentTypes";
import UIStateStore, { type UIStateSnapshot } from "../cognition/UIStateStore";
import KnowledgeLibrary, { type KnowledgeEntry } from "../cognition/KnowledgeLibrary";
import MultiChatStore, { type ChatConversation, type ChatMessage } from "../multichat/MultiChatStore";
import ProjectStore, { type LeluProject } from "../projects/ProjectStore";
import ProactiveCore, { type ProactiveQuestion } from "../proactive/ProactiveCore";
import { parseLifecycle } from "../proactive/QuestionLifecycle";
import ImprovementQueue, { type ImprovementProposal } from "../selfdev/ImprovementQueue";
import type Brain from "../../brain/Brain";
import type ResponsePattern from "../../brain/ResponsePattern";
import type UserManager from "../user/UserManager";
import type UserProfile from "../user/UserProfile";
import { resolveFirst } from "../resolveEnv";

export type SupabasePersistenceStatus = "disabled" | "connecting" | "connected" | "signed_out" | "degraded";

export interface SupabaseAuthState {
  status: SupabasePersistenceStatus;
  session: Session | null;
  email: string | null;
  displayName: string | null;
}

type RemoteRow = Record<string, any>;

/**
 * Optional cloud persistence under the existing local-first runtime.
 * Local stores remain authoritative for immediate UI/cognition work. Supabase
 * is a durable mirror and recovery source; all failures are contained.
 */
/**
 * Upper bound on a persisted message body. Chosen above the longest message in
 * the existing store so hydrate → persist is lossless; exceeding it is flagged
 * in the row metadata rather than dropped quietly.
 */
const MESSAGE_TEXT_LIMIT = 48_000;

/**
 * Rows per hydration request.
 *
 * Comfortably under PostgREST's 1000-row default cap — a page larger than
 * the cap would come back short and be mistaken for the end of the table —
 * and small enough that one page cannot exhaust the 8s statement timeout.
 */
const HYDRATE_PAGE_SIZE = 500;

/** Ceiling on pages per table, so a pathological loop cannot run forever. */
const MAX_HYDRATE_PAGES = 200;

/**
 * Per-table bound for the small stores.
 *
 * Per TABLE, not for the whole hydration: the old single bound let the
 * slowest table discard every other table's rows.
 */
const CORE_HYDRATE_TIMEOUT_MS = 15_000;

export default class SupabasePersistence {
  private static instance: SupabasePersistence | null = null;
  private client: SupabaseClient | null = null;
  private userId: string | null = null;
  private status: SupabasePersistenceStatus = "disabled";
  private attached = false;
  private hydrated = false;
  /** True only once conversations AND every message page have been collected. */
  private historyHydrated = false;
  private historyProgress: { loaded: number; total: number } = { loaded: 0, total: 0 };
  private runtimeBrain: Brain | null = null;
  private runtimeUser: UserManager | null = null;
  private authSession: Session | null = null;
  private authSubscription: { unsubscribe: () => void } | null = null;
  private readonly authListeners = new Set<(state: SupabaseAuthState) => void>();
  private readonly runtimeUnsubscribers: Array<() => void> = [];
  private realtimeRefreshInFlight = new Set<string>();
  private realtimeChannel: ReturnType<SupabaseClient["channel"]> | null = null;

  private constructor() {}

  public static getInstance(): SupabasePersistence {
    if (!SupabasePersistence.instance) SupabasePersistence.instance = new SupabasePersistence();
    return SupabasePersistence.instance;
  }

  public getStatus(): SupabasePersistenceStatus { return this.status; }

  public getAuthState(): SupabaseAuthState {
    const user = this.authSession?.user;
    return {
      status: this.status,
      session: this.authSession,
      email: user?.email ?? null,
      displayName: (user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? null) as string | null,
    };
  }

  public subscribeAuth(listener: (state: SupabaseAuthState) => void): () => void {
    this.authListeners.add(listener);
    listener(this.getAuthState());
    return () => this.authListeners.delete(listener);
  }

  public isConnected(): boolean {
    return (this.status === "connected" || this.status === "degraded") && this.client !== null && this.userId !== null;
  }

  public async signInWithEmail(email: string, password: string): Promise<{ error: string | null }> {
    if (!this.client) await this.initialize(this.runtimeBrain ?? undefined, this.runtimeUser ?? undefined);
    if (!this.client) return { error: "Supabase is not configured." };

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return { error: "Enter your email and password." };
    const { error } = await this.client.auth.signInWithPassword({ email: normalizedEmail, password });
    return { error: error?.message ?? null };
  }

  public async signUpWithEmail(email: string, password: string): Promise<{ error: string | null; requiresConfirmation: boolean }> {
    if (!this.client) await this.initialize(this.runtimeBrain ?? undefined, this.runtimeUser ?? undefined);
    if (!this.client) return { error: "Supabase is not configured.", requiresConfirmation: false };

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return { error: "Enter your email and password.", requiresConfirmation: false };
    if (password.length < 6) return { error: "Use a password with at least 6 characters.", requiresConfirmation: false };
    const { data, error } = await this.client.auth.signUp({ email: normalizedEmail, password });
    return {
      error: error?.message ?? null,
      requiresConfirmation: !error && !data.session,
    };
  }

  public async signOut(): Promise<{ error: string | null }> {
    if (!this.client) return { error: null };
    const { error } = await this.client.auth.signOut();
    if (error) return { error: error.message };
    return { error: null };
  }

  public async initialize(brain?: Brain, user?: UserManager): Promise<SupabasePersistenceStatus> {
    if (brain) this.runtimeBrain = brain;
    if (user) this.runtimeUser = user;
    if (this.client && (this.status === "connected" || this.status === "signed_out")) {
      if (this.authSession && brain && !this.hydrated) await this.hydrateRuntime(brain, user);
      return this.status;
    }

    // Resolved through the FULL chain, not just the VITE_-prefixed names.
    //
    // publicEnv() only carries `import.meta.env.VITE_*`, so an operator who
    // set the documented unprefixed names — SUPABASE_URL and
    // SUPABASE_PUBLISHABLE_KEY, which is what ENV_VARS.md asks for and what
    // the server itself reads — configured the server and left the browser
    // blind. Supabase then reported "not configured" on a correctly
    // configured deployment, which is why cloud identity never worked.
    //
    // resolveFirst also consults the `__LELU_*__` globals that
    // plugins/runtimeKeyBridge.ts publishes, which is the browser's only
    // route to an unprefixed value.
    const firstConfigured = (...values: Array<string | undefined>): string =>
      values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
    const env = publicEnv();
    const url = firstConfigured(
      resolveFirst("SUPABASE_URL", "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
      env.VITE_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_URL,
    );
    const publishableKey = firstConfigured(
      resolveFirst(
        "SUPABASE_PUBLISHABLE_KEY",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      ),
      env.VITE_SUPABASE_PUBLISHABLE_KEY,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
    if (!url || !publishableKey) {
      this.status = "disabled";
      this.emitAuthState();
      return this.status;
    }

    this.status = "connecting";
    this.emitAuthState();
    try {
      this.client = createClient(url, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      this.authSubscription = this.client.auth.onAuthStateChange((_event, session) => {
        // Supabase holds an internal auth lock during this callback. Queue
        // hydration/realtime work after the callback returns.
        setTimeout(() => void this.applySession(session), 0);
      }).data.subscription;
      // Bounded network: an unreachable/slow Supabase must NEVER stall LÉLU's
      // boot or a chat turn — the app falls back to local mode (status
      // "degraded") exactly as the catch below describes, just on a timer
      // instead of waiting forever.
      const existing = await this.withTimeout(
        this.client.auth.getSession(),
        6000,
        "Supabase session check",
      );
      const session = existing.data.session;
      // Older builds created anonymous Supabase users automatically. Do not
      // continue that identity now that Google is the explicit cloud account.
      if (session?.user?.is_anonymous) {
        await this.withTimeout(this.client.auth.signOut(), 4000, "Supabase sign-out");
        await this.applySession(null);
      } else {
        await this.applySession(session);
      }
      return this.status;
    } catch (error) {
      this.status = "degraded";
      this.emitAuthState();
      console.warn("[Lélu] Supabase persistence unavailable; local mode remains active", error);
      return this.status;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  private emitAuthState(): void {
    const state = this.getAuthState();
    for (const listener of this.authListeners) {
      try { listener(state); } catch { /* auth observers are isolated */ }
    }
  }

  private detachRuntime(): void {
    while (this.runtimeUnsubscribers.length > 0) {
      this.runtimeUnsubscribers.pop()?.();
    }
    this.attached = false;
    this.hydrated = false;
    if (this.realtimeChannel) {
      void this.realtimeChannel.unsubscribe();
      this.realtimeChannel = null;
    }
  }

  private async applySession(session: Session | null): Promise<void> {
    const nextUserId = session?.user?.id ?? null;
    const changedUser = nextUserId !== this.userId;
    if (changedUser) this.detachRuntime();

    this.authSession = session;
    this.userId = nextUserId;
    if (!session || !nextUserId) {
      this.status = "signed_out";
      this.emitAuthState();
      return;
    }

    this.status = "connected";
    this.emitAuthState();
    this.startRealtime();
    if (this.runtimeBrain && !this.hydrated) {
      // Bounded hydration: a slow table read must not stall the turn.
      await this.withTimeout(
        this.hydrateRuntime(this.runtimeBrain, this.runtimeUser ?? undefined),
        8000,
        "Supabase hydration",
      );
    }
    this.attachRuntime();
  }

  /**
   * Hydrate the existing stores; never clears local state.
   *
   * Two phases, because the tables are not alike.
   *
   * Everything used to be read in ONE `Promise.all` under one 10s bound. On
   * the live project that meant the slowest table decided the fate of all
   * eleven: a single timeout threw, the catch marked the status degraded,
   * and NOTHING hydrated — memories included, even though memories are
   * small and had already arrived. Conversations and messages are the heavy
   * ones (235 and 1043 rows and growing); the rest are tens of rows.
   *
   * So the small stores hydrate first, under their own bound, and the heavy
   * conversation history continues in the background afterwards. The UI is
   * not kept waiting on chat history, and a slow history can no longer cost
   * the user their memories.
   */
  public async hydrateRuntime(brain: Brain, user?: UserManager): Promise<void> {
    if (!this.isConnected() || this.hydrated || !this.client) return;
    this.hydrated = true;

    await this.hydrateCoreStores(brain, user);

    // Deliberately not awaited: conversation history is large and the
    // interface is usable without it. It merges in as it arrives.
    void this.hydrateConversationHistory();
  }

  /**
   * The small stores — memories, projects, agents, questions, settings.
   *
   * Each read is settled independently so one failure cannot discard the
   * others. That is the difference between "chat history was slow" and
   * "LÉLU lost her memory this session".
   */
  private async hydrateCoreStores(brain: Brain, user?: UserManager): Promise<void> {
    const read = async (table: string, orderBy = "id"): Promise<RemoteRow[]> => {
      try {
        return await this.withTimeout(this.read(table, { orderBy }), CORE_HYDRATE_TIMEOUT_MS, `Supabase ${table} hydrate`);
      } catch (error) {
        this.status = "degraded";
        console.warn(`[Lélu] Supabase hydrate for ${table} degraded`, error);
        return [];
      }
    };

    const [
      memoryRows, projectRows, agentRows, questionRows,
      knowledgeRows, improvementRows, uiRows, newsRows, preferenceRows,
    ] = await Promise.all([
      read("memory_items"),
      read("projects"),
      read("agents"),
      read("proactive_questions"),
      read("knowledge_items"),
      read("improvement_items"),
      // These three have no `id`: ui_state and news_preferences are one row
      // per user, user_preferences is keyed (user_id, preference_key).
      read("ui_state", "user_id"),
      read("news_preferences", "user_id"),
      read("user_preferences", "user_id"),
    ]);

    try {
      const memories = memoryRows.map((row) => this.toMemory(row)).filter((item): item is ResponsePattern => Boolean(item));
      await brain.mergeMemories(memories);
      ProjectStore.getInstance().mergeRemote(projectRows.map((row) => this.toProject(row)).filter((item): item is LeluProject => Boolean(item)));
      AgentStore.getInstance().mergeRemote(agentRows.map((row) => this.toAgent(row)).filter((item): item is LeluAgent => Boolean(item)));
      ProactiveCore.getInstance().mergeRemote(questionRows.map((row) => this.toQuestion(row)).filter((item): item is ProactiveQuestion => Boolean(item)));
      KnowledgeLibrary.getInstance().mergeRemote(knowledgeRows.map((row) => this.toKnowledge(row)).filter((item): item is KnowledgeEntry => Boolean(item)));
      ImprovementQueue.getInstance().mergeRemote(improvementRows.map((row) => this.toImprovement(row)).filter((item): item is ImprovementProposal => Boolean(item)));
      const uiRow = uiRows[0];
      if (uiRow?.state && typeof uiRow.state === "object") UIStateStore.getInstance().update(uiRow.state as Partial<UIStateSnapshot>);
      const newsRow = newsRows[0];
      if (Array.isArray(newsRow?.topics)) ProactiveCore.getInstance().mergeNewsPreferences(newsRow.topics);
      const profileRow = preferenceRows.find((row) => row.preference_key === "profile");
      if (user && profileRow?.value && typeof profileRow.value === "object") await user.mergeRemote(profileRow.value as UserProfile);
    } catch (error) {
      this.status = "degraded";
      console.warn("[Lélu] Supabase hydration degraded; local state remains active", error);
    }
  }

  /**
   * Conversations and their messages, merged progressively.
   *
   * Conversations arrive first so the chat list is populated, then messages
   * page in and are merged as each page lands. A partial result is never
   * mistaken for a complete one: `read` throws rather than return short, and
   * `historyHydrated` is only set once both tables are fully collected, so a
   * caller can tell "still loading" from "done".
   */
  private async hydrateConversationHistory(): Promise<void> {
    try {
      const conversationRows = await this.read("conversations");
      // The conversation LIST can be shown before any message has arrived.
      this.mergeConversations(conversationRows, []);

      const messageRows: RemoteRow[] = [];
      await this.read("messages", {
        onPage: (rows, loaded, total) => {
          this.historyProgress = { loaded, total };
          // Merge each page as it lands, so a long history fills in
          // progressively instead of appearing all at once at the end.
          messageRows.push(...rows);
          this.mergeConversations(conversationRows, messageRows);
        },
      });

      this.mergeConversations(conversationRows, messageRows);
      this.historyHydrated = true;
    } catch (error) {
      // History stays incomplete and says so, rather than the store being
      // left looking authoritative while rows are missing.
      this.status = "degraded";
      this.historyHydrated = false;
      console.warn("[Lélu] Supabase conversation history hydration incomplete", error);
    }
  }

  /**
   * Merge remote conversations without dropping messages that have not
   * arrived yet.
   *
   * MultiChatStore.mergeRemote REPLACES a conversation whole when the remote
   * copy is newer. During a paged hydration the remote copy is newer and its
   * `messages` array is still partial — so a naive merge would overwrite a
   * fully-loaded local conversation with an empty or half-filled one, which
   * is the silent record loss this work exists to end.
   *
   * So a conversation keeps whichever message set is larger: the incoming
   * page-so-far, or what the store already holds. Messages are only ever
   * added by hydration, never removed.
   */
  private mergeConversations(conversationRows: RemoteRow[], messageRows: RemoteRow[]): void {
    const store = MultiChatStore.getInstance();
    const existing = new Map(store.listAll().map((conversation) => [conversation.id, conversation]));
    const incoming = this.toConversations(conversationRows, messageRows).map((conversation) => {
      const local = existing.get(conversation.id);
      if (!local || conversation.messages.length >= local.messages.length) return conversation;
      return { ...conversation, messages: local.messages };
    });
    store.mergeRemote(incoming);
  }

  /** Has the full conversation history finished loading? */
  public isHistoryHydrated(): boolean {
    return this.historyHydrated;
  }

  /** How far the background history load has got, for status surfaces. */
  public getHistoryProgress(): { loaded: number; total: number } {
    return { ...this.historyProgress };
  }

  /** Attach canonical stores and meaningful event streams once after boot. */
  public attachRuntime(): void {
    if (this.attached || !this.isConnected()) return;
    this.attached = true;
    const projects = ProjectStore.getInstance();
    const agents = AgentStore.getInstance();
    const proactive = ProactiveCore.getInstance();
    const chats = MultiChatStore.getInstance();
    const ui = UIStateStore.getInstance();
    const improvements = ImprovementQueue.getInstance();
    const events = AgentEventBus.getInstance();

    this.runtimeUnsubscribers.push(
      projects.subscribe((value) => void this.persistProjects(value)),
      agents.subscribe((value) => void this.persistAgents(value)),
      proactive.subscribeQuestions((value) => void this.persistQuestion(value)),
      proactive.subscribeQuestionChanges((value) => void this.persistQuestion(value)),
      chats.subscribe((value) => void this.persistConversations(value)),
      ui.subscribe((value) => void this.persistUiState(value)),
      improvements.subscribe((value) => void this.persistImprovements(value)),
      KnowledgeLibrary.getInstance().subscribe((value) => void this.persistKnowledge(value)),
      events.subscribe((event) => void this.persistCognitiveEvent(event)),
    );

    void this.persistProjects(projects.list());
    void this.persistAgents(agents.list());
    void this.persistQuestion(proactive.getActiveQuestion());
    void this.persistConversations(chats.list());
    void this.persistUiState(ui.get());
    void this.persistImprovements(improvements.list());
    if (this.runtimeUser) {
      this.runtimeUnsubscribers.push(this.runtimeUser.subscribe((profile) => void this.persistUserProfile(profile)));
    }
    if (this.runtimeBrain) {
      void this.runtimeBrain.recallAll().then((memories) => this.persistMemories(memories));
    }
  }

  public async persistMemories(memories: ResponsePattern[]): Promise<void> {
    if (!this.isConnected() || memories.length === 0) return;
    await this.write("memory_items", memories.map((memory) => ({
      id: memory.id, user_id: this.userId, category: memory.category,
      memory_type: memory.memoryType ?? "user", prompt: memory.prompt.slice(0, 2000),
      response: memory.response.slice(0, 6000), keywords: memory.keywords.slice(0, 40),
      context: memory.context, importance: memory.importance, confidence: memory.confidence,
      successful_uses: memory.successfulUses, failed_uses: memory.failedUses,
      created_at: new Date(memory.createdAt).toISOString(), updated_at: new Date(memory.updatedAt).toISOString(),
    })), "memory_items");
  }

  public async persistUserProfile(profile: UserProfile): Promise<void> {
    if (!this.isConnected()) return;
    await this.write("user_preferences", [{ user_id: this.userId, preference_key: "profile", value: profile, updated_at: new Date(profile.updatedAt).toISOString() }], "user_preferences");
  }

  public async persistNewsPreferences(topics: string[]): Promise<void> {
    if (!this.isConnected()) return;
    await this.write("news_preferences", [{ user_id: this.userId, topics: topics.slice(-40), metadata: {}, updated_at: new Date().toISOString() }], "news_preferences");
  }

  public async persistKnowledge(entries: KnowledgeEntry[]): Promise<void> {
    if (!this.isConnected() || entries.length === 0) return;
    await this.write("knowledge_items", entries.map((entry) => ({
      id: entry.id, user_id: this.userId, title: entry.title, domain: entry.domain,
      detail: entry.detail.slice(0, 4000), source: entry.source ?? null,
      metadata: { status: entry.status }, updated_at: new Date(entry.updatedAt).toISOString(),
      created_at: new Date(entry.updatedAt).toISOString(),
    })), "knowledge_items");
  }

  public async persistApiHealth(records: Array<Record<string, unknown>>): Promise<void> {
    if (!this.isConnected() || records.length === 0) return;
    await this.write("api_health", records.map((record) => ({
      provider: String(record.provider ?? record.name ?? "unknown"), user_id: this.userId,
      status: String((record.health as Record<string, unknown> | undefined)?.status ?? record.status ?? "unknown"), latency_ms: typeof (record.health as Record<string, unknown> | undefined)?.latency === "number" ? (record.health as Record<string, unknown>).latency as number : typeof record.latency === "number" ? record.latency : null,
      details: record, checked_at: new Date().toISOString(),
    })), "api_health");
  }

  private async persistProjects(projects: LeluProject[]): Promise<void> {
    if (!this.isConnected()) return;
    await this.write("projects", projects.map((project) => ({
      id: project.id, user_id: this.userId, name: project.name, description: project.description,
      status: project.status, agent_ids: project.agentIds, items: project.items, queries: project.queries ?? [],
      schedule: project.schedule ?? null,
      // Structured request fields round-trip through the metadata jsonb
      // column (added by migration 202608240002) so the full user
      // instruction and execution plan survive sync/recovery.
      metadata: {
        originalRequest: project.originalRequest ?? null,
        objective: project.objective ?? null,
        context: project.context ?? null,
        actionableTasks: project.actionableTasks ?? [],
        priority: project.priority ?? null,
        location: project.location ?? null,
        executionPlan: project.executionPlan ?? [],
      },
      created_at: new Date(project.createdAt).toISOString(), updated_at: new Date(project.updatedAt).toISOString(),
    })), "projects");
  }

  private async persistAgents(agents: LeluAgent[]): Promise<void> {
    if (!this.isConnected()) return;
    await this.write("agents", agents.map((agent) => ({
      id: agent.id, user_id: this.userId, name: agent.name, role: agent.role, status: agent.status,
      enabled: agent.enabled, project_id: agent.projectId, state: agent,
      updated_at: new Date(agent.updatedAt).toISOString(),
    })), "agents");
  }

  private async persistQuestion(question: ProactiveQuestion | null): Promise<void> {
    if (!question || !this.isConnected()) return;
    await this.write("proactive_questions", [{
      id: question.id, user_id: this.userId, question: question.question, question_key: question.key,
      category: question.category, reason: question.reason, priority: question.priority,
      related_project_id: question.relatedProjectId ?? null, related_task: question.relatedTask ?? null,
      blocks_execution: question.blocksExecution, remember_answer: question.rememberAnswer, status: question.status,
      user_response: question.userResponse ?? null, asked_at: new Date(question.askedAt).toISOString(),
      // The lifecycle is what makes a dismissal survive a sync. Without it
      // a reconnect would hydrate a question whose coarse status still read
      // "pending" and surface it again — the resurfacing bug, restored by
      // the database.
      lifecycle: question.lifecycle ?? {},
      resolved_at: question.resolvedAt ? new Date(question.resolvedAt).toISOString() : null,
      created_at: new Date(question.createdAt).toISOString(), updated_at: new Date(question.updatedAt).toISOString(),
    }], "proactive_questions");
  }

  private async persistConversations(conversations: ChatConversation[]): Promise<void> {
    if (!this.isConnected()) return;
    await this.write("conversations", conversations.map((conversation) => ({
      id: conversation.id, user_id: this.userId, title: conversation.title, project_id: conversation.projectId,
      metadata: { pinned: conversation.pinned, linkedIds: conversation.linkedIds, tags: conversation.tags, topic: conversation.topic, unread: conversation.unread, processing: conversation.processing },
      created_at: new Date(conversation.createdAt).toISOString(), updated_at: new Date(conversation.updatedAt).toISOString(),
    })), "conversations");
    const messages = conversations.flatMap((conversation) => conversation.messages.map((message) => {
      // Hydrate reads whatever is stored, so a cap below the longest existing
      // message would silently shorten real history on every round trip.
      // The cap stays well above observed content, and when it does bite the
      // loss is recorded instead of being invisible.
      const truncated = message.text.length > MESSAGE_TEXT_LIMIT;
      return {
        id: message.id, user_id: this.userId, conversation_id: conversation.id, role: message.role,
        text: truncated ? message.text.slice(0, MESSAGE_TEXT_LIMIT) : message.text,
        provider: message.provider ?? null, confidence: message.confidence ?? null,
        metadata: {
          source: message.source, reasoning: message.reasoning, plan: message.plan,
          ...(truncated ? { truncated: true, originalLength: message.text.length } : {}),
        },
        created_at: new Date(message.timestamp).toISOString(),
      };
    }));
    await this.write("messages", messages, "messages");
  }

  private async persistUiState(state: UIStateSnapshot): Promise<void> {
    if (!this.isConnected()) return;
    await this.write("ui_state", [{ user_id: this.userId, state, updated_at: new Date().toISOString() }], "ui_state");
  }

  private async persistImprovements(proposals: ImprovementProposal[]): Promise<void> {
    if (!this.isConnected() || proposals.length === 0) return;
    await this.write("improvement_items", proposals.map((proposal) => ({
      id: proposal.id, user_id: this.userId, state: proposal, updated_at: new Date(proposal.updated).toISOString(),
    })), "improvement_items");
  }

  private async persistCognitiveEvent(event: AgentEvent): Promise<void> {
    if (!this.isConnected()) return;
    await this.append("cognitive_events", [{ user_id: this.userId, event_type: event.type, task_id: event.taskId, payload: event, created_at: new Date().toISOString() }], "cognitive_events");
  }

  public async reconnect(brain?: Brain, user?: UserManager): Promise<SupabasePersistenceStatus> {
    this.detachRuntime();
    this.authSubscription?.unsubscribe();
    this.authSubscription = null;
    this.status = "disabled";
    this.client = null;
    this.userId = null;
    this.authSession = null;
    this.emitAuthState();
    return this.initialize(brain, user);
  }

  /**
   * Read a whole table, in pages, without ever silently losing rows.
   *
   * `select("*")` with no range is capped by PostgREST's `db-max-rows`
   * (1000 on Supabase by default). With 1043 messages in the live project
   * that returned 1000 rows and NO error — 43 messages vanished, and
   * hydration reported success. A truncated read is indistinguishable from
   * a complete one unless you ask how many rows there really are, so this
   * asks: the first page requests an exact count, and paging continues
   * until that many rows have been collected.
   *
   * Pages are also small enough to stay inside the 8s `statement_timeout`
   * that Supabase sets on the `authenticated` role, which a single
   * unbounded scan of a large table can exceed.
   *
   * `onPage` makes the read incremental: a caller can merge each page as it
   * lands instead of waiting for the whole table.
   */
  private async read(
    table: string,
    options: {
      onPage?: (rows: RemoteRow[], loaded: number, total: number) => void;
      /** Stable sort key. See the ordering note below. */
      orderBy?: string;
    } = {},
  ): Promise<RemoteRow[]> {
    if (!this.client) return [];

    const collected: RemoteRow[] = [];
    let total = 0;
    let pagesRead = 0;

    for (let page = 0; page < MAX_HYDRATE_PAGES; page += 1) {
      pagesRead = page + 1;
      const from = page * HYDRATE_PAGE_SIZE;
      const to = from + HYDRATE_PAGE_SIZE - 1;
      // The exact count is requested on every page rather than only the
      // first: rows can be inserted while a long hydration is running, and
      // a stale total would stop paging early.
      // ORDER BY is not optional here. Postgres guarantees no row order
      // without one, so two unordered range requests may return overlapping
      // or disjoint slices — pages would silently duplicate some rows and
      // skip others, which looks exactly like the truncation this paging
      // replaced. Every hydrated table is ordered by a stable unique key.
      const { data, error, count } = await this.client
        .from(table)
        .select("*", { count: "exact" })
        .order(options.orderBy ?? "id", { ascending: true })
        .range(from, to);
      if (error) throw error;

      const rows = Array.isArray(data) ? (data as RemoteRow[]) : [];
      if (typeof count === "number") total = count;
      collected.push(...rows);
      options.onPage?.(rows, collected.length, total || collected.length);

      // A short page means the server had nothing more to give.
      if (rows.length < HYDRATE_PAGE_SIZE) break;
      if (total > 0 && collected.length >= total) break;
    }

    // Reaching the page ceiling with rows still outstanding is a real
    // shortfall. Returning quietly here is the exact failure this method
    // exists to prevent, so it is raised instead.
    if (total > 0 && collected.length < total) {
      throw new Error(
        `Hydration incomplete for ${table}: ${collected.length} of ${total} rows after ${pagesRead} page(s).`,
      );
    }
    return collected;
  }

  private async readOne(table: string): Promise<RemoteRow | null> {
    const rows = await this.read(table);
    return rows[0] ?? null;
  }

  // Append-only tables (event logs) carry a server-generated id and no
  // (id,user_id) unique index, so they must be inserted, never upserted.
  private async append(table: string, rows: RemoteRow[], label: string): Promise<boolean> {
    if (!this.client || !this.userId || rows.length === 0) return false;
    const { error } = await this.client.from(table).insert(rows);
    if (error) {
      this.status = "degraded";
      console.warn(`[Lélu] Supabase ${label} sync degraded`, error.message);
      return false;
    }
    return true;
  }

  private async write(table: string, rows: RemoteRow[], label: string): Promise<void> {
    if (!this.client || !this.userId || rows.length === 0) return;
    const { error } = await this.client.from(table).upsert(rows, { onConflict: this.conflictKey(table) });
    if (error) {
      this.status = "degraded";
      console.warn(`[Lélu] Supabase ${label} sync degraded`, error.message);
    }
  }

  // Upsert conflict targets must name an actual unique index on the table or
  // Postgres rejects the statement outright (42P10 / 42703). Verified against
  // the live schema: ui_state(user_id), news_preferences(user_id),
  // api_health(user_id,provider), user_preferences(user_id,preference_key),
  // proactive_questions(user_id,question_key); everything else is (id,user_id).
  private conflictKey(table: string): string {
    if (table === "api_health") return "user_id,provider";
    if (table === "ui_state" || table === "news_preferences") return "user_id";
    if (table === "user_preferences") return "user_id,preference_key";
    if (table === "proactive_questions") return "user_id,question_key";
    return "id,user_id";
  }

  private toMemory(row: RemoteRow): ResponsePattern | null {
    if (!row.id || !row.response) return null;
    return {
      id: String(row.id), category: row.category ?? "general", prompt: row.prompt ?? "",
      response: row.response, intent: "general", keywords: Array.isArray(row.keywords) ? row.keywords : [],
      context: row.context ?? {}, memoryType: row.memory_type ?? "user", importance: Number(row.importance ?? 0.5),
      confidence: Number(row.confidence ?? 0.5), successfulUses: Number(row.successful_uses ?? 0),
      failedUses: Number(row.failed_uses ?? 0), createdAt: Date.parse(row.created_at) || Date.now(), updatedAt: Date.parse(row.updated_at) || Date.now(),
    };
  }

  private toProject(row: RemoteRow): LeluProject | null {
    if (!row.id || !row.name) return null;
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    return {
      id: String(row.id), name: row.name, description: row.description ?? "", status: row.status ?? "active",
      agentIds: Array.isArray(row.agent_ids) ? row.agent_ids : [], items: Array.isArray(row.items) ? row.items : [],
      queries: Array.isArray(row.queries) ? row.queries : [], schedule: row.schedule ?? undefined,
      originalRequest: typeof metadata.originalRequest === "string" ? metadata.originalRequest : undefined,
      objective: typeof metadata.objective === "string" ? metadata.objective : undefined,
      context: typeof metadata.context === "string" ? metadata.context : undefined,
      actionableTasks: Array.isArray(metadata.actionableTasks) ? metadata.actionableTasks : undefined,
      priority: typeof metadata.priority === "string" ? metadata.priority : undefined,
      location: typeof metadata.location === "string" ? metadata.location : undefined,
      executionPlan: Array.isArray(metadata.executionPlan) ? metadata.executionPlan : undefined,
      createdAt: Date.parse(row.created_at) || Date.now(), updatedAt: Date.parse(row.updated_at) || Date.now(),
    };
  }

  private toAgent(row: RemoteRow): LeluAgent | null {
    const state = row.state && typeof row.state === "object" ? row.state as LeluAgent : null;
    if (!row.id || !state?.name) return null;
    return { ...state, id: String(row.id), status: row.status ?? state.status, enabled: row.enabled ?? state.enabled, projectId: row.project_id ?? state.projectId, updatedAt: Date.parse(row.updated_at) || state.updatedAt };
  }

  private toQuestion(row: RemoteRow): ProactiveQuestion | null {
    if (!row.id || !row.question) return null;
    // Validated, not cast: this comes from a jsonb column and from other
    // devices, so a malformed value must read as "none recorded".
    const lifecycle = parseLifecycle(row.lifecycle);
    return { id: String(row.id), key: row.question_key, question: row.question, category: row.category, reason: row.reason ?? "", priority: row.priority, relatedProjectId: row.related_project_id ?? undefined, relatedTask: row.related_task ?? undefined, blocksExecution: Boolean(row.blocks_execution), rememberAnswer: row.remember_answer !== false, askedAt: Date.parse(row.asked_at) || Date.now(), userResponse: row.user_response ?? undefined, resolvedAt: row.resolved_at ? Date.parse(row.resolved_at) : undefined, status: row.status, createdAt: Date.parse(row.created_at) || Date.now(), updatedAt: Date.parse(row.updated_at) || Date.now(),
      // An empty jsonb is a row written before the lifecycle existed.
      // Leaving it undefined lets ProactiveCore derive one from `status`,
      // rather than inventing a "never shown" history for a question the
      // user already closed.
      ...(lifecycle ? { lifecycle } : {}) };
  }

  private toConversations(rows: RemoteRow[], messageRows: RemoteRow[]): ChatConversation[] {
    const messagesByConversation = new Map<string, ChatMessage[]>();
    for (const row of messageRows) {
      const list = messagesByConversation.get(String(row.conversation_id)) ?? [];
      list.push({ id: String(row.id), role: row.role, text: row.text ?? "", timestamp: Date.parse(row.created_at) || Date.now(), source: row.provider ? "ai" : "local", provider: row.provider ?? undefined, confidence: row.confidence ?? undefined, reasoning: row.metadata?.reasoning, plan: row.metadata?.plan });
      messagesByConversation.set(String(row.conversation_id), list);
    }
    return rows.filter((row) => row.id).map((row) => {
      const metadata = row.metadata ?? {};
      return { id: String(row.id), title: row.title ?? "New chat", messages: messagesByConversation.get(String(row.id)) ?? [], createdAt: Date.parse(row.created_at) || Date.now(), updatedAt: Date.parse(row.updated_at) || Date.now(), pinned: Boolean(metadata.pinned), archived: Boolean(metadata.archived), linkedIds: Array.isArray(metadata.linkedIds) ? metadata.linkedIds : [], projectId: row.project_id ?? null, tags: Array.isArray(metadata.tags) ? metadata.tags : [], topic: metadata.topic ?? "", unread: Number(metadata.unread ?? 0), processing: Boolean(metadata.processing) };
    });
  }

  private toKnowledge(row: RemoteRow): KnowledgeEntry | null {
    if (!row.id || !row.title) return null;
    return { id: String(row.id), title: row.title, domain: row.domain, detail: row.detail ?? "", status: row.metadata?.status ?? "learned", source: row.source ?? undefined, updatedAt: Date.parse(row.updated_at) || Date.now() };
  }

  private toImprovement(row: RemoteRow): ImprovementProposal | null {
    if (!row.id || !row.state || typeof row.state !== "object") return null;
    return { ...row.state, id: String(row.id), updated: Number(row.state.updated ?? Date.parse(row.updated_at) ?? Date.now()) } as ImprovementProposal;
  }

  private startRealtime(): void {
    if (!this.client || !this.userId || this.realtimeChannel) return;
    const tables = ["projects", "agents", "proactive_questions", "ui_state"];
    let channel = this.client.channel("lelu-runtime-state");
    for (const table of tables) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `user_id=eq.${this.userId}` }, (payload) => {
        void this.applyRealtimeTable(table);
        AgentEventBus.getInstance().emit({ type: "cognitive_sync", taskId: `realtime-${Date.now()}`, source: `supabase.${table}`, detail: payload.eventType });
      });
    }
    this.realtimeChannel = channel;
    void channel.subscribe((channelStatus) => {
      if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT") this.status = "degraded";
    });
  }

  /** Pull the changed table once and merge it through the canonical store. */
  private async applyRealtimeTable(table: string): Promise<void> {
    if (!this.isConnected() || this.realtimeRefreshInFlight.has(table)) return;
    this.realtimeRefreshInFlight.add(table);
    try {
      if (table === "projects") {
        const rows = await this.read("projects");
        ProjectStore.getInstance().mergeRemote(rows.map((row) => this.toProject(row)).filter((item): item is LeluProject => Boolean(item)));
      } else if (table === "agents") {
        const rows = await this.read("agents");
        AgentStore.getInstance().mergeRemote(rows.map((row) => this.toAgent(row)).filter((item): item is LeluAgent => Boolean(item)));
      } else if (table === "proactive_questions") {
        const rows = await this.read("proactive_questions");
        ProactiveCore.getInstance().mergeRemote(rows.map((row) => this.toQuestion(row)).filter((item): item is ProactiveQuestion => Boolean(item)));
      } else if (table === "ui_state") {
        const row = await this.readOne("ui_state");
        if (row?.state && typeof row.state === "object") UIStateStore.getInstance().update(row.state as Partial<UIStateSnapshot>);
      }
    } catch (error) {
      this.status = "degraded";
      console.warn(`[Lélu] Supabase realtime refresh for ${table} degraded`, error);
    } finally {
      this.realtimeRefreshInFlight.delete(table);
    }
  }

  public async persistEngineeringEvent(
    eventType: string,
    taskId: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.isConnected() || !this.userId) return false;
    try {
      return await this.append("cognitive_events", [{
        user_id: this.userId,
        event_type: `engineering.${eventType}`,
        task_id: taskId,
        payload,
      }], "engineering event");
    } catch (error) {
      console.warn(
        "[Lélu] Supabase engineering event failed (contained)",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

}
