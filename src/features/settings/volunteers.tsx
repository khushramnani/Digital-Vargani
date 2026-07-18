import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/db/client'
import { strings } from '../../lib/strings'
import { AppShell } from '../../components/AppShell'
import { card, field, label as labelCls, btnPrimary, btnGhost, errorText } from '../../components/ui'
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
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Admin-only screen (routed behind RequireRole role="admin"). List +
// create-with-invite-link form only, per the brief: no editing/deleting
// volunteers, no re-invite-generation UI — a lost session is fixed by the
// admin creating a brand-new volunteer invite instead.
export function VolunteersScreen() {
  const [volunteers, setVolunteers] = useState<Volunteer[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

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

  async function copyLink(volunteerId: string, token: string) {
    await navigator.clipboard.writeText(inviteLink(token))
    setCopiedId(volunteerId)
    setTimeout(() => setCopiedId((current) => (current === volunteerId ? null : current)), 2000)
  }

  return (
    <AppShell title={strings.volunteers.title} back={{ to: '/admin', label: strings.admin.dashboardTitle }}>
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
        <label htmlFor="volunteer-phone" className={labelCls}>
          {strings.volunteers.phoneLabel}
        </label>
        <input
          id="volunteer-phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className={field}
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
                <span
                  className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    volunteer.auth_user_id ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {volunteer.auth_user_id ? strings.volunteers.active : strings.volunteers.pending}
                </span>
              </div>
              {volunteer.phone && <p className="mt-0.5 text-sm text-stone-500">{volunteer.phone}</p>}
              {!volunteer.auth_user_id && volunteer.invite_token && (
                <div className="mt-3 flex items-center gap-2">
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
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
      {message}
    </div>
  )
}
