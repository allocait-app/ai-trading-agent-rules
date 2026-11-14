// Writes every SVG in images/ and brand/. No dependencies.
//   node brand/build.mjs                    the real files
//   node brand/build.mjs --out DIR --arial  every file in DIR, set in Arial, to check that nothing overflows
// Text is live and uses the system font stack: no external font, image or script, so GitHub renders it as is.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({ options: { out: { type: 'string' }, arial: { type: 'boolean' } } })
const BRAND = dirname(fileURLToPath(import.meta.url))
const IMAGES = join(BRAND, '..', 'images')
const FONT = args.arial
  ? 'Arial, sans-serif'
  : "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

// Allocait's wing mark, unchanged (src/components/brand/Mark.tsx, 120-unit box). Used only as the small maker sign-off.
const MARK =
  'M0 0L82.36 0L72.58 32L0 32ZM94.9 0L102.43 0A13 13 0 0 1 114.87 16.8L110.22 32L85.13 32ZM0 44L68.91 44L59.13 76L0 76ZM81.46 44L106.56 44L96.78 76L71.68 76ZM0 88L55.47 88L45.69 120L15 120A15 15 0 0 1 0 105ZM68.02 88L93.11 88L83.33 120L58.24 120Z'

// Allocait app tokens (tailwind.config.js, DESIGN.md "Brand"). Yellow is the wing mark on dark grounds only.
export const T = {
  light: { ground: '#f9fafb', card: '#ffffff', edge: ['#09090b', 0.14], rule: ['#09090b', 0.08], lane: ['#09090b', 0.34], ink: '#111827', head: '#111827', sub: '#4b5563', mark: '#0b0b0b', track: ['#030712', 0.07], band: ['#030712', 0.28], disc: '#111827', onDisc: '#ffffff' },
  dark: { ground: '#09090b', card: '#18181b', edge: ['#ffffff', 0.16], rule: ['#ffffff', 0.09], lane: ['#ffffff', 0.4], ink: '#f4f4f5', head: '#ffffff', sub: '#a1a1aa', mark: '#ffc629', track: ['#ffffff', 0.09], band: ['#ffffff', 0.28], disc: '#f4f4f5', onDisc: '#09090b' },
}

// The notice. Ruling 3, word for word. The README carries the full form; images carry this one.
const SIGN_OFF = 'An example from the Allocait team.'
const NOTICE_A = 'Shared as is. Not an Allocait product.'
const NOTICE_B = 'Not made or endorsed by Alpaca or Anthropic.'
const TITLE = 'Rules for AI Trading Agents'
const ILLUSTRATION = ['Illustration.', 'Symbols and numbers are made up.']
const TAGLINE = ['Your own rules, checked', 'before a paper order.']

