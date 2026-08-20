import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Tables } from '../src/lib/db/database.types'
import { CollectionForm } from '../src/features/collection/CollectionForm'

// Per the brief: mock src/lib/db/donations.ts directly (not the raw
// Supabase client) — this is a component test of the form's behavior, and
// mock useAuth so appUser is a fixed, non-editable session identity, the
// same way every prior screen's tests mock only what the component itself
// calls. markSmsSent (send.ts's markSmsSent is re-exported from this module)
// is mocked because CollectionForm reaches it through the send helpers — but
// only when a send button is tapped. Audit v3 removed the on-submit auto-fire,
// so a bare submit no longer calls it.
// Task 10: CollectionForm no longer calls createDonation directly — it goes
// through the offline queue (enqueueDonation/syncOutboxItem from
// src/lib/queue/sync), which is mocked here instead so this test doesn't
// need real IndexedDB (jsdom doesn't implement it).
const { markSmsSent, getDonations } = vi.hoisted(() => ({
  markSmsSent: vi.fn(),
  // CollectionForm now reads the volunteer's own donations to compute the
  // "₹X today · N donors" greeting chip. Default to an empty ledger.
  getDonations: vi.fn(),
}))

vi.mock('../src/lib/db/donations', () => ({
  markSmsSent,
  getDonations,
}))

const { enqueueDonation, syncOutboxItem } = vi.hoisted(() => ({
  enqueueDonation: vi.fn(),
  syncOutboxItem: vi.fn(),
}))

vi.mock('../src/lib/queue/sync', () => ({
  enqueueDonation,
  syncOutboxItem,
}))

// CollectionForm presets the language picker from the mandal default and, since
// plan 2026-08-18 §1, reads the mandal's own donation-source list through the
// get_donation_sources RPC. Mocked so the test never touches the real supabase
// client (this file doesn't mock ../src/lib/db/client) and the list is fixed.
const { getMandalDefaultLang, getDonationSources, getMandal, addDonationSource, updateMandal } = vi.hoisted(() => ({
  getMandalDefaultLang: vi.fn(),
  getDonationSources: vi.fn(),
  getMandal: vi.fn(),
  addDonationSource: vi.fn(),
  updateMandal: vi.fn(),
}))

vi.mock('../src/lib/db/config', () => ({
  getMandalDefaultLang,
  getDonationSources,
  getMandal,
  addDonationSource,
  updateMandal,
}))

const volunteer: Tables<'users'> = {
  id: 'volunteer-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  name: 'Sita Volunteer',
  phone: null,
  email: null,
  role: 'volunteer',
  auth_user_id: 'auth-uid-1',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
}

vi.mock('../src/features/auth/useAuth', () => ({
  useAuth: () => ({
    session: { user: { id: 'auth-uid-1' } },
    appUser: volunteer,
    loading: false,
    refreshAppUser: vi.fn(),
  }),
}))

const createdDonation: Tables<'donations'> = {
  id: 'donation-1',
  mandal_id: '11111111-1111-1111-1111-000000000001',
  receipt_no: 42,
  public_token: 'tok-abc',
  donor_name: 'Ramesh Kulkarni',
  donor_phone: '9876543210',
  amount_paise: 50100,
  mode: 'cash',
  category: 'Society',
  collected_by: 'volunteer-1',
  created_at: '2026-01-01T00:00:00Z',
  voided: false,
  void_reason: null,
  voided_by: null,
  voided_at: null,
  sms_sent_at: null,
  client_idempotency_key: null,
}

function renderForm() {
  render(
    <MemoryRouter>
      <CollectionForm />
    </MemoryRouter>,
  )
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Donor name'), { target: { value: 'Ramesh Kulkarni' } })
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } })
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '501' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
}

const record = () => screen.getByRole('button', { name: /^Record/ })

