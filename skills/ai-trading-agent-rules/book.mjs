#!/usr/bin/env node
// Arithmetic for the ai-trading-agent-rules skill, so the model does none. Pure functions, no network, no dependencies.
// It reads what Alpaca's tools returned and prints JSON. It states no verdict: Allocait's check_trades and
// check_allocations do that.
//
// Pass only what it reads, as plain JSON on stdin. Each position needs these six fields and no others:
//   symbol, qty, current_price, market_value, side, asset_class
// and the account needs cash and equity. Alpaca's own wrapper ({ data: ... }, { data: { result: [...] } }) is also read.
// `today` is optional: the US Eastern date as YYYY-MM-DD (the first ten characters of get_clock's `timestamp`). An
// option expires the day after its date, so it is read once. Without it the machine clock gives the US Eastern date.
//
//   echo '{"account": {"cash": "..", "equity": ".."}, "positions": [..]}' | node book.mjs rows
//   ... | node book.mjs percents            (add "allocait": {"ALFA": 61}, the holdings Allocait records)
//   echo '{"positions": [..], "allocait": {"ALFA": 61}}' | node book.mjs diff
//   echo '{"positions": [..], "order": {"symbol": "ALFA", "side": "sell", "qty": "5"}}' | node book.mjs order
//   node book.mjs rows input.json            (the same JSON in a file, when a long pipe is awkward)
//
// One definition of a supported position, `classify`, is read by rows, percents, diff and order:
//   long stock, ETF or pair quoted in USD      shares = qty
//   long option (OCC symbol, whole contracts)  shares = contracts x 100, price = per-share premium, class Options
//   short stock                                shares = -qty, class Equities (the owner's label)
// Everything else is listed in `stop` and left out of the rest: a written option, a short pair, a pair not quoted in
// USD, an option past its expiry or with a symbol Allocait cannot read, an unreadable number, and a position whose
// market value is not quantity x multiplier x price. `partial` is then true, so the skill can show the owner what was
// left out before it writes anything. A problem with the account itself (cash or equity unreadable, negative cash)
// makes `ok` false and returns no rows.
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLASS = { us_equity: 'Equities', crypto: 'Crypto', us_option: 'Options' }
const MULTIPLIER = 100
const OCC = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/
const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v))
// ECHO/USD and ECHOUSD are two symbols in Allocait, so a slash is kept in the comparison.
const key = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places
const sumOf = (list, f) => list.reduce((n, x) => n + f(x), 0)

/** Alpaca answers wrap data as { data: ... } and lists as { data: { result: [...] } }. Plain values pass through. */
const accountOf = (v) => v?.data ?? v ?? {}
/** The list of positions, or null when the input is not in a shape this reads (an empty list is an account holding nothing). */
const positionsOf = (v) => {
  const list = v?.data?.result ?? v?.data ?? v?.result ?? v
  return Array.isArray(list) ? list : null
}

/**
 * Allocait stores a share count as round(shares, 6), half away from zero. A plain decimal string is rounded on its digits,
 * so 0.1234565 reads 0.123457 as the database's numeric does; anything else goes through Number. Returns a finite number.
 */
export function round6(value) {
  const m = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(typeof value === 'string' ? value.trim() : String(value))
  if (!m) {
    const n = Number(value)
    return n === 0 ? 0 : Math.sign(n) * (Math.round(Math.abs(n) * 1e6) / 1e6)
  }
  const frac = (m[3] ?? '').padEnd(7, '0')
  const n = Number(BigInt(m[2] + frac.slice(0, 6)) + (frac[6] >= '5' ? 1n : 0n)) / 1e6
  return n === 0 ? 0 : m[1] === '-' ? -n : n
}

/** Allocait stores a pair as BASE/USD. Alpaca may list a held pair as BASEUSD. Other quote currencies are not mirrored. */
export function symbolOf(position) {
  const symbol = String(position?.symbol ?? '').trim().toUpperCase()
  if (position?.asset_class !== 'crypto' || symbol.includes('/')) return symbol
  const m = /^([A-Z0-9]{2,10})USD$/.exec(symbol)
  return m ? `${m[1]}/USD` : symbol
}

/** The US Eastern date. A well-formed `today` from the caller wins; otherwise the machine clock, in US Eastern. */
const EASTERN = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
export function todayOf(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : EASTERN.format(new Date())
}