const fo = (c) => `fill="${c[0]}" fill-opacity="${c[1]}"`
const so = (c, w) => `stroke="${c[0]}" stroke-opacity="${c[1]}" stroke-width="${w}"`
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const text = (x, y, s, o = {}) => {
  const { size = 28, w = 400, fill, anchor = 'start', ls = 0 } = o
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${w}" fill="${fill}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${ls ? ` letter-spacing="${ls}"` : ''}>${esc(s)}</text>`
}
const rect = (x, y, w, h, r, fill, stroke) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${fill}${stroke ? ' ' + stroke : ''}/>`
const mark = (x, y, size, fill) => `<path transform="translate(${x} ${y}) scale(${+(size / 120).toFixed(5)})" fill="${fill}" d="${MARK}"/>`
const svg = (w, h, title, desc, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d">\n<title id="t">${esc(title)}</title>\n<desc id="d">${esc(desc)}</desc>\n${body}\n</svg>\n`
const pill = (t, x, y, label, size, h, padX, filled = true) => {
  const w = Math.round(label.length * size * 0.56 + padX * 2)
  return {
    w,
    svg: rect(x, y, w, h, h / 2, filled ? `fill="${t.card}"` : 'fill="none"', so(t.edge, 2)) + text(x + w / 2, y + h / 2 + size * 0.35, label, { size, w: 500, fill: t.ink, anchor: 'middle' }),
  }
}
const frame = (t, w, h) => rect(1, 1, w - 2, h - 2, 24, `fill="${t.ground}"`, so(t.edge, 2))

// ---------- hero, 1760 x 760, shown at 880 ----------
function hero(name) {
  const t = T[name]
  const W = 1760, H = 760
  let b = frame(t, W, H)
  // left column: label, title, tagline
  b += pill(t, 72, 48, 'Open-source example', 24, 48, 24).svg
  b += text(72, 208, 'Rules for AI', { size: 80, w: 600, fill: t.head, ls: -1.6 })
  b += text(72, 294, 'Trading Agents', { size: 80, w: 600, fill: t.head, ls: -1.6 })
  b += text(72, 370, TAGLINE[0], { size: 32, fill: t.sub })
  b += text(72, 412, TAGLINE[1], { size: 32, fill: t.sub })
  // maker sign-off: the mark beside the maker line only; the lines that name other companies sit below, set apart
  // two mark-bands of clear space sit between the maker row and the lines that name Alpaca and Anthropic
  b += mark(72, 496, 44, t.mark)
  b += text(144, 525, SIGN_OFF, { size: 26, w: 600, fill: t.ink })
  b += text(72, 674, NOTICE_A, { size: 26, fill: t.sub })
  b += text(72, 710, NOTICE_B, { size: 26, fill: t.sub })

  // chat: the label sits at +28 and the message one label width on (+136 after Claude, +100 after You), so the gap is the same in every card; only the You cards sit to the right
  const card = (x, y, w, h) => rect(x, y, w, h, 24, `fill="${t.card}"`, so(t.edge, 2))
  const who = (x, y, s) => text(x + 28, y, s, { size: 24, w: 600, fill: t.sub })
  const R = 1688, L = 776
  { const w = 672, x = R - w, y = 48
    b += card(x, y, w, 132) + who(x, y + 58, 'You')
    b += text(x + 100, y + 58, 'Check a buy of 235.423197 ECHO/USD.', { size: 28, w: 500, fill: t.ink })
    b += text(x + 100, y + 98, 'If I say yes, place it in my paper account.', { size: 28, fill: t.ink }) }
  { const w = 880, x = L, y = 196, cx = x + 136
    b += card(x, y, w, 250) + who(x, y + 58, 'Claude')
    b += text(cx, y + 58, '1 of your rules is newly outside range', { size: 30, w: 600, fill: t.head })
    b += text(cx, y + 108, 'Crypto', { size: 26, w: 600, fill: t.ink })
    b += text(cx + 120, y + 108, '0% before, 7.29% after. Your range is 0% to 7%.', { size: 26, fill: t.ink })
    // range bar on a 0 to 8 scale; the ring is the share before, the disc the share after, the tick the end of the range
    const x0 = cx + 11, sc = 78, by = y + 132
    b += rect(cx, by, 11 + 8 * sc, 12, 6, fo(t.track))
    b += rect(cx, by, 11 + 7 * sc, 12, 6, fo(t.band))
    b += `<rect x="${x0 + 7 * sc - 1.5}" y="${by - 8}" width="3" height="28" fill="${t.ink}"/>`
    b += `<circle cx="${x0}" cy="${by + 6}" r="11" fill="${t.card}" stroke="${t.ink}" stroke-width="3"/>`
    b += `<circle cx="${+(x0 + 7.29 * sc).toFixed(1)}" cy="${by + 6}" r="11" fill="${t.disc}" stroke="${t.card}" stroke-width="4"/>`
    b += text(cx, by + 50, 'before', { size: 24, fill: t.sub })
    b += text(+(x0 + 7.29 * sc).toFixed(1), by + 50, 'after', { size: 24, fill: t.sub, anchor: 'middle' })
    b += text(cx, y + 226, 'Cash', { size: 26, w: 600, fill: t.ink })
    b += text(cx + 120, y + 226, '4,332.73. Enough for this order.', { size: 26, fill: t.ink }) }
  { const w = 880, x = L, y = 462
    b += card(x, y, w, 158) + who(x, y + 58, 'Claude')
    b += text(x + 136, y + 58, 'Place this in your Alpaca paper account?', { size: 28, w: 600, fill: t.head })
    b += text(x + 136, y + 98, 'Buy 235.423197 ECHO/USD.', { size: 26, fill: t.sub })
    b += text(x + 136, y + 134, 'Market order, good until cancelled.', { size: 26, fill: t.sub }) }
  { const w = 188, x = R - w, y = 636
    b += card(x, y, w, 84) + who(x, y + 52, 'You')
    b += text(x + 100, y + 52, 'Yes.', { size: 28, w: 500, fill: t.ink }) }
  // a reader can see that nothing here is real
  b += text(L, 666, ILLUSTRATION[0], { size: 24, w: 600, fill: t.sub })
  b += text(L, 700, ILLUSTRATION[1], { size: 24, fill: t.sub })

  return svg(W, H, 'Rules for AI Trading Agents: an open-source example',
    `A short chat. You ask Claude to check a buy of 235.423197 ECHO/USD. Claude says 1 of your rules is newly outside range: Crypto goes from 0% before to 7.29% after, against your range of 0% to 7%. Cash is 4,332.73, enough for this order. Claude asks whether to place it in your Alpaca paper account, as a market order good until cancelled, and you say yes. ${SIGN_OFF} ${NOTICE_A} ${NOTICE_B} ${ILLUSTRATION.join(' ')}`, b)
}

// ---------- flow, 1760 x 880, shown at 880 ----------
function flow(name) {
  const t = T[name]
  const W = 1760, H = 880
  const lanes = [
    { x: 1076, n: 'You', s: '' },
    { x: 1236, n: 'Claude', s: '' },
    { x: 1396, n: 'Alpaca', s: 'paper account' },
    { x: 1556, n: 'Allocait', s: 'your rules' },
  ]
  // [text, second line, from lane, to lane, dashed, answer drawn back as a dashed line]
  const rows = [
    ['You ask Claude to check an order.', '', 0, 1, false],
    ['Claude reads your paper account and last prices.', '', 1, 2, false, true],
    ['Claude sends Allocait the order and those prices.', '', 1, 3, false],
    ['Allocait states what the order does to your ranges.', '', 3, 1, true],
    ['You read the facts and say yes or no.', '', 0, 1, false],
    ['In Claude Code, an installed hook asks you once more.', 'It asks in default and accept-edits modes, and refuses in others.', 1, 0, false],
    ['Claude places the paper order and reads it back.', 'If you ask, Claude records the fill in Allocait.', 1, 2, false, true],
  ]
  const top = 186, pitch = 72, bottom = top + rows.length * pitch
  let b = frame(t, W, H)
  b += text(96, 116, 'One order, seven steps', { size: 36, w: 600, fill: t.head })
  b += text(96, 156, 'You decide. Claude carries. Allocait states.', { size: 26, fill: t.sub })
  for (const l of lanes) {
    b += text(l.x, 116, l.n, { size: 32, w: 600, fill: t.head, anchor: 'middle' })
    if (l.s) b += text(l.x, 152, l.s, { size: 24, fill: t.sub, anchor: 'middle' })
  }
  // row rules
  b += `<line x1="96" y1="${top}" x2="1664" y2="${top}" ${so(t.edge, 2)}/>`
  for (let i = 1; i < rows.length; i++) b += `<line x1="96" y1="${top + i * pitch}" x2="1664" y2="${top + i * pitch}" ${so(t.rule, 2)}/>`
  b += `<line x1="96" y1="${bottom}" x2="1664" y2="${bottom}" ${so(t.edge, 2)}/>`
  // lanes, with a gap where a line passes by without touching that party
  const GAP = 26
  lanes.forEach((l, li) => {
    const gaps = []
    rows.forEach((r, i) => {
      const lo = Math.min(r[2], r[3]), hi = Math.max(r[2], r[3])
      if (li > lo && li < hi) gaps.push(top + i * pitch + pitch / 2)
    })
    // rows next to each other share one gap
    const spans = []
    for (const g of gaps) {
      const last = spans[spans.length - 1]
      if (last && g - GAP - last[1] < 40) last[1] = g + GAP
      else spans.push([g - GAP, g + GAP])
    }
    let y0 = top
    for (const [from, to] of spans) {
      b += `<line x1="${l.x}" y1="${y0}" x2="${l.x}" y2="${from}" ${so(t.lane, 3)}/>`
      b += `<line x1="${l.x - 14}" y1="${from}" x2="${l.x + 14}" y2="${from}" ${so(t.lane, 3)}/><line x1="${l.x - 14}" y1="${to}" x2="${l.x + 14}" y2="${to}" ${so(t.lane, 3)}/>`
      y0 = to
    }
    b += `<line x1="${l.x}" y1="${y0}" x2="${l.x}" y2="${bottom}" ${so(t.lane, 3)}/>`
  })
  // rows
  rows.forEach(([main, sub, a, c, dashed, back], i) => {
    const cy = top + i * pitch + pitch / 2
    b += text(96, cy + 9, String(i + 1), { size: 26, fill: t.sub })
    if (sub) {
      b += text(144, cy - 3, main, { size: 28, fill: t.ink })
      b += text(144, cy + 26, sub, { size: 24, fill: t.sub })
    } else b += text(144, cy + 9, main, { size: 28, fill: t.ink })
    const arrow = (from, to, y, dash) => {
      const x1 = lanes[from].x, x2 = lanes[to].x, dir = x2 > x1 ? 1 : -1, base = x2 - dir * 16
      return `<line x1="${x1}" y1="${y}" x2="${base}" y2="${y}" stroke="${t.disc}" stroke-width="3"${dash ? ' stroke-dasharray="9 7"' : ''}/>` +
        `<circle cx="${x1}" cy="${y}" r="7" fill="${t.disc}" stroke="${t.ground}" stroke-width="3"/>` +
        `<polygon points="${x2},${y} ${base},${y - 8} ${base},${y + 8}" fill="${t.disc}"/>`
    }
    if (back) b += arrow(a, c, cy - 10, dashed) + arrow(c, a, cy + 10, true)
    else b += arrow(a, c, cy, dashed)
  })
  // one-line legend, drawn with the same marks
  const ly = bottom + 56
  b += `<line x1="96" y1="${ly - 8}" x2="150" y2="${ly - 8}" stroke="${t.disc}" stroke-width="3"/><polygon points="156,${ly - 8} 142,${ly - 15} 142,${ly - 1}" fill="${t.disc}"/>`
  b += text(176, ly, 'sent', { size: 24, fill: t.sub })
  b += `<line x1="270" y1="${ly - 8}" x2="324" y2="${ly - 8}" stroke="${t.disc}" stroke-width="3" stroke-dasharray="9 7"/><polygon points="330,${ly - 8} 316,${ly - 15} 316,${ly - 1}" fill="${t.disc}"/>`
  b += text(350, ly, 'returned', { size: 24, fill: t.sub })
  b += `<line x1="500" y1="${ly - 8}" x2="560" y2="${ly - 8}" stroke="${t.disc}" stroke-width="3"/>`
  b += `<line x1="530" y1="${ly - 38}" x2="530" y2="${ly - 28}" ${so(t.lane, 3)}/><line x1="516" y1="${ly - 28}" x2="544" y2="${ly - 28}" ${so(t.lane, 3)}/><line x1="530" y1="${ly + 12}" x2="530" y2="${ly + 22}" ${so(t.lane, 3)}/><line x1="516" y1="${ly + 12}" x2="544" y2="${ly + 12}" ${so(t.lane, 3)}/>`
  b += text(580, ly, 'a gap in a lane: the line passes by', { size: 24, fill: t.sub })
  b += text(96, ly + 56, 'Allocait and Alpaca never talk to each other. Claude carries the facts between them.', { size: 26, w: 500, fill: t.ink })
  b += text(96, ly + 94, 'In chat there is no hook. The skill tells Claude to run the check.', { size: 26, w: 500, fill: t.ink })

  return svg(W, H, 'One order, seven steps',
    'Four columns: You, Claude, Alpaca (your paper account) and Allocait (your rules). Step 1, you ask Claude to check an order. Step 2, Claude reads your paper account and last prices from Alpaca, and the answer is drawn dashed. Step 3, Claude sends Allocait the order and those prices. Step 4, Allocait returns what the order does to your ranges, drawn dashed because it is returned. Step 5, you read the facts and say yes or no. Step 6, in Claude Code, an installed hook asks you once more; it asks in default and accept-edits modes and refuses in others. Step 7, Claude places the paper order with Alpaca and reads it back, drawn dashed; if you ask, Claude records the fill in Allocait. Lines for steps 3 and 4 pass by the Alpaca column and send nothing to it. Allocait and Alpaca never talk to each other; Claude carries the facts between them. In chat there is no hook. The skill tells Claude to run the check.', b)
}

// ---------- social preview, 1280 x 640, solid dark ground ----------
// Two columns on one grid: 80 margins, a 520 left column (x 80 to 600), an 80 gutter, a 520 right column (680 to 1200).
// Rows: the card starts at the top margin (y 80), the title block is centered on the card, and the footer sits on the
// bottom baseline (y 560). The title's second line shares a baseline with the range caption in the card (y 306).
function social() {
  const t = T.dark
  const W = 1280, H = 640
  const L = 80, R = 680, COL = 520, TOP = 80, BASE = 560
  let b = `<rect width="${W}" height="${H}" fill="${t.ground}"/>`
  // Left column: title and tagline, centered on the card's height (the notice says it is open source).
  b += text(L, 222, 'Rules for AI', { size: 70, w: 650, fill: t.head, ls: -1.6 })
  b += text(L, 306, 'Trading Agents', { size: 70, w: 650, fill: t.head, ls: -1.6 })
  b += text(L, 366, TAGLINE[0], { size: 28, fill: t.sub })
  b += text(L, 404, TAGLINE[1], { size: 28, fill: t.sub })
  // Footer row on the bottom baseline: the maker on the left, the notice in the right column.
  b += mark(L, BASE - 24, 26, t.mark)
  b += text(L + 40, BASE, SIGN_OFF, { size: 22, w: 600, fill: t.ink })
  b += text(R, BASE - 32, NOTICE_A, { size: 20, fill: t.sub })
  b += text(R, BASE, NOTICE_B, { size: 20, fill: t.sub })
  // Right column: one card, top-aligned with the label, 32 inside.
  const x = R, y = TOP, w = COL, h = 400, P = 32, ix = x + P, iw = w - 2 * P, ir = ix + iw
  b += rect(x, y, w, h, 16, `fill="${t.card}"`, so(t.edge, 1.5))
  b += text(ix, y + 50, 'Claude', { size: 20, w: 600, fill: t.sub })
  b += text(ir, y + 50, ILLUSTRATION[1], { size: 17, fill: t.sub, anchor: 'end' })
  b += text(ix, y + 104, '1 rule newly outside range', { size: 30, w: 650, fill: t.head })
  b += text(ix, y + 156, 'Crypto band', { size: 21, w: 600, fill: t.ink })
  b += text(ir, y + 156, '0% before, 9% after', { size: 21, fill: t.ink, anchor: 'end' })
  // Whole numbers here, for reading at small sizes. The range bar is on a 0 to 10 percent scale: the owner's range 0 to
  // 7 is the solid part, and 9 sits past its end.
  const at = (pct) => ix + (iw * pct) / 10
  const by = y + 186
  b += rect(ix, by - 4, iw, 8, 4, fo(t.track))
  b += rect(ix, by - 4, at(7) - ix, 8, 4, `fill="${t.sub}"`)
  b += `<line x1="${at(7)}" y1="${by - 14}" x2="${at(7)}" y2="${by + 14}" stroke="${t.ink}" stroke-width="2"/>`
  b += `<circle cx="${ix + 9}" cy="${by}" r="9" fill="${t.card}" stroke="${t.ink}" stroke-width="3"/>`
  b += `<circle cx="${at(9)}" cy="${by}" r="9" fill="${t.ink}"/>`
  b += text(ix, by + 40, 'Your range: 0% to 7%', { size: 18, fill: t.sub })
  // The question and the two answers.
  b += text(ix, y + 304, 'Place it in your paper account?', { size: 23, w: 600, fill: t.ink })
  const bh = 44, btn = (bx, label, filled) =>
    rect(bx, y + 324, label === 'Yes' ? 92 : 80, bh, bh / 2, filled ? `fill="${t.ink}"` : `fill="none"`, filled ? '' : so(t.edge, 2)) +
    text(bx + (label === 'Yes' ? 46 : 40), y + 324 + 29, label, { size: 19, w: 600, fill: filled ? t.ground : t.ink, anchor: 'middle' })
  b += btn(ix, 'No', false) + btn(ix + 96, 'Yes', true)
  return svg(W, H, 'Rules for AI Trading Agents: an open-source example',
    `Open-source example. Rules for AI Trading Agents. Your own rules, checked before a paper order. ${SIGN_OFF} ${NOTICE_A} ${NOTICE_B} An illustration of Claude's answer: 1 rule newly outside range, the Crypto band at 0% before and 9% after against a range of 0% to 7%, and the question whether to place it in your paper account, with No and Yes. ${ILLUSTRATION[1]}`, b)
}

// ---------- plugin icon and tile, 128 square: a range bar, no wing mark, no other company's mark ----------
function glyph(g, bg) {
  // three ranges as rows: a faint track, a bright stretch, and on the last row a disc just past the end of its stretch
  return `<rect x="20" y="32" width="88" height="14" rx="7" fill="${g}" fill-opacity="0.3"/>
<rect x="20" y="32" width="62" height="14" rx="7" fill="${g}"/>
<rect x="20" y="57" width="88" height="14" rx="7" fill="${g}" fill-opacity="0.3"/>
<rect x="20" y="57" width="40" height="14" rx="7" fill="${g}"/>
<rect x="20" y="82" width="88" height="14" rx="7" fill="${g}" fill-opacity="0.3"/>
<rect x="20" y="82" width="50" height="14" rx="7" fill="${g}"/>
<circle cx="86" cy="89" r="13" fill="${g}" stroke="${bg}" stroke-width="5"/>`
}
function tile(kind) {
  const dark = kind === 'icon'
  const bg = dark ? '#0b0b0b' : '#f4f4f5', g = dark ? '#f4f4f5' : '#0b0b0b'
  const edge = dark ? 'stroke="#ffffff" stroke-opacity="0.22"' : 'stroke="#09090b" stroke-opacity="0.16"'
  return svg(128, 128, 'Rules for AI Trading Agents, ' + (dark ? 'plugin icon' : 'light tile'),
    `${dark ? 'A near-black' : 'A light'} rounded square holding a range bar: a long bar with a bright stretch, a ring at the left end and a solid disc just past the end of the stretch.`,
    `<rect x="1" y="1" width="126" height="126" rx="28" fill="${bg}" ${edge} stroke-width="2"/>\n${glyph(g, bg)}`)
}

// ---------- lockup, 1000 x 200, transparent: tile, title, label. No wing mark. ----------
function lockup(name) {
  const t = T[name]
  const dark = name === 'dark'
  const bg = dark ? '#f4f4f5' : '#0b0b0b', g = dark ? '#0b0b0b' : '#f4f4f5'
  const edge = dark ? '#09090b' : '#ffffff'
  const s = 104 / 128
  const tileSvg = `<g transform="translate(48 48) scale(${+s.toFixed(5)})"><rect x="1" y="1" width="126" height="126" rx="28" fill="${bg}" stroke="${edge}" stroke-opacity="0.22" stroke-width="2"/>${glyph(g, bg)}</g>`
  let b = tileSvg
  b += text(190, 94, TITLE, { size: 46, w: 600, fill: t.head, ls: -1 })
  b += pill(t, 190, 114, 'Open-source example', 22, 40, 20, false).svg
  return svg(1000, 200, 'Rules for AI Trading Agents, open-source example',
    'A neutral tile holding a range bar, then the title Rules for AI Trading Agents, then an outlined label that reads Open-source example. The tile is not a company mark.', b)
}

const files = {
  [join(IMAGES, 'hero.svg')]: hero('light'),
  [join(IMAGES, 'hero-dark.svg')]: hero('dark'),
  [join(IMAGES, 'flow.svg')]: flow('light'),
  [join(IMAGES, 'flow-dark.svg')]: flow('dark'),
  [join(BRAND, 'social-preview.svg')]: social(),
  [join(BRAND, 'icon.svg')]: tile('icon'),
  [join(BRAND, 'tile.svg')]: tile('tile'),
  [join(BRAND, 'lockup.svg')]: lockup('light'),
  [join(BRAND, 'lockup-dark.svg')]: lockup('dark'),
}
const flat = (p) => p.split('/').pop()
if (args.out) mkdirSync(args.out, { recursive: true })
else mkdirSync(IMAGES, { recursive: true })
for (const [p, s] of Object.entries(files)) writeFileSync(args.out ? join(args.out, flat(p)) : p, s)
console.log(`wrote ${Object.keys(files).length} files${args.out ? ` to ${args.out}` : ''}`)

// WCAG contrast, printed for BRAND.md
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return ((x + 0.05) / (y + 0.05)).toFixed(1)
}
if (!args.out) {
  for (const n of ['light', 'dark']) {
    const t = T[n]
    console.log(n, 'ink/ground', ratio(t.ink, t.ground), 'ink/card', ratio(t.ink, t.card), 'head/ground', ratio(t.head, t.ground), 'sub/ground', ratio(t.sub, t.ground), 'sub/card', ratio(t.sub, t.card), 'mark/ground', ratio(t.mark, t.ground), 'disc/card', ratio(t.disc, t.card))
  }
  console.log('icon glyph/tile', ratio('#f4f4f5', '#0b0b0b'), 'tile glyph', ratio('#0b0b0b', '#f4f4f5'))
}
