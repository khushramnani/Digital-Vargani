import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/db/client'
import { strings } from '../../lib/strings'
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold text-stone-900">{strings.volunteers.title}</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border border-stone-300 p-4">
        <label htmlFor="volunteer-name" className="text-sm text-stone-600">
          {strings.volunteers.nameLabel}
        </label>
        <input
          id="volunteer-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        <label htmlFor="volunteer-phone" className="text-sm text-stone-600">
          {strings.volunteers.phoneLabel}
        </label>
        <input
          id="volunteer-phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-orange-700 px-3 py-2 text-white disabled:opacity-50"
        >
          {submitting ? strings.volunteers.adding : strings.volunteers.addButton}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </form>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : volunteers.length === 0 ? (
        <p className="text-stone-400">{strings.volunteers.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {volunteers.map((volunteer) => (
            <li key={volunteer.id} className="rounded border border-stone-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-stone-900">{volunteer.name}</span>
                <span className={volunteer.auth_user_id ? 'text-green-700' : 'text-amber-700'}>
                  {volunteer.auth_user_id ? strings.volunteers.active : strings.volunteers.pending}
                </span>
              </div>
              {volunteer.phone && <p className="text-sm text-stone-600">{volunteer.phone}</p>}
              {!volunteer.auth_user_id && volunteer.invite_token && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    readOnly
                    value={inviteLink(volunteer.invite_token)}
                    aria-label={`${strings.volunteers.copyLink}: ${volunteer.name}`}
                    className="flex-1 rounded border border-stone-300 px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => copyLink(volunteer.id, volunteer.invite_token!)}
                    className="rounded border border-stone-300 px-2 py-1 text-sm text-stone-700"
                  >
                    {copiedId === volunteer.id ? strings.volunteers.copied : strings.volunteers.copyLink}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
