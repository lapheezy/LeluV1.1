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
        Row: {
          created_at: string
          enabled: boolean
          id: string
          kind: string
          last_run_at: string | null
          name: string
          system_prompt: string
          universe_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          last_run_at?: string | null
          name: string
          system_prompt?: string
          universe_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          last_run_at?: string | null
          name?: string
          system_prompt?: string
          universe_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_summaries: {
        Row: {
          conversation_id: string | null
          created_at: string
          id: string
          message_count: number
          original_title: string | null
          preserved_reason: string | null
          summary: string
          topics: string[]
          universe_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_count?: number
          original_title?: string | null
          preserved_reason?: string | null
          summary: string
          topics?: string[]
          universe_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_count?: number
          original_title?: string | null
          preserved_reason?: string | null
          summary?: string
          topics?: string[]
          universe_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived: boolean
          continued_from_id: string | null
          crash_count: number
          created_at: string
          id: string
          last_crash_at: string | null
          pinned: boolean
          recovery_state: string
          title: string
          universe_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          continued_from_id?: string | null
          crash_count?: number
          created_at?: string
          id?: string
          last_crash_at?: string | null
          pinned?: boolean
          recovery_state?: string
          title?: string
          universe_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          continued_from_id?: string | null
          crash_count?: number
          created_at?: string
          id?: string
          last_crash_at?: string | null
          pinned?: boolean
          recovery_state?: string
          title?: string
          universe_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_continued_from_id_fkey"
            columns: ["continued_from_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          conversation_id: string | null
          created_at: string
          ends_at: string | null
          id: string
          location: string | null
          notes: string | null
          starts_at: string
          title: string
          universe_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          starts_at: string
          title: string
          universe_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          starts_at?: string
          title?: string
          universe_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          archived: boolean
          body: string
          conversation_id: string | null
          created_at: string
          id: string
          kind: string
          pinned: boolean
          sources: Json
          tags: string[]
          title: string
          universe_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          body?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          pinned?: boolean
          sources?: Json
          tags?: string[]
          title: string
          universe_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          body?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          pinned?: boolean
          sources?: Json
          tags?: string[]
          title?: string
          universe_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          conversation_id: string | null
          created_at: string
          description: string | null
          id: string
          progress: number
          status: string
          target_date: string | null
          title: string
          universe_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          progress?: number
          status?: string
          target_date?: string | null
          title: string
          universe_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          progress?: number
          status?: string
          target_date?: string | null
          title?: string
          universe_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      memories: {
        Row: {
          archived: boolean
          category: string
          confidence: number
          created_at: string
          id: string
          importance: number
          key: string
          last_accessed_at: string | null
          last_referenced_at: string | null
          pinned: boolean
          related_ids: string[]
          source_conversation_id: string | null
          summary: string | null
          tags: string[]
          title: string | null
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          archived?: boolean
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          importance?: number
          key: string
          last_accessed_at?: string | null
          last_referenced_at?: string | null
          pinned?: boolean
          related_ids?: string[]
          source_conversation_id?: string | null
          summary?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          archived?: boolean
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          importance?: number
          key?: string
          last_accessed_at?: string | null
          last_referenced_at?: string | null
          pinned?: boolean
          related_ids?: string[]
          source_conversation_id?: string | null
          summary?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      memory_events: {
        Row: {
          conversation_id: string | null
          created_at: string
          detail: Json
          id: string
          kind: string
          memory_id: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          kind: string
          memory_id?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          kind?: string
          memory_id?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_events_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "memories"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_universes: {
        Row: {
          memory_id: string
          universe_id: string
          user_id: string
        }
        Insert: {
          memory_id: string
          universe_id: string
          user_id: string
        }
        Update: {
          memory_id?: string
          universe_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_universes_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "memories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_universes_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          client_id: string | null
          conversation_id: string
          created_at: string
          id: string
          parts: Json
          role: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          parts: Json
          role: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          parts?: Json
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          conversation_id: string | null
          created_at: string
          id: string
          tags: string[]
          title: string
          universe_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          tags?: string[]
          title: string
          universe_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          tags?: string[]
          title?: string
          universe_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          body: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          email_sent_at: string | null
          id: string
          remind_at: string
          title: string
          universe_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          email_sent_at?: string | null
          id?: string
          remind_at: string
          title: string
          universe_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          email_sent_at?: string | null
          id?: string
          remind_at?: string
          title?: string
          universe_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      system_events: {
        Row: {
          conversation_id: string | null
          created_at: string
          detail: Json | null
          id: string
          kind: string
          message: string | null
          severity: string
          source: string | null
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          kind: string
          message?: string | null
          severity?: string
          source?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          kind?: string
          message?: string | null
          severity?: string
          source?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          conversation_id: string | null
          created_at: string
          done: boolean
          due_at: string | null
          id: string
          notes: string | null
          title: string
          universe_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          done?: boolean
          due_at?: string | null
          id?: string
          notes?: string | null
          title: string
          universe_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          done?: boolean
          due_at?: string | null
          id?: string
          notes?: string | null
          title?: string
          universe_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks_queue: {
        Row: {
          agent: string
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          error: string | null
          id: string
          kind: string
          parent_id: string | null
          payload: Json | null
          priority: number
          result: Json | null
          retries: number
          started_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent?: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          parent_id?: string | null
          payload?: Json | null
          priority?: number
          result?: Json | null
          retries?: number
          started_at?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent?: string
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          parent_id?: string | null
          payload?: Json | null
          priority?: number
          result?: Json | null
          retries?: number
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_queue_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tasks_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      universes: {
        Row: {
          archived: boolean
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
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
