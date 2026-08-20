import { useEffect, useState } from 'react'
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
import { Sheet } from '../../components/Sheet'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PhoneInput } from '../../components/PhoneInput'
import { LetterAvatar, SearchField, SheetHeader } from '../../components/console'
import { HowToSheet } from '../admin/HowToSheet'
import { isOwnerRole, isAdminRole } from '../../lib/roles'
import { formatInviteCode } from '../../lib/inviteCode'
import {
  btnRow,
  btnRowGreen,
  choiceButton,
  consoleField,
  ctaDanger,
  ctaInk,
  ctaMuted,
  ctaOrange,
  ctaQuiet,
  errorText,
  eyebrow,
  eyebrowOnDark,
  hero,
  infoRoundOnDark,
  moneyHero,
  panel,
  panelTitle,
  pill,
} from '../../components/ui'

const t = strings.members

type Filter = 'all' | 'owner' | 'admins' | 'volunteers'
const FILTERS: Filter[] = ['all', 'owner', 'admins', 'volunteers']

function matchesFilter(role: string, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'owner') return role === 'owner'
  if (filter === 'admins') return role === 'admin'
  return role === 'volunteer'
}

function inviteLink(token: string): string {
  return `${window.location.origin}/join/${token}`
}

// An invite is two interchangeable halves. The link is for WhatsApp; the
// code is for the volunteer standing in front of you, or a phone call. The
// server returns both exactly once, so this sheet is the only chance to
// capture them — losing either means a resend.
type ReadyInvite = { link: string; code: string }

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

const roleLabel = (role: string) => (role === 'owner' ? t.roleOwner : role === 'admin' ? t.roleAdmin : t.roleVolunteer)

