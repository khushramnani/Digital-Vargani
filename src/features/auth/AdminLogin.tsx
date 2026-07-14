import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/db/client'
import { strings } from '../../lib/strings'

type Status = 'idle' | 'sending' | 'sent' | 'error'

export function AdminLogin() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('sending')
    setErrorMessage(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })

    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
      return
    }
    setStatus('sent')
  }

  if (status === 'sent') {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-stone-900">{strings.auth.checkEmail}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold text-stone-900">{strings.auth.loginTitle}</h1>
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <label htmlFor="admin-email" className="text-sm text-stone-600">
          {strings.auth.emailLabel}
        </label>
        <input
          id="admin-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-stone-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="rounded bg-orange-700 px-3 py-2 text-white disabled:opacity-50"
        >
          {status === 'sending' ? strings.auth.sending : strings.auth.sendLink}
        </button>
        {status === 'error' && errorMessage && (
          <p role="alert" className="text-sm text-red-700">
            {errorMessage}
          </p>
        )}
      </form>
    </main>
  )
}
