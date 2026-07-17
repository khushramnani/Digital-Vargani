// The one pre-membership call in the app: createMandal runs when the caller
// has authenticated but has no `users` row yet, so no RLS policy can apply
// to them. That's why create_mandal is SECURITY DEFINER server-side, and
// why this lives outside config.ts (everything there assumes a resolved
// mandal).
import { supabase } from './client'

// slugHint/state/address stay optional all the way down: passing undefined
// is what lets each RPC `default null` apply (the server derives the slug
// from the name, and blank state/address land as NULL). The onboarding form
// makes state required in the UI, but the wire contract doesn't — an old
// mandal created before this field simply has none.
export async function createMandal(
  mandalName: string,
  adminName: string,
  opts: { slugHint?: string; state?: string; address?: string } = {},
): Promise<string> {
  const { data, error } = await supabase.rpc('create_mandal', {
    mandal_name: mandalName,
    admin_name: adminName,
    slug_hint: opts.slugHint,
    mandal_state: opts.state,
    mandal_address: opts.address,
  })
  if (error) throw error
  return data
}