// Replaces admins.tsx + volunteers.tsx: one list, one invite flow, per v5's "one
// coherent system" — every action below is additionally gated server-side by the
// RPC itself (create_invite/set_member_role/etc.), this UI-level gating is only
// about not offering a button that would fail.
//
// Redesign 2026-08-18: the design's Members tab — a team hero, role filter pills,
// a search box, pending invites in their own warm card, and each member's actions
// moved off the row and into a sheet, so a list of ten people is a list rather
// than forty buttons.
export function ManageMembersContent() {
  const { appUser } = useAuth()
  const myRole = appUser?.role ?? ''
  const iAmOwner = isOwnerRole(myRole)

  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const [sheet, setSheet] = useState<'invite' | 'howto' | null>(null)
  const [inviteRole, setInviteRole] = useState<'admin' | 'volunteer'>('volunteer')
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteReady, setInviteReady] = useState<ReadyInvite | null>(null)
  const [copied, setCopied] = useState(false)

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [selectedInviteId, setSelectedInviteId] = useState<string | null>(null)
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
    // RequireRole guarantees appUser is resolved before this screen ever mounts
    // in production, but guard anyway: reload() needs appUser.mandal_id.
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
    setInviteReady(null)
  }

  async function handleInvite() {
    setInviteSubmitting(true)
    setError(null)
    try {
      const invite = await createInvite(inviteRole, inviteName, inviteEmail, invitePhone || undefined)
      setInviteReady({ link: inviteLink(invite.token), code: invite.code })
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
      setSelectedInviteId(null)
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
      // resend_invite revokes the old link server-side and returns the new raw
      // token exactly once (only its hash is ever stored) — route it into the
      // same "link ready" sheet the invite-creation flow uses, or the admin has
      // nothing to share and the old link is already dead.
      const fresh = await resendInvite(invite.id)
      setInviteReady({ link: inviteLink(fresh.token), code: fresh.code })
      setSelectedInviteId(null)
      setSheet('invite')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function withRow<T>(id: string, action: () => Promise<T>) {
    setRowBusy(id)
    setError(null)
    try {
      await action()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRowBusy(null)
    }
  }

  const q = search.trim().toLowerCase()
  const matchesSearch = (name: string, email: string | null, phone: string | null) => {
    if (q === '') return true
    const digits = q.replace(/\D/g, '')
    return (
      name.toLowerCase().includes(q) ||
      (email ?? '').toLowerCase().includes(q) ||
      (digits !== '' && (phone ?? '').replace(/\D/g, '').includes(digits))
    )
  }

  const visibleMembers = members.filter(
    (m) => matchesFilter(m.role, filter) && matchesSearch(m.name, m.email, m.phone),
  )
  // Owner is a single person who is already a member, so the owner filter never
  // has invites to show.
  const visibleInvites =
    filter === 'owner'
      ? []
      : invites.filter((i) => matchesFilter(i.role, filter) && matchesSearch(i.name, i.email, i.phone))

  const counts = {
    owner: members.filter((m) => m.role === 'owner').length,
    admins: members.filter((m) => m.role === 'admin').length,
    volunteers: members.filter((m) => m.role === 'volunteer').length,
    off: members.filter((m) => !m.active).length,
  }
  const teamBits = [
    ...(counts.owner ? [t.teamBits.owner(counts.owner)] : []),
    ...(counts.admins ? [t.teamBits.admins(counts.admins)] : []),
    ...(counts.volunteers ? [t.teamBits.volunteers(counts.volunteers)] : []),
    ...(counts.off ? [t.teamBits.deactivated(counts.off)] : []),
  ]

  const selectedMember = members.find((m) => m.id === selectedMemberId) ?? null
  const selectedInvite = invites.find((i) => i.id === selectedInviteId) ?? null

  return (
    <>
      <div className={hero}>
        <div className="flex items-center gap-2">
          <span className={eyebrowOnDark}>{t.teamEyebrow}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setSheet('howto')}
            aria-label={strings.admin.howToEyebrow}
            className={`${infoRoundOnDark} -mt-0.5 h-[26px] w-[26px] text-xs`}
          >
            i
          </button>
        </div>
        <p className={`${moneyHero} mt-1 mb-0.5`}>
          {members.length}
          <span className="text-[17px] font-semibold text-stone-400">{t.inTheMandalSuffix}</span>
        </p>
        <p className="text-[11.5px] font-medium text-stone-400">{teamBits.join(' · ')}</p>
      </div>

      <div className="-mx-4 flex gap-[7px] overflow-x-auto px-4 pt-px pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={pill(filter === f)}
          >
            {f === 'all'
              ? `${t.filterAll} ${members.length}`
              : f === 'owner'
                ? t.filterOwner
                : f === 'admins'
                  ? `${t.filterAdmins} ${counts.admins}`
                  : `${t.filterVolunteers} ${counts.volunteers}`}
          </button>
        ))}
      </div>

      <SearchField value={search} onChange={setSearch} placeholder={t.searchPlaceholder} />

      <button type="button" onClick={() => setSheet('invite')} className={ctaInk}>
        {t.inviteButton}
      </button>

      {error && (
        <p role="alert" className={`rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 ${errorText}`}>
          {error}
        </p>
      )}

      {visibleInvites.length > 0 && (
        <div className="rounded-[18px] border border-warm-border bg-warm p-[15px]">
          <div className="flex items-baseline justify-between gap-2.5">
            <h2 className={`${panelTitle} text-warm-ink`}>{t.pendingInvitesTitle}</h2>
            <span className="text-[11px] font-semibold text-warm-muted">{t.waitingCount(visibleInvites.length)}</span>
          </div>
          <div className="flex flex-col">
            {visibleInvites.map((invite) => (
              <button
                key={invite.id}
                type="button"
                onClick={() => setSelectedInviteId(invite.id)}
                className="mt-0.5 flex items-center gap-[11px] border-t border-warm-line py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-[7px]">
                    <span className="text-[13.5px] font-bold text-stone-900">{invite.name}</span>
                    <span className="rounded-full bg-warm-line px-[7px] py-0.5 text-[10px] font-semibold text-warm-ink">
                      {roleLabel(invite.role)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] font-medium text-warm-muted">
                    {t.invitedMeta(roleLabel(invite.role), daysUntil(invite.expiresAt))}
                  </span>
                </span>
                {invite.code && (
                  <span className="flex-none text-[13px] font-bold tracking-[0.16em] text-warm-ink">
                    {formatInviteCode(invite.code)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : visibleMembers.length === 0 && visibleInvites.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
          {members.length === 0 ? t.empty : t.noneMatch}
        </div>
      ) : (
        <div className={panel}>
          <div className="flex flex-col">
            {visibleMembers.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => setSelectedMemberId(member.id)}
                className="flex items-center gap-[11px] border-t border-stone-100 py-3 text-left transition-colors first:border-0 hover:bg-stone-50"
              >
                <LetterAvatar name={member.name} muted={!member.active} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-[7px]">
                    <span
                      className={`truncate text-sm font-bold ${member.active ? 'text-stone-900' : 'text-stone-400'}`}
                    >
                      {member.name}
                    </span>
                    <span
                      className={`flex-none rounded-full bg-stone-100 px-[7px] py-0.5 text-[10px] font-semibold ${
                        member.active ? 'text-stone-600' : 'text-stone-400'
                      }`}
                    >
                      {roleLabel(member.role)}
                    </span>
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-[11.5px] font-medium ${member.active ? 'text-stone-400' : 'text-faint'}`}
                  >
                    {member.active ? '' : t.deactivatedPrefix}
                    {[member.email, member.phone].filter(Boolean).join(' · ') || t.noContact}
                  </span>
                </span>
                {member.active && <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-full bg-green-600" />}
                <span aria-hidden="true" className="flex-none text-base text-stone-300">
                  ›
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Invite: form, then the one-shot link+code. */}
      <Sheet
        open={sheet === 'invite'}
        onClose={() => {
          setSheet(null)
          resetInviteForm()
        }}
        labelledBy="invite-sheet-title"
      >
        {inviteReady ? (
          <>
            <SheetHeader
              title={t.linkReadyTitle}
              titleId="invite-sheet-title"
              hint={`${t.readyForPrefix}${inviteName || t.roleVolunteer}`}
              onClose={() => {
                setSheet(null)
                resetInviteForm()
              }}
              closeLabel={strings.app.close}
            />
            <p className="mt-4 rounded-[13px] border border-hairline bg-stone-50 px-[13px] py-3 text-xs font-medium break-all text-stone-600">
              {inviteReady.link}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteReady.link)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className={`${btnRow} h-11 flex-1`}
              >
                {copied ? strings.app.copied : t.copyLink}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(inviteReady.link)}`}
                target="_blank"
                rel="noreferrer"
                className={`${btnRowGreen} flex h-11 flex-1 items-center justify-center`}
              >
                {t.shareWhatsApp}
              </a>
            </div>
            <div className="mt-3.5 rounded-[14px] border border-hairline bg-stone-50 px-3.5 py-4 text-center">
              <p className={eyebrow}>{t.orReadCode}</p>
              <p className="font-display mt-1 text-[26px] font-extrabold tracking-[0.18em] text-stone-900">
                {formatInviteCode(inviteReady.code)}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed font-medium text-stone-400 text-pretty">
                {t.codeFootnote}
              </p>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(formatInviteCode(inviteReady.code))}
                className="mt-2 text-sm font-semibold text-orange-600 transition-colors hover:text-orange-700"
              >
                {t.copyCode}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setSheet(null)
                resetInviteForm()
              }}
              className={`mt-4 ${ctaInk}`}
            >
              {t.done}
            </button>
          </>
        ) : (
          <>
            <SheetHeader
              title={t.inviteSheetTitle}
              titleId="invite-sheet-title"
              hint={t.inviteHint}
              onClose={() => setSheet(null)}
              closeLabel={strings.app.close}
            />

            <p className={`${eyebrow} mt-[18px] mb-2`}>{t.roleLabel}</p>
            <div role="group" aria-label={t.roleLabel} className="flex gap-2">
              <button
                type="button"
                aria-pressed={inviteRole === 'volunteer'}
                onClick={() => setInviteRole('volunteer')}
                className={choiceButton(inviteRole === 'volunteer')}
              >
                {t.roleVolunteer}
              </button>
              {/* create_invite only lets an owner mint an admin invite, so an
                  admin is not offered a role the RPC would refuse. */}
              {iAmOwner && (
                <button
                  type="button"
                  aria-pressed={inviteRole === 'admin'}
                  onClick={() => setInviteRole('admin')}
                  className={choiceButton(inviteRole === 'admin')}
                >
                  {t.roleAdmin}
                </button>
              )}
            </div>

            <label htmlFor="invite-name" className={`${eyebrow} mt-4 mb-2 block`}>
              {t.nameLabel}
            </label>
            <input
              id="invite-name"
              value={inviteName}
              placeholder={t.namePlaceholder}
              onChange={(e) => setInviteName(e.target.value)}
              className={consoleField}
            />

            <label htmlFor="invite-email" className={`${eyebrow} mt-4 mb-2 block`}>
              {t.emailLabel}
            </label>
            <input
              id="invite-email"
              type="email"
              value={inviteEmail}
              placeholder={t.emailPlaceholder}
              onChange={(e) => setInviteEmail(e.target.value)}
              className={consoleField}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed font-medium text-stone-400 text-pretty">{t.emailHelp}</p>

            <div className="mt-4">
              <PhoneInput
                id="invite-phone"
                label={t.phoneOptionalLabel}
                value={invitePhone}
                onChange={setInvitePhone}
                placeholder={t.phonePlaceholder}
              />
            </div>

            <button
              type="button"
              onClick={() => void handleInvite()}
              disabled={inviteSubmitting || inviteName.trim() === '' || inviteEmail.trim() === ''}
              className={`mt-[18px] ${inviteName.trim() !== '' && inviteEmail.trim() !== '' && !inviteSubmitting ? ctaOrange : ctaMuted}`}
            >
              {inviteSubmitting ? t.sending : t.sendButton}
            </button>
          </>
        )}
      </Sheet>

      {/* A member's actions live here rather than on the row: ten people on a
          360px screen otherwise means forty buttons. */}
      {selectedMember && (
        <Sheet open onClose={() => setSelectedMemberId(null)} labelledBy="member-sheet-title">
          <SheetHeader
            title={selectedMember.name}
            titleId="member-sheet-title"
            hint={`${roleLabel(selectedMember.role)} · ${selectedMember.active ? t.statusActive : t.statusDeactivated}`}
            onClose={() => setSelectedMemberId(null)}
            closeLabel={strings.app.close}
          >
            <LetterAvatar name={selectedMember.name} muted={!selectedMember.active} size={44} />
          </SheetHeader>

          <div className="mt-4 rounded-[14px] border border-hairline bg-stone-50 px-[13px] py-3">
            <p className="text-[12.5px] font-medium break-all text-stone-700">{selectedMember.email || t.noEmail}</p>
            <p className="mt-0.5 text-[12.5px] font-medium tabular-nums text-stone-500">
              {selectedMember.phone || t.noPhone}
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {selectedMember.role === 'owner' ? (
              <p className="text-xs leading-relaxed font-medium text-stone-400 text-pretty">{t.ownerRowNote}</p>
            ) : (
              <>
                {iAmOwner && selectedMember.role === 'volunteer' && (
                  <button
                    type="button"
                    disabled={rowBusy === selectedMember.id}
                    onClick={() =>
                      void withRow(selectedMember.id, () => setMemberRole(selectedMember.id, 'admin')).then(() =>
                        setSelectedMemberId(null),
                      )
                    }
                    className={`${ctaQuiet} border border-stone-200 bg-white`}
                  >
                    {t.makeAdmin}
                  </button>
                )}
                {iAmOwner && selectedMember.role === 'admin' && (
                  <>
                    <button
                      type="button"
                      disabled={rowBusy === selectedMember.id}
                      onClick={() =>
                        void withRow(selectedMember.id, () => setMemberRole(selectedMember.id, 'volunteer')).then(() =>
                          setSelectedMemberId(null),
                        )
                      }
                      className={`${ctaQuiet} border border-stone-200 bg-white`}
                    >
                      {t.makeVolunteer}
                    </button>
                    {selectedMember.active && (
                      <button
                        type="button"
                        disabled={rowBusy === selectedMember.id}
                        onClick={() => {
                          setTransferring(selectedMember)
                          setSelectedMemberId(null)
                        }}
                        className={`${ctaQuiet} border border-stone-200 bg-white`}
                      >
                        {t.makeOwner}
                      </button>
                    )}
                  </>
                )}
                {/* An admin may deactivate a volunteer; only the owner may touch
                    another admin. Both mirror the RPC's own gate. */}
                {(iAmOwner || (isAdminRole(myRole) && selectedMember.role === 'volunteer')) &&
                  (selectedMember.active ? (
                    <button
                      type="button"
                      disabled={rowBusy === selectedMember.id}
                      onClick={() => {
                        setDeactivating(selectedMember)
                        setSelectedMemberId(null)
                      }}
                      className={ctaDanger}
                    >
                      {t.deactivate}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={rowBusy === selectedMember.id}
                      onClick={() =>
                        void withRow(selectedMember.id, () => reactivateMember(selectedMember.id)).then(() =>
                          setSelectedMemberId(null),
                        )
                      }
                      className={ctaInk}
                    >
                      {t.reactivate}
                    </button>
                  ))}
              </>
            )}
          </div>
        </Sheet>
      )}

      {selectedInvite && (
        <Sheet open onClose={() => setSelectedInviteId(null)} labelledBy="invite-detail-title">
          <SheetHeader
            title={selectedInvite.name}
            titleId="invite-detail-title"
            hint={t.invitedMeta(roleLabel(selectedInvite.role), daysUntil(selectedInvite.expiresAt))}
            onClose={() => setSelectedInviteId(null)}
            closeLabel={strings.app.close}
          />

          {selectedInvite.code && (
            <div className="mt-4 rounded-[14px] border border-warm-border bg-warm px-3.5 py-4 text-center">
              <p className="text-[9.5px] font-bold tracking-[0.14em] text-warm-muted uppercase">{t.codeLabel}</p>
              <p className="font-display mt-1 text-[26px] font-extrabold tracking-[0.18em] text-warm-ink">
                {formatInviteCode(selectedInvite.code)}
              </p>
            </div>
          )}
          <p className="mt-3 text-xs font-medium break-all text-stone-500">
            {[selectedInvite.email, selectedInvite.phone].filter(Boolean).join(' · ') || t.noContact}
          </p>

          {/* An admin can only manage a volunteer's invite; an admin invite is
              the owner's to resend or revoke — same gate as the RPC. */}
          {(selectedInvite.role === 'volunteer' || iAmOwner) && (
            <>
              <button
                type="button"
                disabled={rowBusy === selectedInvite.id}
                onClick={() => void handleResend(selectedInvite)}
                className={`mt-3.5 ${ctaQuiet} border border-stone-200 bg-white`}
              >
                {t.resendLong}
              </button>
              <button
                type="button"
                disabled={rowBusy === selectedInvite.id}
                onClick={() => {
                  setRevoking(selectedInvite)
                  setSelectedInviteId(null)
                }}
                className={`mt-2 ${ctaDanger}`}
              >
                {t.revokeButton}
              </button>
            </>
          )}
        </Sheet>
      )}

      <HowToSheet tab="members" open={sheet === 'howto'} onClose={() => setSheet(null)} />

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
        onConfirm={() => {
          const member = deactivating
          if (!member) return
          setDeactivating(null)
          void withRow(member.id, () => deactivateMember(member.id))
        }}
        onCancel={() => setDeactivating(null)}
        busy={rowBusy === deactivating?.id}
      />
      <ConfirmDialog
        open={transferring !== null}
        title={t.makeOwnerTitle}
        body={t.makeOwnerBody}
        confirmLabel={t.makeOwnerConfirm}
        cancelLabel={strings.void.cancel}
        onConfirm={() => {
          const member = transferring
          if (!member) return
          setTransferring(null)
          void withRow(member.id, () => transferOwnership(member.id))
        }}
        onCancel={() => setTransferring(null)}
        busy={rowBusy === transferring?.id}
      />
    </>
  )
}
