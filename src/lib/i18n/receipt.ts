// Donor-facing copy, in every language a receipt can be sent in. This is
// deliberately separate from strings.ts: that file is operator-facing UI copy
// and stays English (SPEC.md assumption 5), while these ten strings plus the
// message body are the only text a donor ever reads.
export const LANGS = ['en', 'mr', 'hi', 'gu'] as const
export type Lang = (typeof LANGS)[number]

export type ReceiptStrings = {
  notFound: string
  donorLabel: string
  amountLabel: string
  receiptNoLabel: string
  dateLabel: string
  stampCash: string
  stampOnline: string
  voidedBanner: string
  voidedReasonPrefix: string
  signatureLabel: string
  // Kept short (SMS length matters). {amountRupees} is a plain number
  // (no thousands separator, no repeated ₹) so the message stays short.
  smsMessage: (amountRupees: number, receiptLink: string) => string
}

export const receiptStrings: Record<Lang, ReceiptStrings> = {
  en: {
    notFound: 'Receipt not found.',
    donorLabel: 'Donor',
    amountLabel: 'Amount',
    receiptNoLabel: 'Receipt No.',
    dateLabel: 'Date',
    stampCash: 'RECEIVED: CASH',
    stampOnline: 'RECEIVED: ONLINE',
    voidedBanner: 'This entry has been voided',
    voidedReasonPrefix: 'Reason: ',
    signatureLabel: 'President',
    smsMessage: (amountRupees, receiptLink) =>
      `Thank you for your ₹${amountRupees} contribution. View your official receipt here: ${receiptLink}`,
  },
  // mr/hi/gu land in Task 2.
} as Record<Lang, ReceiptStrings>

// Resolves a ?lang= query param. Unknown, absent, or hostile values fall back
// to English rather than throwing — this reads a URL a donor could have
// mangled, and a broken receipt is worse than an English one.
export function toLang(value: string | null | undefined): Lang {
  return LANGS.includes(value as Lang) ? (value as Lang) : 'en'
}