// window.location.href can't actually be assigned in jsdom without either
// throwing ("Not implemented: navigation") or leaving the test process on a
// different page — replace it with a plain writable stand-in so
// send.ts's `window.location.href = buildSmsLink(...)` is just a normal
// property write we can assert against, same idea as mocking any other
// browser API a unit under test calls but doesn't own.
const realLocation = window.location

beforeEach(() => {
  vi.clearAllMocks()
  // Reset the remembered send channel so each test starts on the SMS default
  // (a WhatsApp tap in a prior test must not carry over and change auto-send),
  // and the remembered source so the chip row starts on the mandal's first.
  localStorage.clear()
  enqueueDonation.mockResolvedValue({ localId: 'local-id-1' })
  syncOutboxItem.mockResolvedValue(createdDonation)
  markSmsSent.mockResolvedValue(undefined)
  getDonations.mockResolvedValue([])
  getMandalDefaultLang.mockResolvedValue('en')
  getDonationSources.mockResolvedValue(['Society', 'Shop', 'Other'])
  getMandal.mockRejectedValue(new Error('admin only'))
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://vinayak-mandal.example', href: 'https://vinayak-mandal.example/volunteer' },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('CollectionForm', () => {
  it('keeps the submit button inert until name, amount and mode are all present', async () => {
    renderForm()
    expect(record()).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Donor name'), { target: { value: 'Ramesh Kulkarni' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '501' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } })
    // Payment mode is deliberately NOT defaulted: it drives every volunteer's
    // cash-in-hand, so a UPI donation must never be bookable as cash by
    // accident. Until a tile is tapped the form cannot be submitted.
    expect(record()).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
    expect(record()).toBeEnabled()
    expect(enqueueDonation).not.toHaveBeenCalled()
  })

  it('converts rupees to paise and sends collectedBy from the session, never receipt_no/public_token', async () => {
    renderForm()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Society' })).toBeInTheDocument())
    fillValidForm()

    fireEvent.click(record())

    await waitFor(() => expect(enqueueDonation).toHaveBeenCalledTimes(1))
    const payload = enqueueDonation.mock.calls[0][0]
    expect(payload).toEqual({
      donorName: 'Ramesh Kulkarni',
      // v4 §3: PhoneInput stores E.164 — the national digits typed into the
      // field are combined with the visible country code (default IN +91),
      // replacing the old silent "10 digits must be Indian" guess in send.ts.
      donorPhone: '+919876543210',
      amountPaise: 50100,
      mode: 'cash',
      // Plan 2026-08-18 §1: the mandal's FIRST source name, as text — not the
      // old 'society' slug.
      category: 'Society',
      collectedBy: 'volunteer-1',
    })
    expect(payload).not.toHaveProperty('receipt_no')
    expect(payload).not.toHaveProperty('public_token')
  })

  it('immediately attempts a sync after enqueueing, using the returned localId', async () => {
    renderForm()
    fillValidForm()

    fireEvent.click(record())

    await waitFor(() => expect(syncOutboxItem).toHaveBeenCalledWith('local-id-1'))
  })

  it('shows the returned receipt number and resets the form after a successful submit', async () => {
    renderForm()
    fillValidForm()

    fireEvent.click(record())

    await waitFor(() => expect(screen.getByText(/receipt #42/i)).toBeInTheDocument())
    // The confirmation replaces the form; going back to it must find it blank.
    fireEvent.click(screen.getByRole('button', { name: 'Log another donation' }))
    expect(screen.getByLabelText('Donor name')).toHaveValue('')
    expect(screen.getByLabelText('Phone')).toHaveValue('')
    expect(screen.getByLabelText('Amount')).toHaveValue(null)
  })

  it('shows an error instead of a success confirmation when enqueueDonation rejects', async () => {
    enqueueDonation.mockRejectedValue(new Error('network error'))
    renderForm()
    fillValidForm()

    fireEvent.click(record())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network error'))
    expect(screen.queryByText(/receipt #/i)).not.toBeInTheDocument()
  })

  it('shows a "saved offline" confirmation (no receipt number, no SMS attempt) when syncOutboxItem returns null', async () => {
    syncOutboxItem.mockResolvedValue(null)
    renderForm()
    fillValidForm()

    fireEvent.click(record())

    await waitFor(() =>
      expect(screen.getByText("Saved — will send once you're back online.")).toBeInTheDocument(),
    )
    expect(screen.queryByText(/receipt #/i)).not.toBeInTheDocument()
    expect(markSmsSent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Log another donation' }))
    expect(screen.getByLabelText('Donor name')).toHaveValue('')
    expect(screen.getByLabelText('Phone')).toHaveValue('')
    expect(screen.getByLabelText('Amount')).toHaveValue(null)
  })

  it('does NOT auto-fire on submit — it shows the send-choice card with both channels and marks nothing sent', async () => {
    renderForm()
    fillValidForm()

    fireEvent.click(record())

    await waitFor(() => expect(screen.getByText(/receipt #42/i)).toBeInTheDocument())
    // Nothing sends silently: the OS composer is never navigated to, and the
    // donation is not marked sent, so it stays in Pending Send.
    expect(window.location.href).toBe('https://vinayak-mandal.example/volunteer')
    expect(markSmsSent).not.toHaveBeenCalled()
    // Both channels are offered as an explicit choice.
    expect(screen.getByRole('button', { name: 'Send via SMS' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send via WhatsApp' })).toBeInTheDocument()
  })

  it('fires the SMS link and marks the donation sent only once "Send via SMS" is tapped', async () => {
    renderForm()
    fillValidForm()
    fireEvent.click(record())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send via SMS' })).toBeInTheDocument())

    // jsdom's default UA isn't an iOS one, so this exercises the Android/
    // default `?body=` branch of buildSmsLink.
    fireEvent.click(screen.getByRole('button', { name: 'Send via SMS' }))

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/42-tok-abc?lang=en',
    )
    // v4: the stored legacy 10-digit phone is normalized to E.164 (+91…) before
    // the sms: link is built (send.ts / normalizeToE164).
    expect(window.location.href).toBe(`sms:+919876543210?body=${expectedMessage}`)
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
  })

  it('renders a "Send via WhatsApp" button after submit, which opens the wa.me link when tapped', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderForm()
    fillValidForm()
    fireEvent.click(record())
    await waitFor(() => expect(enqueueDonation).toHaveBeenCalledTimes(1))
    markSmsSent.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))

    const expectedMessage = encodeURIComponent(
      'Thank you for your ₹501 contribution. View your official receipt here: https://vinayak-mandal.example/r/42-tok-abc?lang=en',
    )
    expect(openSpy).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${expectedMessage}`, '_blank', 'noopener')
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
    openSpy.mockRestore()
  })

  it('links to the Pending Send tray', () => {
    renderForm()
    expect(screen.getByRole('link', { name: 'Pending sends' })).toHaveAttribute('href', '/collect/pending')
  })

  it('presets the language picker from the mandal default and sends the receipt in it', async () => {
    getMandalDefaultLang.mockResolvedValue('mr')
    renderForm()

    await waitFor(() => expect(screen.getByRole('radio', { name: 'मराठी' })).toBeChecked())

    fillValidForm()
    fireEvent.click(record())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send via SMS' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Send via SMS' }))

    // The Marathi copy, and the link carries ?lang=mr so the receipt page
    // reads the same language straight back out.
    const expectedMessage = encodeURIComponent(
      'तुमच्या ₹501 वर्गणीबद्दल धन्यवाद. तुमची अधिकृत पावती येथे पहा: https://vinayak-mandal.example/r/42-tok-abc?lang=mr',
    )
    expect(window.location.href).toBe(`sms:+919876543210?body=${expectedMessage}`)
    expect(markSmsSent).toHaveBeenCalledWith('donation-1')
  })

  // ── Plan 2026-08-18 §1 — custom donation sources ─────────────────────────
  describe('donation sources', () => {
    it('builds the chip row from the mandal RPC, not a hardcoded three', async () => {
      getDonationSources.mockResolvedValue(['Galli', 'Sponsor'])
      renderForm()

      await waitFor(() => expect(screen.getByRole('button', { name: 'Galli' })).toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Sponsor' })).toBeInTheDocument()
      // The old fixed triple is gone — 'Society' is only there if the mandal
      // still has it.
      expect(screen.queryByRole('button', { name: 'Society' })).not.toBeInTheDocument()
      // First source is preselected, so a submit always carries one.
      expect(screen.getByRole('button', { name: 'Galli' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('submits the picked source NAME as the category', async () => {
      getDonationSources.mockResolvedValue(['Society', 'Galli'])
      renderForm()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Galli' })).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: 'Galli' }))
      fillValidForm()
      fireEvent.click(record())

      await waitFor(() => expect(enqueueDonation).toHaveBeenCalledTimes(1))
      expect(enqueueDonation.mock.calls[0][0].category).toBe('Galli')
    })

    it('remembers the last picked source across mounts', async () => {
      getDonationSources.mockResolvedValue(['Society', 'Galli'])
      const first = render(
        <MemoryRouter>
          <CollectionForm />
        </MemoryRouter>,
      )
      await waitFor(() => expect(screen.getByRole('button', { name: 'Galli' })).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Galli' }))
      first.unmount()

      renderForm()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Galli' })).toHaveAttribute('aria-pressed', 'true'))
    })

    it('falls back to the first source when the remembered one is no longer in the list', async () => {
      // v4 stored the old lowercase slug; a mandal that has since renamed
      // 'Society' away must not keep submitting a source it no longer has.
      localStorage.setItem('vm:lastCategory', 'society')
      getDonationSources.mockResolvedValue(['Galli', 'Sponsor'])
      renderForm()

      await waitFor(() => expect(screen.getByRole('button', { name: 'Galli' })).toHaveAttribute('aria-pressed', 'true'))
    })

    it('still recognises a remembered legacy slug when the mandal kept the name', async () => {
      localStorage.setItem('vm:lastCategory', 'shop')
      getDonationSources.mockResolvedValue(['Society', 'Shop', 'Other'])
      renderForm()

      await waitFor(() => expect(screen.getByRole('button', { name: 'Shop' })).toHaveAttribute('aria-pressed', 'true'))
    })

    it("gives a volunteer an add-only sources sheet — no rename or remove", async () => {
      renderForm()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Society' })).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: 'Manage' }))

      expect(screen.getByRole('heading', { name: 'Donation sources' })).toBeInTheDocument()
      expect(screen.getByLabelText('Add a source')).toBeInTheDocument()
      // Rename inputs and remove buttons belong to an admin only — mandals'
      // UPDATE RLS refuses a volunteer, so the controls simply aren't drawn.
      expect(screen.queryByLabelText('Source name 1')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Remove source/ })).not.toBeInTheDocument()
    })

    it("routes a volunteer's add through the RPC and adopts the returned list", async () => {
      addDonationSource.mockResolvedValue(['Society', 'Shop', 'Other', 'Galli'])
      renderForm()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Society' })).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Manage' }))

      fireEvent.change(screen.getByLabelText('Add a source'), { target: { value: '  Galli  ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))

      await waitFor(() => expect(addDonationSource).toHaveBeenCalledWith('Galli'))
      // updateMandal is the admin-only rename/remove path and must never be
      // reached from a volunteer's add.
      expect(updateMandal).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.getByText('Sources saved.')).toBeInTheDocument())
    })

    it('rejects a duplicate name before it ever reaches the server', async () => {
      renderForm()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Society' })).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Manage' }))

      fireEvent.change(screen.getByLabelText('Add a source'), { target: { value: 'shop' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))

      expect(screen.getByRole('alert')).toHaveTextContent('You already have a source with that name.')
      expect(addDonationSource).not.toHaveBeenCalled()
    })

    it('hides the add row and explains why once six sources exist', async () => {
      getDonationSources.mockResolvedValue(['One', 'Two', 'Three', 'Four', 'Five', 'Six'])
      renderForm()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Six' })).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Manage' }))

      expect(screen.queryByLabelText('Add a source')).not.toBeInTheDocument()
      expect(screen.getByText(/Six is the most the chip row holds/)).toBeInTheDocument()
    })
  })

  // ── Plan 2026-08-18 §2 — record without a receipt ────────────────────────
  describe('skip phone', () => {
    it('blocks a blank phone until the volunteer says the donor gave none', async () => {
      renderForm()
      fireEvent.change(screen.getByLabelText('Donor name'), { target: { value: 'No Phone Donor' } })
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '501' } })
      fireEvent.click(screen.getByRole('button', { name: 'Cash' }))

      // A silently-blank field used to save as "no phone", so a mistyped number
      // cost the donor their receipt with nothing on screen explaining why.
      expect(record()).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'No phone — log without a receipt' }))
      expect(record()).toBeEnabled()
      expect(record()).toHaveTextContent('Record without receipt')
    })

    it('hides the phone field and the receipt-language picker while skipping', async () => {
      renderForm()
      expect(screen.getByLabelText('Phone')).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'English' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'No phone — log without a receipt' }))

      expect(screen.queryByLabelText('Phone')).not.toBeInTheDocument()
      // No number means no message is ever composed, so a language for it would
      // be a choice with no effect.
      expect(screen.queryByRole('radio', { name: 'English' })).not.toBeInTheDocument()
      expect(screen.getByText('Logging without a receipt')).toBeInTheDocument()
    })

    it('clears a half-typed number when the toggle flips, so it cannot ride along', async () => {
      renderForm()
      fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '98765' } })
      fireEvent.click(screen.getByRole('button', { name: 'No phone — log without a receipt' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add a phone number instead' }))

      expect(screen.getByLabelText('Phone')).toHaveValue('')
    })

    it('sends an empty phone and shows the no-receipt confirmation', async () => {
      syncOutboxItem.mockResolvedValue({ ...createdDonation, donor_phone: null })
      renderForm()
      fireEvent.change(screen.getByLabelText('Donor name'), { target: { value: 'No Phone Donor' } })
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '501' } })
      fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
      fireEvent.click(screen.getByRole('button', { name: 'No phone — log without a receipt' }))

      fireEvent.click(record())

      await waitFor(() => expect(enqueueDonation).toHaveBeenCalledTimes(1))
      expect(enqueueDonation.mock.calls[0][0].donorPhone).toBe('')

      await waitFor(() => expect(screen.getByText(/receipt #42/i)).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: 'Send via SMS' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Send via WhatsApp' })).not.toBeInTheDocument()
      expect(screen.getByText(/It’s in the books all the same/)).toBeInTheDocument()
      expect(markSmsSent).not.toHaveBeenCalled()
    })

    it('resets the toggle after a save, so the next donor starts with a phone field', async () => {
      syncOutboxItem.mockResolvedValue({ ...createdDonation, donor_phone: null })
      renderForm()
      fireEvent.change(screen.getByLabelText('Donor name'), { target: { value: 'No Phone Donor' } })
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '501' } })
      fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
      fireEvent.click(screen.getByRole('button', { name: 'No phone — log without a receipt' }))
      fireEvent.click(record())

      await waitFor(() => expect(screen.getByText(/receipt #42/i)).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Log another donation' }))

      expect(screen.getByLabelText('Phone')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'No phone — log without a receipt' })).toBeInTheDocument()
    })
  })
})
