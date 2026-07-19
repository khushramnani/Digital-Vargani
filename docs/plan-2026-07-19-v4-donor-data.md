# Plan v4 — Donor data, categories, phone UX, receipt fixes, send-sheet (2026-07-19)

Scope reviewed against current code. Six work areas, each with the "why", the current-code evidence, and the concrete change. Hand this to the CLI session as the spec.

---

## 1. Donor details for admin (contact, follow-up, history)

**Today:** `CollectionsScreen` rows show only name, receipt no, mode, amount (`Collections.tsx:125-147`). `getDonations` already fetches the full row — `donor_phone`, `created_at`, `collected_by` are in memory and simply not rendered. No donor-level view exists anywhere.

**Change (two layers):**

**1a. Row detail.** Tapping a collection row expands (accordion on mobile, or side panel on desktop admin) to show: donor phone (as `tel:` link + WhatsApp button), date+time, payment mode, category (see #2), collected by (volunteer name — needs a join or a name lookup via the volunteers list the admin already can read), receipt link (open/copy), void action. One tap from list to "call this donor".

**1b. Donor directory — new admin screen "Donors".** Aggregate donations by donor identity (`donor_phone` when present, else normalized `donor_name`): name, phone, total given, number of donations, first/last donation date, per-year totals. Row tap → their donation history + call/WhatsApp actions. This answers "next year, who gave what" and event follow-ups directly.
- Implementation: a `donors_summary` RPC (admin-only, mandal-scoped, aggregates non-voided donations grouped by phone-or-name) — cheaper and safer than shipping all rows to the client; add harness assertion (other-mandal admin sees nothing).
- Add a **year/season filter** on both Collections and Donors (`created_at` year) — festival data stays queryable across years. This also means we should steer admins away from "Clear all donations" as year-end hygiene (it voids history); note in UI copy: "Keep past years — use the year filter instead."

**Stats (see also #2):** dashboard gains a "Collections insight" card: total donations (count), unique donors, average donation, largest donation. All computable in the existing ledger fetch or a small RPC.

## 2. Donation source category: Society / Shop / Other

**Why:** mandals collect door-to-door (society flats), from shops, and ad-hoc. Treasurers want the split.

**Change:**
- Migration: `donations.category text not null default 'society' check (category in ('society','shop','other'))`. Existing rows become 'society' (the dominant case) — acceptable and documented. Append-only trigger: add `category` to the guarded columns (it must not be editable after insert; wrong category = void + re-enter, consistent with everything else).
- Collect form: 3-chip segmented control under payment mode (🏠 Society / 🏪 Shop / 🪔 Other), default Society, remembered per session (volunteers often do a whole lane of shops).
- Offline queue: include `category` in the outbox row.
- Dashboard: "Where money came from" mini-card next to "Where money went": per-category amount + donation count (Society ₹X · N donations, …). Donor count overall on the same card.
- Collections screen: category chip on each row + filter.
- RPC/report: transparency page does NOT show categories of income (privacy/simplicity) — internal only, unless you later decide otherwise.

## 3. Phone numbers: visible +91 and a country-code picker

**Today:** `buildWhatsAppLink` (`send.ts:26-30`) silently assumes any 10-digit number is +91; inputs are bare text with "10-digit mobile" placeholders; volunteers/donors abroad break (wrong wa.me target, silently).

**Change (Google-style, no heavy dependency):**
- New `PhoneInput` component: country selector (flag + dial code, default 🇮🇳 +91, searchable dropdown from a small bundled list of ~240 `{iso, name, dialCode, nationalLength?}` entries) + national-number field. The +91 is **always visible** as a prefix chip so nobody wonders what's being assumed.
- Store numbers as **E.164** (`+919876543210`) in `donor_phone`, `users.phone`, inquiry contacts. Legacy 10-digit rows: normalize on read (`^\d{10}$` → prepend +91) — matches today's assumption so nothing breaks; optional one-time migration to rewrite stored rows.
- `sms:` and `wa.me` builders take E.164 directly (wa.me wants digits only, strip the +). Kill the 10-digit heuristic.
- Validation: required length per selected country when known, else 6–15 digits (E.164 bounds). Keep donor phone optional as-is.
- Apply everywhere a phone is entered: collect form, volunteer/admin creation, inquiry contacts, president phone (Settings).

## 4. Receipt inquiry block: president NAME + clickable numbers

**Today (confirmed):** `inquiryContactsFor` (`ReceiptPage.tsx:89`) uses `president_name ?? mandal_name` — when no president name is saved, the **mandal name** shows next to the president's phone (exactly what you saw). Numbers render as plain text `{c.name} — {c.phone}` (`:210-212`), not links.

**Change:**
- Settings gains an explicit **"President name"** field (prefill = the admin `users.name` captured at mandal creation; editable). `get_public_receipt` returns it; drop the mandal-name fallback entirely — if there's no name AND no other contact, show just the number with the generic label from `receiptStrings` ("For inquiries"), never the mandal name as a person.
- Render each contact as: name (person) on one line, phone as `<a href="tel:+91…">+91 98765 43210</a>` styled underlined-dotted in the receipt palette — donor taps → dialer opens. Add a small WhatsApp glyph link (`wa.me`) beside it — donors overwhelmingly prefer that.
- Format displayed numbers from E.164 → `+91 98765 43210` grouping (national formatting for IN; generic grouping otherwise).

## 5. Signature block: bigger + name always present

**Today (confirmed):** signature image is `h-16` (64px, `ReceiptPage.tsx:190`); the name renders **only if `president_name` exists** (`:195-197`) — same root cause as #4: the field was never explicitly collected, so receipts show just the italic "President" label.

**Change:**
- Signature image → `h-24` (96px), width capped `max-w-[220px]`, keep `object-contain`; nudge the rule/label block accordingly. (Design reference shows roughly this proportion.)
- With #4's required president-name field, the name line always renders: name in the marker font, "President" label under it (both already styled correctly at `:194-198`).
- Settings preview (already live) lets the admin verify both instantly.

## 6. Post-submit send block — better pattern than appending below the form

**Your instinct is right.** The block-below-form (current `CollectionForm` success card) has two real problems: on a phone the block renders *below the fold* (form + chips + modes fill the viewport, so after submit the volunteer sees… nothing move), and it leaves the stale filled form on screen, inviting double-submits.

**Recommendation: bottom sheet (action sheet) — the mobile-native pattern.**
On successful log (or queue), slide up a **bottom sheet** over the dimmed form:
1. Header: green tick + "₹501 logged — Receipt #VM/2026/0013" (offline case: amber dot + "Saved on phone — will sync").
2. Message preview bubble (existing copy).
3. Two thumb-height buttons: **Send via SMS** (primary orange) / **Send on WhatsApp** (secondary, green accent) — primary = remembered channel.
4. Quiet row: "Preview receipt" · "Skip for now".
5. On send-tap or skip: sheet dismisses, **form resets to empty**, focus back on donor name → the fast repeat loop ("+ New collection" becomes implicit).
Skip keeps the donation in Pending Send (with both buttons) since `sms_sent_at` stays null — this composes perfectly with the fix from audit v3 (mark sent only on explicit tap).
- Why a sheet over alternatives: a separate success *page* (design reference's approach) costs a navigation and loses form context; an inline swap is invisible on phones; a sheet is instant, thumb-reachable, standard (GPay/Paytm collect flows), and needs no router change. Implement as a small `Sheet` component (fixed bottom, `translate-y` transition, focus-trapped, Esc/backdrop = Skip) — reusable later for the volunteer "More" menu.

## 7. City/State — smart two-way field (replaces current single "city" approach)

**Today:** one `CityTypeahead` writes `city` and silently keeps whatever `state` was before ("Use as typed" doesn't touch state) — confusing in Settings and wrong for villages not in the list.

**Change — two columns, two visible fields, one smart assist layer:**
- Keep/confirm **two DB columns**: `city` and `state`. Two labeled fields in Signup and Settings — the user always sees and owns both values (your "clean" fallback is the base behavior).
- Assist layer on top (bundled data, zero API):
  - Type in **City** → dropdown of matches shown as "Vadodara, Gujarat"; picking one fills BOTH fields.
  - Type in **State** (dropdown of 36 states/UTs with free-type filter) → City field's dropdown now suggests cities of that state first; free-typed city that's not in the list is accepted as-is.
  - Reverse order works too (state first, then city suggestions scoped to it), and either field can be left as pure free text — the dataset only *suggests*, never blocks.
  - If a picked city disagrees with an already-chosen state, the pick wins and updates state (visible change, user can re-edit).
- Validation: state must be one of the 36 (or empty); city free text. Receipt shows "City" as today (falls back to state if city empty).
- This is ~30 lines over the existing combobox + a `state` field — not the heavy geo-API version. Dataset: existing `INDIAN_CITIES` (city+state pairs) + `INDIAN_STATES`.

## 8. Danger Zone — permanent delete of donation history

**Today:** "Clear all donations" is a bulk **void** — rows stay in the DB and appear under the "Removed" toggle. There is deliberately no DELETE path anywhere (append-only design; RLS has no DELETE policies).

**Change — keep void as the everyday path, add true purge as a separate, scarier action:**
- New SECURITY DEFINER RPC `purge_donations(scope)` — admin-only, mandal-scoped, `search_path` pinned, hard-`DELETE`s rows. Two scopes:
  - `'removed'` — permanently erase only already-voided rows ("empty the removed history"). The everyday cleanup.
  - `'all'` — erase the mandal's entire donation history. The nuclear year-reset / test-data wipe.
- Danger Zone UI (Collections screen or Settings): two buttons, each with typed-phrase confirm (existing `ConfirmDialog` pattern) + explicit consequence copy: **"This cannot be undone. Donor receipt links will stop working. Totals, donor history and the transparency report will change."**
- Implementation notes for the CLI session:
  - RLS has no DELETE policies — deletion MUST go through the definer RPC (don't add DELETE policies; keeps raw clients unable to delete).
  - Also clear matching local outbox rows (a queued-but-synced item could otherwise resurrect confusion) and note purged receipt tokens now 404 (that's the point).
  - Books-balance: purging **cash** donations that were never voided changes cash-in-hand mid-flight — restrict `'all'` purge with a guard: warn (or block) when non-voided cash donations exist that aren't covered by handovers; simplest honest rule: `'all'` purge is allowed but the confirm shows the current net effect ("₹X of recorded collections will be erased").
  - Harness assertions: volunteer cannot call it; other-mandal admin purges nothing; `'removed'` scope leaves active rows untouched.
- Explicitly documented trade-off: purge deletes the audit trail — that's its purpose (test data, privacy, fresh season). The UI copy should steer real accounting corrections to void, and year-over-year analysis (plan #1b) to the year filter instead of deletion.

---

## Build order

| Step | Work | Notes |
|---|---|---|
| 1 | Migration: `category` column + guard, president_name (if not already a column — else just Settings wiring), phone E.164 normalization decision | one migration, harness additions |
| 2 | PhoneInput component + E.164 plumbing (form, settings, volunteers, queue, senders) | kills the +91 heuristic |
| 3 | Collect form: category chips + bottom-sheet send step (replaces below-block; markSmsSent on tap only) | tests: sheet skip → stays pending |
| 4 | Receipt: president name field + tel/wa links + h-24 signature | verify in Settings preview |
| 5 | Admin: collections row detail, Donors screen + donors_summary RPC, year filter, insight card, category breakdown card | RPC + harness |
| 6 | City/State smart pair (Signup + Settings), state column wiring | replaces CityTypeahead behavior (#7) |
| 7 | `purge_donations` RPC + Danger Zone purge UI (removed-only / all) with typed-phrase confirms | harness: role + tenant + scope (#8) |

Definition of done: admin can tap any collection → call the donor; Donors screen answers "who gave what, this year and last"; dashboard shows society/shop/other split + donor count; a UK number entered with 🇬🇧 +44 reaches the right WhatsApp; receipt shows president name under a visibly larger signature and his number dials on tap; logging 5 donations in a row never requires scrolling or manual form clearing.
