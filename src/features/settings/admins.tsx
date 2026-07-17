import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/db/client'
import { strings } from '../../lib/strings'
import type { Tables } from '../../lib/db/database.types'

type Admin = Tables<'users'>

// Same data-fetching shape as volunteers.tsx's fetchVolunteers: a plain
// function (no setState inside) so both the initial-load effect and the
// post-submit refetch each own their own setState calls.
async function fetchAdmins(): Promise<Admin[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'admin')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Admin-only screen (routed behind RequireRole role="admin"). Deliberately
// simpler than volunteers.tsx: an admin's "invite" is just requesting a
// magic link at /login with the email added here (link_admin_account, see
// 20260714121305_add_users_email.sql, links it on first login) — no
// invite_token/copy-link UI needed, unlike a volunteer's token-based invite.
export function AdminsScreen() {
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchAdmins()
      .then((data) => {
        if (active) setAdmins(data)
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
    setError(null)
    setEmailError(null)

    if (!isValidEmail(email)) {
      setEmailError(strings.admins.errors.email)
      return
    }

    setSubmitting(true)
    const { error: insertError } = await supabase.from('users').insert({
      name,
      email,
      role: 'admin',
    })

    setSubmitting(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setName('')
    setEmail('')
    setAdmins(await fetchAdmins())
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold text-stone-900">{strings.admins.title}</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border border-stone-300 p-4">
        <label htmlFor="admin-name" className="text-sm text-stone-600">
          {strings.admins.nameLabel}
        </label>
        <input
          id="admin-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        <label htmlFor="admin-email" className="text-sm text-stone-600">
          {strings.admins.emailLabel}
        </label>
        <input
          id="admin-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        {emailError && (
          <p role="alert" className="text-sm text-red-700">
            {emailError}
          </p>
        )}
        <p className="text-sm text-stone-500">{strings.admins.loginHint}</p>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-orange-700 px-3 py-2 text-white disabled:opacity-50"
        >
          {submitting ? strings.admins.adding : strings.admins.addButton}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </form>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : admins.length === 0 ? (
        <p className="text-stone-400">{strings.admins.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {admins.map((admin) => (
            <li key={admin.id} className="rounded border border-stone-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-stone-900">{admin.name}</span>
                <span className={admin.auth_user_id ? 'text-green-700' : 'text-amber-700'}>
                  {admin.auth_user_id ? strings.admins.active : strings.admins.pending}
                </span>
              </div>
              {admin.email && <p className="text-sm text-stone-600">{admin.email}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
