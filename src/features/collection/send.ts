// SMS deep-link builder + optimistic "sent" bookkeeping, shared by
// CollectionForm's auto-send/fallback button and PendingSend's retry
// button — one send flow, reused (not duplicated) in both places.
import { markSmsSent, type Donation } from '../../lib/db/donations'
import { toRupees } from '../../lib/money'
import { strings } from '../../lib/strings'

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

// `/r/:public_token` is Task 9's public receipt page (not built yet, per
// this task's scope boundary) — this only constructs the URL to it.
export function receiptUrl(publicToken: string): string {
  return `${window.location.origin}/r/${publicToken}`
}

// The one send flow: build the link, attempt to open the native SMS
// composer, then optimistically record it as sent. Fire-and-forget on
// markSmsSent — `sms:` links have no delivery confirmation, and a failed
// update just leaves the row in the "Pending send" tray (PendingSend.tsx)
// instead of surfacing an error over an otherwise-successful donation.
export function sendReceiptSms(donation: Donation): void {
  const message = strings.collection.smsMessage(toRupees(donation.amount_paise), receiptUrl(donation.public_token))
  window.location.href = buildSmsLink(donation.donor_phone ?? '', message)
  markSmsSent(donation.id).catch(() => {})
}