/** The expiry date (YYYY-MM-DD) of an OCC symbol Allocait can read, or null. Same reading as private.occ_parse. */
export function expiryOf(symbol) {
  const m = OCC.exec(String(symbol ?? ''))
  if (!m) return null
  const [year, month, day] = [2000 + Number(m[2]), Number(m[3]), Number(m[4])]
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${year}-${m[3]}-${m[4]}`
}
const isExpired = (symbol, today) => {
  const on = expiryOf(symbol)
  return on !== null && on < today
}

/**
 * The one definition of a supported position. Returns { item } for a position this example mirrors, or { symbol, reason }
 * for one it leaves out. Reads only the six fields. A short's direction comes from `side` and abs(qty), and its value is
 * recomputed, because the sign Alpaca gives qty and market_value for a short is not confirmed here. Every position's
 * market value must match quantity x multiplier x price (to a cent or 0.1 percent), which is what catches an option
 * priced per contract or a missing x100.
 */
function classify(p, today) {
  const symbol = symbolOf(p)
  const out = (reason) => ({ symbol, reason })
  const cls = p?.asset_class
  if (!(cls in CLASS)) return out(`asset class ${cls ?? 'unknown'} is not mirrored here`)
  const qty = num(p?.qty)
  const price = num(p?.current_price)
  const market = num(p?.market_value)
  if (!Number.isFinite(qty) || !Number.isFinite(price) || !Number.isFinite(market) || price < 0) return out('a number could not be read')
  // Nothing held: Allocait stores no row for it, so it is not an item (and not a difference).
  if (qty === 0) return { zero: true }
  if (qty < 0 && p.side === 'long') return out('side and quantity disagree')
  const short = p.side === 'short' || qty < 0
  // Allocait keeps a count to 6 places, so that count is the one mirrored, priced and compared.
  const count = Math.abs(round6(p.qty))
  if (count === 0) return out('a quantity below 0.000001 is not recorded')
  let kind
  let multiplier = 1
  if (cls === 'us_option') {
    if (short) return out('a written option is not mirrored: Allocait holds options long only')
    if (expiryOf(symbol) === null) return out('an option symbol Allocait cannot read is not mirrored')
    if (!Number.isInteger(Math.abs(qty))) return out('an option count that is not whole contracts is not mirrored')
    if (isExpired(symbol, today)) return out('an option past its expiry is not mirrored: Allocait counts it 0')
    kind = 'option'
    multiplier = MULTIPLIER
  } else if (cls === 'crypto') {
    if (short) return out('a short pair is not mirrored here')
    if (!/^[A-Z0-9]{2,10}\/USD$/.test(symbol)) return out('a pair that does not end in USD is not mirrored here')
    kind = 'pair'
  } else kind = short ? 'short' : 'stock'
  const shares = (short ? -count : count) * multiplier
  const exact = shares * price
  // A long position's market value is positive; a short's sign is not relied on.
  const gap = kind === 'short' ? Math.abs(Math.abs(market) - Math.abs(exact)) : Math.abs(market - exact)
  const tolerance = Math.max(0.02, 0.001 * Math.abs(market))
  if (gap > tolerance) return out('market value does not match quantity times price')
  return { item: { symbol, shares, price, kind, tolerance, value: kind === 'option' || kind === 'short' ? exact : market, asset_class: kind === 'option' ? 'Options' : CLASS[cls] } }
}

function read(account, positions, today) {
  const acct = accountOf(account)
  const list = positionsOf(positions)
  const readable = list !== null
  let items = []
  const stop = []
  for (const p of list ?? []) {
    const c = classify(p, today)
    if (c.item) items.push(c.item)
    else if (!c.zero) stop.push({ item: c.symbol || 'UNKNOWN', reason: c.reason })
  }
  if (!readable) stop.push({ item: 'POSITIONS', reason: 'the positions could not be read' })
  // Allocait refuses one symbol listed twice (ECHO/USD and ECHOUSD are one pair), so a repeated symbol is left out whole.
  const count = new Map()
  for (const i of items) count.set(key(i.symbol), (count.get(key(i.symbol)) ?? 0) + 1)
  for (const [k, n] of count) {
    if (n < 2) continue
    stop.push({ item: items.find((i) => key(i.symbol) === k).symbol, reason: 'the symbol is listed more than once, so none of it is mirrored' })
    items = items.filter((i) => key(i.symbol) !== k)
  }
  const cash = num(acct.cash)
  const equity = num(acct.equity ?? acct.portfolio_value)
  let account_ok = readable
  if (!Number.isFinite(cash) || !Number.isFinite(equity)) {
    account_ok = false
    stop.push({ item: 'ACCOUNT', reason: 'cash or equity could not be read' })
  } else if (cash < 0) {
    account_ok = false
    stop.push({ item: 'ACCOUNT', reason: 'cash is negative (margin in use)' })
  }
  return { items, stop, cash, equity, account_ok, readable }
}

const ACCOUNT_GAP = { item: 'ACCOUNT', reason: 'equity does not equal cash plus the positions listed' }

/**
 * Whether Alpaca's equity equals its cash plus the signed rows. It applies only when the account holds an option or a
 * short, and nothing was left out (a left-out item explains a gap). A book of long stock and pairs keeps the old rule:
 * the rounding residue folds into CASH. The tolerance in dollars is the sum of the positions' own tolerances, at least 0.50.
 */
function reconcile(r) {
  const special = r.items.some((i) => i.kind === 'option' || i.kind === 'short')
  const total = r.cash + sumOf(r.items, (i) => i.shares * i.price)
  const gap = r.equity - total
  const tolerance = Math.max(0.5, sumOf(r.items, (i) => i.tolerance))
  return { special, total, gap, unreconciled: special && r.stop.length === 0 && Math.abs(gap) > tolerance }
}

/** Up to the next cent, so recorded cash never ends below the exact figure. Only float noise is absorbed. */
function ceilCents(x) {
  const c = x * 100
  const n = Math.round(c)
  return (Math.abs(c - n) <= Math.max(1e-9, Math.abs(c) * 1e-15) ? n : Math.ceil(c)) / 100
}

/**
 * Each supported position as an Allocait row (send them to replace_positions as `positions`), with a price map for
 * check_trades. Nothing is written here. `deposit` is the cash to record before the rows: Alpaca's cash plus the signed
 * value of the rows at their prices (a short is negative), rounded up to the cent, so Allocait's cash ends at Alpaca's
 * cash or at most a cent above it and a fully invested account is never refused for cash. 0 means record none. With
 * nothing left out it equals `equity` to within that cent. A share count has at most 6 decimals, as Allocait keeps it. `equity_gap` is `equity` minus `allocait_total`, the total Allocait
 * will read after the mirror.
 */
export function rows(account, positions, today) {
  const r = read(account, positions, todayOf(today))
  const none = { ok: r.account_ok, partial: false, equity: r.equity, cash: r.cash, deposit: null, allocait_total: null, equity_gap: null, allow_shorts_needed: false, rows: [], prices: {}, stop: r.stop }
  if (!r.account_ok) return none
  let items = r.items
  let stop = r.stop
  const exact = r.cash + sumOf(items, (i) => i.shares * i.price)
  if (exact < -0.005) return { ...none, ok: false, stop: [...stop, { item: 'ACCOUNT', reason: 'what is left out outweighs the account: the opening cash would be below zero' }] }
  const deposit = Math.max(0, ceilCents(exact)) || 0
  // Allocait refuses a long row while cash is 0 or less, and only a short sold at a price puts cash in first.
  if (deposit === 0 && !items.some((i) => i.shares < 0 && i.price > 0)) {
    const zero = items.filter((i) => i.shares > 0 && i.shares * i.price === 0)
    items = items.filter((i) => !zero.includes(i))
    stop = [...stop, ...zero.map((i) => ({ item: i.symbol, reason: 'a position worth 0 cannot be recorded while there is no cash' }))]
  }
  const rec = reconcile(r)
  if (rec.unreconciled) stop = [...stop, ACCOUNT_GAP]
  return {
    ok: true,
    partial: stop.length > 0,
    equity: r.equity,
    cash: r.cash,
    deposit,
    allocait_total: round(exact, 2),
    equity_gap: round(r.equity - exact, 2),
    allow_shorts_needed: items.some((i) => i.shares < 0),
    rows: items.map(({ symbol, shares, price, asset_class, kind }) => (kind === 'option' ? { symbol, shares, price, asset_class, mark: price } : { symbol, shares, price, asset_class })),
    prices: Object.fromEntries(items.map((i) => [i.symbol, i.price])),
    stop,
  }
}

/**
 * Percent of account value per symbol, with CASH; a short is negative and an option is its premium value. With nothing
 * skipped and no option or short the map sums to exactly 100 (the rounding residue goes to CASH). With an option or a
 * short, the residue folds into CASH only when equity matches cash plus the positions; otherwise `unreconciled_pct`
 * carries it and `stop` names ACCOUNT. With something skipped, CASH is Alpaca's cash as a percent and `skipped_pct` is
 * the rest: the part of the account value this example does not read (negative when a written option was left out).
 * `asset_classes` names only the symbols `allocait` does not hold.
 */
export function percents(account, positions, allocait = {}, today) {
  const r = read(account, positions, todayOf(today))
  const allocations = {}
  const asset_classes = {}
  // A symbol Allocait already holds keeps the class it has there: sending the label would override it (check_allocations).
  const held = new Set(Object.keys(allocait ?? {}).map(key))
  const usable = r.account_ok && r.equity > 0
  const rec = reconcile(r)
  let stop = r.stop
  if (r.account_ok && !(r.equity > 0)) stop = [...stop, { item: 'ACCOUNT', reason: 'equity is zero or below, so no percent can be read' }]
  let sum = 0
  let skipped_pct = 0
  let unreconciled_pct = 0
  // What is left for CASH. Rounding each percent can leave a fully invested account a hair below zero: the largest
  // holding takes that hair, so the map still sums to 100 and CASH reads 0.
  const cashRest = () => {
    const rest = round(100 - sum, 4)
    if (!(rest < 0 && rest > -0.01) || !r.items.length) return rest
    const top = r.items.reduce((a, p) => (Math.abs(allocations[p.symbol]) > Math.abs(allocations[a.symbol]) ? p : a)).symbol
    allocations[top] = round(allocations[top] + rest, 4)
    return 0
  }
  if (usable) {
    for (const p of r.items) {
      const pct = round((p.value / r.equity) * 100, 4)
      allocations[p.symbol] = pct
      if (!held.has(key(p.symbol))) asset_classes[p.symbol] = p.asset_class
      sum += pct
    }
    if (r.stop.length === 0 && !rec.special) allocations.CASH = cashRest()
    else {
      allocations.CASH = round((r.cash / r.equity) * 100, 4)
      const rest = round(100 - sum - allocations.CASH, 4)
      if (r.stop.length > 0) skipped_pct = rest
      else if (rec.unreconciled) {
        unreconciled_pct = rest
        stop = [...stop, ACCOUNT_GAP]
      } else allocations.CASH = cashRest()
    }
  }
  const partial = usable && stop.length > 0
  const ok = usable && (partial || allocations.CASH >= 0)
  return {
    ok,
    partial,
    equity: r.equity,
    allocations: ok ? allocations : {},
    asset_classes: ok ? asset_classes : {},
    skipped_pct: ok && partial ? skipped_pct : 0,
    ...(rec.special && { unreconciled_pct: ok ? unreconciled_pct : 0 }),
    stop,
  }
}

/**
 * Compares only exact things: the set of held symbols and each signed share count (an option is contracts x 100, a short
 * is negative). Alpaca's positions that this example does not mirror are left out of both sides and named in `stop`, so a
 * held option never shows as a difference. An option Allocait holds past its expiry is not a difference either: it is in
 * `expired_allocait` as a ready row (shares 0, price 0, which books no cash). A symbol Allocait holds that `stop` leaves
 * out is in `held_left_out`: a replace_positions call that omits it is refused. Both keys appear only when not empty, and either one makes `in_step` false.
 */
export function diff(positions, allocait, today) {
  const t = todayOf(today)
  const r = read({ cash: '0', equity: '0' }, positions, t)
  // With no readable positions every holding would look closed: report that and compare nothing.
  if (!r.readable) return { in_step: false, partial: true, only_alpaca: [], only_allocait: [], different: [], stop: r.stop }
  const skippedKeys = new Map(r.stop.filter((s) => s.item !== 'ACCOUNT').map((s) => [key(s.item), s.reason]))
  const heldNow = Object.entries(allocait ?? {}).filter(([, n]) => Number(n) !== 0)
  const expired_allocait = heldNow.filter(([s]) => isExpired(key(s), t)).map(([s]) => ({ symbol: s, shares: 0, price: 0 }))
  const expiredKeys = new Set(expired_allocait.map((x) => key(x.symbol)))
  const held_left_out = heldNow.filter(([s]) => !expiredKeys.has(key(s)) && skippedKeys.has(key(s))).map(([s]) => ({ symbol: s, reason: skippedKeys.get(key(s)) }))
  const mine = new Map(Object.entries(allocait ?? {}).filter(([s]) => !skippedKeys.has(key(s)) && !expiredKeys.has(key(s))).map(([s, n]) => [key(s), { symbol: s, shares: Number(n) }]))
  const theirs = new Map(r.items.map((p) => [key(p.symbol), { symbol: p.symbol, shares: p.shares }]))
  const only_alpaca = [...theirs].filter(([k]) => !mine.has(k)).map(([, v]) => v.symbol)
  const only_allocait = [...mine].filter(([k]) => !theirs.has(k)).map(([, v]) => v.symbol)
  const different = [...theirs]
    .filter(([k, v]) => mine.has(k) && Math.abs(mine.get(k).shares - v.shares) > 1e-6)
    .map(([k, v]) => ({ symbol: v.symbol, alpaca: v.shares, allocait: mine.get(k).shares }))
  const stop = r.stop.filter((s) => s.item !== 'ACCOUNT')
  return {
    in_step: !only_alpaca.length && !only_allocait.length && !different.length && !expired_allocait.length && !held_left_out.length,
    partial: stop.length > 0,
    only_alpaca,
    only_allocait,
    different,
    stop,
    ...(expired_allocait.length > 0 && { expired_allocait }),
    ...(held_left_out.length > 0 && { held_left_out }),
  }
}

/**
 * Whether an order is one this skill places. `held` is the signed share count the account holds in the symbol (0 when
 * none), for the check's `shares_before`. `outside_skill` is true for an option order, for any order in a symbol the
 * account holds short, and for a SELL of more than the account holds long (a dollar amount is read at the position's
 * current_price). It also reads true for a symbol the account holds that this example cannot read.
 */
export function order(positions, ord, today) {
  const r = read({ cash: '0', equity: '0' }, positions, todayOf(today))
  const symbol = String(ord?.symbol ?? '').trim().toUpperCase()
  const k = key(symbol)
  const mine = r.items.find((i) => key(i.symbol) === k)
  const left = r.stop.find((s) => s.item !== 'ACCOUNT' && key(s.item) === k)
  const held = mine ? mine.shares : 0
  const outside = (reason) => ({ outside_skill: true, reason, held })
  if (!r.readable) return outside('the positions could not be read')
  // A held pair written without its slash is another symbol in Allocait and in the hook, so it is not read as the held one.
  const bare = /^([A-Z0-9]{2,10})USD$/.exec(symbol)
  if (bare && [...r.items.map((i) => i.symbol), ...r.stop.map((s) => s.item)].some((x) => key(x) === `${bare[1]}/USD`)) {
    return outside(`write the pair as ${bare[1]}/USD, with the slash`)
  }
  const side = String(ord?.side ?? '').toLowerCase()
  if (OCC.test(symbol)) return outside('an option order is not placed from this skill')
  if (side !== 'buy' && side !== 'sell') return outside('the side could not be read')
  if (left) return outside(`the account holds ${symbol} and this skill does not read it: ${left.reason}`)
  if (held < 0) return outside(`the account holds ${symbol} short, so an order in it covers or extends the short`)
  if (side === 'sell') {
    if (held <= 0) return outside(`a SELL of ${symbol}, which the account does not hold long, opens a short`)
    const qty = num(ord?.qty)
    const amount = Number.isFinite(qty) ? qty : num(ord?.notional) / mine.price
    if (!(amount > 0)) return outside('the quantity could not be read')
    if (amount > held + 1e-9) return outside(`a SELL of more than the account holds long in ${symbol} opens a short`)
  }
  return { outside_skill: false, reason: null, held }
}

function main() {
  const command = process.argv[2]
  let input
  try {
    input = JSON.parse(readFileSync(process.argv[3] ?? 0, 'utf8'))
  } catch {
    return fail('stdin is not JSON')
  }
  if (command === 'rows') return print(rows(input.account, input.positions, input.today))
  if (command === 'percents') return print(percents(input.account, input.positions, input.allocait, input.today))
  if (command === 'diff') return print(diff(input.positions, input.allocait, input.today))
  if (command === 'order') return print(order(input.positions, input.order, input.today))
  fail('usage: node book.mjs rows|percents|diff|order, JSON on stdin')
}
const print = (v) => process.stdout.write(JSON.stringify(v, null, 2) + '\n')
function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main()
