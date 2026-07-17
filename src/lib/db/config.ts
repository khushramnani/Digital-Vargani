// Typed query module for the mandals table + its Storage assets. RLS
// (mandals_admin_* / mandal_assets_admin_*) already enforces admin-only,
// same-mandal writes server-side, so nothing here re-checks role or
// mandal — callers just route the screen behind RequireRole role="admin".
import { toLang, type Lang } from '../i18n/receipt'
import { supabase } from './client'
import type { Tables, TablesUpdate } from './database.types'

export type Mandal = Tables<'mandals'>
export type MandalAssetKind = 'logo' | 'signature' | 'upi_qr'

const ASSETS_BUCKET = 'mandal-assets'

// RLS scopes this to the caller's own mandal, so `single()` still returns
// exactly one row — the tenant filter is server-side, not a client `.eq()`.
export async function getMandal(): Promise<Mandal> {
  const { data, error } = await supabase.from('mandals').select('*').single()
  if (error) throw error
  return data
}

// mandals only has an admin-only RLS select policy — a volunteer session
// gets zero rows from getMandal(). This goes through the
// get_expense_categories() RPC instead, which is grant-to-authenticated,
// scoped to app_mandal_id() server-side, and exposes only the one column
// any session (admin or volunteer) actually needs for the expense form's
// category dropdown.
export async function getExpenseCategories(): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_expense_categories')
  if (error) throw error
  return data ?? []
}

// mandals is admin-only at the RLS level, so a volunteer session reads this
// one column through the RPC instead — same pattern as getExpenseCategories.
// Never throws: the picker's preset is a convenience, and failing it would
// block the collection form over a preference.
export async function getMandalDefaultLang(): Promise<Lang> {
  const { data, error } = await supabase.rpc('get_mandal_default_lang')
  if (error) return 'en'
  return toLang(data)
}

// The id filter is defence in depth, not the guard: mandals_admin_update's
// `id = app_mandal_id()` is what actually prevents writing another mandal's
// row. The old `.eq('id', true)` targeted the boolean singleton PK, which
// no longer exists.
export async function updateMandal(id: string, patch: TablesUpdate<'mandals'>): Promise<void> {
  const { error } = await supabase.from('mandals').update(patch).eq('id', id)
  if (error) throw error
}

// Path is `<mandal_id>/<kind>-<timestamp>.<ext>` — the mandal_assets_admin_write
// policy checks (storage.foldername(name))[1] against app_mandal_id(), so a
// flat path is rejected outright now. upsert:true covers the same-path
// re-upload case; a new timestamp naturally covers the timestamped-path
// case. Caller then calls updateMandal with that URL to point the relevant
// *_url column at it.
export async function uploadMandalAsset(mandalId: string, kind: MandalAssetKind, file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const path = `${mandalId}/${kind}-${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(path, file, { upsert: true })
  if (error) throw error

  const {
    data: { publicUrl },
  } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path)
  return publicUrl
}
