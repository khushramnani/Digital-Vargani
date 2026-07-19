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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      donations: {
        Row: {
          amount_paise: number
          category: string
          client_idempotency_key: string | null
          collected_by: string
          created_at: string
          donor_name: string
          donor_phone: string | null
          id: string
          mandal_id: string
          mode: string
          public_token: string
          receipt_no: number
          sms_sent_at: string | null
          void_reason: string | null
          voided: boolean
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_paise: number
          category?: string
          client_idempotency_key?: string | null
          collected_by: string
          created_at?: string
          donor_name: string
          donor_phone?: string | null
          id?: string
          mandal_id?: string
          mode: string
          public_token?: string
          receipt_no?: number
          sms_sent_at?: string | null
          void_reason?: string | null
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_paise?: number
          category?: string
          client_idempotency_key?: string | null
          collected_by?: string
          created_at?: string
          donor_name?: string
          donor_phone?: string | null
          id?: string
          mandal_id?: string
          mode?: string
          public_token?: string
          receipt_no?: number
          sms_sent_at?: string | null
          void_reason?: string | null
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "donations_collected_by_fkey"
            columns: ["collected_by", "mandal_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "mandal_id"]
          },
          {
            foreignKeyName: "donations_mandal_id_fkey"
            columns: ["mandal_id"]
            isOneToOne: false
            referencedRelation: "mandals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_paise: number
          category: string
          created_at: string
          description: string | null
          id: string
          mandal_id: string
          paid_by: string
          paid_from: string
          void_reason: string | null
          voided: boolean
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_paise: number
          category: string
          created_at?: string
          description?: string | null
          id?: string
          mandal_id?: string
          paid_by: string
          paid_from: string
          void_reason?: string | null
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_paise?: number
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          mandal_id?: string
          paid_by?: string
          paid_from?: string
          void_reason?: string | null
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_mandal_id_fkey"
            columns: ["mandal_id"]
            isOneToOne: false
            referencedRelation: "mandals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_paid_by_fkey"
            columns: ["paid_by", "mandal_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "mandal_id"]
          },
          {
            foreignKeyName: "expenses_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      handovers: {
        Row: {
          amount_paise: number
          created_at: string
          id: string
          mandal_id: string
          note: string | null
          received_by: string
          void_reason: string | null
          voided: boolean
          voided_at: string | null
          voided_by: string | null
          volunteer_id: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          id?: string
          mandal_id?: string
          note?: string | null
          received_by: string
          void_reason?: string | null
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
          volunteer_id: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          id?: string
          mandal_id?: string
          note?: string | null
          received_by?: string
          void_reason?: string | null
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "handovers_mandal_id_fkey"
            columns: ["mandal_id"]
            isOneToOne: false
            referencedRelation: "mandals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_received_by_fkey"
            columns: ["received_by", "mandal_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "mandal_id"]
          },
          {
            foreignKeyName: "handovers_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handovers_volunteer_id_fkey"
            columns: ["volunteer_id", "mandal_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "mandal_id"]
          },
        ]
      }
      mandals: {
        Row: {
          address: string | null
          bank_opening_paise: number
          city: string | null
          created_at: string
          creator_phone: string | null
          default_lang: string
          expense_categories: string[]
          hide_president_contact: boolean
          id: string
          inquiry_contacts: Json
          logo_url: string | null
          name: string
          next_receipt_no: number
          president_name: string | null
          receipt_prefix: string
          signature_url: string | null
          slug: string
          state: string | null
          transparency_published: boolean
          transparency_visibility: string
          upi_qr_url: string | null
          upi_vpa: string | null
        }
        Insert: {
          address?: string | null
          bank_opening_paise?: number
          city?: string | null
          created_at?: string
          creator_phone?: string | null
          default_lang?: string
          expense_categories?: string[]
          hide_president_contact?: boolean
          id?: string
          inquiry_contacts?: Json
          logo_url?: string | null
          name: string
          next_receipt_no?: number
          president_name?: string | null
          receipt_prefix?: string
          signature_url?: string | null
          slug: string
          state?: string | null
          transparency_published?: boolean
          transparency_visibility?: string
          upi_qr_url?: string | null
          upi_vpa?: string | null
        }
        Update: {
          address?: string | null
          bank_opening_paise?: number
          city?: string | null
          created_at?: string
          creator_phone?: string | null
          default_lang?: string
          expense_categories?: string[]
          hide_president_contact?: boolean
          id?: string
          inquiry_contacts?: Json
          logo_url?: string | null
          name?: string
          next_receipt_no?: number
          president_name?: string | null
          receipt_prefix?: string
          signature_url?: string | null
          slug?: string
          state?: string | null
          transparency_published?: boolean
          transparency_visibility?: string
          upi_qr_url?: string | null
          upi_vpa?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          active: boolean
          auth_user_id: string | null
          created_at: string
          email: string | null
          id: string
          invite_token: string | null
          mandal_id: string
          name: string
          phone: string | null
          role: string
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          invite_token?: string | null
          mandal_id?: string
          name: string
          phone?: string | null
          role: string
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          invite_token?: string | null
          mandal_id?: string
          name?: string
          phone?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_mandal_id_fkey"
            columns: ["mandal_id"]
            isOneToOne: false
            referencedRelation: "mandals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_mandal_id: { Args: never; Returns: string }
      app_user_id: { Args: never; Returns: string }
      app_user_role: { Args: never; Returns: string }
      clear_donation_history: { Args: { reason: string }; Returns: number }
      create_mandal: {
        Args: {
          admin_name: string
          mandal_address?: string
          mandal_city?: string
          mandal_name: string
          mandal_state?: string
          slug_hint?: string
        }
        Returns: string
      }
      donors_summary: {
        Args: { p_year?: number }
        Returns: {
          donation_count: number
          donor_key: string
          donor_name: string
          donor_phone: string
          first_at: string
          last_at: string
          total_paise: number
        }[]
      }
      get_expense_categories: { Args: never; Returns: string[] }
      get_mandal_default_lang: { Args: never; Returns: string }
      get_public_receipt: {
        Args: { token: string }
        Returns: {
          amount_paise: number
          city: string
          created_at: string
          creator_phone: string
          donor_name: string
          hide_president_contact: boolean
          inquiry_contacts: Json
          logo_url: string
          mandal_name: string
          mode: string
          president_name: string
          receipt_no: number
          receipt_prefix: string
          signature_url: string
          void_reason: string
          voided: boolean
        }[]
      }
      get_transparency_categories: {
        Args: { mandal_slug: string }
        Returns: {
          amount_paise: number
          category: string
        }[]
      }
      get_transparency_report: {
        Args: { mandal_slug: string }
        Returns: {
          donor_count: number
          mandal_name: string
          total_collected_paise: number
          total_expenses_paise: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      link_admin_account: { Args: never; Returns: undefined }
      list_admins: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      purge_donations: { Args: { scope: string }; Returns: number }
      redeem_invite: { Args: { token: string }; Returns: undefined }
      reissue_invite: { Args: { volunteer_id: string }; Returns: string }
      slugify: { Args: { txt: string }; Returns: string }
      void_row: {
        Args: { reason: string; row_id: string; target_table: string }
        Returns: undefined
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
