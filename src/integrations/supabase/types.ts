export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      ai_engine_logs: {
        Row: {
          created_at: string;
          error: string | null;
          function_key: string;
          id: string;
          latency_ms: number | null;
          model: string;
          provider_key: string;
          status: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          function_key: string;
          id?: string;
          latency_ms?: number | null;
          model: string;
          provider_key: string;
          status: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          function_key?: string;
          id?: string;
          latency_ms?: number | null;
          model?: string;
          provider_key?: string;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      ai_engine_routes: {
        Row: {
          created_at: string;
          enabled: boolean;
          function_key: string;
          model: string;
          priority: number;
          provider_key: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          function_key: string;
          model: string;
          priority: number;
          provider_key: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          function_key?: string;
          model?: string;
          priority?: number;
          provider_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_engine_routes_provider_key_fkey";
            columns: ["provider_key"];
            isOneToOne: false;
            referencedRelation: "ai_engine_settings";
            referencedColumns: ["provider_key"];
          },
        ];
      };
      ai_engine_settings: {
        Row: {
          created_at: string;
          enabled: boolean;
          last_checked_at: string | null;
          last_latency_ms: number | null;
          model: string;
          paid_authorized_at: string | null;
          paid_authorized_by: string | null;
          provider_key: string;
          quota_snapshot: Json;
          status: string;
          status_detail: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          last_checked_at?: string | null;
          last_latency_ms?: number | null;
          model: string;
          paid_authorized_at?: string | null;
          paid_authorized_by?: string | null;
          provider_key: string;
          quota_snapshot?: Json;
          status?: string;
          status_detail?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          last_checked_at?: string | null;
          last_latency_ms?: number | null;
          model?: string;
          paid_authorized_at?: string | null;
          paid_authorized_by?: string | null;
          provider_key?: string;
          quota_snapshot?: Json;
          status?: string;
          status_detail?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_engine_settings_paid_authorized_by_fkey";
            columns: ["paid_authorized_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      creator_profiles: {
        Row: {
          age: number | null;
          avatar_url: string;
          bio: string;
          country_code: string;
          created_at: string;
          display_name: string;
          drinks: boolean;
          follower_count: number;
          friend_count: number;
          full_name: string;
          gender: string | null;
          has_kids: boolean;
          hide_followers: boolean;
          id: string;
          is_official: boolean;
          is_gran_liga: boolean;
          is_cupido_active: boolean;
          is_premium: boolean;
          is_super_admin: boolean;
          is_verified_blue: boolean;
          looking_for: string;
          zodiac: string;
          smokes: boolean;
          hobbies: string;
          survey_completed: boolean;
          moderation_status: string;
          selfie_path: string;
          verification_frames: string[];
          verification_status: string;
          video_watch_seconds: number;
        };
        Insert: {
          age?: number | null;
          avatar_url?: string;
          bio?: string;
          country_code?: string;
          created_at?: string;
          display_name?: string;
          drinks?: boolean;
          follower_count?: number;
          friend_count?: number;
          full_name?: string;
          gender?: string | null;
          has_kids?: boolean;
          hide_followers?: boolean;
          id: string;
          is_official?: boolean;
          is_gran_liga?: boolean;
          is_cupido_active?: boolean;
          is_premium?: boolean;
          is_super_admin?: boolean;
          is_verified_blue?: boolean;
          looking_for?: string;
          zodiac?: string;
          smokes?: boolean;
          hobbies?: string;
          survey_completed?: boolean;
          moderation_status?: string;
          selfie_path?: string;
          verification_frames?: string[];
          verification_status?: string;
          video_watch_seconds?: number;
        };
        Update: {
          age?: number | null;
          avatar_url?: string;
          bio?: string;
          country_code?: string;
          created_at?: string;
          display_name?: string;
          drinks?: boolean;
          follower_count?: number;
          friend_count?: number;
          full_name?: string;
          gender?: string | null;
          has_kids?: boolean;
          hide_followers?: boolean;
          id?: string;
          is_official?: boolean;
          is_gran_liga?: boolean;
          is_cupido_active?: boolean;
          is_premium?: boolean;
          is_super_admin?: boolean;
          is_verified_blue?: boolean;
          looking_for?: string;
          zodiac?: string;
          smokes?: boolean;
          hobbies?: string;
          survey_completed?: boolean;
          moderation_status?: string;
          selfie_path?: string;
          verification_frames?: string[];
          verification_status?: string;
          video_watch_seconds?: number;
        };
        Relationships: [
          {
            foreignKeyName: "creator_profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_transactions: {
        Row: {
          created_at: string;
          delta: number;
          id: string;
          reason: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          delta: number;
          id?: string;
          reason: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          delta?: number;
          id?: string;
          reason?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      follows: {
        Row: {
          created_at: string;
          follower_id: string;
          following_id: string;
        };
        Insert: {
          created_at?: string;
          follower_id: string;
          following_id: string;
        };
        Update: {
          created_at?: string;
          follower_id?: string;
          following_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follows_following_id_fkey";
            columns: ["following_id"];
            isOneToOne: false;
            referencedRelation: "creator_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      manual_payments: {
        Row: {
          amount: string;
          created_at: string;
          id: string;
          product_id: string;
          reviewed_at: string | null;
          status: string;
          transaction_ref: string;
          user_id: string;
        };
        Insert: {
          amount: string;
          created_at?: string;
          id?: string;
          product_id: string;
          reviewed_at?: string | null;
          status?: string;
          transaction_ref: string;
          user_id: string;
        };
        Update: {
          amount?: string;
          created_at?: string;
          id?: string;
          product_id?: string;
          reviewed_at?: string | null;
          status?: string;
          transaction_ref?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          actor_id: string | null;
          action_url: string | null;
          body: string;
          created_at: string;
          id: string;
          kind: string | null;
          read: boolean;
          target_id: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          actor_id?: string | null;
          action_url?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          kind?: string | null;
          read?: boolean;
          target_id?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          actor_id?: string | null;
          action_url?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          kind?: string | null;
          read?: boolean;
          target_id?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      payment_settings: {
        Row: {
          id: number;
          paypal_business_name: string;
          paypal_client_id: string;
          paypal_email: string;
          paypal_mode: string;
          paypal_secret: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          paypal_business_name?: string;
          paypal_client_id?: string;
          paypal_email?: string;
          paypal_mode?: string;
          paypal_secret?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          paypal_business_name?: string;
          paypal_client_id?: string;
          paypal_email?: string;
          paypal_mode?: string;
          paypal_secret?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      paypal_orders: {
        Row: {
          amount: string;
          amount_usd: number;
          captured_at: string | null;
          created_at: string;
          credits: number;
          currency: string;
          id: string;
          package_id: string;
          paypal_order_id: string;
          plan_id: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          amount: string;
          amount_usd: number;
          captured_at?: string | null;
          created_at?: string;
          credits: number;
          currency?: string;
          id?: string;
          package_id: string;
          paypal_order_id: string;
          plan_id?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          amount?: string;
          amount_usd?: number;
          captured_at?: string | null;
          created_at?: string;
          credits?: number;
          currency?: string;
          id?: string;
          package_id?: string;
          paypal_order_id?: string;
          plan_id?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      cupido_reward_claims: {
        Row: {
          claim_key: string;
          created_at: string;
          id: string;
          reward_type: string;
          user_id: string;
        };
        Insert: {
          claim_key: string;
          created_at?: string;
          id?: string;
          reward_type: string;
          user_id: string;
        };
        Update: {
          claim_key?: string;
          created_at?: string;
          id?: string;
          reward_type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          age: number | null;
          avatar_url: string | null;
          birth_date: string | null;
          bio: string | null;
          country_code: string | null;
          created_at: string;
          credits: number;
          credits_balance: number;
          daily_streak: number;
          display_name: string | null;
          drinks: boolean;
          email: string | null;
          full_name: string | null;
          gender: string | null;
          has_kids: boolean;
          hide_followers: boolean;
          has_purchased: boolean;
          has_recharged: boolean;
          is_gran_liga: boolean;
          id: string;
          last_daily_claim: string | null;
          last_wheel_spin: string | null;
          theme_mode: string;
          notifications_enabled: boolean;
          sounds_enabled: boolean;
          sound_enabled: boolean;
          zodiac: string;
          smokes: boolean;
          hobbies: string;
          survey_completed: boolean;
          looking_for: string | null;
          phone: string | null;
          plan: string;
          plan_expires_at: string | null;
          referred_by: string | null;
          terms_accepted_at: string | null;
          updated_at: string;
        };
        Insert: {
          age?: number | null;
          avatar_url?: string | null;
          birth_date?: string | null;
          bio?: string | null;
          country_code?: string | null;
          created_at?: string;
          credits?: number;
          credits_balance?: number;
          daily_streak?: number;
          display_name?: string | null;
          drinks?: boolean;
          email?: string | null;
          full_name?: string | null;
          gender?: string | null;
          has_kids?: boolean;
          hide_followers?: boolean;
          has_purchased?: boolean;
          has_recharged?: boolean;
          is_gran_liga?: boolean;
          id: string;
          last_daily_claim?: string | null;
          last_wheel_spin?: string | null;
          theme_mode?: string;
          notifications_enabled?: boolean;
          sounds_enabled?: boolean;
          sound_enabled?: boolean;
          zodiac?: string;
          smokes?: boolean;
          hobbies?: string;
          survey_completed?: boolean;
          looking_for?: string | null;
          phone?: string | null;
          plan?: string;
          plan_expires_at?: string | null;
          referred_by?: string | null;
          terms_accepted_at?: string | null;
          updated_at?: string;
        };
        Update: {
          age?: number | null;
          avatar_url?: string | null;
          birth_date?: string | null;
          bio?: string | null;
          country_code?: string | null;
          created_at?: string;
          credits?: number;
          credits_balance?: number;
          daily_streak?: number;
          display_name?: string | null;
          drinks?: boolean;
          email?: string | null;
          full_name?: string | null;
          gender?: string | null;
          has_kids?: boolean;
          hide_followers?: boolean;
          has_purchased?: boolean;
          has_recharged?: boolean;
          is_gran_liga?: boolean;
          id?: string;
          last_daily_claim?: string | null;
          last_wheel_spin?: string | null;
          theme_mode?: string;
          notifications_enabled?: boolean;
          sounds_enabled?: boolean;
          sound_enabled?: boolean;
          zodiac?: string;
          smokes?: boolean;
          hobbies?: string;
          survey_completed?: boolean;
          looking_for?: string | null;
          phone?: string | null;
          plan?: string;
          plan_expires_at?: string | null;
          referred_by?: string | null;
          terms_accepted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      site_settings: {
        Row: {
          accent_color: string;
          app_logo_url: string;
          banner_image_url: string;
          banner_text: string;
          covers_enabled: boolean;
          custom_sections: Json;
          gallery_enabled: boolean;
          id: number;
          logo_url: string;
          paypal_me_link: string;
          primary_color: string;
          purchases_enabled: boolean;
          site_tagline: string;
          site_title: string;
          songs_enabled: boolean;
          updated_at: string;
          videos_enabled: boolean;
        };
        Insert: {
          accent_color?: string;
          app_logo_url?: string;
          banner_image_url?: string;
          banner_text?: string;
          covers_enabled?: boolean;
          custom_sections?: Json;
          gallery_enabled?: boolean;
          id?: number;
          logo_url?: string;
          paypal_me_link?: string;
          primary_color?: string;
          purchases_enabled?: boolean;
          site_tagline?: string;
          site_title?: string;
          songs_enabled?: boolean;
          updated_at?: string;
          videos_enabled?: boolean;
        };
        Update: {
          accent_color?: string;
          app_logo_url?: string;
          banner_image_url?: string;
          banner_text?: string;
          covers_enabled?: boolean;
          custom_sections?: Json;
          gallery_enabled?: boolean;
          id?: number;
          logo_url?: string;
          paypal_me_link?: string;
          primary_color?: string;
          purchases_enabled?: boolean;
          site_tagline?: string;
          site_title?: string;
          songs_enabled?: boolean;
          updated_at?: string;
          videos_enabled?: boolean;
        };
        Relationships: [];
      };
      songs: {
        Row: {
          bpm: number | null;
          content_id_eligible: boolean;
          created_at: string;
          creator_plan: string;
          credits_refunded: boolean;
          credits_spent: number;
          duration_seconds: number;
          error: string | null;
          expires_at: string | null;
          external_job_id: string | null;
          external_model: string | null;
          external_response_url: string | null;
          external_status_url: string | null;
          fingerprint: string | null;
          genre: string;
          id: string;
          is_public: boolean;
          kind: string;
          lyrics: string | null;
          media_type: string;
          prompt: string;
          published_at: string | null;
          review_status: string;
          source_song_id: string | null;
          status: string;
          storage_path: string | null;
          title: string;
          updated_at: string;
          user_id: string;
          voice_type: string | null;
        };
        Insert: {
          bpm?: number | null;
          content_id_eligible?: boolean;
          created_at?: string;
          creator_plan?: string;
          credits_refunded?: boolean;
          credits_spent?: number;
          duration_seconds: number;
          error?: string | null;
          expires_at?: string | null;
          external_job_id?: string | null;
          external_model?: string | null;
          external_response_url?: string | null;
          external_status_url?: string | null;
          fingerprint?: string | null;
          genre: string;
          id?: string;
          is_public?: boolean;
          kind?: string;
          lyrics?: string | null;
          media_type?: string;
          prompt: string;
          published_at?: string | null;
          review_status?: string;
          source_song_id?: string | null;
          status?: string;
          storage_path?: string | null;
          title: string;
          updated_at?: string;
          user_id?: string;
          voice_type?: string | null;
        };
        Update: {
          bpm?: number | null;
          content_id_eligible?: boolean;
          created_at?: string;
          creator_plan?: string;
          credits_refunded?: boolean;
          credits_spent?: number;
          duration_seconds?: number;
          error?: string | null;
          expires_at?: string | null;
          external_job_id?: string | null;
          external_model?: string | null;
          external_response_url?: string | null;
          external_status_url?: string | null;
          fingerprint?: string | null;
          genre?: string;
          id?: string;
          is_public?: boolean;
          kind?: string;
          lyrics?: string | null;
          media_type?: string;
          prompt?: string;
          published_at?: string | null;
          review_status?: string;
          source_song_id?: string | null;
          status?: string;
          storage_path?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
          voice_type?: string | null;
        };
        Relationships: [];
      };
      support_messages: {
        Row: {
          body: string;
          created_at: string;
          from_admin: boolean;
          id: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          from_admin?: boolean;
          id?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          from_admin?: boolean;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_credits: {
        Row: {
          balance: number;
          daily_reset_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          balance?: number;
          daily_reset_at?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          balance?: number;
          daily_reset_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    cupido_balances: {
      Row: { balance: number; updated_at: string; user_id: string };
      Insert: { balance?: number; updated_at?: string; user_id: string };
      Update: { balance?: number; updated_at?: string; user_id?: string };
      Relationships: [];
    };
    cupido_calls: {
      Row: {
        callee_id: string;
        caller_id: string;
        created_at: string;
        credits_spent: number;
        id: string;
        mode: string;
        status: string;
        video: boolean;
      };
      Insert: {
        callee_id: string;
        caller_id: string;
        created_at?: string;
        credits_spent?: number;
        id?: string;
        mode: string;
        status?: string;
        video?: boolean;
      };
      Update: {
        callee_id?: string;
        caller_id?: string;
        created_at?: string;
        credits_spent?: number;
        id?: string;
        mode?: string;
        status?: string;
        video?: boolean;
      };
      Relationships: [];
    };
    cupido_conversations: {
      Row: { created_at: string; id: string; participant_a: string; participant_b: string };
      Insert: { created_at?: string; id?: string; participant_a: string; participant_b: string };
      Update: { created_at?: string; id?: string; participant_a?: string; participant_b?: string };
      Relationships: [];
    };
    cupido_friends: {
      Row: {
        addressee_id: string;
        created_at: string;
        requester_id: string;
        status: string;
      };
      Insert: {
        addressee_id: string;
        created_at?: string;
        requester_id: string;
        status?: string;
      };
      Update: {
        addressee_id?: string;
        created_at?: string;
        requester_id?: string;
        status?: string;
      };
      Relationships: [];
    };
    friend_requests: {
      Row: {
        addressee_id: string;
        created_at: string;
        id: string;
        requester_id: string;
        status: string;
        updated_at: string;
      };
      Insert: {
        addressee_id: string;
        created_at?: string;
        id?: string;
        requester_id: string;
        status?: string;
        updated_at?: string;
      };
      Update: {
        addressee_id?: string;
        created_at?: string;
        id?: string;
        requester_id?: string;
        status?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    cupido_groups: {
      Row: { created_at: string; description: string; id: string; name: string; owner_id: string };
      Insert: { created_at?: string; description?: string; id?: string; name: string; owner_id: string };
      Update: { created_at?: string; description?: string; id?: string; name?: string; owner_id?: string };
      Relationships: [];
    };
    cupido_group_members: {
      Row: { group_id: string; joined_at: string; role: string; user_id: string };
      Insert: { group_id: string; joined_at?: string; role?: string; user_id: string };
      Update: { group_id?: string; joined_at?: string; role?: string; user_id?: string };
      Relationships: [];
    };
    cupido_group_invites: {
      Row: { created_at: string; group_id: string; id: string; invitee_id: string; inviter_id: string; status: string };
      Insert: { created_at?: string; group_id: string; id?: string; invitee_id: string; inviter_id: string; status?: string };
      Update: { created_at?: string; group_id?: string; id?: string; invitee_id?: string; inviter_id?: string; status?: string };
      Relationships: [];
    };
    cupido_pk_requests: {
      Row: { answered_at: string | null; created_at: string; expires_at: string; host_id: string; id: string; requester_id: string; room_id: string; status: string };
      Insert: { answered_at?: string | null; created_at?: string; expires_at?: string; host_id: string; id?: string; requester_id: string; room_id: string; status?: string };
      Update: { answered_at?: string | null; created_at?: string; expires_at?: string; host_id?: string; id?: string; requester_id?: string; room_id?: string; status?: string };
      Relationships: [];
    };
    cupido_gift_sends: {
      Row: {
        cash_value: number;
        created_at: string;
        credits: number;
        gift_id: string;
        id: string;
        receiver_id: string;
        sender_id: string;
      };
      Insert: {
        cash_value: number;
        created_at?: string;
        credits: number;
        gift_id: string;
        id?: string;
        receiver_id: string;
        sender_id: string;
      };
      Update: {
        cash_value?: number;
        created_at?: string;
        credits?: number;
        gift_id?: string;
        id?: string;
        receiver_id?: string;
        sender_id?: string;
      };
      Relationships: [];
    };
    cupido_gifts: {
      Row: { cash: number; credits: number; emoji: string; id: string; name: string; sort_order: number };
      Insert: { cash: number; credits: number; emoji: string; id: string; name: string; sort_order: number };
      Update: { cash?: number; credits?: number; emoji?: string; id?: string; name?: string; sort_order?: number };
      Relationships: [];
    };
    cupido_live_rooms: {
      Row: {
        created_at: string;
        ended_at: string | null;
        host_id: string;
        id: string;
        is_live: boolean;
        premium_coins: number;
        premium_minutes: number;
        premium_ends_at: string | null;
        title: string;
        viewer_count: number;
      };
      Insert: {
        created_at?: string;
        ended_at?: string | null;
        host_id: string;
        id?: string;
        is_live?: boolean;
        premium_coins?: number;
        premium_minutes?: number;
        premium_ends_at?: string | null;
        title: string;
        viewer_count?: number;
      };
      Update: {
        created_at?: string;
        ended_at?: string | null;
        host_id?: string;
        id?: string;
        is_live?: boolean;
        premium_coins?: number;
        premium_minutes?: number;
        premium_ends_at?: string | null;
        title?: string;
        viewer_count?: number;
      };
      Relationships: [];
    };
    cupido_live_signals: {
      Row: { created_at: string; id: string; payload: Json; receiver_id: string | null; room_id: string; sender_id: string };
      Insert: {
        created_at?: string;
        id?: string;
        payload: Json;
        receiver_id?: string | null;
        room_id: string;
        sender_id: string;
      };
      Update: {
        created_at?: string;
        id?: string;
        payload?: Json;
        receiver_id?: string | null;
        room_id?: string;
        sender_id?: string;
      };
      Relationships: [];
    };
    cupido_live_viewers: {
      Row: { joined_at: string; room_id: string; user_id: string };
      Insert: { joined_at?: string; room_id: string; user_id: string };
      Update: { joined_at?: string; room_id?: string; user_id?: string };
      Relationships: [];
    };
    cupido_face_verification_videos: {
      Row: { created_at: string; id: string; reviewed_at: string | null; reviewed_by: string | null; status: string; user_id: string; video_path: string };
      Insert: { created_at?: string; id?: string; reviewed_at?: string | null; reviewed_by?: string | null; status?: string; user_id: string; video_path: string };
      Update: { created_at?: string; id?: string; reviewed_at?: string | null; reviewed_by?: string | null; status?: string; user_id?: string; video_path?: string };
      Relationships: [];
    };
    cupido_follower_count_events: {
      Row: { follower_count: number; updated_at: string; user_id: string };
      Insert: { follower_count?: number; updated_at?: string; user_id: string };
      Update: { follower_count?: number; updated_at?: string; user_id?: string };
      Relationships: [];
    };
    live_streams: {
      Row: {
        ended_at: string | null;
        host_id: string;
        id: string;
        premium_coins: number;
        premium_minutes: number;
        premium_ends_at: string | null;
        started_at: string;
        status: string;
        title: string;
        viewers_count: number;
      };
      Insert: {
        ended_at?: string | null;
        host_id: string;
        id: string;
        premium_coins?: number;
        premium_minutes?: number;
        premium_ends_at?: string | null;
        started_at?: string;
        status?: string;
        title?: string;
        viewers_count?: number;
      };
      Update: {
        ended_at?: string | null;
        host_id?: string;
        id?: string;
        premium_coins?: number;
        premium_minutes?: number;
        premium_ends_at?: string | null;
        started_at?: string;
        status?: string;
        title?: string;
        viewers_count?: number;
      };
      Relationships: [];
    };
    live_comments: {
      Row: { body: string; created_at: string; id: string; stream_id: string; user_id: string };
      Insert: { body: string; created_at?: string; id?: string; stream_id: string; user_id: string };
      Update: { body?: string; created_at?: string; id?: string; stream_id?: string; user_id?: string };
      Relationships: [];
    };
    cupido_likes: {
      Row: { actor_id: string; created_at: string; kind: string; target_id: string };
      Insert: { actor_id: string; created_at?: string; kind: string; target_id: string };
      Update: { actor_id?: string; created_at?: string; kind?: string; target_id?: string };
      Relationships: [];
    };
    cupido_messages: {
      Row: {
        audio_path: string;
        body: string;
        conversation_id: string;
        created_at: string;
        deleted_for_all_at: string | null;
        edited_at: string | null;
        id: string;
        sender_id: string;
        media_path: string;
        read_at: string | null;
        reply_to_id: string | null;
      };
      Insert: {
        audio_path?: string;
        body?: string;
        conversation_id: string;
        created_at?: string;
        id?: string;
        sender_id: string;
        media_path?: string;
        reply_to_id?: string | null;
      };
      Update: {
        audio_path?: string;
        body?: string;
        conversation_id?: string;
        created_at?: string;
        id?: string;
        sender_id?: string;
        media_path?: string;
        deleted_for_all_at?: string | null;
        edited_at?: string | null;
        read_at?: string | null;
        reply_to_id?: string | null;
      };
      Relationships: [];
    };
    cupido_post_likes: {
      Row: { created_at: string; post_id: string; user_id: string };
      Insert: { created_at?: string; post_id: string; user_id: string };
      Update: { created_at?: string; post_id?: string; user_id?: string };
      Relationships: [];
    };
    cupido_posts: {
      Row: {
        caption: string;
        comments_count: number;
        created_at: string;
        dislikes_count: number;
        id: string;
        is_promoted: boolean;
        kind: string;
        likes_count: number;
        media_path: string | null;
        moderation_status: string;
        saves_count: number;
        shares_count: number;
        user_id: string;
        views_count: number;
      };
      Insert: {
        caption?: string;
        comments_count?: number;
        created_at?: string;
        dislikes_count?: number;
        id?: string;
        is_promoted?: boolean;
        kind: string;
        likes_count?: number;
        media_path?: string | null;
        moderation_status?: string;
        saves_count?: number;
        shares_count?: number;
        user_id: string;
        views_count?: number;
      };
      Update: {
        caption?: string;
        comments_count?: number;
        created_at?: string;
        dislikes_count?: number;
        id?: string;
        is_promoted?: boolean;
        kind?: string;
        likes_count?: number;
        media_path?: string;
        moderation_status?: string;
        saves_count?: number;
        shares_count?: number;
        user_id?: string;
        views_count?: number;
      };
      Relationships: [];
    };
    cupido_reports: {
      Row: {
        created_at: string;
        id: string;
        reason: string;
        reported_id: string;
        reporter_id: string;
        status: string;
      };
      Insert: {
        created_at?: string;
        id?: string;
        reason?: string;
        reported_id: string;
        reporter_id: string;
        status?: string;
      };
      Update: {
        created_at?: string;
        id?: string;
        reason?: string;
        reported_id?: string;
        reporter_id?: string;
        status?: string;
      };
      Relationships: [];
    };
    cupido_terms_acceptance: {
      Row: { accepted_at: string; user_id: string; version: string };
      Insert: { accepted_at?: string; user_id: string; version: string };
      Update: { accepted_at?: string; user_id?: string; version?: string };
      Relationships: [];
    };
    cupido_referrals: {
      Row: {
        created_at: string;
        referee_id: string;
        referrer_id: string;
        rewarded_at: string | null;
        status: string;
        verified_at: string | null;
      };
      Insert: {
        created_at?: string;
        referee_id: string;
        referrer_id: string;
        rewarded_at?: string | null;
        status?: string;
        verified_at?: string | null;
      };
      Update: {
        created_at?: string;
        referee_id?: string;
        referrer_id?: string;
        rewarded_at?: string | null;
        status?: string;
        verified_at?: string | null;
      };
      Relationships: [];
    };
    cupido_withdrawals: {
      Row: {
        account_details: string;
        amount: number;
        country_code: string;
        created_at: string;
        id: string;
        method: string;
        reviewed_at: string | null;
        status: string;
        user_id: string;
      };
      Insert: {
        account_details: string;
        amount: number;
        country_code: string;
        created_at?: string;
        id?: string;
        method: string;
        reviewed_at?: string | null;
        status?: string;
        user_id: string;
      };
      Update: {
        account_details?: string;
        amount?: number;
        country_code?: string;
        created_at?: string;
        id?: string;
        method?: string;
        reviewed_at?: string | null;
        status?: string;
        user_id?: string;
      };
      Relationships: [];
    };
    };
    Views: {
      cupido_public_profiles: {
        Row: {
          age: number | null;
          avatar_url: string;
          bio: string;
          country_code: string;
          created_at: string;
          display_name: string;
          drinks: boolean;
          friend_count: number;
          follower_count: number;
          gender: string | null;
          has_kids: boolean;
          hide_followers: boolean;
          hobbies: string;
          survey_completed: boolean;
          id: string;
          is_official: boolean;
          is_cupido_active: boolean;
          is_premium: boolean;
          is_super_admin: boolean;
          is_verified_blue: boolean;
          is_gran_liga: boolean;
          looking_for: string;
          smokes: boolean;
          zodiac: string;
          verification_status: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      cupido_count_followers: { Args: { _following: string }; Returns: number };
      cupido_claim_daily_reward: { Args: never; Returns: Json };
      cupido_public_paypal_client_id: { Args: never; Returns: string };
      cupido_count_followers_batch: {
        Args: { _following: string[] };
        Returns: { following_id: string; follower_count: number }[];
      };
      cupido_list_followers: {
        Args: { _following: string };
        Returns: { avatar_url: string; display_name: string; follower_id: string }[];
      };
      admin_adjust_credits: {
        Args: { _delta: number; _user_id: string };
        Returns: number;
      };
      admin_review_cover: {
        Args: { _approve: boolean; _song_id: string };
        Returns: undefined;
      };
      admin_set_plan: {
        Args: { _days: number; _plan: string; _user_id: string };
        Returns: undefined;
      };
      apply_daily_refill: { Args: { _uid: string }; Returns: undefined };
      consume_credits: {
        Args: { _amount: number; _reason: string };
        Returns: number;
      };
      effective_plan: { Args: { _user_id: string }; Returns: string };
      ensure_my_profile: { Args: never; Returns: undefined };
      grant_credits: {
        Args: { _amount: number; _reason: string; _user_id: string };
        Returns: number;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      refresh_my_credits: { Args: never; Returns: Json };
      try_date: { Args: { _v: string }; Returns: string };
      verify_license: {
        Args: { _song_id: string };
        Returns: {
          content_id_eligible: boolean;
          created_at: string;
          creator_id: string;
          creator_name: string;
          fingerprint: string;
          genre: string;
          id: string;
          kind: string;
          review_status: string;
          title: string;
          voice_type: string;
        }[];
      };
    cupido_accept_terms: { Args: { _version: string }; Returns: undefined };
    cupido_admin_auto_terms: { Args: never; Returns: undefined };
    cupido_can_access_conversation: { Args: { _conversation: string }; Returns: boolean };
    cupido_open_conversation: { Args: { _other: string }; Returns: string };
    cupido_request_withdrawal: {
      Args: { _account_details: string; _amount: number; _country_code: string; _method: string };
      Returns: string;
    };
    cupido_register_referral: { Args: { _referrer: string }; Returns: undefined };
    cupido_review_verification: {
      Args: { _approve: boolean; _frames?: string[]; _user_id: string };
      Returns: undefined;
    };
    cupido_review_withdrawal: { Args: { _approve: boolean; _id: string }; Returns: undefined };
    cupido_save_profile: {
      Args: {
        _bio: string;
        _country_code: string;
        _display_name: string;
        _drinks: boolean;
        _has_kids: boolean;
        _looking_for: string;
      };
      Returns: undefined;
    };
    cupido_end_live_room: { Args: { _id: string }; Returns: undefined };
    cupido_submit_face_verification_video: { Args: { _video_path: string }; Returns: string };
    cupido_review_face_verification_video: { Args: { _approve: boolean; _request: string }; Returns: undefined };
    cupido_record_video_watch: { Args: { _post: string; _seconds: number }; Returns: number };
    cupido_get_video_watch_seconds: { Args: { _user: string }; Returns: number };
    cupido_get_studio_analytics: {
      Args: never;
      Returns: {
        video_id: string;
        creator_id: string;
        creator_name: string;
        country_code: string;
        follower_count: number;
        video_title: string;
        views_count: number;
        watched_seconds: number;
        created_at: string;
      }[];
    };
    cupido_send_gift: {
      Args: { _cash_value: number; _credits: number; _gift_id: string; _receiver: string };
      Returns: string;
    };
      cupido_finalize_paypal_package: {
        Args: { _credits: number; _gran_liga: boolean; _order_id: string; _user_id: string };
        Returns: boolean;
      };
      cupido_create_group: { Args: { _description?: string; _name: string }; Returns: string };
      cupido_invite_group_friend: { Args: { _group: string; _invitee: string }; Returns: string };
      cupido_respond_group_invite: { Args: { _accept: boolean; _invite: string }; Returns: boolean };
      cupido_promote_post: { Args: { _post: string }; Returns: boolean };
      cupido_request_pk: { Args: { _room: string }; Returns: string };
      cupido_respond_pk: { Args: { _accept: boolean; _request: string }; Returns: string };
    cupido_send_live_gift: {
      Args: { _cash_value: number; _credits: number; _gift_id: string; _receiver: string; _room: string };
      Returns: string;
    };
    cupido_set_avatar: { Args: { _moderation: string; _url: string }; Returns: undefined };
    cupido_set_like: { Args: { _kind: string; _remove: boolean; _target: string }; Returns: boolean };
    cupido_start_live_room: { Args: { _title: string }; Returns: string };
    cupido_toggle_post_like: { Args: { _post: string }; Returns: boolean };
    cupido_start_call: { Args: { _callee: string; _mode: string; _video: boolean }; Returns: string };
    cupido_submit_live_verification: { Args: { _frames: string[] }; Returns: undefined };
    cupido_register_post_view: { Args: { _post: string }; Returns: number };
    cupido_register_post_share: { Args: { _post: string }; Returns: number };
    cupido_submit_selfie: { Args: { _path: string }; Returns: undefined };
    cupido_answer_call: { Args: { _accept: boolean; _id: string }; Returns: undefined };
    cupido_end_call: { Args: { _id: string; _status: string }; Returns: undefined };
    };
    Enums: {
      app_role: "admin" | "admin_supremo" | "user";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "admin_supremo", "user"],
    },
  },
} as const;
