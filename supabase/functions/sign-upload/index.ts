// Authorises a Cloudinary upload for the calling admin's own mandal.
//
// The API secret lives here and never reaches the browser — that's the whole
// reason this function exists rather than an unsigned upload preset (which
// would be an open upload endpoint anyone could spam).
//
// Deliberately thin: `supabase functions serve` needs Docker, which the dev
// machine doesn't have, so nothing here is unit-tested. Everything with real
// logic is in ./signature.ts, which is. What's left is auth + plumbing, and
// it's verified by a real upload.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { signParams } from './signature.ts'

// Browser calls (supabase.functions.invoke from the app) are cross-origin, so
// the browser sends a preflight OPTIONS first and reads CORS headers off every
// response. Without these the upload fails with "Failed to send a request to
// the Edge Function". Origin '*' is fine — auth is enforced by the JWT check
// below, not by the origin. This function is deployed with verify_jwt = false
// (see config.toml) precisely so the platform lets the un-authenticated
// preflight through to us; we still authenticate every real request here.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('missing authorization', { status: 401, headers: corsHeaders })

  // Resolve the caller with THEIR jwt, so RLS applies exactly as it would in
  // the browser — users_self_select is what lets them read their own row.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: authUser } = await supabase.auth.getUser()
  if (!authUser?.user) return new Response('not authenticated', { status: 401, headers: corsHeaders })

  const { data: appUser } = await supabase
    .from('users')
    .select('mandal_id, role, active')
    .eq('auth_user_id', authUser.user.id)
    .maybeSingle()

  // Only an active admin of some mandal may upload branding for it.
  if (!appUser || !appUser.active || appUser.role !== 'admin') {
    return new Response('admin only', { status: 403, headers: corsHeaders })
  }

  // The folder comes from the caller's OWN row — never from the request body.
  // Same rule enforce_insert_defaults() applies to mandal_id: a client that
  // asks to write into another mandal's folder is simply ignored, not obeyed.
  const folder = `mandals/${appUser.mandal_id}`
  const timestamp = Math.round(Date.now() / 1000).toString()

  const signature = await signParams({ folder, timestamp }, Deno.env.get('CLOUDINARY_API_SECRET')!)

  return new Response(
    JSON.stringify({
      signature,
      timestamp,
      folder,
      api_key: Deno.env.get('CLOUDINARY_API_KEY')!,
      cloud_name: Deno.env.get('CLOUDINARY_CLOUD_NAME')!,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
