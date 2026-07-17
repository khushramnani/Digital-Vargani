// Typed query module for the mandals table + its Storage assets. RLS
// (mandals_admin_* / mandal_assets_admin_*) already enforces admin-only,
// same-mandal writes server-side, so nothing here re-checks role or
// mandal — callers just route the screen behind RequireRole role="admin".
import { toLang, type Lang } from '../i18n/receipt'
import { supabase } from './client'
import type { Tables, TablesUpdate } from './database.types'

export type Mandal = Tables<'mandals'>
export type MandalAssetKind = 'logo' | 'signature' | 'upi_qr'

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

// Uploads straight to Cloudinary, authorised by the sign-upload edge
// function. Two reasons it goes through the function rather than an unsigned
// preset: the API secret never reaches the browser, and the upload folder is
// derived from the caller's JWT server-side — an unsigned preset would be an
// open upload endpoint anyone reading this bundle could spam.
//
// `mandalId`/`kind` are kept in the signature for call-site clarity but are
// NOT trusted and NOT read here (underscored) — the function signs its own
// folder from the session. If they disagree, the server wins. `public_id` is
// deliberately omitted — an unsigned public_id would make Cloudinary reject
// the signature, and the folder already scopes the asset. Old Supabase
// Storage URLs in *_url columns keep rendering — they're just strings, and
// nothing here touches them.
export async function uploadMandalAsset(_mandalId: string, _kind: MandalAssetKind, file: File): Promise<string> {
  const { data: sig, error } = await supabase.functions.invoke('sign-upload')
  if (error) throw error

  const form = new FormData()
  form.append('file', file)
  form.append('api_key', sig.api_key)
  form.append('timestamp', sig.timestamp)
  form.append('folder', sig.folder)
  form.append('signature', sig.signature)

  const response = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) throw new Error(`Cloudinary upload failed (${response.status})`)

  const { secure_url } = await response.json()
  return secure_url
}
