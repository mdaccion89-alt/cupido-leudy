export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      creator_profiles: {
        Row: {
          avatar_url: string;
          bio: string;
          created_at: string;
          display_name: string;
          follower_count: number;
          id: string;
          is_official: boolean;
          is_premium: boolean;
        };
        Insert: {
          avatar_url?: string;
          bio?: string;
          created_at?: string;
          display_name?: string;
          follower_count?: number;
          id: string;
          is_official?: boolean;
          is_premium?: boolean;
        };
        Update: {
          avatar_url?: string;
          bio?: string;
          created_at?: string;
          display_name?: string;
          follower_count?: number;
          id?: string;
          is_official?: boolean;
          is_premium?: boolean;
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
          body: string;
          created_at: string;
          id: string;
          read: boolean;
          title: string;
          user_id: string;
        };
        Insert: {
          body?: string;
          created_at?: string;
          id?: string;
          read?: boolean;
          title: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          read?: boolean;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      payment_settings: {
        Row: {
          id: number;
          paypal_email: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          paypal_email?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          paypal_email?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      paypal_orders: {
        Row: {
          amount: string;
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
      profiles: {
        Row: {
          birth_date: string | null;
          created_at: string;
          display_name: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          plan: string;
          plan_expires_at: string | null;
        };
        Insert: {
          birth_date?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          plan?: string;
          plan_expires_at?: string | null;
        };
        Update: {
          birth_date?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          plan?: string;
          plan_expires_at?: string | null;
        };
        Relationships: [];
      };
      site_settings: {
        Row: {
          accent_color: string;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
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
