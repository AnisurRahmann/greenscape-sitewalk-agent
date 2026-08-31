// Mirrors supabase/migrations/0001_init.sql. Hand-authored because no
// Greenscape Supabase project is linked yet. Enum-like columns are plain
// text + CHECK constraints in Postgres, so they type as string here — same
// output `supabase gen types` produces. Regenerate once the repo points at
// its own project:
//   npx supabase gen types typescript --linked > src/lib/db/types.ts
// Literal unions for statuses/units belong in Zod schemas in src/lib.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          id: string;
          actor: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          before: Json | null;
          after: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor?: string | null;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor?: string | null;
          action?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      agent_runs: {
        Row: {
          id: string;
          proposal_id: string | null;
          site_walk_id: string | null;
          step: string;
          model: string;
          tokens_in: number | null;
          tokens_out: number | null;
          cost_usd: number | null;
          latency_ms: number | null;
          status: string;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          proposal_id?: string | null;
          site_walk_id?: string | null;
          step: string;
          model: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
          cost_usd?: number | null;
          latency_ms?: number | null;
          status: string;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          proposal_id?: string | null;
          site_walk_id?: string | null;
          step?: string;
          model?: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
          cost_usd?: number | null;
          latency_ms?: number | null;
          status?: string;
          error?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_runs_proposal_id_fkey';
            columns: ['proposal_id'];
            isOneToOne: false;
            referencedRelation: 'proposals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agent_runs_site_walk_id_fkey';
            columns: ['site_walk_id'];
            isOneToOne: false;
            referencedRelation: 'site_walks';
            referencedColumns: ['id'];
          },
        ];
      };
      catalog_items: {
        Row: {
          id: string;
          sku: string;
          category: string;
          name: string;
          description: string | null;
          unit: string;
          unit_price: number;
          unit_cost: number;
          min_qty: number;
          notes: string | null;
          embedding: string | null;
          search_tsv: string;
          materials_ratio: number;
        };
        Insert: {
          id?: string;
          sku: string;
          category: string;
          name: string;
          description?: string | null;
          unit: string;
          unit_price: number;
          unit_cost: number;
          min_qty?: number;
          notes?: string | null;
          embedding?: string | null;
          materials_ratio?: number;
        };
        Update: {
          id?: string;
          sku?: string;
          category?: string;
          name?: string;
          description?: string | null;
          unit?: string;
          unit_price?: number;
          unit_cost?: number;
          min_qty?: number;
          notes?: string | null;
          embedding?: string | null;
          materials_ratio?: number;
        };
        Relationships: [];
      };
      extractions: {
        Row: {
          id: string;
          site_walk_id: string;
          raw_json: Json;
          schema_valid: boolean;
          retry_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          site_walk_id: string;
          raw_json: Json;
          schema_valid?: boolean;
          retry_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          site_walk_id?: string;
          raw_json?: Json;
          schema_valid?: boolean;
          retry_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'extractions_site_walk_id_fkey';
            columns: ['site_walk_id'];
            isOneToOne: false;
            referencedRelation: 'site_walks';
            referencedColumns: ['id'];
          },
        ];
      };
      guardrail_events: {
        Row: {
          id: string;
          proposal_id: string;
          rule: string;
          severity: string;
          passed: boolean;
          detail: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          proposal_id: string;
          rule: string;
          severity: string;
          passed: boolean;
          detail?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          proposal_id?: string;
          rule?: string;
          severity?: string;
          passed?: boolean;
          detail?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'guardrail_events_proposal_id_fkey';
            columns: ['proposal_id'];
            isOneToOne: false;
            referencedRelation: 'proposals';
            referencedColumns: ['id'];
          },
        ];
      };
      leads: {
        Row: {
          id: string;
          full_name: string;
          phone: string | null;
          email: string | null;
          address: string | null;
          city: string | null;
          source: string | null;
          ghl_contact_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          city?: string | null;
          source?: string | null;
          ghl_contact_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          city?: string | null;
          source?: string | null;
          ghl_contact_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      outbound_events: {
        Row: {
          id: string;
          proposal_id: string;
          channel: string;
          idempotency_key: string;
          payload: Json | null;
          provider_message_id: string | null;
          status: string | null;
          attempts: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          proposal_id: string;
          channel: string;
          idempotency_key: string;
          payload?: Json | null;
          provider_message_id?: string | null;
          status?: string | null;
          attempts?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          proposal_id?: string;
          channel?: string;
          idempotency_key?: string;
          payload?: Json | null;
          provider_message_id?: string | null;
          status?: string | null;
          attempts?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'outbound_events_proposal_id_fkey';
            columns: ['proposal_id'];
            isOneToOne: false;
            referencedRelation: 'proposals';
            referencedColumns: ['id'];
          },
        ];
      };
      proposal_line_items: {
        Row: {
          id: string;
          proposal_id: string;
          catalog_item_id: string | null;
          description: string;
          qty: number;
          unit: string;
          unit_price: number;
          unit_cost: number;
          line_total: number;
          match_method: string | null;
          match_confidence: number | null;
          transcript_evidence: string | null;
          evidence_verified: boolean;
          needs_review: boolean;
          sort_order: number | null;
        };
        Insert: {
          id?: string;
          proposal_id: string;
          catalog_item_id?: string | null;
          description: string;
          qty: number;
          unit: string;
          unit_price: number;
          unit_cost: number;
          line_total: number;
          match_method?: string | null;
          match_confidence?: number | null;
          transcript_evidence?: string | null;
          evidence_verified?: boolean;
          needs_review?: boolean;
          sort_order?: number | null;
        };
        Update: {
          id?: string;
          proposal_id?: string;
          catalog_item_id?: string | null;
          description?: string;
          qty?: number;
          unit?: string;
          unit_price?: number;
          unit_cost?: number;
          line_total?: number;
          match_method?: string | null;
          match_confidence?: number | null;
          transcript_evidence?: string | null;
          evidence_verified?: boolean;
          needs_review?: boolean;
          sort_order?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'proposal_line_items_catalog_item_id_fkey';
            columns: ['catalog_item_id'];
            isOneToOne: false;
            referencedRelation: 'catalog_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proposal_line_items_proposal_id_fkey';
            columns: ['proposal_id'];
            isOneToOne: false;
            referencedRelation: 'proposals';
            referencedColumns: ['id'];
          },
        ];
      };
      proposals: {
        Row: {
          id: string;
          lead_id: string;
          site_walk_id: string;
          status: string;
          subtotal: number | null;
          mobilization_fee: number | null;
          contingency: number | null;
          tax: number | null;
          total: number | null;
          cost_total: number | null;
          margin_pct: number | null;
          narrative: string | null;
          exclusions: string | null;
          version: number;
          approved_by: string | null;
          approved_at: string | null;
          sent_at: string | null;
          pdf_path: string | null;
          public_token: string;
          created_at: string;
          step_status: Json | null;
        };
        Insert: {
          id?: string;
          lead_id: string;
          site_walk_id: string;
          status?: string;
          subtotal?: number | null;
          mobilization_fee?: number | null;
          contingency?: number | null;
          tax?: number | null;
          total?: number | null;
          cost_total?: number | null;
          margin_pct?: number | null;
          narrative?: string | null;
          exclusions?: string | null;
          version?: number;
          approved_by?: string | null;
          approved_at?: string | null;
          sent_at?: string | null;
          pdf_path?: string | null;
          public_token?: string;
          created_at?: string;
          step_status?: Json | null;
        };
        Update: {
          id?: string;
          lead_id?: string;
          site_walk_id?: string;
          status?: string;
          subtotal?: number | null;
          mobilization_fee?: number | null;
          contingency?: number | null;
          tax?: number | null;
          total?: number | null;
          cost_total?: number | null;
          margin_pct?: number | null;
          narrative?: string | null;
          exclusions?: string | null;
          version?: number;
          approved_by?: string | null;
          approved_at?: string | null;
          sent_at?: string | null;
          pdf_path?: string | null;
          public_token?: string;
          created_at?: string;
          step_status?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'proposals_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proposals_site_walk_id_fkey';
            columns: ['site_walk_id'];
            isOneToOne: false;
            referencedRelation: 'site_walks';
            referencedColumns: ['id'];
          },
        ];
      };
      site_walks: {
        Row: {
          id: string;
          lead_id: string;
          audio_path: string | null;
          transcript: string | null;
          transcript_provider: string | null;
          duration_seconds: number | null;
          input_mode: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          audio_path?: string | null;
          transcript?: string | null;
          transcript_provider?: string | null;
          duration_seconds?: number | null;
          input_mode: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          lead_id?: string;
          audio_path?: string | null;
          transcript?: string | null;
          transcript_provider?: string | null;
          duration_seconds?: number | null;
          input_mode?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'site_walks_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      match_catalog_fused: {
        Args: {
          p_query_embedding: number[];
          p_raw_query: string;
          p_match_count?: number;
          p_rrf_k?: number;
          p_strategy_depth?: number;
        };
        Returns: {
          id: string;
          sku: string;
          category: string;
          name: string;
          description: string | null;
          unit: string;
          unit_price: number;
          unit_cost: number;
          min_qty: number;
          notes: string | null;
          fused_score: number;
          vector_rank: number | null;
          lexical_rank: number | null;
          fuzzy_rank: number | null;
          match_method: string;
        }[];
      };
      search_catalog_fuzzy: {
        Args: { p_raw_query: string; p_match_count?: number };
        Returns: {
          id: string;
          sku: string;
          category: string;
          name: string;
          description: string | null;
          unit: string;
          unit_price: number;
          unit_cost: number;
          min_qty: number;
          notes: string | null;
          score: number;
        }[];
      };
      search_catalog_lexical: {
        Args: { p_raw_query: string; p_match_count?: number };
        Returns: {
          id: string;
          sku: string;
          category: string;
          name: string;
          description: string | null;
          unit: string;
          unit_price: number;
          unit_cost: number;
          min_qty: number;
          notes: string | null;
          score: number;
        }[];
      };
      search_catalog_vector: {
        Args: { p_query_embedding: number[]; p_match_count?: number };
        Returns: {
          id: string;
          sku: string;
          category: string;
          name: string;
          description: string | null;
          unit: string;
          unit_price: number;
          unit_cost: number;
          min_qty: number;
          notes: string | null;
          score: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DefaultSchema = Database['public'];

export type Tables<T extends keyof DefaultSchema['Tables']> = DefaultSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][T]['Update'];
export type Enums<T extends keyof DefaultSchema['Enums']> = DefaultSchema['Enums'][T];
