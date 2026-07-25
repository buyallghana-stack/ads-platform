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
      ad_attempts: {
        Row: {
          ad_id: string
          attempt_number: number
          created_at: string
          id: number
          is_correct: boolean
          question_id: string | null
          submitted_answer: string | null
          user_id: string
          watch_seconds: number | null
        }
        Insert: {
          ad_id: string
          attempt_number: number
          created_at?: string
          id?: never
          is_correct: boolean
          question_id?: string | null
          submitted_answer?: string | null
          user_id: string
          watch_seconds?: number | null
        }
        Update: {
          ad_id?: string
          attempt_number?: number
          created_at?: string
          id?: never
          is_correct?: boolean
          question_id?: string | null
          submitted_answer?: string | null
          user_id?: string
          watch_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_attempts_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_attempts_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "ad_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_question_options: {
        Row: {
          created_at: string
          id: string
          is_correct: boolean
          option_text: string
          question_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_correct?: boolean
          option_text: string
          question_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_correct?: boolean
          option_text?: string
          question_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "ad_question_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "ad_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_questions: {
        Row: {
          ad_id: string
          answer_format: Database["public"]["Enums"]["answer_format"]
          correct_answer: string | null
          created_at: string
          id: string
          position: number
          question_text: string
          show_at_seconds: number | null
          updated_at: string
        }
        Insert: {
          ad_id: string
          answer_format: Database["public"]["Enums"]["answer_format"]
          correct_answer?: string | null
          created_at?: string
          id?: string
          position?: number
          question_text: string
          show_at_seconds?: number | null
          updated_at?: string
        }
        Update: {
          ad_id?: string
          answer_format?: Database["public"]["Enums"]["answer_format"]
          correct_answer?: string | null
          created_at?: string
          id?: string
          position?: number
          question_text?: string
          show_at_seconds?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_questions_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          ip: unknown
          new_values: Json | null
          old_values: Json | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          ip?: unknown
          new_values?: Json | null
          old_values?: Json | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          ip?: unknown
          new_values?: Json | null
          old_values?: Json | null
          user_agent?: string | null
        }
        Relationships: []
      }
      ads: {
        Row: {
          advertiser_name: string | null
          completions_count: number
          created_at: string
          created_by: string | null
          description: string | null
          duration_seconds: number | null
          ends_at: string | null
          format: Database["public"]["Enums"]["ad_format"]
          id: string
          max_completions: number | null
          min_watch_seconds: number | null
          points_reward: number
          starts_at: string | null
          status: Database["public"]["Enums"]["ad_status"]
          storage_path: string | null
          thumbnail_path: string | null
          title: string
          updated_at: string
          video_source: Database["public"]["Enums"]["video_source"] | null
          weight: number
          youtube_video_id: string | null
        }
        Insert: {
          advertiser_name?: string | null
          completions_count?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_seconds?: number | null
          ends_at?: string | null
          format: Database["public"]["Enums"]["ad_format"]
          id?: string
          max_completions?: number | null
          min_watch_seconds?: number | null
          points_reward: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["ad_status"]
          storage_path?: string | null
          thumbnail_path?: string | null
          title: string
          updated_at?: string
          video_source?: Database["public"]["Enums"]["video_source"] | null
          weight?: number
          youtube_video_id?: string | null
        }
        Update: {
          advertiser_name?: string | null
          completions_count?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_seconds?: number | null
          ends_at?: string | null
          format?: Database["public"]["Enums"]["ad_format"]
          id?: string
          max_completions?: number | null
          min_watch_seconds?: number | null
          points_reward?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["ad_status"]
          storage_path?: string | null
          thumbnail_path?: string | null
          title?: string
          updated_at?: string
          video_source?: Database["public"]["Enums"]["video_source"] | null
          weight?: number
          youtube_video_id?: string | null
        }
        Relationships: []
      }
      app_config: {
        Row: {
          description: string
          is_public: boolean
          key: string
          max_value: number | null
          min_value: number | null
          updated_at: string
          updated_by: string | null
          value: string
          value_type: Database["public"]["Enums"]["config_value_type"]
        }
        Insert: {
          description: string
          is_public?: boolean
          key: string
          max_value?: number | null
          min_value?: number | null
          updated_at?: string
          updated_by?: string | null
          value: string
          value_type: Database["public"]["Enums"]["config_value_type"]
        }
        Update: {
          description?: string
          is_public?: boolean
          key?: string
          max_value?: number | null
          min_value?: number | null
          updated_at?: string
          updated_by?: string | null
          value?: string
          value_type?: Database["public"]["Enums"]["config_value_type"]
        }
        Relationships: []
      }
      auth_signals: {
        Row: {
          country: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["auth_event_type"]
          fingerprint: string | null
          id: number
          ip: unknown
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["auth_event_type"]
          fingerprint?: string | null
          id?: never
          ip?: unknown
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["auth_event_type"]
          fingerprint?: string | null
          id?: never
          ip?: unknown
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      blocked_email_domains: {
        Row: {
          added_at: string
          domain: string
          source: string | null
        }
        Insert: {
          added_at?: string
          domain: string
          source?: string | null
        }
        Update: {
          added_at?: string
          domain?: string
          source?: string | null
        }
        Relationships: []
      }
      blocked_identities: {
        Row: {
          blocked_at: string
          email_hash: string
          id: string
          phone_hash: string | null
          reason: string
        }
        Insert: {
          blocked_at?: string
          email_hash: string
          id?: string
          phone_hash?: string | null
          reason?: string
        }
        Update: {
          blocked_at?: string
          email_hash?: string
          id?: string
          phone_hash?: string | null
          reason?: string
        }
        Relationships: []
      }
      blocked_ip_ranges: {
        Row: {
          added_at: string
          category: string
          cidr: unknown
          source: string | null
        }
        Insert: {
          added_at?: string
          category?: string
          cidr: unknown
          source?: string | null
        }
        Update: {
          added_at?: string
          category?: string
          cidr?: unknown
          source?: string | null
        }
        Relationships: []
      }
      daily_earning_counters: {
        Row: {
          ads_completed: number
          day: string
          last_earned_at: string | null
          points_earned: number
          user_id: string
        }
        Insert: {
          ads_completed?: number
          day: string
          last_earned_at?: string | null
          points_earned?: number
          user_id: string
        }
        Update: {
          ads_completed?: number
          day?: string
          last_earned_at?: string | null
          points_earned?: number
          user_id?: string
        }
        Relationships: []
      }
      daily_issuance: {
        Row: {
          ceiling_alerted_at: string | null
          day: string
          points_issued: number
          updated_at: string
        }
        Insert: {
          ceiling_alerted_at?: string | null
          day: string
          points_issued?: number
          updated_at?: string
        }
        Update: {
          ceiling_alerted_at?: string | null
          day?: string
          points_issued?: number
          updated_at?: string
        }
        Relationships: []
      }
      fraud_checks: {
        Row: {
          action: Database["public"]["Enums"]["fraud_action"]
          code: string
          description: string
          is_enabled: boolean
          name: string
          severity: Database["public"]["Enums"]["risk_level"]
          updated_at: string
          updated_by: string | null
          weight: number
        }
        Insert: {
          action?: Database["public"]["Enums"]["fraud_action"]
          code: string
          description: string
          is_enabled?: boolean
          name: string
          severity?: Database["public"]["Enums"]["risk_level"]
          updated_at?: string
          updated_by?: string | null
          weight?: number
        }
        Update: {
          action?: Database["public"]["Enums"]["fraud_action"]
          code?: string
          description?: string
          is_enabled?: boolean
          name?: string
          severity?: Database["public"]["Enums"]["risk_level"]
          updated_at?: string
          updated_by?: string | null
          weight?: number
        }
        Relationships: []
      }
      fraud_signals: {
        Row: {
          check_code: string
          created_at: string
          details: Json
          id: number
          score_delta: number
          user_id: string
        }
        Insert: {
          check_code: string
          created_at?: string
          details?: Json
          id?: never
          score_delta: number
          user_id: string
        }
        Update: {
          check_code?: string
          created_at?: string
          details?: Json
          id?: never
          score_delta?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fraud_signals_check_code_fkey"
            columns: ["check_code"]
            isOneToOne: false
            referencedRelation: "fraud_checks"
            referencedColumns: ["code"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          is_clearable: boolean | null
          read_at: string | null
          reference: Json | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_clearable?: boolean | null
          read_at?: string | null
          reference?: Json | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_clearable?: boolean | null
          read_at?: string | null
          reference?: Json | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      payout_coin_networks: {
        Row: {
          address_pattern: string
          code: string
          coin_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          rail_confirmed: boolean
          rail_notes: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          address_pattern: string
          code: string
          coin_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          rail_confirmed?: boolean
          rail_notes?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          address_pattern?: string
          code?: string
          coin_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          rail_confirmed?: boolean
          rail_notes?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_coin_networks_coin_id_fkey"
            columns: ["coin_id"]
            isOneToOne: false
            referencedRelation: "payout_coins"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_coins: {
        Row: {
          address_pattern: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          rail_confirmed: boolean
          rail_notes: string | null
          requires_network: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          address_pattern?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          rail_confirmed?: boolean
          rail_notes?: string | null
          requires_network?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          address_pattern?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          rail_confirmed?: boolean
          rail_notes?: string | null
          requires_network?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      payout_detail_changes: {
        Row: {
          created_at: string
          id: number
          ip: unknown
          method: Database["public"]["Enums"]["payout_method"]
          new_masked: string | null
          old_masked: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          ip?: unknown
          method: Database["public"]["Enums"]["payout_method"]
          new_masked?: string | null
          old_masked?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          ip?: unknown
          method?: Database["public"]["Enums"]["payout_method"]
          new_masked?: string | null
          old_masked?: string | null
          user_id?: string
        }
        Relationships: []
      }
      payout_providers: {
        Row: {
          code: string
          country_code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          number_pattern: string
          rail_confirmed: boolean
          rail_notes: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          country_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          number_pattern: string
          rail_confirmed?: boolean
          rail_notes?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          country_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          number_pattern?: string
          rail_confirmed?: boolean
          rail_notes?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      points_ledger: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id: number
          metadata: Json
          points_per_currency_unit: number
          reference_id: string | null
          reference_type: string | null
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id?: never
          metadata?: Json
          points_per_currency_unit: number
          reference_id?: string | null
          reference_type?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          entry_type?: Database["public"]["Enums"]["ledger_entry_type"]
          id?: never
          metadata?: Json
          points_per_currency_unit?: number
          reference_id?: string | null
          reference_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          deleted_at: string | null
          deletion_effective_at: string | null
          deletion_requested_at: string | null
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          flagged_at: string | null
          flagged_by: string | null
          flagged_reason: string | null
          full_name: string
          id: string
          phone: string | null
          referral_code: string
          referred_by: string | null
          signup_country: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          deleted_at?: string | null
          deletion_effective_at?: string | null
          deletion_requested_at?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          flagged_reason?: string | null
          full_name: string
          id: string
          phone?: string | null
          referral_code: string
          referred_by?: string | null
          signup_country?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          deleted_at?: string | null
          deletion_effective_at?: string | null
          deletion_requested_at?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          flagged_reason?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          referral_code?: string
          referred_by?: string | null
          signup_country?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      redemptions: {
        Row: {
          approved_early: boolean
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level_at_request: Database["public"]["Enums"]["risk_level"]
          risk_score_at_request: number
          snapshot_account_name: string | null
          snapshot_coin_code: string | null
          snapshot_msisdn: string | null
          snapshot_network_code: string | null
          snapshot_provider_code: string | null
          snapshot_wallet: string | null
          status: Database["public"]["Enums"]["redemption_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_early?: boolean
          created_at?: string
          currency_amount: number
          currency_code?: string
          early_approval_reason?: string | null
          external_reference?: string | null
          failure_reason?: string | null
          holding_until: string
          id?: string
          method: Database["public"]["Enums"]["payout_method"]
          paid_at?: string | null
          points_amount: number
          points_per_currency_unit: number
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level_at_request?: Database["public"]["Enums"]["risk_level"]
          risk_score_at_request?: number
          snapshot_account_name?: string | null
          snapshot_coin_code?: string | null
          snapshot_msisdn?: string | null
          snapshot_network_code?: string | null
          snapshot_provider_code?: string | null
          snapshot_wallet?: string | null
          status?: Database["public"]["Enums"]["redemption_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_early?: boolean
          created_at?: string
          currency_amount?: number
          currency_code?: string
          early_approval_reason?: string | null
          external_reference?: string | null
          failure_reason?: string | null
          holding_until?: string
          id?: string
          method?: Database["public"]["Enums"]["payout_method"]
          paid_at?: string | null
          points_amount?: number
          points_per_currency_unit?: number
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level_at_request?: Database["public"]["Enums"]["risk_level"]
          risk_score_at_request?: number
          snapshot_account_name?: string | null
          snapshot_coin_code?: string | null
          snapshot_msisdn?: string | null
          snapshot_network_code?: string | null
          snapshot_provider_code?: string | null
          snapshot_wallet?: string | null
          status?: Database["public"]["Enums"]["redemption_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          activation_bonus_paid_at: string | null
          activation_bonus_points: number
          ads_at_activation: number | null
          code_used: string
          created_at: string
          id: string
          referee_id: string
          referrer_id: string
          rejected_by: string | null
          rejected_reason: string | null
          signup_bonus_paid_at: string | null
          signup_bonus_points: number
          status: Database["public"]["Enums"]["referral_status"]
          updated_at: string
        }
        Insert: {
          activation_bonus_paid_at?: string | null
          activation_bonus_points?: number
          ads_at_activation?: number | null
          code_used: string
          created_at?: string
          id?: string
          referee_id: string
          referrer_id: string
          rejected_by?: string | null
          rejected_reason?: string | null
          signup_bonus_paid_at?: string | null
          signup_bonus_points?: number
          status?: Database["public"]["Enums"]["referral_status"]
          updated_at?: string
        }
        Update: {
          activation_bonus_paid_at?: string | null
          activation_bonus_points?: number
          ads_at_activation?: number | null
          code_used?: string
          created_at?: string
          id?: string
          referee_id?: string
          referrer_id?: string
          rejected_by?: string | null
          rejected_reason?: string | null
          signup_bonus_paid_at?: string | null
          signup_bonus_points?: number
          status?: Database["public"]["Enums"]["referral_status"]
          updated_at?: string
        }
        Relationships: []
      }
      subscription_payments: {
        Row: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          currency_code: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          method: Database["public"]["Enums"]["subscription_payment_method"]
          period_days: number
          provider_payload: Json
          status: Database["public"]["Enums"]["subscription_payment_status"]
          tier_id: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          confirmed_at?: string | null
          created_at?: string
          currency_code?: string
          external_reference?: string | null
          failure_reason?: string | null
          id?: string
          method: Database["public"]["Enums"]["subscription_payment_method"]
          period_days: number
          provider_payload?: Json
          status?: Database["public"]["Enums"]["subscription_payment_status"]
          tier_id: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          confirmed_at?: string | null
          created_at?: string
          currency_code?: string
          external_reference?: string | null
          failure_reason?: string | null
          id?: string
          method?: Database["public"]["Enums"]["subscription_payment_method"]
          period_days?: number
          provider_payload?: Json
          status?: Database["public"]["Enums"]["subscription_payment_status"]
          tier_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      system_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          code: string
          context: Json
          created_at: string
          id: number
          message: string
          severity: Database["public"]["Enums"]["alert_severity"]
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          code: string
          context?: Json
          created_at?: string
          id?: never
          message: string
          severity: Database["public"]["Enums"]["alert_severity"]
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          code?: string
          context?: Json
          created_at?: string
          id?: never
          message?: string
          severity?: Database["public"]["Enums"]["alert_severity"]
        }
        Relationships: []
      }
      tiers: {
        Row: {
          ad_cooldown_seconds: number
          ad_priority: number
          billing_period_days: number
          created_at: string
          currency_code: string
          daily_ad_cap: number
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          price_minor: number
          redemption_minimum_points: number
          referral_bonus_multiplier: number
          reward_multiplier: number
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          ad_cooldown_seconds?: number
          ad_priority?: number
          billing_period_days?: number
          created_at?: string
          currency_code?: string
          daily_ad_cap: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          price_minor?: number
          redemption_minimum_points: number
          referral_bonus_multiplier?: number
          reward_multiplier?: number
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          ad_cooldown_seconds?: number
          ad_priority?: number
          billing_period_days?: number
          created_at?: string
          currency_code?: string
          daily_ad_cap?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          price_minor?: number
          redemption_minimum_points?: number
          referral_bonus_multiplier?: number
          reward_multiplier?: number
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_ad_state: {
        Row: {
          ad_id: string
          attempts_used: number
          completed_at: string | null
          created_at: string
          locked_at: string | null
          status: Database["public"]["Enums"]["user_ad_status"]
          updated_at: string
          user_id: string
          watch_completed_at: string | null
          watch_started_at: string | null
        }
        Insert: {
          ad_id: string
          attempts_used?: number
          completed_at?: string | null
          created_at?: string
          locked_at?: string | null
          status?: Database["public"]["Enums"]["user_ad_status"]
          updated_at?: string
          user_id: string
          watch_completed_at?: string | null
          watch_started_at?: string | null
        }
        Update: {
          ad_id?: string
          attempts_used?: number
          completed_at?: string | null
          created_at?: string
          locked_at?: string | null
          status?: Database["public"]["Enums"]["user_ad_status"]
          updated_at?: string
          user_id?: string
          watch_completed_at?: string | null
          watch_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_ad_state_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
        ]
      }
      user_backup_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_balances: {
        Row: {
          balance: number
          lifetime_earned: number
          lifetime_spent: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          lifetime_earned?: number
          lifetime_spent?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          lifetime_earned?: number
          lifetime_spent?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_devices: {
        Row: {
          fingerprint: string
          first_seen_at: string
          last_seen_at: string
          seen_count: number
          user_id: string
        }
        Insert: {
          fingerprint: string
          first_seen_at?: string
          last_seen_at?: string
          seen_count?: number
          user_id: string
        }
        Update: {
          fingerprint?: string
          first_seen_at?: string
          last_seen_at?: string
          seen_count?: number
          user_id?: string
        }
        Relationships: []
      }
      user_payout_details: {
        Row: {
          account_name: string | null
          coin_id: string | null
          created_at: string
          last_changed_at: string
          method: Database["public"]["Enums"]["payout_method"]
          msisdn: string | null
          network_id: string | null
          provider_id: string | null
          updated_at: string
          user_id: string
          wallet_address: string | null
        }
        Insert: {
          account_name?: string | null
          coin_id?: string | null
          created_at?: string
          last_changed_at?: string
          method: Database["public"]["Enums"]["payout_method"]
          msisdn?: string | null
          network_id?: string | null
          provider_id?: string | null
          updated_at?: string
          user_id: string
          wallet_address?: string | null
        }
        Update: {
          account_name?: string | null
          coin_id?: string | null
          created_at?: string
          last_changed_at?: string
          method?: Database["public"]["Enums"]["payout_method"]
          msisdn?: string | null
          network_id?: string | null
          provider_id?: string | null
          updated_at?: string
          user_id?: string
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_payout_details_coin_id_fkey"
            columns: ["coin_id"]
            isOneToOne: false
            referencedRelation: "payout_coins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_payout_details_network_id_fkey"
            columns: ["network_id"]
            isOneToOne: false
            referencedRelation: "payout_coin_networks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_payout_details_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payout_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_risk_scores: {
        Row: {
          last_computed_at: string
          level: Database["public"]["Enums"]["risk_level"]
          review_notes: string | null
          review_status: Database["public"]["Enums"]["fraud_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          score: number
          signal_count: number
          user_id: string
        }
        Insert: {
          last_computed_at?: string
          level?: Database["public"]["Enums"]["risk_level"]
          review_notes?: string | null
          review_status?: Database["public"]["Enums"]["fraud_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number
          signal_count?: number
          user_id: string
        }
        Update: {
          last_computed_at?: string
          level?: Database["public"]["Enums"]["risk_level"]
          review_notes?: string | null
          review_status?: Database["public"]["Enums"]["fraud_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number
          signal_count?: number
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_security: {
        Row: {
          pin_failed_attempts: number
          pin_hash: string | null
          pin_locked_until: string | null
          pin_set_at: string | null
          totp_confirmed_at: string | null
          totp_failed_attempts: number
          totp_locked_until: string | null
          totp_secret_cipher: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          pin_failed_attempts?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          pin_set_at?: string | null
          totp_confirmed_at?: string | null
          totp_failed_attempts?: number
          totp_locked_until?: string | null
          totp_secret_cipher?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          pin_failed_attempts?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          pin_set_at?: string | null
          totp_confirmed_at?: string | null
          totp_failed_attempts?: number
          totp_locked_until?: string | null
          totp_secret_cipher?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_session_records: {
        Row: {
          country: string | null
          ip: unknown
          last_seen_at: string
          session_id: string
          signed_in_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          country?: string | null
          ip?: unknown
          last_seen_at?: string
          session_id: string
          signed_in_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          country?: string | null
          ip?: unknown
          last_seen_at?: string
          session_id?: string
          signed_in_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          cancelled_at: string | null
          created_at: string
          current_period_end: string
          grace_ends_at: string | null
          id: string
          started_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          tier_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          current_period_end: string
          grace_ends_at?: string | null
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          tier_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string
          grace_ends_at?: string | null
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          tier_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_referral_code: {
        Args: {
          p_code: string
          p_fingerprint?: string
          p_ip?: unknown
          p_referee_id: string
        }
        Returns: {
          activation_bonus_paid_at: string | null
          activation_bonus_points: number
          ads_at_activation: number | null
          code_used: string
          created_at: string
          id: string
          referee_id: string
          referrer_id: string
          rejected_by: string | null
          rejected_reason: string | null
          signup_bonus_paid_at: string | null
          signup_bonus_points: number
          status: Database["public"]["Enums"]["referral_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "referrals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_redemption: {
        Args: {
          p_admin_id: string
          p_approve_early?: boolean
          p_early_reason?: string
          p_notes?: string
          p_redemption_id: string
        }
        Returns: {
          approved_early: boolean
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level_at_request: Database["public"]["Enums"]["risk_level"]
          risk_score_at_request: number
          snapshot_account_name: string | null
          snapshot_coin_code: string | null
          snapshot_msisdn: string | null
          snapshot_network_code: string | null
          snapshot_provider_code: string | null
          snapshot_wallet: string | null
          status: Database["public"]["Enums"]["redemption_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "redemptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      broadcast_notification: {
        Args: {
          p_body: string
          p_reference?: Json
          p_title: string
          p_type: Database["public"]["Enums"]["notification_type"]
        }
        Returns: number
      }
      cancel_account_deletion: { Args: { p_user_id: string }; Returns: boolean }
      cancel_redemption: {
        Args: { p_redemption_id: string; p_user_id: string }
        Returns: {
          approved_early: boolean
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level_at_request: Database["public"]["Enums"]["risk_level"]
          risk_score_at_request: number
          snapshot_account_name: string | null
          snapshot_coin_code: string | null
          snapshot_msisdn: string | null
          snapshot_network_code: string | null
          snapshot_provider_code: string | null
          snapshot_wallet: string | null
          status: Database["public"]["Enums"]["redemption_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "redemptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_subscription: {
        Args: { p_user_id: string }
        Returns: {
          cancelled_at: string | null
          created_at: string
          current_period_end: string
          grace_ends_at: string | null
          id: string
          started_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          tier_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_referral_activation: {
        Args: { p_referee_id: string }
        Returns: boolean
      }
      clear_notifications: { Args: never; Returns: undefined }
      clear_totp_failures: { Args: { p_user_id: string }; Returns: undefined }
      clear_user_flag: {
        Args: { p_admin_id: string; p_user_id: string }
        Returns: {
          avatar_path: string | null
          created_at: string
          deleted_at: string | null
          deletion_effective_at: string | null
          deletion_requested_at: string | null
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          flagged_at: string | null
          flagged_by: string | null
          flagged_reason: string | null
          full_name: string
          id: string
          phone: string | null
          referral_code: string
          referred_by: string | null
          signup_country: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      config_bool: { Args: { p_key: string }; Returns: boolean }
      config_decimal: { Args: { p_key: string }; Returns: number }
      config_int: { Args: { p_key: string }; Returns: number }
      confirm_subscription_payment: {
        Args: { p_payload?: Json; p_payment_id: string; p_reference: string }
        Returns: {
          cancelled_at: string | null
          created_at: string
          current_period_end: string
          grace_ends_at: string | null
          id: string
          started_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          tier_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_totp_enrollment: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      consume_backup_code: {
        Args: { p_code: string; p_user_id: string }
        Returns: Json
      }
      create_notification: {
        Args: {
          p_body: string
          p_reference?: Json
          p_title: string
          p_type: Database["public"]["Enums"]["notification_type"]
          p_user_id: string
        }
        Returns: string
      }
      credit_points: {
        Args: {
          p_amount: number
          p_enforce_daily_cap?: boolean
          p_entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          p_metadata?: Json
          p_reference_id?: string
          p_reference_type?: string
          p_user_id: string
        }
        Returns: {
          amount: number
          balance_after: number
          created_at: string
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id: number
          metadata: Json
          points_per_currency_unit: number
          reference_id: string | null
          reference_type: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "points_ledger"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      debit_points: {
        Args: {
          p_amount: number
          p_entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          p_metadata?: Json
          p_reference_id?: string
          p_reference_type?: string
          p_user_id: string
        }
        Returns: {
          amount: number
          balance_after: number
          created_at: string
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id: number
          metadata: Json
          points_per_currency_unit: number
          reference_id: string | null
          reference_type: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "points_ledger"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      disable_totp: { Args: { p_user_id: string }; Returns: undefined }
      due_account_deletions: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      email_is_registered: { Args: { p_email: string }; Returns: boolean }
      evaluate_signup_fraud: {
        Args: {
          p_email: string
          p_fingerprint?: string
          p_ip?: unknown
          p_phone?: string
          p_user_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["fraud_decision"]
        SetofOptions: {
          from: "*"
          to: "fraud_decision"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      expire_subscriptions: {
        Args: never
        Returns: {
          to_expired: number
          to_grace: number
        }[]
      }
      finalise_account_deletion: { Args: { p_user_id: string }; Returns: Json }
      flag_user_account: {
        Args: { p_admin_id: string; p_reason: string; p_user_id: string }
        Returns: {
          avatar_path: string | null
          created_at: string
          deleted_at: string | null
          deletion_effective_at: string | null
          deletion_requested_at: string | null
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          flagged_at: string | null
          flagged_by: string | null
          flagged_reason: string | null
          full_name: string
          id: string
          phone: string | null
          referral_code: string
          referred_by: string | null
          signup_country: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fraud_fingerprint_account_count: {
        Args: { p_exclude?: string; p_fingerprint: string }
        Returns: number
      }
      fraud_ip_signup_velocity: {
        Args: { p_ip: unknown; p_window_hours: number }
        Returns: number
      }
      fraud_is_email_domain_blocked: {
        Args: { p_email: string }
        Returns: boolean
      }
      fraud_is_ip_blocked: { Args: { p_ip: unknown }; Returns: boolean }
      fraud_phone_duplicate_count: {
        Args: { p_exclude?: string; p_phone: string }
        Returns: number
      }
      generate_referral_code: { Args: never; Returns: string }
      get_active_sessions: {
        Args: never
        Returns: {
          country: string
          id: string
          ip: string
          is_current: boolean
          last_seen: string
          signed_in_at: string
          user_agent: string
        }[]
      }
      get_ad_feed: {
        Args: {
          p_format?: Database["public"]["Enums"]["ad_format"]
          p_limit?: number
          p_user_id: string
        }
        Returns: {
          advertiser_name: string
          attempts_remaining: number
          attempts_used: number
          description: string
          duration_seconds: number
          format: Database["public"]["Enums"]["ad_format"]
          id: string
          min_watch_seconds: number
          points_award: number
          points_reward: number
          question_count: number
          storage_path: string
          thumbnail_path: string
          title: string
          video_source: Database["public"]["Enums"]["video_source"]
          youtube_video_id: string
        }[]
      }
      get_ad_question_for_user: {
        Args: { p_ad_id: string; p_position?: number }
        Returns: {
          answer_format: Database["public"]["Enums"]["answer_format"]
          option_id: string
          option_text: string
          question_id: string
          question_text: string
        }[]
      }
      get_ad_questions_for_user: {
        Args: { p_ad_id: string }
        Returns: {
          answer_format: Database["public"]["Enums"]["answer_format"]
          option_id: string
          option_text: string
          question_id: string
          question_index: number
          question_text: string
          show_at_seconds: number
        }[]
      }
      get_deletion_status: { Args: never; Returns: Json }
      get_eligible_ads: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          advertiser_name: string | null
          completions_count: number
          created_at: string
          created_by: string | null
          description: string | null
          duration_seconds: number | null
          ends_at: string | null
          format: Database["public"]["Enums"]["ad_format"]
          id: string
          max_completions: number | null
          min_watch_seconds: number | null
          points_reward: number
          starts_at: string | null
          status: Database["public"]["Enums"]["ad_status"]
          storage_path: string | null
          thumbnail_path: string | null
          title: string
          updated_at: string
          video_source: Database["public"]["Enums"]["video_source"] | null
          weight: number
          youtube_video_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_referral_summary: {
        Args: { p_user_id: string }
        Returns: {
          activated_count: number
          ads_required: number
          pending_count: number
          points_earned: number
          referral_code: string
          total_referred: number
        }[]
      }
      get_totp_secret_cipher: { Args: { p_user_id: string }; Returns: string }
      get_totp_status: { Args: never; Returns: Json }
      get_user_earning_status: {
        Args: { p_user_id: string }
        Returns: {
          account_disabled: boolean
          ads_completed_today: number
          ads_remaining_today: number
          balance: number
          currency_value: number
          daily_ad_cap: number
          earning_paused: boolean
          tier_name: string
          tier_slug: string
        }[]
      }
      has_withdrawal_pin: { Args: { p_user_id: string }; Returns: boolean }
      identity_hash: { Args: { p_value: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_identity_blocked: {
        Args: { p_email: string; p_phone: string }
        Returns: boolean
      }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_notification_read: { Args: { p_id: string }; Returns: undefined }
      mark_redemption_failed: {
        Args: { p_admin_id: string; p_reason: string; p_redemption_id: string }
        Returns: {
          approved_early: boolean
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level_at_request: Database["public"]["Enums"]["risk_level"]
          risk_score_at_request: number
          snapshot_account_name: string | null
          snapshot_coin_code: string | null
          snapshot_msisdn: string | null
          snapshot_network_code: string | null
          snapshot_provider_code: string | null
          snapshot_wallet: string | null
          status: Database["public"]["Enums"]["redemption_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "redemptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_redemption_paid: {
        Args: {
          p_admin_id: string
          p_redemption_id: string
          p_reference: string
        }
        Returns: {
          approved_early: boolean
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level_at_request: Database["public"]["Enums"]["risk_level"]
          risk_score_at_request: number
          snapshot_account_name: string | null
          snapshot_coin_code: string | null
          snapshot_msisdn: string | null
          snapshot_network_code: string | null
          snapshot_provider_code: string | null
          snapshot_wallet: string | null
          status: Database["public"]["Enums"]["redemption_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "redemptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mask_payout_value: { Args: { p_value: string }; Returns: string }
      normalise_phone: { Args: { p_phone: string }; Returns: string }
      precheck_signup_fraud: {
        Args: { p_email: string; p_ip?: unknown }
        Returns: Database["public"]["CompositeTypes"]["fraud_decision"]
        SetofOptions: {
          from: "*"
          to: "fraud_decision"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recompute_user_risk: {
        Args: { p_user_id: string }
        Returns: {
          last_computed_at: string
          level: Database["public"]["Enums"]["risk_level"]
          review_notes: string | null
          review_status: Database["public"]["Enums"]["fraud_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          score: number
          signal_count: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_risk_scores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconcile_user_balance: {
        Args: { p_user_id: string }
        Returns: {
          drift: number
          entry_count: number
          ledger_balance: number
          stored_balance: number
          user_id: string
        }[]
      }
      record_auth_signal: {
        Args: {
          p_country?: string
          p_event_type: Database["public"]["Enums"]["auth_event_type"]
          p_fingerprint?: string
          p_ip?: unknown
          p_user_agent?: string
          p_user_id: string
        }
        Returns: number
      }
      record_fraud_signal: {
        Args: { p_check_code: string; p_details?: Json; p_user_id: string }
        Returns: boolean
      }
      record_session_context: {
        Args: {
          p_country: string
          p_ip: string
          p_session_id: string
          p_user_agent: string
          p_user_id: string
        }
        Returns: undefined
      }
      register_ad_view: {
        Args: { p_ad_id: string; p_user_id: string }
        Returns: string
      }
      register_totp_failure: { Args: { p_user_id: string }; Returns: Json }
      reject_redemption: {
        Args: { p_admin_id: string; p_reason: string; p_redemption_id: string }
        Returns: {
          approved_early: boolean
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level_at_request: Database["public"]["Enums"]["risk_level"]
          risk_score_at_request: number
          snapshot_account_name: string | null
          snapshot_coin_code: string | null
          snapshot_msisdn: string | null
          snapshot_network_code: string | null
          snapshot_provider_code: string | null
          snapshot_wallet: string | null
          status: Database["public"]["Enums"]["redemption_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "redemptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_referral: {
        Args: { p_admin_id: string; p_reason: string; p_referral_id: string }
        Returns: {
          activation_bonus_paid_at: string | null
          activation_bonus_points: number
          ads_at_activation: number | null
          code_used: string
          created_at: string
          id: string
          referee_id: string
          referrer_id: string
          rejected_by: string | null
          rejected_reason: string | null
          signup_bonus_paid_at: string | null
          signup_bonus_points: number
          status: Database["public"]["Enums"]["referral_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "referrals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_matured_holds: { Args: never; Returns: number }
      replace_backup_codes: {
        Args: { p_codes: string[]; p_user_id: string }
        Returns: number
      }
      request_account_deletion: { Args: { p_user_id: string }; Returns: string }
      request_redemption: {
        Args: {
          p_ip?: unknown
          p_method: Database["public"]["Enums"]["payout_method"]
          p_points: number
          p_user_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["redemption_request_result"]
        SetofOptions: {
          from: "*"
          to: "redemption_request_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reset_withdrawal_pin: {
        Args: { p_new_pin: string; p_user_id: string }
        Returns: undefined
      }
      resolve_user_tier: {
        Args: { p_user_id: string }
        Returns: {
          ad_cooldown_seconds: number
          ad_priority: number
          billing_period_days: number
          created_at: string
          currency_code: string
          daily_ad_cap: number
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          price_minor: number
          redemption_minimum_points: number
          referral_bonus_multiplier: number
          reward_multiplier: number
          slug: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tiers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_other_sessions: { Args: never; Returns: number }
      revoke_session: { Args: { p_session_id: string }; Returns: boolean }
      set_payout_details: {
        Args: {
          p_account_name?: string
          p_coin_id?: string
          p_ip?: unknown
          p_method: Database["public"]["Enums"]["payout_method"]
          p_msisdn?: string
          p_network_id?: string
          p_provider_id?: string
          p_user_id: string
          p_wallet_address?: string
        }
        Returns: {
          account_name: string | null
          coin_id: string | null
          created_at: string
          last_changed_at: string
          method: Database["public"]["Enums"]["payout_method"]
          msisdn: string | null
          network_id: string | null
          provider_id: string | null
          updated_at: string
          user_id: string
          wallet_address: string | null
        }
        SetofOptions: {
          from: "*"
          to: "user_payout_details"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_withdrawal_pin: {
        Args: { p_current_pin?: string; p_new_pin: string; p_user_id: string }
        Returns: undefined
      }
      start_subscription_payment: {
        Args: {
          p_method: Database["public"]["Enums"]["subscription_payment_method"]
          p_tier_id: string
          p_user_id: string
        }
        Returns: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          currency_code: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          method: Database["public"]["Enums"]["subscription_payment_method"]
          period_days: number
          provider_payload: Json
          status: Database["public"]["Enums"]["subscription_payment_status"]
          tier_id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_totp_enrollment: {
        Args: { p_cipher: string; p_user_id: string }
        Returns: undefined
      }
      submit_ad_answers: {
        Args: { p_ad_id: string; p_answers: Json; p_user_id: string }
        Returns: Database["public"]["CompositeTypes"]["ad_answer_result"]
        SetofOptions: {
          from: "*"
          to: "ad_answer_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      totp_lock_state: { Args: { p_user_id: string }; Returns: Json }
      utc_today: { Args: never; Returns: string }
      verify_withdrawal_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      ad_answer_outcome:
        | "correct"
        | "incorrect"
        | "locked"
        | "already_completed"
        | "not_eligible"
        | "not_watched"
        | "too_fast"
        | "daily_cap_reached"
        | "earning_blocked"
      ad_format: "video" | "survey"
      ad_status: "draft" | "active" | "paused" | "exhausted" | "archived"
      alert_severity: "info" | "warning" | "critical"
      answer_format: "multiple_choice" | "short_text"
      app_role: "user" | "admin"
      auth_event_type:
        | "signup"
        | "login"
        | "redemption_request"
        | "payout_details_change"
      config_value_type: "int" | "decimal" | "bool" | "text"
      fraud_action: "flag" | "block"
      fraud_review_status: "none" | "pending" | "cleared" | "confirmed_fraud"
      ledger_entry_type:
        | "ad_view"
        | "survey"
        | "referral_signup"
        | "referral_activation"
        | "redemption_request"
        | "redemption_refund"
        | "admin_adjustment"
      notification_type: "announcement" | "payout" | "flag"
      payout_method: "crypto" | "mobile_money"
      redemption_status:
        | "held"
        | "pending_approval"
        | "approved"
        | "paid"
        | "rejected"
        | "cancelled"
        | "failed"
      referral_status: "pending" | "activated" | "rejected"
      risk_level: "low" | "medium" | "high" | "critical"
      subscription_payment_method: "korapay" | "crypto" | "paystack"
      subscription_payment_status:
        | "pending"
        | "confirmed"
        | "failed"
        | "refunded"
      subscription_status: "active" | "grace" | "expired" | "cancelled"
      user_ad_status: "in_progress" | "completed" | "failed_locked"
      video_source: "upload" | "youtube"
    }
    CompositeTypes: {
      ad_answer_result: {
        outcome: Database["public"]["Enums"]["ad_answer_outcome"] | null
        points_awarded: number | null
        attempts_used: number | null
        attempts_remaining: number | null
        new_balance: number | null
        message: string | null
      }
      fraud_decision: {
        allowed: boolean | null
        block_reason: string | null
        score: number | null
        level: Database["public"]["Enums"]["risk_level"] | null
        signals_fired: string[] | null
      }
      redemption_request_result: {
        redemption_id: string | null
        status: Database["public"]["Enums"]["redemption_status"] | null
        points: number | null
        currency: number | null
        holding_until: string | null
        message: string | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ad_answer_outcome: [
        "correct",
        "incorrect",
        "locked",
        "already_completed",
        "not_eligible",
        "not_watched",
        "too_fast",
        "daily_cap_reached",
        "earning_blocked",
      ],
      ad_format: ["video", "survey"],
      ad_status: ["draft", "active", "paused", "exhausted", "archived"],
      alert_severity: ["info", "warning", "critical"],
      answer_format: ["multiple_choice", "short_text"],
      app_role: ["user", "admin"],
      auth_event_type: [
        "signup",
        "login",
        "redemption_request",
        "payout_details_change",
      ],
      config_value_type: ["int", "decimal", "bool", "text"],
      fraud_action: ["flag", "block"],
      fraud_review_status: ["none", "pending", "cleared", "confirmed_fraud"],
      ledger_entry_type: [
        "ad_view",
        "survey",
        "referral_signup",
        "referral_activation",
        "redemption_request",
        "redemption_refund",
        "admin_adjustment",
      ],
      notification_type: ["announcement", "payout", "flag"],
      payout_method: ["crypto", "mobile_money"],
      redemption_status: [
        "held",
        "pending_approval",
        "approved",
        "paid",
        "rejected",
        "cancelled",
        "failed",
      ],
      referral_status: ["pending", "activated", "rejected"],
      risk_level: ["low", "medium", "high", "critical"],
      subscription_payment_method: ["korapay", "crypto", "paystack"],
      subscription_payment_status: [
        "pending",
        "confirmed",
        "failed",
        "refunded",
      ],
      subscription_status: ["active", "grace", "expired", "cancelled"],
      user_ad_status: ["in_progress", "completed", "failed_locked"],
      video_source: ["upload", "youtube"],
    },
  },
} as const
