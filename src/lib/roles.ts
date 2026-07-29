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

// Where a member lands once their role is known. Four screens made this same
// decision independently (login, signup, join, resolver) and any one of them
// getting it wrong sends someone into a route their role can't hold — which
// RequireRole bounces, which lands them back where they started.
export function homePathFor(role: string): string {
  return isAdminRole(role) ? '/admin' : '/collect'
}
