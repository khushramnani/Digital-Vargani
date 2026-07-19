// SMS deep-link builder + optimistic "sent" bookkeeping, shared by
// CollectionForm's auto-send/fallback button and PendingSend's retry
// button — one send flow, reused (not duplicated) in both places.
import { markSmsSent, type Donation } from '../../lib/db/donations'
import { toRupees } from '../../lib/money'
import { receiptStrings, type Lang } from '../../lib/i18n/receipt'

export { markSmsSent }

// iOS and Android disagree on the `sms:` URI's query-string separator for
// the `body` param (a real, documented quirk — see plan.md's risks): iOS
// wants `sms:<number>&body=<text>`, Android/every other browser wants
// `sms:<number>?body=<text>`.
export function buildSmsLink(phone: string, message: string): string {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const separator = isIOS ? '&body=' : '?body='
  return `sms:${phone}${separator}${encodeURIComponent(message)}`
}

// WhatsApp's wa.me links need a full international number, digits only (no
// +, spaces, or symbols). Donor phone numbers are only validated as a
// plausible 7-15 digit count (lib/validation/donation.ts), not a specific
// format, so a bare 10-digit number is assumed to be an Indian mobile
// missing its country code and gets 91 prepended; anything else is passed
// through as-is on the assumption it already includes a country code.
export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '')
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${withCountryCode}?text=${encodeURIComponent(message)}`
}

// The donor's language rides on the receipt link as ?lang= rather than on
// the donation row: no column, no migration, and the receipt page reads it
// straight back out. F4: the receipt number rides in front of the token as a
// human-friendly prefix (`/r/<receiptNo>-<token>`), so the link reads like a
// bill number — the FULL public_token still follows and is the only thing
// gating access (no entropy lost). The receipt page strips the numeric prefix
// and looks the row up by token, so old `/r/<token>` links keep working.
export function receiptUrl(receiptNo: number, publicToken: string, lang: Lang): string {
  return `${window.location.origin}/r/${receiptNo}-${publicToken}?lang=${lang}`
}

// The exact SMS/WhatsApp text that goes out for a donation. Exported so the
// post-log send tray (CollectionForm) can PREVIEW the message without
// duplicating the copy — one source of truth for what the donor receives.
export function buildReceiptMessage(donation: Donation, lang: Lang): string {
  return receiptStrings[lang].smsMessage(
    toRupees(donation.amount_paise),
    receiptUrl(donation.receipt_no, donation.public_token, lang),
  )
}

// The one send flow: build the link, attempt to open the native SMS
// composer, then optimistically record it as sent. Fire-and-forget on
// markSmsSent — `sms:` links have no delivery confirmation, and a failed
// update just leaves the row in the "Pending send" tray (PendingSend.tsx)
// instead of surfacing an error over an otherwise-successful donation.
export function sendReceiptSms(donation: Donation, lang: Lang): void {
  window.location.href = buildSmsLink(donation.donor_phone ?? '', buildReceiptMessage(donation, lang))
  markSmsSent(donation.id).catch(() => {})
}

// Same shape as sendReceiptSms, opened in a new tab instead of same-tab
// navigation — unlike the sms: URI (an OS-handled protocol that never
// actually navigates the tab), https://wa.me/... is a normal URL, so
// window.location.href would leave the app. markSmsSent is reused
// unchanged: that column means "a receipt has been sent for this donation"
// for the Pending Send tray's purposes, not "sent via SMS specifically".
export function sendReceiptWhatsApp(donation: Donation, lang: Lang): void {
  window.open(buildWhatsAppLink(donation.donor_phone ?? '', buildReceiptMessage(donation, lang)), '_blank', 'noopener')
  markSmsSent(donation.id).catch(() => {})
}
