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
  festivalSubtitle: string
  officialReceipt: string
  receivedFrom: string
  contributionLabel: string
  inquiryHeading: string
  // Generic per-contact label used when a contact has a phone but no person
  // name (e.g. president phone saved with no president_name). We NEVER fall
  // back to the mandal name here — that would read as a person's name.
  inquiryForLabel: string
  footerNote: string
  // Kept short (SMS length matters). {amountRupees} is a plain number
  // (no thousands separator, no repeated ₹) so the message stays short.
  smsMessage: (amountRupees: number, receiptLink: string) => string
  // The tamper-evident "amount in words" line. Only the WRAPPER phrase is
  // localized here; `words` (the digits-to-words conversion in amountWords.ts)
  // stays English on every receipt — full number-word localization is out of
  // scope for now.
  amountInWordsLine: (words: string) => string
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
    festivalSubtitle: 'Sarvajanik Ganeshotsav',
    officialReceipt: 'Official Donation Receipt',
    receivedFrom: 'Received with gratitude from',
    contributionLabel: 'Contribution amount',
    inquiryHeading: 'For any questions',
    inquiryForLabel: 'For inquiries',
    footerNote:
      'This digital receipt is issued in the spirit of the traditional bill-book. A copy has been sent to your phone. May Bappa bless you. 🙏',
    smsMessage: (amountRupees, receiptLink) =>
      `Thank you for your ₹${amountRupees} contribution. View your official receipt here: ${receiptLink}`,
    amountInWordsLine: (words) => `Rupees ${words} only`,
  },
  mr: {
    notFound: 'पावती सापडली नाही.',
    donorLabel: 'देणगीदार',
    amountLabel: 'रक्कम',
    receiptNoLabel: 'पावती क्र.',
    dateLabel: 'दिनांक',
    stampCash: 'मिळाले: रोख',
    stampOnline: 'मिळाले: ऑनलाइन',
    voidedBanner: 'ही नोंद रद्द करण्यात आली आहे',
    voidedReasonPrefix: 'कारण: ',
    signatureLabel: 'अध्यक्ष',
    festivalSubtitle: 'सार्वजनिक गणेशोत्सव',
    officialReceipt: 'अधिकृत देणगी पावती',
    receivedFrom: 'कृतज्ञतापूर्वक स्वीकारले',
    contributionLabel: 'वर्गणी रक्कम',
    inquiryHeading: 'काही प्रश्नांसाठी संपर्क',
    inquiryForLabel: 'चौकशीसाठी',
    footerNote:
      'ही डिजिटल पावती पारंपरिक पावती पुस्तकाच्या भावनेने दिली आहे. एक प्रत तुमच्या फोनवर पाठवली आहे. गणपती बाप्पा मोरया. 🙏',
    smsMessage: (amountRupees, receiptLink) =>
      `तुमच्या ₹${amountRupees} वर्गणीबद्दल धन्यवाद. तुमची अधिकृत पावती येथे पहा: ${receiptLink}`,
    amountInWordsLine: (words) => `रुपये ${words} फक्त`,
  },
  hi: {
    notFound: 'रसीद नहीं मिली.',
    donorLabel: 'दानदाता',
    amountLabel: 'राशि',
    receiptNoLabel: 'रसीद सं.',
    dateLabel: 'दिनांक',
    stampCash: 'प्राप्त: नकद',
    stampOnline: 'प्राप्त: ऑनलाइन',
    voidedBanner: 'यह प्रविष्टि रद्द कर दी गई है',
    voidedReasonPrefix: 'कारण: ',
    signatureLabel: 'अध्यक्ष',
    festivalSubtitle: 'सार्वजनिक गणेशोत्सव',
    officialReceipt: 'आधिकारिक दान रसीद',
    receivedFrom: 'सादर आभार सहित प्राप्त',
    contributionLabel: 'योगदान राशि',
    inquiryHeading: 'किसी भी प्रश्न के लिए',
    inquiryForLabel: 'पूछताछ के लिए',
    footerNote:
      'यह डिजिटल रसीद पारंपरिक रसीद बही की भावना से जारी की गई है. एक प्रति आपके फ़ोन पर भेजी गई है. गणपति बाप्पा मोरया. 🙏',
    smsMessage: (amountRupees, receiptLink) =>
      `आपके ₹${amountRupees} के योगदान के लिए धन्यवाद. अपनी आधिकारिक रसीद यहाँ देखें: ${receiptLink}`,
    amountInWordsLine: (words) => `रुपये ${words} मात्र`,
  },
  gu: {
    notFound: 'રસીદ મળી નથી.',
    donorLabel: 'દાતા',
    amountLabel: 'રકમ',
    receiptNoLabel: 'રસીદ નં.',
    dateLabel: 'તારીખ',
    stampCash: 'મળ્યું: રોકડ',
    stampOnline: 'મળ્યું: ઓનલાઈન',
    voidedBanner: 'આ નોંધ રદ કરવામાં આવી છે',
    voidedReasonPrefix: 'કારણ: ',
    signatureLabel: 'પ્રમુખ',
    festivalSubtitle: 'સાર્વજનિક ગણેશોત્સવ',
    officialReceipt: 'સત્તાવાર દાન રસીદ',
    receivedFrom: 'સાભાર સ્વીકૃત',
    contributionLabel: 'ફાળાની રકમ',
    inquiryHeading: 'કોઈપણ પ્રશ્ન માટે',
    inquiryForLabel: 'પૂછપરછ માટે',
    footerNote:
      'આ ડિજિટલ રસીદ પરંપરાગત રસીદ ચોપડાની ભાવનાથી આપવામાં આવી છે. એક નકલ તમારા ફોન પર મોકલી છે. ગણપતિ બાપ્પા મોર્યા. 🙏',
    smsMessage: (amountRupees, receiptLink) =>
      `તમારા ₹${amountRupees} ના યોગદાન બદલ આભાર. તમારી અધિકૃત રસીદ અહીં જુઓ: ${receiptLink}`,
    amountInWordsLine: (words) => `રૂપિયા ${words} પૂરા`,
  },
}

// Resolves a ?lang= query param. Unknown, absent, or hostile values fall back
// to English rather than throwing — this reads a URL a donor could have
// mangled, and a broken receipt is worse than an English one.
export function toLang(value: string | null | undefined): Lang {
  return LANGS.includes(value as Lang) ? (value as Lang) : 'en'
}
