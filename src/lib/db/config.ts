// Typed query module for the single-row mandal_config table + its Storage
// assets. RLS (mandal_config_admin_* / mandal_assets_admin_*, both from
// Task 2 + this task's storage migration) already enforces admin-only
// writes server-side, so nothing here re-checks role — callers just need
// to route the screen behind RequireRole role="admin".
import { supabase } from './client'
import type { Tables, TablesUpdate } from './database.types'

export type MandalConfig = Tables<'mandal_config'>
export type MandalAssetKind = 'logo' | 'signature' | 'upi_qr'

const ASSETS_BUCKET = 'mandal-assets'

export async function getMandalConfig(): Promise<MandalConfig> {
  const { data, error } = await supabase.from('mandal_config').select('*').single()
  if (error) throw error
  return data
}

// id is the boolean PK that's always `true` (single-row table, see Task 2's
// migration) — filtering by it is how the one row gets targeted.
export async function updateMandalConfig(patch: TablesUpdate<'mandal_config'>): Promise<void> {
  const { error } = await supabase.from('mandal_config').update(patch).eq('id', true)
  if (error) throw error
}

// Uploads to a timestamped path (upsert:true covers the same-path
// re-upload case; a new timestamp naturally covers the timestamped-path
// case) and returns the public URL. Caller then calls updateMandalConfig
// with that URL to point the relevant *_url column at it.
export async function uploadMandalAsset(kind: MandalAssetKind, file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
  const path = `${kind}-${Date.now()}.${ext}`

  const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(path, file, { upsert: true })
  if (error) throw error

  const {
    data: { publicUrl },
  } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path)
  return publicUrl
}
