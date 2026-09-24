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
      ad_link_clicks: {
        Row: {
          ad_id: string
          clicked_at: string
          id: string
          points_awarded: number
          user_id: string
        }
        Insert: {
          ad_id: string
          clicked_at?: string
          id?: string
          points_awarded?: number
          user_id: string
        }
        Update: {
          ad_id?: string
          clicked_at?: string
          id?: string
          points_awarded?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_link_clicks_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
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
      ad_question_rules: {
        Row: {
          created_at: string
          depends_on_question_id: string
          id: string
          negate: boolean
          option_id: string | null
          question_id: string
          value_text: string | null
        }
        Insert: {
          created_at?: string
          depends_on_question_id: string
          id?: string
          negate?: boolean
          option_id?: string | null
          question_id: string
          value_text?: string | null
        }
        Update: {
          created_at?: string
          depends_on_question_id?: string
          id?: string
          negate?: boolean
          option_id?: string | null
          question_id?: string
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_question_rules_depends_on_question_id_fkey"
            columns: ["depends_on_question_id"]
            isOneToOne: false
            referencedRelation: "ad_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_question_rules_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "ad_question_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_question_rules_question_id_fkey"
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
          condition_mode: Database["public"]["Enums"]["question_condition_mode"]
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
          condition_mode?: Database["public"]["Enums"]["question_condition_mode"]
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
          condition_mode?: Database["public"]["Enums"]["question_condition_mode"]
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
      ad_responses: {
        Row: {
          ad_id: string
          answer_format: string
          answer_label: string | null
          answer_text: string | null
          answered_at: string
          attempt_number: number
          id: number
          is_correct: boolean | null
          is_graded: boolean
          occasion: number
          option_id: string | null
          question_id: string | null
          question_position: number | null
          question_text: string
          user_id: string
          watch_seconds: number | null
        }
        Insert: {
          ad_id: string
          answer_format: string
          answer_label?: string | null
          answer_text?: string | null
          answered_at?: string
          attempt_number?: number
          id?: never
          is_correct?: boolean | null
          is_graded?: boolean
          occasion?: number
          option_id?: string | null
          question_id?: string | null
          question_position?: number | null
          question_text: string
          user_id: string
          watch_seconds?: number | null
        }
        Update: {
          ad_id?: string
          answer_format?: string
          answer_label?: string | null
          answer_text?: string | null
          answered_at?: string
          attempt_number?: number
          id?: never
          is_correct?: boolean | null
          is_graded?: boolean
          occasion?: number
          option_id?: string | null
          question_id?: string | null
          question_position?: number | null
          question_text?: string
          user_id?: string
          watch_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_responses_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_responses_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "ad_question_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "ad_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_tiers: {
        Row: {
          ad_id: string
          tier_id: string
        }
        Insert: {
          ad_id: string
          tier_id: string
        }
        Update: {
          ad_id?: string
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_tiers_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_tiers_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "tiers"
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
      admin_view_sessions: {
        Row: {
          admin_id: string
          ended_at: string | null
          expires_at: string
          id: string
          started_at: string
          target_user_id: string
          token: string
        }
        Insert: {
          admin_id: string
          ended_at?: string | null
          expires_at: string
          id?: string
          started_at?: string
          target_user_id: string
          token: string
        }
        Update: {
          admin_id?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          started_at?: string
          target_user_id?: string
          token?: string
        }
        Relationships: []
      }
      ads: {
        Row: {
          advertiser_id: string | null
          advertiser_logo_path: string | null
          advertiser_name: string | null
          article_body: string | null
          completions_count: number
          created_at: string
          created_by: string | null
          cta_label: string | null
          cta_links: Json
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
          advertiser_id?: string | null
          advertiser_logo_path?: string | null
          advertiser_name?: string | null
          article_body?: string | null
          completions_count?: number
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_links?: Json
          description?: string | null
          duration_seconds?: number | null
          ends_at?: string | null
          format: Database["public"]["Enums"]["ad_format"]
          id?: string
          max_completions?: number | null
          min_watch_seconds?: number | null
          points_reward?: number
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
          advertiser_id?: string | null
          advertiser_logo_path?: string | null
          advertiser_name?: string | null
          article_body?: string | null
          completions_count?: number
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_links?: Json
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
        Relationships: [
          {
            foreignKeyName: "ads_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      advertiser_payments: {
        Row: {
          advertiser_id: string
          amount_minor: number
          created_at: string
          currency_code: string
          id: string
          method: string | null
          note: string | null
          received_at: string
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          advertiser_id: string
          amount_minor: number
          created_at?: string
          currency_code?: string
          id?: string
          method?: string | null
          note?: string | null
          received_at?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          advertiser_id?: string
          amount_minor?: number
          created_at?: string
          currency_code?: string
          id?: string
          method?: string | null
          note?: string | null
          received_at?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advertiser_payments_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      advertisers: {
        Row: {
          contact: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          name: string
          notes: string | null
          started_at: string
          status: Database["public"]["Enums"]["advertiser_status"]
          updated_at: string
        }
        Insert: {
          contact?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          name: string
          notes?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["advertiser_status"]
          updated_at?: string
        }
        Update: {
          contact?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["advertiser_status"]
          updated_at?: string
        }
        Relationships: []
      }
      announcements: {
        Row: {
          audience: string
          body: string
          business: Database["public"]["Enums"]["notification_business"]
          created_at: string
          id: string
          recipient_count: number
          sent_by: string | null
          title: string
        }
        Insert: {
          audience?: string
          body: string
          business?: Database["public"]["Enums"]["notification_business"]
          created_at?: string
          id?: string
          recipient_count: number
          sent_by?: string | null
          title: string
        }
        Update: {
          audience?: string
          body?: string
          business?: Database["public"]["Enums"]["notification_business"]
          created_at?: string
          id?: string
          recipient_count?: number
          sent_by?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      communities: {
        Row: {
          business: Database["public"]["Enums"]["notification_business"]
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          platform: Database["public"]["Enums"]["community_platform"]
          sort_order: number
          updated_at: string
          url: string
        }
        Insert: {
          business?: Database["public"]["Enums"]["notification_business"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          platform?: Database["public"]["Enums"]["community_platform"]
          sort_order?: number
          updated_at?: string
          url: string
        }
        Update: {
          business?: Database["public"]["Enums"]["notification_business"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          platform?: Database["public"]["Enums"]["community_platform"]
          sort_order?: number
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          charged_minor: number
          coupon_id: string
          created_at: string
          discount_minor: number
          id: string
          list_minor: number
          order_id: string | null
          subscription_payment_id: string | null
          user_id: string
        }
        Insert: {
          charged_minor: number
          coupon_id: string
          created_at?: string
          discount_minor: number
          id?: string
          list_minor: number
          order_id?: string | null
          subscription_payment_id?: string | null
          user_id: string
        }
        Update: {
          charged_minor?: number
          coupon_id?: string
          created_at?: string
          discount_minor?: number
          id?: string
          list_minor?: number
          order_id?: string | null
          subscription_payment_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_subscription_payment_id_fkey"
            columns: ["subscription_payment_id"]
            isOneToOne: false
            referencedRelation: "subscription_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          amount_minor: number | null
          business: Database["public"]["Enums"]["coupon_business"]
          code: string
          created_at: string
          created_by: string | null
          discount_kind: Database["public"]["Enums"]["coupon_discount_kind"]
          ends_at: string | null
          first_purchase_only: boolean
          id: string
          is_active: boolean
          max_discount_minor: number | null
          min_spend_minor: number
          note: string | null
          per_user_limit: number
          percent: number | null
          product_id: string | null
          quota: number
          starts_at: string | null
          tier_id: string | null
          updated_at: string
        }
        Insert: {
          amount_minor?: number | null
          business: Database["public"]["Enums"]["coupon_business"]
          code: string
          created_at?: string
          created_by?: string | null
          discount_kind: Database["public"]["Enums"]["coupon_discount_kind"]
          ends_at?: string | null
          first_purchase_only?: boolean
          id?: string
          is_active?: boolean
          max_discount_minor?: number | null
          min_spend_minor?: number
          note?: string | null
          per_user_limit?: number
          percent?: number | null
          product_id?: string | null
          quota: number
          starts_at?: string | null
          tier_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_minor?: number | null
          business?: Database["public"]["Enums"]["coupon_business"]
          code?: string
          created_at?: string
          created_by?: string | null
          discount_kind?: Database["public"]["Enums"]["coupon_discount_kind"]
          ends_at?: string | null
          first_purchase_only?: boolean
          id?: string
          is_active?: boolean
          max_discount_minor?: number | null
          min_spend_minor?: number
          note?: string | null
          per_user_limit?: number
          percent?: number | null
          product_id?: string | null
          quota?: number
          starts_at?: string | null
          tier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupons_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
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
      ebook_chapters: {
        Row: {
          body: string
          created_at: string
          id: string
          position: number
          product_id: string
          title: string
          word_count: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          position?: number
          product_id: string
          title: string
          word_count?: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          position?: number
          product_id?: string
          title?: string
          word_count?: number
        }
        Relationships: []
      }
      entitlements: {
        Row: {
          created_at: string
          expires_at: string | null
          granted_at: string
          id: string
          order_id: string
          product_id: string
          status: Database["public"]["Enums"]["entitlement_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          id?: string
          order_id: string
          product_id: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          id?: string
          order_id?: string
          product_id?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id?: string
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
      fx_rates: {
        Row: {
          fetched_at: string
          pair: string
          rate: number
          source: string
          updated_at: string
        }
        Insert: {
          fetched_at?: string
          pair: string
          rate: number
          source: string
          updated_at?: string
        }
        Update: {
          fetched_at?: string
          pair?: string
          rate?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      game_plays: {
        Row: {
          created_at: string
          extra_plays_awarded: number
          game: Database["public"]["Enums"]["game_kind"]
          id: string
          points_awarded: number
          prize_id: string
          roll: number
          slot: number
          user_id: string
          week_start: string
          weight_total: number
        }
        Insert: {
          created_at?: string
          extra_plays_awarded?: number
          game: Database["public"]["Enums"]["game_kind"]
          id?: string
          points_awarded: number
          prize_id: string
          roll: number
          slot: number
          user_id: string
          week_start: string
          weight_total: number
        }
        Update: {
          created_at?: string
          extra_plays_awarded?: number
          game?: Database["public"]["Enums"]["game_kind"]
          id?: string
          points_awarded?: number
          prize_id?: string
          roll?: number
          slot?: number
          user_id?: string
          week_start?: string
          weight_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "game_plays_prize_id_fkey"
            columns: ["prize_id"]
            isOneToOne: false
            referencedRelation: "game_prizes"
            referencedColumns: ["id"]
          },
        ]
      }
      game_prizes: {
        Row: {
          colour: string
          created_at: string
          daily_cap: number
          extra_plays: number
          game: Database["public"]["Enums"]["game_kind"]
          id: string
          is_active: boolean
          label: string
          points: number
          slot: number
          updated_at: string
          weekly_cap: number
          weight: number
        }
        Insert: {
          colour?: string
          created_at?: string
          daily_cap?: number
          extra_plays?: number
          game: Database["public"]["Enums"]["game_kind"]
          id?: string
          is_active?: boolean
          label: string
          points?: number
          slot: number
          updated_at?: string
          weekly_cap?: number
          weight?: number
        }
        Update: {
          colour?: string
          created_at?: string
          daily_cap?: number
          extra_plays?: number
          game?: Database["public"]["Enums"]["game_kind"]
          id?: string
          is_active?: boolean
          label?: string
          points?: number
          slot?: number
          updated_at?: string
          weekly_cap?: number
          weight?: number
        }
        Relationships: []
      }
      gift_code_attempts: {
        Row: {
          attempted: string
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          attempted: string
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          attempted?: string
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      gift_code_redemptions: {
        Row: {
          created_at: string
          gift_code_id: string
          id: string
          points_awarded: number
          user_id: string
        }
        Insert: {
          created_at?: string
          gift_code_id: string
          id?: string
          points_awarded: number
          user_id: string
        }
        Update: {
          created_at?: string
          gift_code_id?: string
          id?: string
          points_awarded?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_code_redemptions_gift_code_id_fkey"
            columns: ["gift_code_id"]
            isOneToOne: true
            referencedRelation: "gift_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          note: string | null
          points: number
          revoked_at: string | null
          revoked_by: string | null
          status: Database["public"]["Enums"]["gift_code_status"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          note?: string | null
          points: number
          revoked_at?: string | null
          revoked_by?: string | null
          status?: Database["public"]["Enums"]["gift_code_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          note?: string | null
          points?: number
          revoked_at?: string | null
          revoked_by?: string | null
          status?: Database["public"]["Enums"]["gift_code_status"]
          updated_at?: string
        }
        Relationships: []
      }
      hub_inbound_events: {
        Row: {
          amount_minor: number | null
          currency_code: string | null
          detail: string | null
          event: string
          hub_reference: string
          id: string
          payload: Json
          payment_id: string | null
          payment_kind: string
          received_at: string
          request_id: string
          result: string
        }
        Insert: {
          amount_minor?: number | null
          currency_code?: string | null
          detail?: string | null
          event: string
          hub_reference: string
          id?: string
          payload?: Json
          payment_id?: string | null
          payment_kind?: string
          received_at?: string
          request_id: string
          result: string
        }
        Update: {
          amount_minor?: number | null
          currency_code?: string | null
          detail?: string | null
          event?: string
          hub_reference?: string
          id?: string
          payload?: Json
          payment_id?: string | null
          payment_kind?: string
          received_at?: string
          request_id?: string
          result?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          business: Database["public"]["Enums"]["notification_business"]
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
          business?: Database["public"]["Enums"]["notification_business"]
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
          business?: Database["public"]["Enums"]["notification_business"]
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
          legal_name: string | null
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
          legal_name?: string | null
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
          legal_name?: string | null
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
      reading_progress: {
        Row: {
          chapter_id: string | null
          position: number
          product_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chapter_id?: string | null
          position?: number
          product_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chapter_id?: string | null
          position?: number
          product_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_progress_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "ebook_chapters"
            referencedColumns: ["id"]
          },
        ]
      }
      redemptions: {
        Row: {
          admin_hold_at: string | null
          approved_early: boolean
          coin_amount: number | null
          coin_usd: number | null
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          fee_amount: number
          fee_percent: number
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          net_amount: number | null
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          quoted_at: string | null
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
          usd_ghs: number | null
          user_id: string
        }
        Insert: {
          admin_hold_at?: string | null
          approved_early?: boolean
          coin_amount?: number | null
          coin_usd?: number | null
          created_at?: string
          currency_amount: number
          currency_code?: string
          early_approval_reason?: string | null
          external_reference?: string | null
          failure_reason?: string | null
          fee_amount?: number
          fee_percent?: number
          holding_until: string
          id?: string
          method: Database["public"]["Enums"]["payout_method"]
          net_amount?: number | null
          paid_at?: string | null
          points_amount: number
          points_per_currency_unit: number
          quoted_at?: string | null
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
          usd_ghs?: number | null
          user_id: string
        }
        Update: {
          admin_hold_at?: string | null
          approved_early?: boolean
          coin_amount?: number | null
          coin_usd?: number | null
          created_at?: string
          currency_amount?: number
          currency_code?: string
          early_approval_reason?: string | null
          external_reference?: string | null
          failure_reason?: string | null
          fee_amount?: number
          fee_percent?: number
          holding_until?: string
          id?: string
          method?: Database["public"]["Enums"]["payout_method"]
          net_amount?: number | null
          paid_at?: string | null
          points_amount?: number
          points_per_currency_unit?: number
          quoted_at?: string | null
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
          usd_ghs?: number | null
          user_id?: string
        }
        Relationships: []
      }
      referral_commissions: {
        Row: {
          amount_minor: number
          created_at: string
          currency_code: string
          id: string
          level: number
          payment_id: string
          percent_applied: number
          points: number
          referee_id: string
          referral_id: string
          referrer_id: string
          reversed_at: string | null
          scope_at_payment: string
          source_referral_id: string
          tier_id: string
          tier_multiplier: number
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency_code: string
          id?: string
          level?: number
          payment_id: string
          percent_applied: number
          points: number
          referee_id: string
          referral_id: string
          referrer_id: string
          reversed_at?: string | null
          scope_at_payment: string
          source_referral_id: string
          tier_id: string
          tier_multiplier: number
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency_code?: string
          id?: string
          level?: number
          payment_id?: string
          percent_applied?: number
          points?: number
          referee_id?: string
          referral_id?: string
          referrer_id?: string
          reversed_at?: string | null
          scope_at_payment?: string
          source_referral_id?: string
          tier_id?: string
          tier_multiplier?: number
        }
        Relationships: [
          {
            foreignKeyName: "referral_commissions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "subscription_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_source_referral_id_fkey"
            columns: ["source_referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          activation_bonus_paid_at: string | null
          activation_bonus_points: number
          ads_at_activation: number | null
          code_used: string
          created_at: string
          id: string
          l2_activation_bonus_paid_at: string | null
          l2_activation_bonus_points: number
          l2_referrer_id: string | null
          l2_reversed_at: string | null
          l2_signup_bonus_paid_at: string | null
          l2_signup_bonus_points: number
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
          l2_activation_bonus_paid_at?: string | null
          l2_activation_bonus_points?: number
          l2_referrer_id?: string | null
          l2_reversed_at?: string | null
          l2_signup_bonus_paid_at?: string | null
          l2_signup_bonus_points?: number
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
          l2_activation_bonus_paid_at?: string | null
          l2_activation_bonus_points?: number
          l2_referrer_id?: string | null
          l2_reversed_at?: string | null
          l2_signup_bonus_paid_at?: string | null
          l2_signup_bonus_points?: number
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
          list_minor: number | null
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
          list_minor?: number | null
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
          list_minor?: number | null
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
      support_messages: {
        Row: {
          author: Database["public"]["Enums"]["support_author"]
          author_id: string | null
          body: string
          context: Json | null
          created_at: string
          id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          author: Database["public"]["Enums"]["support_author"]
          author_id?: string | null
          body: string
          context?: Json | null
          created_at?: string
          id?: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          author?: Database["public"]["Enums"]["support_author"]
          author_id?: string | null
          body?: string
          context?: Json | null
          created_at?: string
          id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "support_threads"
            referencedColumns: ["user_id"]
          },
        ]
      }
      support_threads: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          last_message_at: string
          opened_at: string
          status: Database["public"]["Enums"]["support_thread_status"]
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          last_message_at?: string
          opened_at?: string
          status?: Database["public"]["Enums"]["support_thread_status"]
          user_id: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          last_message_at?: string
          opened_at?: string
          status?: Database["public"]["Enums"]["support_thread_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_threads_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
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
      task_completions: {
        Row: {
          claimed_at: string
          id: string
          milestone_total_points: number | null
          previous_total_points: number | null
          progress_at_claim: number
          reward_points: number
          task_id: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          id?: string
          milestone_total_points?: number | null
          previous_total_points?: number | null
          progress_at_claim: number
          reward_points: number
          task_id: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          id?: string
          milestone_total_points?: number | null
          previous_total_points?: number | null
          progress_at_claim?: number
          reward_points?: number
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          code: string
          created_at: string
          cumulative: boolean
          description: string
          icon: string
          id: string
          is_active: boolean
          metric: Database["public"]["Enums"]["task_metric"]
          name: string
          reward_points: number
          sort_order: number
          target: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          cumulative?: boolean
          description: string
          icon?: string
          id?: string
          is_active?: boolean
          metric: Database["public"]["Enums"]["task_metric"]
          name: string
          reward_points: number
          sort_order?: number
          target: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          cumulative?: boolean
          description?: string
          icon?: string
          id?: string
          is_active?: boolean
          metric?: Database["public"]["Enums"]["task_metric"]
          name?: string
          reward_points?: number
          sort_order?: number
          target?: number
          updated_at?: string
        }
        Relationships: []
      }
      tiers: {
        Row: {
          ad_cooldown_seconds: number
          ad_priority: number
          band_max_minor: number | null
          band_max_multiplier: number | null
          billing_period_days: number
          coming_soon: boolean
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
          weekly_game_plays: number
        }
        Insert: {
          ad_cooldown_seconds?: number
          ad_priority?: number
          band_max_minor?: number | null
          band_max_multiplier?: number | null
          billing_period_days?: number
          coming_soon?: boolean
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
          weekly_game_plays?: number
        }
        Update: {
          ad_cooldown_seconds?: number
          ad_priority?: number
          band_max_minor?: number | null
          band_max_multiplier?: number | null
          billing_period_days?: number
          coming_soon?: boolean
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
          weekly_game_plays?: number
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
          times_completed: number
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
          times_completed?: number
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
          times_completed?: number
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
          amount_minor: number | null
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
          amount_minor?: number | null
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
          amount_minor?: number | null
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
      vault_investments: {
        Row: {
          amount_minor: number
          claimed_at: string | null
          claimed_points: number | null
          created_at: string
          currency_code: string
          daily_return_percent: number
          ends_at: string
          expected_profit_minor: number
          expected_return_minor: number
          id: string
          payment_id: string | null
          period_days: number
          plan_id: string
          plan_name: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          claimed_at?: string | null
          claimed_points?: number | null
          created_at?: string
          currency_code?: string
          daily_return_percent: number
          ends_at: string
          expected_profit_minor: number
          expected_return_minor: number
          id?: string
          payment_id?: string | null
          period_days: number
          plan_id: string
          plan_name: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          claimed_at?: string | null
          claimed_points?: number | null
          created_at?: string
          currency_code?: string
          daily_return_percent?: number
          ends_at?: string
          expected_profit_minor?: number
          expected_return_minor?: number
          id?: string
          payment_id?: string | null
          period_days?: number
          plan_id?: string
          plan_name?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_investments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "vault_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_investments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "vault_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_payments: {
        Row: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          currency_code: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          method: string
          plan_id: string
          provider_payload: Json | null
          status: string
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
          method?: string
          plan_id: string
          provider_payload?: Json | null
          status?: string
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
          method?: string
          plan_id?: string
          provider_payload?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "vault_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_plans: {
        Row: {
          created_at: string
          currency_code: string
          daily_return_percent: number
          description: string | null
          id: string
          is_active: boolean
          name: string
          period_days: number
          price_minor: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency_code?: string
          daily_return_percent: number
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          period_days: number
          price_minor: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency_code?: string
          daily_return_percent?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          period_days?: number
          price_minor?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ad_occasion_ref: {
        Args: { p_ad_id: string; p_occasion: number }
        Returns: string
      }
      ad_repeat_ready: { Args: { p_finished_at: string }; Returns: boolean }
      ad_reward_points:
        | {
            Args: {
              p_ad_id: string
              p_base: number
              p_done?: number
              p_user_id: string
            }
            Returns: number
          }
        | {
            Args: { p_base: number; p_done?: number; p_user_id: string }
            Returns: number
          }
      admin_active_view_session: {
        Args: { p_token: string }
        Returns: {
          admin_id: string
          expires_at: string
          target_user_id: string
        }[]
      }
      admin_ad_responses: {
        Args: {
          p_ad_id?: string
          p_admin_id: string
          p_from?: string
          p_to?: string
        }
        Returns: {
          ad_format: string
          ad_id: string
          ad_title: string
          answer: string
          answer_format: string
          answered_at: string
          attempt_number: number
          correct: boolean
          graded: boolean
          occasion: number
          option_id: string
          phone: string
          plan: string
          points_awarded: number
          question_position: number
          question_text: string
          respondent: string
          user_id: string
          watch_seconds: number
        }[]
      }
      admin_announcement_audience: { Args: never; Returns: number }
      admin_area_allowed: {
        Args: { p_area: string; p_user_id: string }
        Returns: boolean
      }
      admin_broadcast_announcement: {
        Args: {
          p_admin: string
          p_audience?: string
          p_body: string
          p_title: string
        }
        Returns: {
          audience: string
          body: string
          business: Database["public"]["Enums"]["notification_business"]
          created_at: string
          id: string
          recipient_count: number
          sent_by: string | null
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "announcements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_count_unread_support: { Args: never; Returns: number }
      admin_create_gift_code: {
        Args: {
          p_admin_id: string
          p_code: string
          p_expires_at?: string
          p_note?: string
          p_points: number
        }
        Returns: {
          code: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          note: string | null
          points: number
          revoked_at: string | null
          revoked_by: string | null
          status: Database["public"]["Enums"]["gift_code_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "gift_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_daily_money: {
        Args: { p_days?: number }
        Returns: {
          day: string
          deposits: number
          withdrawals: number
        }[]
      }
      admin_decide_redemption: {
        Args: {
          p_action: string
          p_admin_id: string
          p_approve_early?: boolean
          p_early_reason?: string
          p_reason?: string
          p_redemption_id: string
          p_reference?: string
        }
        Returns: {
          admin_hold_at: string | null
          approved_early: boolean
          coin_amount: number | null
          coin_usd: number | null
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          fee_amount: number
          fee_percent: number
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          net_amount: number | null
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          quoted_at: string | null
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
          usd_ghs: number | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "redemptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_delete_ad: {
        Args: { p_ad_id: string; p_admin_id: string }
        Returns: string
      }
      admin_delete_advertiser: {
        Args: { p_admin_id: string; p_advertiser_id: string }
        Returns: string
      }
      admin_delete_advertiser_payment: {
        Args: { p_admin_id: string; p_payment_id: string }
        Returns: undefined
      }
      admin_delete_community: {
        Args: { p_admin_id: string; p_id: string }
        Returns: undefined
      }
      admin_delete_coupon: {
        Args: { p_admin_id: string; p_id: string }
        Returns: undefined
      }
      admin_delete_plan: {
        Args: { p_admin_id: string; p_plan_id: string }
        Returns: string
      }
      admin_delete_quiz_question: {
        Args: { p_admin_id: string; p_question_id: string }
        Returns: undefined
      }
      admin_delete_resource: {
        Args: { p_admin_id: string; p_resource_id: string }
        Returns: undefined
      }
      admin_delete_task: {
        Args: { p_admin_id: string; p_task_id: string }
        Returns: string
      }
      admin_end_view_session: { Args: { p_token: string }; Returns: undefined }
      admin_finance_statement: {
        Args: { p_months?: number }
        Returns: {
          advertisers_ghs: number
          month: string
          subscriptions_ghs: number
          vault_ghs: number
          withdrawals_ghs: number
        }[]
      }
      admin_game_stats: {
        Args: {
          p_admin_id: string
          p_days?: number
          p_game: Database["public"]["Enums"]["game_kind"]
        }
        Returns: {
          actual_rtp: number
          expected_rtp: number
          extra_plays_won: number
          players_period: number
          plays_period: number
          plays_total: number
          points_period: number
        }[]
      }
      admin_get_ad: {
        Args: { p_ad_id: string; p_admin_id: string }
        Returns: Json
      }
      admin_get_leaderboard: {
        Args: { p_admin_id: string; p_limit?: number; p_period?: string }
        Returns: {
          avatar_path: string
          display_name: string
          email: string
          flagged: boolean
          full_name: string
          movement: string
          phone: string
          points: number
          previous_rank: number
          rank: number
          user_id: string
        }[]
      }
      admin_get_support_thread: {
        Args: { p_admin: string; p_user: string }
        Returns: Json
      }
      admin_grant_role: {
        Args: { p_admin_id: string; p_role: string; p_target_id: string }
        Returns: undefined
      }
      admin_list_administrators: {
        Args: never
        Returns: {
          accepted: boolean
          email: string
          granted_at: string
          id: string
          is_you: boolean
          last_seen_at: string
          name: string
          role: string
          two_factor: boolean
        }[]
      }
      admin_list_ads: {
        Args: { p_status?: Database["public"]["Enums"]["ad_status"] }
        Returns: {
          advertiser_name: string
          attempts_count: number
          branching_count: number
          completions_count: number
          created_at: string
          cue_count: number
          description: string
          duration_seconds: number
          ends_at: string
          format: Database["public"]["Enums"]["ad_format"]
          graded_count: number
          id: string
          max_completions: number
          min_watch_seconds: number
          points_reward: number
          question_count: number
          starts_at: string
          status: Database["public"]["Enums"]["ad_status"]
          thumbnail_path: string
          tier_slugs: string[]
          title: string
          updated_at: string
          video_source: Database["public"]["Enums"]["video_source"]
          weight: number
        }[]
      }
      admin_list_advertiser_payments: {
        Args: { p_advertiser_id: string }
        Returns: {
          amount_ghs: number
          id: string
          method: string
          note: string
          received_at: string
          recorded_by: string
          reference: string
        }[]
      }
      admin_list_advertisers: {
        Args: never
        Returns: {
          ads_live: number
          ads_total: number
          contact: string
          ends_at: string
          id: string
          last_paid_at: string
          name: string
          notes: string
          paid_ghs: number
          payments: number
          spent_ghs: number
          started_at: string
          status: string
        }[]
      }
      admin_list_affiliate_prizes: {
        Args: {
          p_admin_id: string
          p_game: Database["public"]["Enums"]["affiliate_game_kind"]
        }
        Returns: {
          amount_minor: number
          colour: string
          daily_cap: number
          extra_plays: number
          id: string
          is_active: boolean
          label: string
          paid_minor: number
          slot: number
          times_won: number
          weekly_cap: number
          weight: number
        }[]
      }
      admin_list_announcements: {
        Args: { p_limit?: number }
        Returns: {
          audience: string
          body: string
          created_at: string
          id: string
          recipient_count: number
          sent_by_name: string
          title: string
        }[]
      }
      admin_list_audit: {
        Args: { p_limit?: number }
        Returns: {
          action: string
          actor: string
          after: string
          at: string
          before: string
          id: string
          note: string
          target: string
        }[]
      }
      admin_list_coupon_redemptions: {
        Args: { p_admin_id: string; p_coupon_id: string }
        Returns: {
          charged_minor: number
          created_at: string
          discount_minor: number
          email: string
          id: string
          list_minor: number
          person: string
          status: string
          user_id: string
        }[]
      }
      admin_list_coupons: {
        Args: { p_admin_id: string }
        Returns: {
          amount_minor: number
          business: Database["public"]["Enums"]["coupon_business"]
          code: string
          created_at: string
          discount_given_minor: number
          discount_kind: Database["public"]["Enums"]["coupon_discount_kind"]
          ends_at: string
          first_purchase_only: boolean
          id: string
          is_active: boolean
          max_discount_minor: number
          min_spend_minor: number
          note: string
          per_user_limit: number
          percent: number
          product_id: string
          quota: number
          revenue_minor: number
          starts_at: string
          target_name: string
          tier_id: string
          used: number
        }[]
      }
      admin_list_game_prizes: {
        Args: {
          p_admin_id: string
          p_game: Database["public"]["Enums"]["game_kind"]
        }
        Returns: {
          chance_percent: number
          colour: string
          daily_cap: number
          extra_plays: number
          id: string
          is_active: boolean
          label: string
          points: number
          slot: number
          weekly_cap: number
          weight: number
          won_this_week: number
          won_today: number
        }[]
      }
      admin_list_gift_codes: {
        Args: { p_status?: Database["public"]["Enums"]["gift_code_status"] }
        Returns: {
          code: string
          created_at: string
          created_by_name: string
          expires_at: string
          id: string
          note: string
          points: number
          redeemed_at: string
          redeemed_by_email: string
          redeemed_by_name: string
          status: Database["public"]["Enums"]["gift_code_status"]
        }[]
      }
      admin_list_hub_flags: {
        Args: { p_limit?: number }
        Returns: {
          amount_minor: number
          currency_code: string
          detail: string
          event: string
          hub_reference: string
          id: string
          payment_id: string
          payment_kind: string
          person: string
          received_at: string
          request_id: string
          result: string
        }[]
      }
      admin_list_hub_payments: {
        Args: { p_limit?: number }
        Returns: {
          amount_minor: number
          confirmed_at: string
          created_at: string
          currency_code: string
          email: string
          event_count: number
          failure_reason: string
          hub_reference: string
          id: string
          last_detail: string
          last_event: string
          last_event_at: string
          last_result: string
          item_name: string
          payment_kind: string
          person: string
          status: string
          user_id: string
        }[]
      }
      admin_list_people: {
        Args: { p_scope?: string }
        Returns: {
          ads_watched: number
          avatar_path: string
          balance_points: number
          email: string
          flag_reason: string
          flagged_by: string
          id: string
          joined_at: string
          last_active_at: string
          last_message: string
          last_message_at: string
          lifetime_points: number
          name: string
          paid_out_ghs: number
          phone: string
          referrals: number
          status: string
          tier: string
          tier_multiplier: number
          tier_paid_ghs: number
          unread: number
        }[]
      }
      admin_list_plans: {
        Args: never
        Returns: {
          active: number
          active_last_month: number
          ad_cooldown_seconds: number
          ad_priority: number
          band_max_ghs: number
          billing_period_days: number
          daily_ad_cap: number
          description: string
          id: string
          coming_soon: boolean
          is_active: boolean
          is_default: boolean
          monthly_ghs: number
          name: string
          own_band_max_ghs: number
          own_band_max_multiplier: number
          paid_above_floor: number
          paid_avg_ghs: number
          paid_count: number
          price_ghs: number
          redemption_minimum_points: number
          referral_bonus_multiplier: number
          reward_multiplier: number
          slug: string
          sort_order: number
        }[]
      }
      admin_list_redemptions: {
        Args: { p_status?: Database["public"]["Enums"]["redemption_status"] }
        Returns: {
          account_name: string
          admin_hold_at: string
          approved_early: boolean
          coin_amount: number
          coin_code: string
          decision_note: string
          destination: string
          fee_ghs: number
          fee_percent: number
          ghs: number
          holding_until: string
          id: string
          live_coin_amount: number
          method: Database["public"]["Enums"]["payout_method"]
          net_ghs: number
          paid_before: number
          paid_before_ghs: number
          points: number
          provider: string
          quoted_at: string
          reference: string
          requested_at: string
          reuse: number
          risk: Database["public"]["Enums"]["risk_level"]
          risk_reasons: string[]
          status: Database["public"]["Enums"]["redemption_status"]
          status_changed_at: string
          user_avatar_path: string
          user_email: string
          user_id: string
          user_joined_at: string
          user_name: string
        }[]
      }
      admin_team_milestones: {
        Args: { p_admin_id: string; p_user_id: string }
        Returns: Json
      }
      admin_list_tasks: {
        Args: { p_admin_id: string }
        Returns: {
          claimed_count: number
          code: string
          cumulative: boolean
          description: string
          eligible_now: number
          icon: string
          id: string
          is_active: boolean
          metric: Database["public"]["Enums"]["task_metric"]
          name: string
          points_paid: number
          reward_points: number
          sort_order: number
          target: number
        }[]
      }
      admin_list_onboarding_steps: {
        Args: { p_admin_id: string }
        Returns: {
          is_derived: boolean
          is_enabled: boolean
          key: string
          sort_order: number
        }[]
      }
      admin_list_tier_game_plays: {
        Args: { p_admin_id: string }
        Returns: {
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          price_minor: number
          slug: string
          weekly_game_plays: number
        }[]
      }
      admin_mark_support_read: {
        Args: { p_admin: string; p_user: string }
        Returns: number
      }
      admin_overview_metrics: { Args: never; Returns: Json }
      admin_record_advertiser_payment: {
        Args: {
          p_admin_id: string
          p_advertiser_id: string
          p_amount_minor: number
          p_method?: string
          p_note?: string
          p_received_at?: string
          p_reference?: string
        }
        Returns: {
          advertiser_id: string
          amount_minor: number
          created_at: string
          currency_code: string
          id: string
          method: string | null
          note: string | null
          received_at: string
          recorded_by: string | null
          reference: string | null
        }
        SetofOptions: {
          from: "*"
          to: "advertiser_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_revoke_gift_code: {
        Args: { p_admin_id: string; p_code_id: string }
        Returns: {
          code: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          note: string | null
          points: number
          revoked_at: string | null
          revoked_by: string | null
          status: Database["public"]["Enums"]["gift_code_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "gift_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_revoke_role: {
        Args: { p_admin_id: string; p_target_id: string }
        Returns: undefined
      }
      admin_role: {
        Args: { p_user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      admin_save_ad: {
        Args: {
          p_ad: Json
          p_admin_id: string
          p_questions?: Json
          p_tier_ids?: string[]
        }
        Returns: string
      }
      admin_save_advertiser: {
        Args: { p_admin_id: string; p_advertiser: Json }
        Returns: {
          contact: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          name: string
          notes: string | null
          started_at: string
          status: Database["public"]["Enums"]["advertiser_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "advertisers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_affiliate_prizes: {
        Args: {
          p_admin_id: string
          p_game: Database["public"]["Enums"]["affiliate_game_kind"]
          p_prizes: Json
        }
        Returns: number
      }
      admin_save_community: {
        Args: {
          p_admin_id: string
          p_business: Database["public"]["Enums"]["notification_business"]
          p_id: string
          p_is_active: boolean
          p_name: string
          p_platform: Database["public"]["Enums"]["community_platform"]
          p_sort_order: number
          p_url: string
        }
        Returns: {
          business: Database["public"]["Enums"]["notification_business"]
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          platform: Database["public"]["Enums"]["community_platform"]
          sort_order: number
          updated_at: string
          url: string
        }
        SetofOptions: {
          from: "*"
          to: "communities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_coupon: {
        Args: {
          p_admin_id: string
          p_amount_minor: number
          p_business: Database["public"]["Enums"]["coupon_business"]
          p_code: string
          p_discount_kind: Database["public"]["Enums"]["coupon_discount_kind"]
          p_ends_at: string
          p_first_purchase_only: boolean
          p_id: string
          p_is_active: boolean
          p_max_discount_minor: number
          p_min_spend_minor: number
          p_note: string
          p_per_user_limit: number
          p_percent: number
          p_product_id: string
          p_quota: number
          p_starts_at: string
          p_tier_id: string
        }
        Returns: {
          amount_minor: number | null
          business: Database["public"]["Enums"]["coupon_business"]
          code: string
          created_at: string
          created_by: string | null
          discount_kind: Database["public"]["Enums"]["coupon_discount_kind"]
          ends_at: string | null
          first_purchase_only: boolean
          id: string
          is_active: boolean
          max_discount_minor: number | null
          min_spend_minor: number
          note: string | null
          per_user_limit: number
          percent: number | null
          product_id: string | null
          quota: number
          starts_at: string | null
          tier_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "coupons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_game_prizes: {
        Args: {
          p_admin_id: string
          p_game: Database["public"]["Enums"]["game_kind"]
          p_prizes: Json
        }
        Returns: number
      }
      admin_save_onboarding_steps: {
        Args: { p_admin_id: string; p_steps: Json }
        Returns: number
      }
      admin_save_plan: {
        Args: { p_admin_id: string; p_plan: Json }
        Returns: {
          ad_cooldown_seconds: number
          ad_priority: number
          band_max_minor: number | null
          band_max_multiplier: number | null
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
          weekly_game_plays: number
        }
        SetofOptions: {
          from: "*"
          to: "tiers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_quiz_question: {
        Args: { p_admin_id: string; p_question: Json }
        Returns: string
      }
      admin_save_task: {
        Args: { p_admin_id: string; p_task: Json }
        Returns: string
      }
      admin_save_weekly_bonus_campaign: {
        Args: { p_admin_id: string; p_campaign: Json }
        Returns: string
      }
      admin_send_support_message: {
        Args: { p_admin: string; p_body: string; p_user: string }
        Returns: {
          author: Database["public"]["Enums"]["support_author"]
          author_id: string | null
          body: string
          context: Json | null
          created_at: string
          id: string
          read_at: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_ad_status: {
        Args: {
          p_ad_id: string
          p_admin_id: string
          p_status: Database["public"]["Enums"]["ad_status"]
        }
        Returns: Database["public"]["Enums"]["ad_status"]
      }
      admin_set_config: {
        Args: { p_admin_id: string; p_values: Json }
        Returns: {
          config_key: string
          new_value: string
          previous_value: string
        }[]
      }
      admin_set_plan_coming_soon: {
        Args: { p_admin_id: string; p_coming_soon: boolean; p_plan_id: string }
        Returns: Database["public"]["Tables"]["tiers"]["Row"]
      }
      admin_set_plan_visibility: {
        Args: { p_active: boolean; p_admin_id: string; p_plan_id: string }
        Returns: {
          ad_cooldown_seconds: number
          ad_priority: number
          band_max_minor: number | null
          band_max_multiplier: number | null
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
          weekly_game_plays: number
        }
        SetofOptions: {
          from: "*"
          to: "tiers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_support_status: {
        Args: { p_admin: string; p_closed: boolean; p_user: string }
        Returns: {
          closed_at: string | null
          closed_by: string | null
          last_message_at: string
          opened_at: string
          status: Database["public"]["Enums"]["support_thread_status"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_threads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_tier_game_plays: {
        Args: { p_admin_id: string; p_plays: number; p_tier_id: string }
        Returns: number
      }
      admin_start_view_session: {
        Args: { p_admin_id: string; p_target_user_id: string }
        Returns: {
          expires_at: string
          token: string
        }[]
      }
      admin_user_id_by_email: {
        Args: { p_admin_id: string; p_email: string }
        Returns: string
      }
      affiliate_game_board: {
        Args: { p_game: Database["public"]["Enums"]["affiliate_game_kind"] }
        Returns: {
          amount_minor: number
          colour: string
          extra_plays: number
          label: string
          slot: number
        }[]
      }
      affiliate_game_status: { Args: { p_user_id: string }; Returns: Json }
      affiliate_leaderboard_standing: {
        Args: { p_period?: string; p_user_id: string }
        Returns: Json
      }
      affiliate_week_start: { Args: never; Returns: string }
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
          l2_activation_bonus_paid_at: string | null
          l2_activation_bonus_points: number
          l2_referrer_id: string | null
          l2_reversed_at: string | null
          l2_signup_bonus_paid_at: string | null
          l2_signup_bonus_points: number
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
          admin_hold_at: string | null
          approved_early: boolean
          coin_amount: number | null
          coin_usd: number | null
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          fee_amount: number
          fee_percent: number
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          net_amount: number | null
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          quoted_at: string | null
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
          usd_ghs: number | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "redemptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_admin: { Args: { p_admin_id: string }; Returns: undefined }
      assert_admin_area: {
        Args: { p_admin_id: string; p_area: string }
        Returns: undefined
      }
      assert_not_anonymous: { Args: never; Returns: undefined }
      attach_hub_reference: {
        Args: { p_payment_id: string; p_reference: string }
        Returns: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          currency_code: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          list_minor: number | null
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
      base_ad_points: { Args: never; Returns: number }
      broadcast_notification: {
        Args: {
          p_body: string
          p_business?: Database["public"]["Enums"]["notification_business"]
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
          admin_hold_at: string | null
          approved_early: boolean
          coin_amount: number | null
          coin_usd: number | null
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          fee_amount: number
          fee_percent: number
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          net_amount: number | null
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          quoted_at: string | null
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
          usd_ghs: number | null
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
          amount_minor: number | null
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
      claim_task: {
        Args: { p_task_id: string; p_user_id: string }
        Returns: Json
      }
      claim_vault_investment: {
        Args: { p_investment_id: string }
        Returns: {
          amount_minor: number
          claimed_at: string | null
          claimed_points: number | null
          created_at: string
          currency_code: string
          daily_return_percent: number
          ends_at: string
          expected_profit_minor: number
          expected_return_minor: number
          id: string
          payment_id: string | null
          period_days: number
          plan_id: string
          plan_name: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vault_investments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claw_back_referral_points: {
        Args: {
          p_amount: number
          p_meta: Json
          p_referral_id: string
          p_user: string
        }
        Returns: number
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
          legal_name: string | null
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
      config_allowed_values: { Args: { p_key: string }; Returns: string[] }
      config_bool: { Args: { p_key: string }; Returns: boolean }
      config_decimal: { Args: { p_key: string }; Returns: number }
      config_int: { Args: { p_key: string }; Returns: number }
      config_text: { Args: { p_key: string }; Returns: string }
      confirm_subscription_payment: {
        Args: { p_payload?: Json; p_payment_id: string; p_reference: string }
        Returns: {
          amount_minor: number | null
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
      attach_vault_hub_reference: {
        Args: { p_payment_id: string; p_reference: string }
        Returns: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          currency_code: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          method: string
          plan_id: string
          provider_payload: Json | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vault_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_vault_payment: {
        Args: { p_payment_id: string; p_reason?: string }
        Returns: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          currency_code: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          method: string
          plan_id: string
          provider_payload: Json | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vault_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reverse_vault_payment: {
        Args: { p_payment_id: string; p_reason?: string }
        Returns: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          currency_code: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          method: string
          plan_id: string
          provider_payload: Json | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vault_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_vault_payment: {
        Args: { p_payload?: Json; p_payment_id: string; p_reference: string }
        Returns: {
          amount_minor: number
          claimed_at: string | null
          claimed_points: number | null
          created_at: string
          currency_code: string
          daily_return_percent: number
          ends_at: string
          expected_profit_minor: number
          expected_return_minor: number
          id: string
          payment_id: string | null
          period_days: number
          plan_id: string
          plan_name: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vault_investments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_backup_code: {
        Args: { p_code: string; p_user_id: string }
        Returns: Json
      }
      coupon_quote: {
        Args: {
          p_amount_minor: number
          p_code: string
          p_kind?: Database["public"]["Enums"]["order_kind"]
          p_product_id: string
          p_tier_id: string
          p_user_id: string
        }
        Returns: {
          charged_minor: number
          coupon_id: string
          discount_minor: number
          list_minor: number
          ok: boolean
          reason: string
        }[]
      }
      coupon_uses: {
        Args: { p_coupon_id: string; p_user_id?: string }
        Returns: number
      }
      create_notification: {
        Args: {
          p_body: string
          p_business?: Database["public"]["Enums"]["notification_business"]
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
      disable_user_account: {
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
          legal_name: string | null
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
      due_account_deletions: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      eligible_ad_ids: {
        Args: { p_user_id: string }
        Returns: {
          ad_id: string
        }[]
      }
      email_is_registered: { Args: { p_email: string }; Returns: boolean }
      enable_user_account: {
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
          legal_name: string | null
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
      expire_affiliate_entitlements: { Args: never; Returns: number }
      expire_subscriptions: {
        Args: never
        Returns: {
          to_expired: number
          to_grace: number
        }[]
      }
      fail_subscription_payment: {
        Args: { p_payment_id: string; p_reason?: string }
        Returns: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          currency_code: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          list_minor: number | null
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
          legal_name: string | null
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
      fx_rate: { Args: { p_pair: string }; Returns: number }
      game_eligible_prizes: {
        Args: {
          p_game: Database["public"]["Enums"]["game_kind"]
          p_week: string
        }
        Returns: {
          colour: string
          created_at: string
          daily_cap: number
          extra_plays: number
          game: Database["public"]["Enums"]["game_kind"]
          id: string
          is_active: boolean
          label: string
          points: number
          slot: number
          updated_at: string
          weekly_cap: number
          weight: number
        }[]
        SetofOptions: {
          from: "*"
          to: "game_prizes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      game_status_for: {
        Args: { p_user_id: string }
        Returns: {
          allowance: number
          enabled: boolean
          remaining: number
          used: number
          week_ends_at: string
          week_start: string
        }[]
      }
      game_week_start: { Args: never; Returns: string }
      generate_certificate_code: { Args: never; Returns: string }
      generate_gift_code: { Args: never; Returns: string }
      generate_referral_code: { Args: never; Returns: string }
      get_active_referral_count: {
        Args: { p_user_id: string }
        Returns: number
      }
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
          advertiser_logo_path: string
          advertiser_name: string
          article_body: string
          attempts_remaining: number
          attempts_used: number
          cta_label: string
          cta_links: Json
          description: string
          duration_seconds: number
          format: Database["public"]["Enums"]["ad_format"]
          graded_count: number
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
          condition_mode: Database["public"]["Enums"]["question_condition_mode"]
          options: Json
          question_id: string
          question_index: number
          question_text: string
          rules: Json
          show_at_seconds: number
        }[]
      }
      get_deletion_status: { Args: never; Returns: Json }
      get_earnings_breakdown: {
        Args: { p_user_id: string }
        Returns: {
          adjustment_points: number
          articles_points: number
          balance_points: number
          earned_points: number
          fees_currency: number
          first_earned_at: string
          game_points: number
          gift_code_points: number
          paid_out_currency: number
          plans_count: number
          plans_spent_minor: number
          points_per_currency_unit: number
          referral_activation_points: number
          referral_purchase_points: number
          referral_signup_points: number
          surveys_points: number
          task_points: number
          videos_points: number
          withdrawn_paid_points: number
          withdrawn_pending_points: number
          withdrawn_refunded_points: number
        }[]
      }
      get_eligible_ads: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          advertiser_id: string | null
          advertiser_name: string | null
          article_body: string | null
          completions_count: number
          created_at: string
          created_by: string | null
          cta_label: string | null
          cta_links: Json
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
      get_game_board: {
        Args: { p_game: Database["public"]["Enums"]["game_kind"] }
        Returns: {
          colour: string
          extra_plays: number
          label: string
          points: number
          slot: number
        }[]
      }
      get_game_status: {
        Args: never
        Returns: {
          allowance: number
          enabled: boolean
          remaining: number
          used: number
          week_ends_at: string
          week_start: string
        }[]
      }
      get_onboarding_state: { Args: { p_user_id: string }; Returns: Json }
      get_leaderboard: {
        Args: { p_limit?: number; p_period?: string }
        Returns: {
          avatar_path: string
          display_name: string
          movement: string
          points: number
          previous_rank: number
          rank: number
          user_id: string
        }[]
      }
      get_leaderboard_standing: {
        Args: { p_period?: string }
        Returns: {
          movement: string
          points: number
          previous_rank: number
          rank: number
          total_ranked: number
        }[]
      }
      get_referral_summary: {
        Args: { p_user_id: string }
        Returns: {
          activated_count: number
          ads_required: number
          commission_points: number
          level_two_count: number
          level_two_points: number
          pending_count: number
          points_earned: number
          purchases_count: number
          referral_code: string
          total_referred: number
        }[]
      }
      get_tasks: {
        Args: never
        Returns: {
          claimable: boolean
          claimed_at: string
          code: string
          description: string
          icon: string
          id: string
          metric: Database["public"]["Enums"]["task_metric"]
          name: string
          progress: number
          reward_points: number
          target: number
        }[]
      }
      get_team_members: {
        Args: { p_user_id: string }
        Returns: {
          avatar_path: string
          extra_plans: number
          full_name: string
          joined_at: string
          member_id: string
          member_level: number
          phone: string
          plans_bought: number
          plans_value: number
          redeemed: number
          remaining: number
          top_plan: string
        }[]
      }
      get_team_summary: {
        Args: { p_user_id: string }
        Returns: {
          member_level: number
          people: number
          plans_bought: number
          plans_value: number
          redeemed: number
          remaining: number
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
          free_earning_ends_at: string
          free_earning_over: boolean
          points_cap_reached: boolean
          points_earned_today: number
          reward_multiplier: number
          tier_name: string
          tier_slug: string
        }[]
      }
      has_entitlement: {
        Args: { p_product_id: string; p_user_id: string }
        Returns: boolean
      }
      has_withdrawal_pin: { Args: { p_user_id: string }; Returns: boolean }
      hold_redemption: {
        Args: { p_admin_id: string; p_reason: string; p_redemption_id: string }
        Returns: {
          admin_hold_at: string | null
          approved_early: boolean
          coin_amount: number | null
          coin_usd: number | null
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          fee_amount: number
          fee_percent: number
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          net_amount: number | null
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          quoted_at: string | null
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
          usd_ghs: number | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "redemptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      identity_hash: { Args: { p_value: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_identity_blocked: {
        Args: { p_email: string; p_phone: string }
        Returns: boolean
      }
      is_super_admin: { Args: { p_user_id?: string }; Returns: boolean }
      leaderboard_counted_types: {
        Args: never
        Returns: Database["public"]["Enums"]["ledger_entry_type"][]
      }
      leaderboard_display_name: {
        Args: { p_full_name: string }
        Returns: string
      }
      leaderboard_period_bounds: {
        Args: { p_period: string }
        Returns: Record<string, unknown>
      }
      maintenance_closed_for: { Args: { p_user_id: string }; Returns: boolean }
      mark_onboarding_step: { Args: { p_step: string }; Returns: Json }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_notification_read: { Args: { p_id: string }; Returns: undefined }
      mark_redemption_failed: {
        Args: { p_admin_id: string; p_reason: string; p_redemption_id: string }
        Returns: {
          admin_hold_at: string | null
          approved_early: boolean
          coin_amount: number | null
          coin_usd: number | null
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          fee_amount: number
          fee_percent: number
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          net_amount: number | null
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          quoted_at: string | null
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
          usd_ghs: number | null
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
          admin_hold_at: string | null
          approved_early: boolean
          coin_amount: number | null
          coin_usd: number | null
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          fee_amount: number
          fee_percent: number
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          net_amount: number | null
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          quoted_at: string | null
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
          usd_ghs: number | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "redemptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_support_read: { Args: never; Returns: number }
      mask_payout_value: { Args: { p_value: string }; Returns: string }
      may_repeat_ads: { Args: { p_user_id: string }; Returns: boolean }
      normalise_phone: { Args: { p_phone: string }; Returns: string }
      notify_admins: {
        Args: {
          p_body: string
          p_data?: Json
          p_title: string
          p_type: Database["public"]["Enums"]["notification_type"]
        }
        Returns: number
      }
      pay_one_referral_commission: {
        Args: {
          p_beneficiary: string
          p_gross: number
          p_headroom: number
          p_level: number
          p_payment_id: string
          p_percent: number
          p_referral_id: string
          p_scope: string
          p_source_referral_id: string
        }
        Returns: {
          amount_minor: number
          created_at: string
          currency_code: string
          id: string
          level: number
          payment_id: string
          percent_applied: number
          points: number
          referee_id: string
          referral_id: string
          referrer_id: string
          reversed_at: string | null
          scope_at_payment: string
          source_referral_id: string
          tier_id: string
          tier_multiplier: number
        }
        SetofOptions: {
          from: "*"
          to: "referral_commissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_referral_purchase_commission: {
        Args: { p_payment_id: string }
        Returns: {
          amount_minor: number
          created_at: string
          currency_code: string
          id: string
          level: number
          payment_id: string
          percent_applied: number
          points: number
          referee_id: string
          referral_id: string
          referrer_id: string
          reversed_at: string | null
          scope_at_payment: string
          source_referral_id: string
          tier_id: string
          tier_multiplier: number
        }
        SetofOptions: {
          from: "*"
          to: "referral_commissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pct_change: { Args: { p_now: number; p_prev: number }; Returns: number }
      plan_band_for_amount: {
        Args: { p_minor: number }
        Returns: {
          ad_cooldown_seconds: number
          ad_priority: number
          band_max_minor: number | null
          band_max_multiplier: number | null
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
          weekly_game_plays: number
        }
        SetofOptions: {
          from: "*"
          to: "tiers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plan_band_max_minor: { Args: { p_tier_id: string }; Returns: number }
      plan_multiplier_for_amount: { Args: { p_minor: number }; Returns: number }
      play_game: {
        Args: {
          p_game: Database["public"]["Enums"]["game_kind"]
          p_user_id: string
        }
        Returns: Json
      }
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
      purchase_vault_with_balance: {
        Args: { p_plan_id: string; p_user_id?: string }
        Returns: {
          amount_minor: number
          claimed_at: string | null
          claimed_points: number | null
          created_at: string
          currency_code: string
          daily_return_percent: number
          ends_at: string
          expected_profit_minor: number
          expected_return_minor: number
          id: string
          payment_id: string | null
          period_days: number
          plan_id: string
          plan_name: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vault_investments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      quote_crypto_payout: {
        Args: { p_coin: string; p_ghs: number }
        Returns: Json
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
      record_ad_link_click: {
        Args: { p_ad_id: string; p_user_id: string }
        Returns: Database["public"]["CompositeTypes"]["ad_answer_result"]
        SetofOptions: {
          from: "*"
          to: "ad_answer_result"
          isOneToOne: true
          isSetofReturn: false
        }
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
      redeem_gift_code: {
        Args: { p_code: string; p_user_id: string }
        Returns: Json
      }
      register_ad_view: {
        Args: { p_ad_id: string; p_user_id: string }
        Returns: string
      }
      register_totp_failure: { Args: { p_user_id: string }; Returns: Json }
      reject_redemption: {
        Args: { p_admin_id: string; p_reason: string; p_redemption_id: string }
        Returns: {
          admin_hold_at: string | null
          approved_early: boolean
          coin_amount: number | null
          coin_usd: number | null
          created_at: string
          currency_amount: number
          currency_code: string
          early_approval_reason: string | null
          external_reference: string | null
          failure_reason: string | null
          fee_amount: number
          fee_percent: number
          holding_until: string
          id: string
          method: Database["public"]["Enums"]["payout_method"]
          net_amount: number | null
          paid_at: string | null
          points_amount: number
          points_per_currency_unit: number
          quoted_at: string | null
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
          usd_ghs: number | null
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
          l2_activation_bonus_paid_at: string | null
          l2_activation_bonus_points: number
          l2_referrer_id: string | null
          l2_reversed_at: string | null
          l2_signup_bonus_paid_at: string | null
          l2_signup_bonus_points: number
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
      replay_onboarding: { Args: never; Returns: Json }
      resolve_user_tier: {
        Args: { p_user_id: string }
        Returns: {
          ad_cooldown_seconds: number
          ad_priority: number
          band_max_minor: number | null
          band_max_multiplier: number | null
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
          weekly_game_plays: number
        }
        SetofOptions: {
          from: "*"
          to: "tiers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reverse_subscription_payment: {
        Args: { p_payment_id: string; p_reason?: string }
        Returns: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          currency_code: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          list_minor: number | null
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
      revoke_other_sessions: { Args: never; Returns: number }
      revoke_session: { Args: { p_session_id: string }; Returns: boolean }
      ring_payment_reconciliation: { Args: never; Returns: number }
      run_affiliate_maintenance: {
        Args: never
        Returns: {
          cleared: number
          errors: string[]
          expired: number
          warned: number
        }[]
      }
      second_level_referral: {
        Args: { p_referee_id: string }
        Returns: {
          activation_bonus_paid_at: string | null
          activation_bonus_points: number
          ads_at_activation: number | null
          code_used: string
          created_at: string
          id: string
          l2_activation_bonus_paid_at: string | null
          l2_activation_bonus_points: number
          l2_referrer_id: string | null
          l2_reversed_at: string | null
          l2_signup_bonus_paid_at: string | null
          l2_signup_bonus_points: number
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
      send_support_message: {
        Args: { p_body: string; p_context?: Json }
        Returns: {
          author: Database["public"]["Enums"]["support_author"]
          author_id: string | null
          body: string
          context: Json | null
          created_at: string
          id: string
          read_at: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_fx_rate: {
        Args: { p_pair: string; p_rate: number; p_source: string }
        Returns: {
          fetched_at: string
          pair: string
          rate: number
          source: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fx_rates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
      skip_onboarding: { Args: never; Returns: Json }
      start_onboarding: { Args: never; Returns: Json }
      start_subscription_payment: {
        Args: {
          p_amount_minor?: number
          p_coupon_code?: string
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
          list_minor: number | null
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
      start_vault_payment: {
        Args: { p_plan_id: string; p_user_id: string }
        Returns: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          currency_code: string
          external_reference: string | null
          failure_reason: string | null
          id: string
          method: string
          plan_id: string
          provider_payload: Json | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "vault_payments"
          isOneToOne: true
          isSetofReturn: false
        }
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
      take_coupon: {
        Args: {
          p_amount_minor: number
          p_code: string
          p_kind?: Database["public"]["Enums"]["order_kind"]
          p_product_id: string
          p_tier_id: string
          p_user_id: string
        }
        Returns: {
          charged_minor: number
          coupon_id: string
          discount_minor: number
        }[]
      }
      team_milestones: { Args: { p_user_id: string }; Returns: Json }
      team_member_ids: {
        Args: { p_user_id: string }
        Returns: {
          member_id: string
          member_level: number
        }[]
      }
      totp_lock_state: { Args: { p_user_id: string }; Returns: Json }
      training_level_rank: { Args: { p_level: string }; Returns: number }
      user_ad_allowances: {
        Args: { p_user_id: string }
        Returns: {
          ads: number
          multiplier: number
          name: string
          slot: number
          slug: string
          tier_id: string
        }[]
      }
      user_has_fresh_ads: { Args: { p_user_id: string }; Returns: boolean }
      user_target_tiers: {
        Args: { p_user_id: string }
        Returns: {
          sort_order: number
          tier_id: string
        }[]
      }
      user_task_metric: {
        Args: {
          p_metric: Database["public"]["Enums"]["task_metric"]
          p_user_id: string
        }
        Returns: number
      }
      user_weekly_play_allowance: {
        Args: { p_user_id: string }
        Returns: number
      }
      utc_today: { Args: never; Returns: string }
      verify_withdrawal_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: Json
      }
      visible_ad_questions: {
        Args: { p_ad_id: string; p_answers: Json }
        Returns: {
          question_id: string
          question_position: number
        }[]
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
        | "cooldown_active"
        | "points_cap_reached"
      ad_format: "video" | "survey" | "link"
      ad_status: "draft" | "active" | "paused" | "exhausted" | "archived"
      advertiser_status: "pending" | "active" | "ended"
      affiliate_entitlement_status: "active" | "expired" | "revoked"
      affiliate_game_kind: "mystery_box" | "spin_wheel"
      affiliate_status: "pending" | "active" | "suspended"
      affiliate_task_metric:
        | "sales"
        | "referrals"
        | "games_played"
        | "leaderboard_rank"
      affiliate_tier: "beginner" | "professional"
      alert_severity: "info" | "warning" | "critical"
      answer_format: "multiple_choice" | "short_text"
      app_role: "user" | "admin" | "super_admin" | "support" | "ads_manager"
      auth_event_type:
        | "signup"
        | "login"
        | "redemption_request"
        | "payout_details_change"
      commission_entry_type: "credit" | "reversal" | "payout" | "adjustment"
      commission_status:
        | "pending"
        | "cleared"
        | "requested"
        | "paid"
        | "reversed"
      community_platform:
        | "whatsapp"
        | "telegram"
        | "x"
        | "instagram"
        | "facebook"
        | "tiktok"
        | "other"
      config_value_type: "int" | "decimal" | "bool" | "text"
      conversion_status: "attributed" | "reversed"
      coupon_business: "ads" | "affiliate"
      coupon_discount_kind: "percent" | "fixed"
      entitlement_status: "active" | "expired" | "revoked"
      fraud_action: "flag" | "block"
      fraud_review_status: "none" | "pending" | "cleared" | "confirmed_fraud"
      game_kind: "mystery_box" | "spin_wheel"
      gift_code_status: "active" | "redeemed" | "revoked"
      ledger_entry_type:
        | "ad_view"
        | "survey"
        | "referral_signup"
        | "referral_activation"
        | "redemption_request"
        | "redemption_refund"
        | "admin_adjustment"
        | "referral_purchase"
        | "gift_code"
        | "game_prize"
        | "task_reward"
        | "vault_payout"
        | "vault_deposit"
        | "weekly_bonus"
      notification_business: "ads" | "affiliate" | "both"
      notification_type:
        | "announcement"
        | "payout"
        | "flag"
        | "support"
        | "vault"
      order_kind: "purchase" | "training_renewal" | "training_upgrade"
      order_payment_method: "paystack" | "crypto"
      order_status: "pending" | "confirmed" | "refunded" | "failed"
      payout_method: "crypto" | "mobile_money"
      product_kind: "course" | "ebook" | "bundle"
      question_condition_mode: "all" | "any"
      redemption_status:
        | "held"
        | "pending_approval"
        | "approved"
        | "paid"
        | "rejected"
        | "cancelled"
        | "failed"
        | "disputed"
      referral_status: "pending" | "activated" | "rejected"
      risk_level: "low" | "medium" | "high" | "critical"
      subscription_payment_method: "korapay" | "crypto" | "paystack"
      subscription_payment_status:
        | "pending"
        | "confirmed"
        | "failed"
        | "refunded"
      subscription_status: "active" | "grace" | "expired" | "cancelled"
      support_author: "user" | "admin"
      support_thread_status: "open" | "closed"
      task_metric:
        | "account_created"
        | "plans_purchased"
        | "ads_watched"
        | "surveys_completed"
        | "points_earned"
        | "referrals_activated"
        | "games_played"
        | "gift_codes_redeemed"
        | "withdrawals_made"
        | "has_2fa"
        | "has_avatar"
        | "has_withdrawal_pin"
        | "referrals_purchased"
        | "vault_deposits_made"
        | "team_members"
      user_ad_status: "in_progress" | "completed" | "failed_locked"
      vendor_status: "active" | "archived"
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
        "cooldown_active",
        "points_cap_reached",
      ],
      ad_format: ["video", "survey", "link"],
      ad_status: ["draft", "active", "paused", "exhausted", "archived"],
      advertiser_status: ["pending", "active", "ended"],
      affiliate_entitlement_status: ["active", "expired", "revoked"],
      affiliate_game_kind: ["mystery_box", "spin_wheel"],
      affiliate_status: ["pending", "active", "suspended"],
      affiliate_task_metric: [
        "sales",
        "referrals",
        "games_played",
        "leaderboard_rank",
      ],
      affiliate_tier: ["beginner", "professional"],
      alert_severity: ["info", "warning", "critical"],
      answer_format: ["multiple_choice", "short_text"],
      app_role: ["user", "admin", "super_admin", "support", "ads_manager"],
      auth_event_type: [
        "signup",
        "login",
        "redemption_request",
        "payout_details_change",
      ],
      commission_entry_type: ["credit", "reversal", "payout", "adjustment"],
      commission_status: [
        "pending",
        "cleared",
        "requested",
        "paid",
        "reversed",
      ],
      community_platform: [
        "whatsapp",
        "telegram",
        "x",
        "instagram",
        "facebook",
        "tiktok",
        "other",
      ],
      config_value_type: ["int", "decimal", "bool", "text"],
      conversion_status: ["attributed", "reversed"],
      coupon_business: ["ads", "affiliate"],
      coupon_discount_kind: ["percent", "fixed"],
      entitlement_status: ["active", "expired", "revoked"],
      fraud_action: ["flag", "block"],
      fraud_review_status: ["none", "pending", "cleared", "confirmed_fraud"],
      game_kind: ["mystery_box", "spin_wheel"],
      gift_code_status: ["active", "redeemed", "revoked"],
      ledger_entry_type: [
        "ad_view",
        "survey",
        "referral_signup",
        "referral_activation",
        "redemption_request",
        "redemption_refund",
        "admin_adjustment",
        "referral_purchase",
        "gift_code",
        "game_prize",
        "task_reward",
        "vault_payout",
        "vault_deposit",
        "weekly_bonus",
      ],
      notification_business: ["ads", "affiliate", "both"],
      notification_type: ["announcement", "payout", "flag", "support", "vault"],
      order_kind: ["purchase", "training_renewal", "training_upgrade"],
      order_payment_method: ["paystack", "crypto"],
      order_status: ["pending", "confirmed", "refunded", "failed"],
      payout_method: ["crypto", "mobile_money"],
      product_kind: ["course", "ebook", "bundle"],
      question_condition_mode: ["all", "any"],
      redemption_status: [
        "held",
        "pending_approval",
        "approved",
        "paid",
        "rejected",
        "cancelled",
        "failed",
        "disputed",
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
      support_author: ["user", "admin"],
      support_thread_status: ["open", "closed"],
      task_metric: [
        "account_created",
        "plans_purchased",
        "ads_watched",
        "surveys_completed",
        "points_earned",
        "referrals_activated",
        "games_played",
        "gift_codes_redeemed",
        "withdrawals_made",
        "has_2fa",
        "has_avatar",
        "has_withdrawal_pin",
        "referrals_purchased",
        "vault_deposits_made",
        "team_members",
      ],
      user_ad_status: ["in_progress", "completed", "failed_locked"],
      vendor_status: ["active", "archived"],
      video_source: ["upload", "youtube"],
    },
  },
} as const
