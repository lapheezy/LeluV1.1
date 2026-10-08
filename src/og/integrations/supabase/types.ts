/**
 * Generated from the live schema of Supabase project nrehsldbfxthspikaxvr.
 *
 * Regenerate rather than hand-edit. This file was previously generated from
 * the pre-migration schema, so it still declared `memories` and
 * `memory_events` — one renamed to `legacy_memories`, the other never
 * present in this project — and declared none of the v1.1 runtime tables.
 * The OG panels typechecked against that stale shape while failing at
 * runtime, which is the failure a generated type file exists to prevent.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agents: {
        Row: { enabled: boolean; id: string; name: string; project_id: string | null; role: string; state: Json; status: string; updated_at: string; user_id: string }
        Insert: { enabled?: boolean; id: string; name: string; project_id?: string | null; role?: string; state?: Json; status: string; updated_at?: string; user_id: string }
        Update: { enabled?: boolean; id?: string; name?: string; project_id?: string | null; role?: string; state?: Json; status?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      api_health: {
        Row: { checked_at: string; details: Json; latency_ms: number | null; provider: string; status: string; user_id: string }
        Insert: { checked_at?: string; details?: Json; latency_ms?: number | null; provider: string; status: string; user_id: string }
        Update: { checked_at?: string; details?: Json; latency_ms?: number | null; provider?: string; status?: string; user_id?: string }
        Relationships: []
      }
      cognitive_events: {
        Row: { created_at: string; event_type: string; id: string; payload: Json; task_id: string | null; user_id: string }
        Insert: { created_at?: string; event_type: string; id?: string; payload?: Json; task_id?: string | null; user_id: string }
        Update: { created_at?: string; event_type?: string; id?: string; payload?: Json; task_id?: string | null; user_id?: string }
        Relationships: []
      }
      conversation_summaries: {
        Row: { conversation_id: string | null; created_at: string; id: string; message_count: number; original_title: string | null; preserved_reason: string | null; summary: string; topics: string[]; universe_id: string | null; updated_at: string; user_id: string }
        Insert: { conversation_id?: string | null; created_at?: string; id?: string; message_count?: number; original_title?: string | null; preserved_reason?: string | null; summary: string; topics?: string[]; universe_id?: string | null; updated_at?: string; user_id: string }
        Update: { conversation_id?: string | null; created_at?: string; id?: string; message_count?: number; original_title?: string | null; preserved_reason?: string | null; summary?: string; topics?: string[]; universe_id?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      conversations: {
        Row: { created_at: string; id: string; metadata: Json; project_id: string | null; title: string; updated_at: string; user_id: string }
        Insert: { created_at?: string; id: string; metadata?: Json; project_id?: string | null; title: string; updated_at?: string; user_id: string }
        Update: { created_at?: string; id?: string; metadata?: Json; project_id?: string | null; title?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      events: {
        Row: { conversation_id: string | null; created_at: string; ends_at: string | null; id: string; location: string | null; notes: string | null; starts_at: string; title: string; universe_id: string | null; updated_at: string; user_id: string }
        Insert: { conversation_id?: string | null; created_at?: string; ends_at?: string | null; id?: string; location?: string | null; notes?: string | null; starts_at: string; title: string; universe_id?: string | null; updated_at?: string; user_id: string }
        Update: { conversation_id?: string | null; created_at?: string; ends_at?: string | null; id?: string; location?: string | null; notes?: string | null; starts_at?: string; title?: string; universe_id?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      files: {
        Row: { archived: boolean; body: string; conversation_id: string | null; created_at: string; id: string; kind: string; pinned: boolean; sources: Json; tags: string[]; title: string; universe_id: string | null; updated_at: string; user_id: string }
        Insert: { archived?: boolean; body?: string; conversation_id?: string | null; created_at?: string; id?: string; kind?: string; pinned?: boolean; sources?: Json; tags?: string[]; title: string; universe_id?: string | null; updated_at?: string; user_id: string }
        Update: { archived?: boolean; body?: string; conversation_id?: string | null; created_at?: string; id?: string; kind?: string; pinned?: boolean; sources?: Json; tags?: string[]; title?: string; universe_id?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      goals: {
        Row: { conversation_id: string | null; created_at: string; description: string | null; id: string; progress: number; status: string; target_date: string | null; title: string; universe_id: string | null; updated_at: string; user_id: string }
        Insert: { conversation_id?: string | null; created_at?: string; description?: string | null; id?: string; progress?: number; status?: string; target_date?: string | null; title: string; universe_id?: string | null; updated_at?: string; user_id: string }
        Update: { conversation_id?: string | null; created_at?: string; description?: string | null; id?: string; progress?: number; status?: string; target_date?: string | null; title?: string; universe_id?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      improvement_items: {
        Row: { id: string; state: Json; updated_at: string; user_id: string }
        Insert: { id: string; state?: Json; updated_at?: string; user_id: string }
        Update: { id?: string; state?: Json; updated_at?: string; user_id?: string }
        Relationships: []
      }
      knowledge_items: {
        Row: { created_at: string; detail: string; domain: string; id: string; metadata: Json; source: string | null; title: string; updated_at: string; user_id: string }
        Insert: { created_at?: string; detail: string; domain: string; id: string; metadata?: Json; source?: string | null; title: string; updated_at?: string; user_id: string }
        Update: { created_at?: string; detail?: string; domain?: string; id?: string; metadata?: Json; source?: string | null; title?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      legacy_conversations: {
        Row: { archived: boolean; continued_from_id: string | null; crash_count: number; created_at: string; id: string; last_crash_at: string | null; pinned: boolean; recovery_state: string; title: string; universe_id: string | null; updated_at: string; user_id: string }
        Insert: { archived?: boolean; continued_from_id?: string | null; crash_count?: number; created_at?: string; id?: string; last_crash_at?: string | null; pinned?: boolean; recovery_state?: string; title?: string; universe_id?: string | null; updated_at?: string; user_id: string }
        Update: { archived?: boolean; continued_from_id?: string | null; crash_count?: number; created_at?: string; id?: string; last_crash_at?: string | null; pinned?: boolean; recovery_state?: string; title?: string; universe_id?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      legacy_memories: {
        Row: { archived: boolean; category: string; created_at: string; id: string; importance: number; key: string; last_referenced_at: string | null; pinned: boolean; source_conversation_id: string | null; summary: string | null; tags: string[]; title: string | null; updated_at: string; user_id: string; value: string }
        Insert: { archived?: boolean; category?: string; created_at?: string; id?: string; importance?: number; key: string; last_referenced_at?: string | null; pinned?: boolean; source_conversation_id?: string | null; summary?: string | null; tags?: string[]; title?: string | null; updated_at?: string; user_id: string; value: string }
        Update: { archived?: boolean; category?: string; created_at?: string; id?: string; importance?: number; key?: string; last_referenced_at?: string | null; pinned?: boolean; source_conversation_id?: string | null; summary?: string | null; tags?: string[]; title?: string | null; updated_at?: string; user_id?: string; value?: string }
        Relationships: []
      }
      legacy_messages: {
        Row: { conversation_id: string; created_at: string; id: string; parts: Json; role: string; user_id: string }
        Insert: { conversation_id: string; created_at?: string; id?: string; parts: Json; role: string; user_id: string }
        Update: { conversation_id?: string; created_at?: string; id?: string; parts?: Json; role?: string; user_id?: string }
        Relationships: []
      }
      memory_items: {
        Row: { category: string; confidence: number; context: Json; created_at: string; failed_uses: number; id: string; importance: number; keywords: string[]; memory_type: string; prompt: string; response: string; successful_uses: number; updated_at: string; user_id: string }
        Insert: { category: string; confidence?: number; context?: Json; created_at?: string; failed_uses?: number; id: string; importance?: number; keywords?: string[]; memory_type?: string; prompt: string; response: string; successful_uses?: number; updated_at?: string; user_id: string }
        Update: { category?: string; confidence?: number; context?: Json; created_at?: string; failed_uses?: number; id?: string; importance?: number; keywords?: string[]; memory_type?: string; prompt?: string; response?: string; successful_uses?: number; updated_at?: string; user_id?: string }
        Relationships: []
      }
      memory_universes: {
        Row: { memory_id: string; universe_id: string; user_id: string }
        Insert: { memory_id: string; universe_id: string; user_id: string }
        Update: { memory_id?: string; universe_id?: string; user_id?: string }
        Relationships: []
      }
      messages: {
        Row: { confidence: number | null; conversation_id: string; created_at: string; id: string; metadata: Json; provider: string | null; role: string; text: string; user_id: string }
        Insert: { confidence?: number | null; conversation_id: string; created_at?: string; id: string; metadata?: Json; provider?: string | null; role: string; text: string; user_id: string }
        Update: { confidence?: number | null; conversation_id?: string; created_at?: string; id?: string; metadata?: Json; provider?: string | null; role?: string; text?: string; user_id?: string }
        Relationships: []
      }
      news_preferences: {
        Row: { metadata: Json; topics: string[]; updated_at: string; user_id: string }
        Insert: { metadata?: Json; topics?: string[]; updated_at?: string; user_id: string }
        Update: { metadata?: Json; topics?: string[]; updated_at?: string; user_id?: string }
        Relationships: []
      }
      notes: {
        Row: { body: string; conversation_id: string | null; created_at: string; id: string; tags: string[]; title: string; universe_id: string | null; updated_at: string; user_id: string }
        Insert: { body?: string; conversation_id?: string | null; created_at?: string; id?: string; tags?: string[]; title: string; universe_id?: string | null; updated_at?: string; user_id: string }
        Update: { body?: string; conversation_id?: string | null; created_at?: string; id?: string; tags?: string[]; title?: string; universe_id?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      proactive_questions: {
        Row: { asked_at: string; blocks_execution: boolean; category: string; created_at: string; id: string; priority: string; question: string; question_key: string; reason: string; related_project_id: string | null; related_task: string | null; remember_answer: boolean; resolved_at: string | null; status: string; updated_at: string; user_id: string; user_response: string | null }
        Insert: { asked_at: string; blocks_execution?: boolean; category: string; created_at?: string; id: string; priority: string; question: string; question_key: string; reason: string; related_project_id?: string | null; related_task?: string | null; remember_answer?: boolean; resolved_at?: string | null; status: string; updated_at?: string; user_id: string; user_response?: string | null }
        Update: { asked_at?: string; blocks_execution?: boolean; category?: string; created_at?: string; id?: string; priority?: string; question?: string; question_key?: string; reason?: string; related_project_id?: string | null; related_task?: string | null; remember_answer?: boolean; resolved_at?: string | null; status?: string; updated_at?: string; user_id?: string; user_response?: string | null }
        Relationships: []
      }
      projects: {
        Row: { agent_ids: string[]; created_at: string; description: string; id: string; items: Json; name: string; queries: string[]; schedule: Json | null; status: string; updated_at: string; user_id: string }
        Insert: { agent_ids?: string[]; created_at?: string; description?: string; id: string; items?: Json; name: string; queries?: string[]; schedule?: Json | null; status: string; updated_at?: string; user_id: string }
        Update: { agent_ids?: string[]; created_at?: string; description?: string; id?: string; items?: Json; name?: string; queries?: string[]; schedule?: Json | null; status?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      reminders: {
        Row: { body: string | null; conversation_id: string | null; created_at: string; delivered_at: string | null; email_sent_at: string | null; id: string; remind_at: string; title: string; universe_id: string | null; updated_at: string; user_id: string }
        Insert: { body?: string | null; conversation_id?: string | null; created_at?: string; delivered_at?: string | null; email_sent_at?: string | null; id?: string; remind_at: string; title: string; universe_id?: string | null; updated_at?: string; user_id: string }
        Update: { body?: string | null; conversation_id?: string | null; created_at?: string; delivered_at?: string | null; email_sent_at?: string | null; id?: string; remind_at?: string; title?: string; universe_id?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      system_events: {
        Row: { conversation_id: string | null; created_at: string; detail: Json | null; id: string; kind: string; message: string | null; severity: string; source: string | null; user_id: string }
        Insert: { conversation_id?: string | null; created_at?: string; detail?: Json | null; id?: string; kind: string; message?: string | null; severity?: string; source?: string | null; user_id: string }
        Update: { conversation_id?: string | null; created_at?: string; detail?: Json | null; id?: string; kind?: string; message?: string | null; severity?: string; source?: string | null; user_id?: string }
        Relationships: []
      }
      tasks: {
        Row: { conversation_id: string | null; created_at: string; done: boolean; due_at: string | null; id: string; notes: string | null; title: string; universe_id: string | null; updated_at: string; user_id: string }
        Insert: { conversation_id?: string | null; created_at?: string; done?: boolean; due_at?: string | null; id?: string; notes?: string | null; title: string; universe_id?: string | null; updated_at?: string; user_id: string }
        Update: { conversation_id?: string | null; created_at?: string; done?: boolean; due_at?: string | null; id?: string; notes?: string | null; title?: string; universe_id?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      tasks_queue: {
        Row: { agent: string; completed_at: string | null; conversation_id: string | null; created_at: string; error: string | null; id: string; kind: string; parent_id: string | null; payload: Json | null; priority: number; result: Json | null; retries: number; started_at: string | null; status: string; title: string; updated_at: string; user_id: string }
        Insert: { agent?: string; completed_at?: string | null; conversation_id?: string | null; created_at?: string; error?: string | null; id?: string; kind: string; parent_id?: string | null; payload?: Json | null; priority?: number; result?: Json | null; retries?: number; started_at?: string | null; status?: string; title: string; updated_at?: string; user_id: string }
        Update: { agent?: string; completed_at?: string | null; conversation_id?: string | null; created_at?: string; error?: string | null; id?: string; kind?: string; parent_id?: string | null; payload?: Json | null; priority?: number; result?: Json | null; retries?: number; started_at?: string | null; status?: string; title?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      ui_state: {
        Row: { state: Json; updated_at: string; user_id: string }
        Insert: { state?: Json; updated_at?: string; user_id: string }
        Update: { state?: Json; updated_at?: string; user_id?: string }
        Relationships: []
      }
      universes: {
        Row: { archived: boolean; color: string | null; created_at: string; description: string | null; icon: string | null; id: string; name: string; position: number; updated_at: string; user_id: string }
        Insert: { archived?: boolean; color?: string | null; created_at?: string; description?: string | null; icon?: string | null; id?: string; name: string; position?: number; updated_at?: string; user_id: string }
        Update: { archived?: boolean; color?: string | null; created_at?: string; description?: string | null; icon?: string | null; id?: string; name?: string; position?: number; updated_at?: string; user_id?: string }
        Relationships: []
      }
      user_preferences: {
        Row: { preference_key: string; updated_at: string; user_id: string; value: Json }
        Insert: { preference_key: string; updated_at?: string; user_id: string; value: Json }
        Update: { preference_key?: string; updated_at?: string; user_id?: string; value?: Json }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
