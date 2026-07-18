import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/db/client'
import { strings } from '../../lib/strings'
import { AppShell } from '../../components/AppShell'
import { card, field, label as labelCls, btnPrimary, errorText } from '../../components/ui'
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
    <AppShell title={strings.admins.title} back={{ to: '/admin', label: strings.admin.dashboardTitle }}>
      <form onSubmit={handleSubmit} className={`flex flex-col gap-3 ${card} p-5`}>
        <label htmlFor="admin-name" className={labelCls}>
          {strings.admins.nameLabel}
        </label>
        <input
          id="admin-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={field}
        />
        <label htmlFor="admin-email" className={labelCls}>
          {strings.admins.emailLabel}
        </label>
        <input
          id="admin-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={field}
        />
        {emailError && (
          <p role="alert" className={errorText}>
            {emailError}
          </p>
        )}
        <p className="text-[13px] leading-relaxed text-stone-500">{strings.admins.loginHint}</p>
        <button type="submit" disabled={submitting} className={btnPrimary}>
          {submitting ? strings.admins.adding : strings.admins.addButton}
        </button>
        {error && (
          <p role="alert" className={errorText}>
            {error}
          </p>
        )}
      </form>

      {loading ? (
        <p className="text-stone-400">{strings.auth.loading}</p>
      ) : admins.length === 0 ? (
        <EmptyState message={strings.admins.empty} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {admins.map((admin) => (
            <li key={admin.id} className={`${card} p-4`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-stone-900">{admin.name}</span>
                <StatusPill active={!!admin.auth_user_id} activeLabel={strings.admins.active} pendingLabel={strings.admins.pending} />
              </div>
              {admin.email && <p className="mt-0.5 text-sm text-stone-500">{admin.email}</p>}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  )
}

function StatusPill({ active, activeLabel, pendingLabel }: { active: boolean; activeLabel: string; pendingLabel: string }) {
  return (
    <span
      className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        active ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
      }`}
    >
      {active ? activeLabel : pendingLabel}
    </span>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-12 text-center text-stone-400">
      {message}
    </div>
  )
}
