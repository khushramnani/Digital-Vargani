// The one pre-membership call in the app: createMandal runs when the caller
// has authenticated but has no `users` row yet, so no RLS policy can apply
// to them. That's why create_mandal is SECURITY DEFINER server-side, and
// why this lives outside config.ts (everything there assumes a resolved
// mandal).
import { supabase } from './client'

// slugHint is the founder's chosen public link, and stays optional all the
// way down: passing undefined is what lets the RPC's `default null` apply,
// so the server derives a slug from the name instead.
export async function createMandal(mandalName: string, adminName: string, slugHint?: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_mandal', {
    mandal_name: mandalName,
    admin_name: adminName,
    slug_hint: slugHint,
  })
  if (error) throw error
  return data
}
