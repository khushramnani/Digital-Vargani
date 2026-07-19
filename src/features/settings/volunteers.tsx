import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/db/client'
import { strings } from '../../lib/strings'
import { card, field, label as labelCls, btnPrimary, btnGhost, errorText } from '../../components/ui'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PhoneInput } from '../../components/PhoneInput'
import type { Tables } from '../../lib/db/database.types'

type Volunteer = Tables<'users'>

function inviteLink(token: string): string {
  return `${window.location.origin}/invite/${token}`
}

// No setState here — kept as a plain data-fetching function so both the
// initial-load effect and the post-submit refetch can each own their own
// setState calls at their own call sites.
async function fetchVolunteers(): Promise<Volunteer[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'volunteer')
    // Removed volunteers are deactivated, not deleted (their donations must
    // keep their collector), so the list shows only the current team.
    .eq('active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Mints a fresh invite token server-side and clears the old binding, so a
// volunteer who lost their session can re-redeem (audit 2026-07-18 #4).
async function reissueInvite(volunteerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('reissue_invite', { volunteer_id: volunteerId })
  if (error) throw error
  return data
}

// Admin-only content body (rendered inside AdminLayout's console frame at
// /admin/volunteers). List + create-with-invite-link form only, per the brief:
// no editing/deleting volunteers, no re-invite-generation UI — a lost session
// is fixed by the admin creating a brand-new volunteer invite instead.
export function VolunteersContent() {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [reissuingId, setReissuingId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Volunteer | null>(null)
  const [removingBusy, setRemovingBusy] = useState(false)

  useEffect(() => {
    let active = true
    fetchVolunteers()
      .then((data) => {
        if (active) setVolunteers(data)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.from('users').insert({
      name,
      phone: phone || null,
      role: 'volunteer',
      invite_token: crypto.randomUUID(),
    })

    setSubmitting(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setName('')
    setPhone('')
    setVolunteers(await fetchVolunteers())
  }

  // Removing a volunteer DEACTIVATES them rather than deleting the row:
  // donations.collected_by references users(id), so a hard delete would either
  // be refused or orphan money records. active=false is a real revocation —
  // app_user_id()/app_user_role()/app_mandal_id() are all gated on `active`
  // (audit v3), so their session loses every permission immediately — while the
  // donations they already collected stay attributed and keep the books
  // balanced. Clearing invite_token also kills any link already sent.
  async function handleRemove() {
    if (!removing) return
    setRemovingBusy(true)
    setError(null)
    const { error: removeError } = await supabase
      .from('users')
      .update({ active: false, invite_token: null })
      .eq('id', removing.id)
    setRemovingBusy(false)
    if (removeError) {
      setError(removeError.message)
      return
    }
    setRemoving(null)
    setVolunteers(await fetchVolunteers())
  }

  async function copyLink(volunteerId: string, token: string) {
    await navigator.clipboard.writeText(inviteLink(token))
    setCopiedId(volunteerId)
    setTimeout(() => setCopiedId((current) => (current === volunteerId ? null : current)), 2000)
  }

  async function handleReissue(volunteerId: string) {
    setReissuingId(volunteerId)
    setError(null)
    try {
      const token = await reissueInvite(volunteerId)
      // Reflect the reset locally: the volunteer becomes "pending" again with
      // the new link shown, no refetch needed.
      setVolunteers((current) =>
        current.map((v) => (v.id === volunteerId ? { ...v, invite_token: token, auth_user_id: null } : v)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setReissuingId(null)
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className={`flex flex-col gap-3 ${card} p-5`}>
        <label htmlFor="volunteer-name" className={labelCls}>
          {strings.volunteers.nameLabel}
        </label>
        <input
          id="volunteer-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={field}
        />
        {/* v4 §3: E.164 phone via the country-picker input (kills the silent +91). */}
        <PhoneInput
          id="volunteer-phone"
          label={strings.volunteers.phoneLabel}
          value={phone}
          onChange={setPhone}
        />
        <button type="submit" disabled={submitting} className={btnPrimary}>
          {submitting ? strings.volunteers.adding : strings.volunteers.addButton}
        </button>
        {error && (
          <p role="alert" className={errorText}>
            {error}
          </p>
        )}
      </form>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : volunteers.length === 0 ? (
        <EmptyState message={strings.volunteers.empty} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {volunteers.map((volunteer) => (
            <li key={volunteer.id} className={`${card} p-4`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-stone-900">{volunteer.name}</span>
                <div className="flex flex-none items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      volunteer.auth_user_id ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {volunteer.auth_user_id ? strings.volunteers.active : strings.volunteers.pending}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRemoving(volunteer)}
                    aria-label={`${strings.volunteers.removeButton}: ${volunteer.name}`}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    {strings.volunteers.removeButton}
                  </button>
                </div>
              </div>
              {volunteer.phone && <p className="mt-0.5 text-sm text-stone-500">{volunteer.phone}</p>}
              {!volunteer.auth_user_id && volunteer.invite_token ? (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={inviteLink(volunteer.invite_token)}
                      aria-label={`${strings.volunteers.copyLink}: ${volunteer.name}`}
                      className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm text-stone-500"
                    />
                    <button
                      type="button"
                      onClick={() => copyLink(volunteer.id, volunteer.invite_token!)}
                      className={`flex-none ${btnGhost} px-3 py-1.5`}
                    >
                      {copiedId === volunteer.id ? strings.volunteers.copied : strings.volunteers.copyLink}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleReissue(volunteer.id)}
                    disabled={reissuingId === volunteer.id}
                    className="self-start text-xs font-semibold text-stone-500 hover:text-stone-700 disabled:opacity-50"
                  >
                    {reissuingId === volunteer.id ? strings.volunteers.regenerating : strings.volunteers.regenerate}
                  </button>
                </div>
              ) : volunteer.auth_user_id ? (
                <div className="mt-3 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleReissue(volunteer.id)}
                    disabled={reissuingId === volunteer.id}
                    className={`self-start ${btnGhost} px-3 py-1.5`}
                  >
                    {reissuingId === volunteer.id ? strings.volunteers.regenerating : strings.volunteers.resetInvite}
                  </button>
                  <p className="text-xs leading-relaxed text-stone-400">{strings.volunteers.resetHint}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={strings.volunteers.removeTitle}
        body={strings.volunteers.removeBody}
        confirmLabel={strings.volunteers.removeConfirm}
        cancelLabel={strings.void.cancel}
        onConfirm={handleRemove}
        onCancel={() => setRemoving(null)}
        busy={removingBusy}
      />
    </>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
      {message}
    </div>
  )
}
