import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  fetchMembers,
  fetchPendingInvites,
  createInvite,
  revokeInvite,
  resendInvite,
  setMemberRole,
  transferOwnership,
  deactivateMember,
  reactivateMember,
  type Member,
  type PendingInvite,
} from '../../lib/db/members'
import { strings } from '../../lib/strings'
import { card, field, label as labelCls, btnPrimary, btnGhost, errorText } from '../../components/ui'
import { Sheet } from '../../components/Sheet'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PhoneInput } from '../../components/PhoneInput'
import { isOwnerRole, isAdminRole } from '../../lib/roles'

const t = strings.members

type Filter = 'all' | 'owner' | 'admins' | 'volunteers'

function matchesFilter(role: string, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'owner') return role === 'owner'
  if (filter === 'admins') return role === 'admin'
  return role === 'volunteer'
}

function inviteLink(token: string): string {
  return `${window.location.origin}/join/${token}`
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

// Replaces admins.tsx + volunteers.tsx: one list, one invite flow, per
// v5's "one coherent system" — every action below is additionally gated
// server-side by the RPC itself (create_invite/set_member_role/etc.), this
// UI-level gating is only about not offering a button that would fail.
export function ManageMembersContent() {
  const { appUser } = useAuth()
  const myRole = appUser?.role ?? ''
  const iAmOwner = isOwnerRole(myRole)

  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const [sheetOpen, setSheetOpen] = useState(false)
  const [inviteRole, setInviteRole] = useState<'admin' | 'volunteer'>('volunteer')
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteLinkReady, setInviteLinkReady] = useState<string | null>(null)

  const [revoking, setRevoking] = useState<PendingInvite | null>(null)
  const [deactivating, setDeactivating] = useState<Member | null>(null)
  const [transferring, setTransferring] = useState<Member | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  async function reload() {
    const [m, i] = await Promise.all([fetchMembers(appUser!.mandal_id), fetchPendingInvites()])
    setMembers(m)
    setInvites(i)
  }

  useEffect(() => {
    // RequireRole guarantees appUser is resolved before this screen ever
    // mounts in production, but guard anyway: reload() now needs
    // appUser.mandal_id, so wait for it rather than dereferencing null.
    if (!appUser) return
    let active = true
    reload()
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [appUser])

  function resetInviteForm() {
    setInviteName('')
    setInviteEmail('')
    setInvitePhone('')
    setInviteRole('volunteer')
    setInviteLinkReady(null)
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInviteSubmitting(true)
    setError(null)
    try {
      const token = await createInvite(inviteRole, inviteName, inviteEmail || undefined, invitePhone || undefined)
      setInviteLinkReady(inviteLink(token))
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInviteSubmitting(false)
    }
  }

  async function handleRevoke() {
    if (!revoking) return
    setRowBusy(revoking.id)
    try {
      await revokeInvite(revoking.id)
      setRevoking(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function handleResend(invite: PendingInvite) {
    setRowBusy(invite.id)
    setError(null)
    try {
      // resend_invite revokes the old link server-side and returns the new
      // raw token exactly once (only its hash is ever stored) — route it
      // into the same "link ready" sheet the invite-creation flow uses, or
      // the admin has nothing to share and the old link is already dead.
      const token = await resendInvite(invite.id)
      setInviteLinkReady(inviteLink(token))
      setSheetOpen(true)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function handleRoleChange(member: Member, role: 'admin' | 'volunteer') {
    setRowBusy(member.id)
    setError(null)
    try {
      await setMemberRole(member.id, role)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function handleTransfer() {
    if (!transferring) return
    setRowBusy(transferring.id)
    try {
      await transferOwnership(transferring.id)
      setTransferring(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function handleDeactivate() {
    if (!deactivating) return
    setRowBusy(deactivating.id)
    try {
      await deactivateMember(deactivating.id)
      setDeactivating(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function handleReactivate(member: Member) {
    setRowBusy(member.id)
    setError(null)
    try {
      await reactivateMember(member.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  const visibleMembers = members.filter((m) => matchesFilter(m.role, filter))
  const visibleInvites = filter === 'all' || filter === 'admins' || filter === 'volunteers'
    ? invites.filter((i) => filter === 'all' || matchesFilter(i.role, filter))
    : []

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {(['all', 'owner', 'admins', 'volunteers'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                filter === f ? 'bg-orange-600 text-white' : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
              }`}
            >
              {f === 'all' ? t.filterAll : f === 'owner' ? t.filterOwner : f === 'admins' ? t.filterAdmins : t.filterVolunteers}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setSheetOpen(true)} className={btnPrimary}>
          {t.inviteButton}
        </button>
      </div>

      {error && (
        <p role="alert" className={`${errorText} mt-3`}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-stone-400">{strings.auth.loading}</p>
      ) : visibleMembers.length === 0 && visibleInvites.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
          {t.empty}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2.5">
          {visibleInvites.map((invite) => (
            <li key={invite.id} className={`${card} p-4`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-semibold text-stone-900">{invite.name}</span>
                  <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500">
                    {invite.role === 'admin' ? t.roleAdmin : t.roleVolunteer}
                  </span>
                </div>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                  {t.statusInvited} · {t.expiresIn(daysUntil(invite.expiresAt))}
                </span>
              </div>
              {(invite.email || invite.phone) && (
                <p className="mt-0.5 text-sm text-stone-500">{[invite.email, invite.phone].filter(Boolean).join(' · ')}</p>
              )}
              <div className="mt-3 flex gap-2">
                {(invite.role === 'volunteer' || iAmOwner) && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleResend(invite)}
                      disabled={rowBusy === invite.id}
                      className={`${btnGhost} px-3 py-1.5 text-xs`}
                    >
                      {t.resendButton}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRevoking(invite)}
                      disabled={rowBusy === invite.id}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      {t.revokeButton}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}

          {visibleMembers.map((member) => (
            <li key={member.id} className={`${card} p-4`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-semibold text-stone-900">{member.name}</span>
                  <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500">
                    {member.role === 'owner' ? t.roleOwner : member.role === 'admin' ? t.roleAdmin : t.roleVolunteer}
                  </span>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    member.active ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-500'
                  }`}
                >
                  {member.active ? t.statusActive : t.statusDeactivated}
                </span>
              </div>
              {(member.email || member.phone) && (
                <p className="mt-0.5 text-sm text-stone-500">{[member.email, member.phone].filter(Boolean).join(' · ')}</p>
              )}

              {iAmOwner && member.role !== 'owner' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {member.role === 'volunteer' ? (
                    <button type="button" onClick={() => handleRoleChange(member, 'admin')} disabled={rowBusy === member.id} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                      {t.makeAdmin}
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => handleRoleChange(member, 'volunteer')} disabled={rowBusy === member.id} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                        {t.makeVolunteer}
                      </button>
                      {member.active && (
                        <button type="button" onClick={() => setTransferring(member)} disabled={rowBusy === member.id} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                          {t.makeOwner}
                        </button>
                      )}
                    </>
                  )}
                  {member.active ? (
                    <button type="button" onClick={() => setDeactivating(member)} disabled={rowBusy === member.id} className="rounded-lg px-2 py-1 text-xs font-semibold text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600">
                      {t.deactivate}
                    </button>
                  ) : (
                    <button type="button" onClick={() => handleReactivate(member)} disabled={rowBusy === member.id} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                      {t.reactivate}
                    </button>
                  )}
                </div>
              )}

              {isAdminRole(myRole) && !iAmOwner && member.role === 'volunteer' && (
                <div className="mt-3">
                  {member.active ? (
                    <button type="button" onClick={() => setDeactivating(member)} disabled={rowBusy === member.id} className="rounded-lg px-2 py-1 text-xs font-semibold text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600">
                      {t.deactivate}
                    </button>
                  ) : (
                    <button type="button" onClick={() => handleReactivate(member)} disabled={rowBusy === member.id} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                      {t.reactivate}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} labelledBy="invite-sheet-title">
        {inviteLinkReady ? (
          <div className="flex flex-col gap-3">
            <h2 id="invite-sheet-title" className="font-display text-lg font-bold text-stone-900">
              {t.linkReadyTitle}
            </h2>
            <input readOnly value={inviteLinkReady} className={`${field} text-sm`} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(inviteLinkReady)}
                className={`flex-1 ${btnGhost}`}
              >
                {t.copyLink}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(inviteLinkReady)}`}
                target="_blank"
                rel="noreferrer"
                className={`flex-1 ${btnPrimary} text-center`}
              >
                {t.shareWhatsApp}
              </a>
            </div>
            <button
              type="button"
              onClick={() => {
                setSheetOpen(false)
                resetInviteForm()
              }}
              className={btnGhost}
            >
              {t.done}
            </button>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="flex flex-col gap-3">
            <h2 id="invite-sheet-title" className="font-display text-lg font-bold text-stone-900">
              {t.inviteSheetTitle}
            </h2>
            <div>
              <span className={labelCls}>{t.roleLabel}</span>
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setInviteRole('volunteer')}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${
                    inviteRole === 'volunteer' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-stone-300 text-stone-600'
                  }`}
                >
                  {t.roleVolunteer}
                </button>
                {iAmOwner && (
                  <button
                    type="button"
                    onClick={() => setInviteRole('admin')}
                    className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ${
                      inviteRole === 'admin' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-stone-300 text-stone-600'
                    }`}
                  >
                    {t.roleAdmin}
                  </button>
                )}
              </div>
            </div>
            <label htmlFor="invite-name" className={labelCls}>
              {t.nameLabel}
            </label>
            <input id="invite-name" required value={inviteName} onChange={(e) => setInviteName(e.target.value)} className={field} />
            <label htmlFor="invite-email" className={labelCls}>
              {t.emailLabel}
            </label>
            <input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className={field} />
            <p className="text-xs text-stone-500">{t.emailHelp}</p>
            <PhoneInput id="invite-phone" label={t.phoneLabel} value={invitePhone} onChange={setInvitePhone} />
            <button type="submit" disabled={inviteSubmitting} className={btnPrimary}>
              {inviteSubmitting ? t.sending : t.sendButton}
            </button>
          </form>
        )}
      </Sheet>

      <ConfirmDialog
        open={revoking !== null}
        title={t.revokeTitle}
        body={t.revokeBody}
        confirmLabel={t.revokeConfirm}
        cancelLabel={strings.void.cancel}
        onConfirm={handleRevoke}
        onCancel={() => setRevoking(null)}
        busy={rowBusy === revoking?.id}
      />
      <ConfirmDialog
        open={deactivating !== null}
        title={t.deactivateTitle}
        body={t.deactivateBody}
        confirmLabel={t.deactivateConfirm}
        cancelLabel={strings.void.cancel}
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivating(null)}
        busy={rowBusy === deactivating?.id}
      />
      <ConfirmDialog
        open={transferring !== null}
        title={t.makeOwnerTitle}
        body={t.makeOwnerBody}
        confirmLabel={t.makeOwnerConfirm}
        cancelLabel={strings.void.cancel}
        onConfirm={handleTransfer}
        onCancel={() => setTransferring(null)}
        busy={rowBusy === transferring?.id}
      />
    </>
  )
}
