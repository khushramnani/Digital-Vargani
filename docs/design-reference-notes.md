# Design Reference Notes — "Vinayak Mandal" Claude Design (captured 2026-07-19)

Source: claude.ai/design share `13772beb…` (`Vinayak Mandal.dc.html`), walked through in present mode.
Purpose: implementation reference for F3 (receipt), F9 (admin dashboard) and general UI polish, merged with our existing features. Our rules: keep our direct auto-send-on-submit, real offline tray, role model, and multi-tenant branding; adopt the reference's visual patterns.

## Global look

Warm cream/stone background (#efe9dc-ish), dark chocolate top bar with mandal logo chip + name + subtitle ("Digital Vargani · Ganeshotsav 2026"), orange (#ea6a12-ish) primary buttons/pills, rounded-2xl cards with soft shadows. Role switcher pills top-right (Volunteer / Admin / Public) — presentation artifact, not a product feature. Devotional serif reserved for donor-facing surfaces; clean sans for the tool.

## Volunteer app (phone)

**Layout:** bottom tab bar with 5 items — Collect (+), Send (💬), Mine (list), Cash (dot), More (…). Worth adopting: our current nav is link-chips on the form screen; a fixed bottom tab bar is better one-handed UX and solves the back-button complaint on the volunteer side.

**Collect form:** greeting header "Namaste, <volunteer name>" + right-aligned chip "₹7,701 TODAY · 3 DONORS" (personal daily total — nice motivator, we can compute from today's donations by this user). Fields: donor name, phone, big Amount input with ₹ prefix, then quick-amount chips **₹101 / ₹251 / ₹501 / ₹1100** and a wide **₹2100** chip (auspicious amounts). Payment mode as 3 icon cards (Cash 💵 / UPI 📱 / Bank 🏦), selected = orange border + tint. CTA: full-width orange "Log & send receipt →" with microcopy under it: **"Saved locally first · sends when you press Send"** — great trust copy for our offline queue, adopt verbatim.

**Send tray (post-log + pending):** after logging, a card shows: "Send from your SMS — ₹0 cost, arrives from you, a trusted neighbour" explainer, gray bubble with the exact SMS text preview (message + short link `vinayakmandal.org/r/z1`), primary **"Open SMS & Send"**, secondary outline **"Preview donor receipt"**, then a dark **"+ New collection"** button. Below: "PENDING SEND — 1 waiting" list, each row: amber dot, donor name, `#012 · ₹501`, orange **Send** button.
Adopt: SMS text preview bubble (volunteers see exactly what goes out), "Preview donor receipt" secondary action, "+ New collection" quick loop, "N waiting" counter. We extend with our WhatsApp secondary button + needs-attention (poison) state which the design lacks.

**Mine (my collections):** rows with mode icon tile, name, `#009 · Cash · Today, 4:20 PM`, right-aligned bold amount + small red "void" text-link. Matches our screen; adopt the mode icon + timestamp subline.

**Cash in hand:** headline stat card in deep maroon: "YOU OWE THE TREASURER / ₹5,300 / Cash collected, not yet handed over" — then 3 mini stat cards: ₹8,300 CASH COLLECTED / ₹0 SPENT ON MANDAL / ₹3,000 HANDED OVER, then orange CTA "Hand cash to treasurer →", then MY HANDOVERS list. Adopt this whole composition — much clearer than a bare number; the maroon "you owe" framing is the emotional core.

## Admin (desktop, treasurer console)

Browser-frame mock at `app.vinayakmandal.org/admin`. **Layout: dark sidebar** (Treasurer console): Dashboard / All collections / Expenses / Volunteers / Handovers / Public report, Settings pinned at bottom. Content area:

- H1 "Master Ledger" + subline "Live view · Ganeshotsav 2026 · updated just now".
- **Books-balance banner** (green tint, big ✓ chip): bold "Books balance — everything reconciles" + the actual equation in words: "Net Balance ₹11,903 = Volunteers ₹7,601 + Treasurer cash ₹4,000 + Bank ₹302". ADOPT: showing the equation with real numbers is far better than our bare ✓/✗ — it teaches the treasurer what the check means and makes a red state debuggable. (Our reconcile.ts already returns these components.)
- 3 stat cards: TOTAL FUND POOL ₹23,403 "12 donations collected" (green number) / TOTAL EXPENSES ₹11,500 "5 payments made" (orange number) / NET BALANCE on dark card, white number, "Collections − Expenses".
- Two-column body: **Cash-in-hand tracker** card (header + right-aligned "₹7,601 with volunteers" total; rows: avatar initial, name, subline "collected ₹9,901 · handed ₹3,000", right big amount + "still owes") and **Where money went** card (pie + legend rows "category · % " with amounts).
- **Mobile admin (captured 2026-07-19, second pass):** no sidebar, no hamburger. Sticky header: small letterspaced "TREASURER CONSOLE" + big "Master Ledger", then a **horizontally scrollable pill-tab row** (Ledger • Collections • Expenses • Volunteers • …, active = orange pill) that stays pinned while content scrolls. Below: books-balance banner (stacked, button wraps under text), **2×2 stat grid** with a 4th card mobile adds: "CASH W/ VOLUNTEERS ₹7,601" (maroon number), then cash tracker card (compact rows: avatar initial, name, "handed ₹X" subline, owed amount right) and pie card stacked. This pill-tab pattern is the design's mobile admin nav — adopt it as the persistent AdminLayout mobile header (with our extra items: Handovers, Admins, Transparency, Settings in the scroll row) plus a always-visible "+ Collect" action.

Adopt for our MasterLedger: sidebar layout on desktop (our current dashboard is a link-card grid — fine on phone, weak on desktop), equation banner, stat-card styling (dark net-balance card), cash-in-hand tracker rows with collected/handed subline, pie card with amount+percent legend. Keep: our extra nav items (Admins, Transparency, Collect donation) — fold into sidebar; "Collect donation" stays a prominent action (goes to /collect).

## Public receipt (donor)

Parchment card inside phone, scalloped/torn top AND bottom edges:
1. Invocation line, small maroon: `॥ ॐ श्री गणेशाय नमः ॥`
2. Mandal name, large serif: "Vinayak Yuvak Mandal"
3. Italic subline: "Sarvajanik Ganeshotsav · Est. 1974 · Pune" (→ for us: tagline/city from mandal profile)
4. Bordered badge, letterspaced: OFFICIAL DONATION RECEIPT
5. Row: "Receipt No. **VYM/2026/0012**" ←→ "Date **Today, 6:12 PM**" (formatted receipt number: prefix/year/zero-padded — nicer than bare integer; feeds F4 pretty URLs too)
6. Dashed divider · "Received with gratitude from" · donor name large serif
7. "Contribution amount" · **₹501 huge** (decorative numerals) · amount in words italic: "Rupees five hundred one only" — ADOPT amount-in-words, strong bill-book authenticity cue
8. Signature block left: signature image above **name "Shri Madhukar Deshmukh"** + italic "President" — exactly the user's ask (name + label, larger signature). Rotated green rubber stamp right: "RECEIVED / **ONLINE**(or CASH) / <mandal name>" 
9. Below card, italic: "This digital receipt is issued in the spirit of the traditional bill-book. A copy has been sent to your phone. May Bappa bless you. 🙏"
Plus (our additions not in design): inquiry contacts footer (F6), language toggle, Ganesha watermark (we have it; design's is subtle).

## Public transparency report

Same parchment language: invocation, mandal name, letterspaced "GANESHOTSAV 2026 · FUND REPORT". Hero card: "TOTAL COLLECTED FROM SOCIETY / **₹23,403** (large green serif) / across 12 families — with heartfelt thanks". Card "How the funds were used": pie + legend rows (category / ₹amount / %). Footer note in dashed-border box: "Individual donor names and amounts are kept private. This report shows only the mandal's totals — complete transparency, in one glance. 🙏" — adopt this privacy note verbatim-ish. ("across N families" = donor count; we have it.)

## Gap list vs our app (what the redesign changes)

| Area | Ours today | Adopt from design |
|---|---|---|
| Volunteer nav | link chips on form | bottom tab bar (Collect/Send/Mine/Cash/More) |
| Collect form | plain fields | greeting + today chip, amount chips, icon mode cards, offline microcopy |
| Post-log | auto-opens SMS (keep!) | add SMS-preview bubble + receipt preview + "+ New collection" on the after-state/tray |
| Admin dashboard | card grid + bare ✓/✗ | sidebar console, equation banner, styled stat trio, tracker rows, pie legend with ₹+% |
| Receipt | phone-less layout, label-only signature, small logo | invocation, Est./city subline, formatted receipt no., amount-in-words, name+label signature, bigger logo/signature |
| Transparency | functional | parchment hero + privacy note + "across N families" |
| Cash screen | number + form | maroon "you owe" hero + 3 stat cards + handover list |

Things we deliberately do NOT take: fake short domain (`vinayakmandal.org`) — ours is tenant slug + real host; "Simulate mismatch" demo button; single-mandal "VYM" branding (ours is per-mandal config); design's SMS-only send (we add WhatsApp).
