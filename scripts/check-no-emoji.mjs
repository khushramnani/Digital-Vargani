// Part 4 of the 2026-08-18 plan: no emoji in the app, ever again.
//
// The design uses zero emoji and zero icon fonts — modes are uppercase text
// chips, sources are name chips, people are letter avatars, actions are text
// buttons, and the few glyphs it does draw are drawn with borders and bars. Emoji
// were also the least reliable pixels in the product: rendering varies wildly
// across the low-end Android WebViews these mandals actually use, and some fall
// back to tofu.
//
// Typographic marks are NOT emoji and deliberately stay: ✓ ✗ ✕ ⌃ ⌄ ◆ ● ▮ ⌁ ▾ ›
// ‹ ＋ — all monochrome, all in fonts we already load, all used by the design.
// What this rejects is the Emoji_Presentation set: pictographs and flags.
//
// Run: node scripts/check-no-emoji.mjs   (wired to `npm run lint:emoji`)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOTS = ['src', 'e2e', 'tests']
const EXTENSIONS = ['.ts', '.tsx', '.css', '.html']

// The ONE allowed exception: the phone country picker's flag column is data
// about countries, not decoration, and a picker of 250 countries without flags
// is materially harder to scan.
const ALLOWED = new Set(['src/lib/countries.ts'])

// \p{Extended_Pictographic} covers emoji pictographs; the Regional_Indicator
// pair covers flags (which are otherwise plain letters). Variation Selector-16
// is the "render the previous char as emoji" request, so it counts too.
//
// A few legal-notice marks are Extended_Pictographic by Unicode reckoning but
// are plainly typography, and every font we load renders them as text.
const TYPOGRAPHY = new Set(['\u00A9', '\u00AE', '\u2122'])
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|️/gu

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (EXTENSIONS.some((e) => full.endsWith(e))) yield full
  }
}

const offences = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative('.', file).split(sep).join('/')
    if (ALLOWED.has(rel)) continue
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const hit of line.matchAll(EMOJI)) {
          if (TYPOGRAPHY.has(hit[0])) continue
          offences.push(`${rel}:${i + 1}  ${hit[0]}  ${line.trim().slice(0, 100)}`)
        }
      })
  }
}

if (offences.length > 0) {
  console.error(`Found ${offences.length} emoji. The design uses none — use text, or draw the glyph.\n`)
  for (const o of offences) console.error(`  ${o}`)
  console.error(`\nIf a file genuinely needs them, add it to ALLOWED in ${'scripts/check-no-emoji.mjs'}.`)
  process.exit(1)
}
console.log('No emoji found.')
