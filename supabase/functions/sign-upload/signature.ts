// Cloudinary's upload-signature algorithm, per
// https://cloudinary.com/documentation/signatures. Pure and I/O-free so
// Vitest can reach it: `supabase functions serve` needs Docker, which this
// machine doesn't have, so index.ts is untestable locally and everything
// worth testing lives here instead.
//
// Uses Web Crypto, which exists in both Deno (the Edge runtime) and Node 18+
// (Vitest) — one implementation, two runtimes, no duplication.

// Sent in the upload POST but never signed; signing one yields an "Invalid
// Signature" from Cloudinary that only shows up on a real upload.
const NEVER_SIGNED = new Set(['file', 'cloud_name', 'resource_type', 'api_key'])

export function buildStringToSign(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((key) => !NEVER_SIGNED.has(key))
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
}

// SHA-1 is Cloudinary's default signature algorithm.
export async function signParams(params: Record<string, string>, apiSecret: string): Promise<string> {
  const toSign = buildStringToSign(params) + apiSecret
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(toSign))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
