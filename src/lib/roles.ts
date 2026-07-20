// One 'owner or admin' check, reused everywhere role gating used to write
// `role === 'admin'` — the exact string check every one of those call sites
// silently broke the moment 'owner' became a real third role. One function
// instead of `role === 'owner' || role === 'admin'` copy-pasted at each site.
export type Role = 'owner' | 'admin' | 'volunteer'

export function isAdminRole(role: string): boolean {
  return role === 'owner' || role === 'admin'
}

export function isOwnerRole(role: string): boolean {
  return role === 'owner'
}
