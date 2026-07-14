// Hand-authored: no live Supabase project exists yet (see supabase/verify-local.sh
// and .superpowers/sdd/task-2-brief.md). Once a project is connected, regenerate
// with `npm run db:types` and diff the result against this file to catch drift.
//
// Shape mirrors `supabase gen types typescript` output. Note: `role`, `mode`,
// and `paid_from` are plain `text` columns with CHECK constraints, not Postgres
// enums — the real generator types those as `string`, not a literal union, so
// this file does the same to stay diff-clean against a future real generation.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      mandal_config: {
        Row: {
          id: boolean
          name: string
          logo_url: string | null
          signature_url: string | null
          upi_vpa: string | null
          upi_qr_url: string | null
          receipt_prefix: string
          expense_categories: string[]
          bank_opening_paise: number
        }
        Insert: {
          id?: boolean
          name: string
          logo_url?: string | null
          signature_url?: string | null
          upi_vpa?: string | null
          upi_qr_url?: string | null
          receipt_prefix?: string
          expense_categories?: string[]
          bank_opening_paise?: number
        }
        Update: {
          id?: boolean
          name?: string
          logo_url?: string | null
          signature_url?: string | null
          upi_vpa?: string | null
          upi_qr_url?: string | null
          receipt_prefix?: string
          expense_categories?: string[]
          bank_opening_paise?: number
        }
        Relationships: []
      }
      users: {
        Row: {
          id: string
          name: string
          phone: string | null
          email: string | null
          role: string
          invite_token: string | null
          auth_user_id: string | null
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          phone?: string | null
          email?: string | null
          role: string
          invite_token?: string | null
          auth_user_id?: string | null
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          phone?: string | null
          email?: string | null
          role?: string
          invite_token?: string | null
          auth_user_id?: string | null
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      donations: {
        Row: {
          id: string
          receipt_no: number
          public_token: string
          donor_name: string
          donor_phone: string | null
          amount_paise: number
          mode: string
          collected_by: string
          created_at: string
          voided: boolean
          void_reason: string | null
          voided_by: string | null
          voided_at: string | null
        }
        Insert: {
          id?: string
          receipt_no?: number
          public_token?: string
          donor_name: string
          donor_phone?: string | null
          amount_paise: number
          mode: string
          collected_by: string
          created_at?: string
          voided?: boolean
          void_reason?: string | null
          voided_by?: string | null
          voided_at?: string | null
        }
        Update: {
          id?: string
          receipt_no?: number
          public_token?: string
          donor_name?: string
          donor_phone?: string | null
          amount_paise?: number
          mode?: string
          collected_by?: string
          created_at?: string
          voided?: boolean
          void_reason?: string | null
          voided_by?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'donations_collected_by_fkey'
            columns: ['collected_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'donations_voided_by_fkey'
            columns: ['voided_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      expenses: {
        Row: {
          id: string
          category: string
          amount_paise: number
          description: string | null
          paid_by: string
          paid_from: string
          created_at: string
          voided: boolean
          void_reason: string | null
          voided_by: string | null
          voided_at: string | null
        }
        Insert: {
          id?: string
          category: string
          amount_paise: number
          description?: string | null
          paid_by: string
          paid_from: string
          created_at?: string
          voided?: boolean
          void_reason?: string | null
          voided_by?: string | null
          voided_at?: string | null
        }
        Update: {
          id?: string
          category?: string
          amount_paise?: number
          description?: string | null
          paid_by?: string
          paid_from?: string
          created_at?: string
          voided?: boolean
          void_reason?: string | null
          voided_by?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'expenses_paid_by_fkey'
            columns: ['paid_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'expenses_voided_by_fkey'
            columns: ['voided_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      handovers: {
        Row: {
          id: string
          volunteer_id: string
          amount_paise: number
          received_by: string
          note: string | null
          created_at: string
          voided: boolean
          void_reason: string | null
          voided_by: string | null
          voided_at: string | null
        }
        Insert: {
          id?: string
          volunteer_id: string
          amount_paise: number
          received_by: string
          note?: string | null
          created_at?: string
          voided?: boolean
          void_reason?: string | null
          voided_by?: string | null
          voided_at?: string | null
        }
        Update: {
          id?: string
          volunteer_id?: string
          amount_paise?: number
          received_by?: string
          note?: string | null
          created_at?: string
          voided?: boolean
          void_reason?: string | null
          voided_by?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'handovers_volunteer_id_fkey'
            columns: ['volunteer_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'handovers_received_by_fkey'
            columns: ['received_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'handovers_voided_by_fkey'
            columns: ['voided_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      // View columns are reported as nullable regardless of the underlying
      // table's NOT NULL constraints — Postgres does not propagate that
      // metadata for views, and neither does the real generator.
      public_mandal_branding: {
        Row: {
          name: string | null
          logo_url: string | null
          signature_url: string | null
          receipt_prefix: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_public_receipt: {
        Args: { token: string }
        Returns: {
          receipt_no: number
          donor_name: string
          amount_paise: number
          mode: string
          created_at: string
          voided: boolean
          void_reason: string | null
        }[]
      }
      link_admin_account: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type DefaultSchema = Database[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof Database },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        Database[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      Database[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof Database },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof Database },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never
