import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rows, percents, diff, order, symbolOf, todayOf, expiryOf, round6 } from '../skills/ai-trading-agent-rules/book.mjs'

const BOOK = fileURLToPath(new URL('../skills/ai-trading-agent-rules/book.mjs', import.meta.url))
const fixture = JSON.parse(readFileSync(new URL('./fixtures/alpaca-positions.example.json', import.meta.url), 'utf8'))
const { account, positions } = fixture
const position = (over) => ({ symbol: 'ALFA', qty: '10', current_price: '5', market_value: '50', asset_class: 'us_equity', side: 'long', ...over })
const run = (command, input) => spawnSync('node', [BOOK, command], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' })
const round4 = (n) => Math.round(n * 1e4) / 1e4
const sum = (o) => Math.round(Object.values(o).reduce((a, b) => a + b, 0) * 1e6) / 1e6

test('rows prints the deposit that leaves Allocait cash at Alpaca cash, equal to equity when nothing is left out', () => {
  const pair = position({ symbol: 'ECHOUSD', asset_class: 'crypto', qty: '0.5', current_price: '100', market_value: '50' })
  const option = position({ symbol: 'ALFA991218C00027000', asset_class: 'us_option', qty: '1', current_price: '2', market_value: '200' })
  // A pair and a long option both mirror, so the deposit is the whole account value and nothing is left out.
  const all = rows({ cash: '5', equity: '255' }, [pair, option])
  assert.equal(all.partial, false)
  assert.equal(all.deposit, 255)
  assert.equal(all.equity_gap, 0)
  // A pair not quoted in USD is left out, so its value is the gap and is not deposited as cash.
  const eur = position({ symbol: 'GOLFEUR', asset_class: 'crypto', qty: '1', current_price: '30', market_value: '30' })
  const left = rows({ cash: '5', equity: '285' }, [pair, option, eur])
  assert.equal(left.partial, true)
  assert.equal(left.deposit, 255)
  assert.equal(left.equity_gap, 30)
  assert.equal(rows({ cash: '5', equity: '55' }, [pair]).deposit, 55)
  assert.equal(rows({ cash: '-5', equity: '55' }, [pair]).deposit, null)
  // The fixture: cash plus each row at its price, to the cent.
  const f = rows(account, positions)
  assert.equal(f.deposit, 10321.55)
  assert.equal(f.allocait_total, 10321.55)
  assert.equal(f.equity_gap, 0)
  assert.equal(f.allow_shorts_needed, false)
})

test('rows maps wrapped Alpaca answers into Allocait rows, numbers parsed, with a price map', () => {
  const r = rows(account, positions)
  assert.equal(r.ok, true)
  assert.equal(r.partial, false)
  assert.equal(r.cash, 4118.6)
  assert.equal(r.equity, 10321.55)
  assert.deepEqual(r.rows.map((x) => x.symbol), ['ALFA', 'BRAV', 'ECHO/USD'])
  assert.deepEqual(r.rows[1], { symbol: 'BRAV', shares: 37.5, price: 93.11, asset_class: 'Equities' })
  assert.equal(r.rows[2].asset_class, 'Crypto')
  assert.deepEqual(r.prices, { ALFA: 41.37, BRAV: 93.11, 'ECHO/USD': 75.1 })
  assert.deepEqual(r.stop, [])
})

test('plain values work as well as Alpaca wrappers, and only the six position fields are read', () => {
  const bare = rows({ cash: '5', equity: '55' }, [position({ extra: 'ignored', avg_entry_price: 'x', unrealized_pl: 'not a number' })])
  assert.equal(bare.ok, true)
  assert.deepEqual(bare.rows, [{ symbol: 'ALFA', shares: 10, price: 5, asset_class: 'Equities' }])
})

test('a pair listed as ECHOUSD gets its slash back and a slash pair is left alone', () => {
  assert.equal(symbolOf({ symbol: 'ECHOUSD', asset_class: 'crypto' }), 'ECHO/USD')
  assert.equal(symbolOf({ symbol: 'ECHO/USD', asset_class: 'crypto' }), 'ECHO/USD')
  assert.equal(symbolOf({ symbol: 'ALFA', asset_class: 'us_equity' }), 'ALFA')
})

test('rows lists a written option, a short pair, an unknown class, a non-USD pair, an unreadable number, an expired option, a non-OCC symbol and a fractional contract in stop, and still returns the rest', () => {
  const list = [
    position(),
    position({ symbol: 'BRAV261218P00090000', asset_class: 'us_option', qty: '-2', current_price: '1.15', market_value: '-230', side: 'short' }),
    position({ symbol: 'CHARUSD', asset_class: 'crypto', qty: '-3', market_value: '-15', side: 'short' }),
    position({ symbol: 'DELT', asset_class: 'something_new' }),
    position({ symbol: 'ECHOEUR', asset_class: 'crypto' }),
    position({ symbol: 'FOXT', qty: 'abc' }),
    position({ symbol: 'GOLF261016C00030000', asset_class: 'us_option', qty: '1', current_price: '0.05', market_value: '5' }),
    position({ symbol: 'HOTL', asset_class: 'us_option', qty: '1', current_price: '2', market_value: '200' }),
    position({ symbol: 'ALFA261218C00050000', asset_class: 'us_option', qty: '1.5', current_price: '2', market_value: '300' }),
    position({ symbol: 'BRAV', qty: '-3', market_value: '-15', side: 'long' }),
    position({ symbol: 'CHAR', qty: '2', current_price: '-1', market_value: '-2' }),
  ]
  const r = rows({ cash: '5', equity: '100' }, list, '2026-11-14')
  assert.equal(r.ok, true)
  assert.equal(r.partial, true)
  assert.deepEqual(r.rows.map((x) => x.symbol), ['ALFA'])
  assert.deepEqual(r.stop.map((s) => s.item), ['BRAV261218P00090000', 'CHAR/USD', 'DELT', 'ECHOEUR', 'FOXT', 'GOLF261016C00030000', 'HOTL', 'ALFA261218C00050000', 'BRAV', 'CHAR'])
  assert.deepEqual(r.stop.map((s) => s.reason), [
    'a written option is not mirrored: Allocait holds options long only',
    'a short pair is not mirrored here',
    'asset class something_new is not mirrored here',
    'a pair that does not end in USD is not mirrored here',
    'a number could not be read',
    'an option past its expiry is not mirrored: Allocait counts it 0',
    'an option symbol Allocait cannot read is not mirrored',
    'an option count that is not whole contracts is not mirrored',
    'side and quantity disagree',
    'a number could not be read',
  ])
})

test('rows is not ok, and returns no rows, for negative cash or an unreadable account', () => {
  for (const acct of [{ cash: '-5', equity: '10' }, { cash: '5' }, {}]) {
    const r = rows(acct, [position()])
    assert.equal(r.ok, false)
    assert.deepEqual(r.rows, [])
    assert.equal(r.stop.at(-1).item, 'ACCOUNT')
  }
})

test('percents sums to exactly 100 with CASH and names each symbol class', () => {
  const p = percents(account, positions)
  assert.equal(p.ok, true)
  assert.equal(p.partial, false)
  assert.equal(sum(p.allocations), 100)
  assert.deepEqual(Object.keys(p.allocations), ['ALFA', 'BRAV', 'ECHO/USD', 'CASH'])
  assert.deepEqual(p.asset_classes, { ALFA: 'Equities', BRAV: 'Equities', 'ECHO/USD': 'Crypto' })
  assert.equal(p.skipped_pct, 0)
})

test('percents names a class only for a symbol Allocait does not hold, so a held class is never overridden', () => {
  const held = { ALFA: 61, 'ECHO/USD': 2.5 }
  const p = percents(account, positions, held)
  assert.deepEqual(p.asset_classes, { BRAV: 'Equities' })
  assert.deepEqual(Object.keys(p.allocations), ['ALFA', 'BRAV', 'ECHO/USD', 'CASH'])
  // No holdings given: every symbol is new to Allocait.
  assert.equal(Object.keys(percents(account, positions).asset_classes).length, 3)
  assert.equal(Object.keys(percents(account, positions, null).asset_classes).length, 3)
  // A pair held without the slash is a different symbol in Allocait, so the pair still needs its class.
  assert.deepEqual(percents(account, positions, { ALFA: 61, BRAV: 37.5, ECHOUSD: 2.5 }).asset_classes, { 'ECHO/USD': 'Crypto' })
  // As a command, from stdin.
  const out = JSON.parse(run('percents', { account, positions, allocait: held }).stdout)
  assert.deepEqual(out.asset_classes, { BRAV: 'Equities' })
})

test('percents of a fully invested account stays ok when rounding leaves CASH a hair below zero', () => {
  const full = percents({ cash: '0', equity: '2212387.07' }, [
    position({ symbol: 'ECHO/USD', asset_class: 'crypto', qty: '390', current_price: '590.32', market_value: '230224.80' }),
    position({ symbol: 'ALFA', qty: '2.524', current_price: '3904.58', market_value: '9855.16' }),
    position({ symbol: 'BRAV', qty: '454.3', current_price: '4341.42', market_value: '1972307.11' }),
  ])
  assert.equal(full.ok, true)
  assert.equal(full.allocations.CASH, 0)
  assert.equal(sum(full.allocations), 100)
  // The largest holding took the hair: 89.1484 became 89.1483.
  assert.equal(full.allocations.BRAV, 89.1483)
})

test('percents with something skipped keeps CASH as cash and reports the skipped part, never folding it into CASH', () => {
  const list = [position({ symbol: 'ALFA', qty: '10', current_price: '5', market_value: '50' }), position({ symbol: 'ECHOEUR', asset_class: 'crypto', qty: '1', current_price: '200', market_value: '200' })]
  const p = percents({ cash: '50', equity: '300' }, list)
  assert.equal(p.ok, true)
  assert.equal(p.partial, true)
  assert.deepEqual(p.allocations, { ALFA: 16.6667, CASH: 16.6667 })
  assert.equal(p.skipped_pct, 66.6666)
  assert.equal(p.stop.length, 1)
})

test('percents is not ok when equity is 0 or below or the residue is negative; no positions is CASH 100', () => {
  assert.equal(percents({ cash: '0', equity: '0' }, []).ok, false)
  assert.equal(percents({ cash: '0', equity: '-1' }, []).ok, false)
  assert.equal(percents({ cash: '0', equity: '10' }, [position({ market_value: '50' })]).ok, false)
  const none = percents({ cash: '10', equity: '10' }, [])
  assert.equal(none.ok, true)
  assert.deepEqual(none.allocations, { CASH: 100 })
})

test('diff names only-Alpaca, only-Allocait and changed share counts, keeps a slash, and compares nothing else', () => {
  assert.deepEqual(diff(positions, { ALFA: 61, 'ECHO/USD': 2.5, GOLF: 4 }), {
    in_step: false, partial: false, only_alpaca: ['BRAV'], only_allocait: ['GOLF'], different: [], stop: [],
  })
  assert.equal(diff(positions, { ALFA: 61, BRAV: 37.5, 'ECHO/USD': 2.5 }).in_step, true)
  // ECHOUSD and ECHO/USD are two symbols in Allocait, so a pair held without the slash shows as a difference.
  const slashless = diff(positions, { ALFA: 61, BRAV: 37.5, ECHOUSD: 2.5 })
  assert.equal(slashless.in_step, false)
  assert.deepEqual([slashless.only_alpaca, slashless.only_allocait], [['ECHO/USD'], ['ECHOUSD']])
  assert.deepEqual(diff(positions, { ALFA: 60, BRAV: 37.5, 'ECHO/USD': 2.5 }).different, [{ symbol: 'ALFA', alpaca: 61, allocait: 60 }])
})

test('diff leaves a position it does not mirror out of both sides, and says so', () => {
  const written = position({ symbol: 'BRAV261218P00090000', asset_class: 'us_option', qty: '-2', current_price: '1.15', market_value: '-230', side: 'short' })
  const d = diff([position(), written], { ALFA: 10 })
  assert.equal(d.in_step, true)
  assert.equal(d.partial, true)
  assert.deepEqual(d.stop.map((s) => s.item), ['BRAV261218P00090000'])
  assert.equal('held_left_out' in d, false)
})

// Made-up odd numbers. Example 1: a long stock, a long option and a short stock; cash plus the signed rows is equity.
const ex = JSON.parse(readFileSync(new URL('./fixtures/alpaca-positions.options-shorts.example.json', import.meta.url), 'utf8'))
const OPTION = 'ALFA261218C00050000'
const optionRow = { symbol: OPTION, shares: 300, price: 2.35, asset_class: 'Options', mark: 2.35 }
const shortRow = { symbol: 'BRAV', shares: -21, price: 93.11, asset_class: 'Equities' }
const written = () => position({ symbol: 'CHAR261218P00090000', asset_class: 'us_option', qty: '-2', current_price: '1.15', market_value: '-230', side: 'short' })
const expired = () => position({ symbol: 'DELT261016C00030000', asset_class: 'us_option', qty: '1', current_price: '0.05', market_value: '5' })

test('rows maps a long option to contracts x 100 shares at the per-share premium, with its mark and the Options class', () => {
  const r = rows(ex.account, ex.positions, ex.today)
  assert.deepEqual(r.rows.find((x) => x.symbol === OPTION), optionRow)
  assert.deepEqual(r.rows.map((x) => x.asset_class), ['Equities', 'Options', 'Equities'])
  assert.deepEqual(r.prices, { ALFA: 41.37, [OPTION]: 2.35, BRAV: 93.11 })
  // Only an option carries a mark.
  assert.deepEqual(r.rows.filter((x) => 'mark' in x).map((x) => x.symbol), [OPTION])
})

test('rows maps a short stock to a negative count whichever sign Alpaca gives qty, and says allow_shorts_needed', () => {
  const negative = rows(ex.account, ex.positions, ex.today)
  assert.deepEqual(negative.rows.find((x) => x.symbol === 'BRAV'), shortRow)
  assert.equal(negative.allow_shorts_needed, true)
  const flipped = positions.data.result // a different book: only the short is read here
  assert.ok(flipped.length > 0)
  const list = ex.positions.data.result.map((p) => (p.symbol === 'BRAV' ? { ...p, qty: '21', market_value: '1955.31' } : p))
  assert.deepEqual(rows(ex.account, list, ex.today), negative)
  // A negative qty with no side is read as a short; a long with a negative qty disagrees with itself.
  const noSide = ex.positions.data.result.map((p) => (p.symbol === 'BRAV' ? { ...p, side: undefined } : p))
  assert.deepEqual(rows(ex.account, noSide, ex.today), negative)
  assert.equal(rows(ex.account, positions, ex.today).allow_shorts_needed, false)
})

test('rows deposit with an option and a short is cash plus the signed rows and equals equity when nothing is left out', () => {
  const r = rows(ex.account, ex.positions, ex.today)
  assert.deepEqual(r, {
    ok: true, partial: false, equity: 9497.81, cash: 9217.43,
    deposit: 9497.81, allocait_total: 9497.81, equity_gap: 0, allow_shorts_needed: true,
    rows: [{ symbol: 'ALFA', shares: 37, price: 41.37, asset_class: 'Equities' }, optionRow, shortRow],
    prices: { ALFA: 41.37, [OPTION]: 2.35, BRAV: 93.11 },
    stop: [],
  })
  // Opening cash less what the rows cost, plus what the short sold for, is Alpaca's cash.
  const end = r.deposit - r.rows.reduce((n, x) => n + x.shares * x.price, 0)
  assert.ok(Math.abs(end - 9217.43) < 0.005)
})

test('rows rounds the deposit up to the cent, absorbs float noise, and a deposit of 0 means no deposit', () => {
  assert.equal(rows({ cash: '0', equity: '0.001' }, [position({ qty: '1', current_price: '0.001', market_value: '0' })]).deposit, 0.01)
  assert.equal(rows({ cash: '0.1', equity: '0.3' }, [position({ qty: '2', current_price: '0.1', market_value: '0.2' })]).deposit, 0.3)
  const empty = rows({ cash: '0', equity: '0' }, [])
  assert.equal(empty.ok, true)
  assert.ok(Object.is(empty.deposit, 0))
  // Cash 0 with a short that sold for as much as the long cost: nothing to deposit, credits come first.
  const funded = rows({ cash: '50', equity: '0' }, [position({ symbol: 'BRAV', qty: '-10', current_price: '20', market_value: '-200', side: 'short' }), position({ qty: '5', current_price: '30', market_value: '150' })])
  assert.equal(funded.deposit, 0)
  assert.equal(funded.rows.length, 2)
  // Cash 0 and only a worthless long row: it cannot be recorded with no cash, so it is left out and named.
  const worthless = rows({ cash: '0', equity: '0' }, [position({ qty: '1', current_price: '0', market_value: '0' })])
  assert.equal(worthless.deposit, 0)
  assert.deepEqual(worthless.rows, [])
  assert.equal(worthless.partial, true)
  assert.equal(worthless.equity_gap, 0)
  assert.match(worthless.stop[0].reason, /worth 0 cannot be recorded/)
})

test('rows leaves a written option and an expired option in stop and reports equity_gap as equity less the total Allocait will read', () => {
  const list = [...ex.positions.data.result, written(), expired()]
  // Alpaca's equity also counts the expired option's 5 and the written option's -230.
  const r = rows({ cash: '9217.43', equity: '9272.81' }, list, ex.today)
  assert.equal(r.ok, true)
  assert.equal(r.partial, true)
  assert.deepEqual(r.rows, rows(ex.account, ex.positions, ex.today).rows)
  assert.equal(r.deposit, 9497.81)
  assert.equal(r.allocait_total, 9497.81)
  assert.equal(r.equity_gap, -225)
  assert.deepEqual(r.stop.map((s) => s.item), ['CHAR261218P00090000', 'DELT261016C00030000'])
})

test('rows stops, with no rows, on negative cash even when shorts are held', () => {
  const r = rows({ cash: '-1250.50', equity: '2927.87' }, [position({ qty: '101', current_price: '41.37', market_value: '4178.37' })])
  assert.deepEqual(r, { ok: false, partial: false, equity: 2927.87, cash: -1250.5, deposit: null, allocait_total: null, equity_gap: null, allow_shorts_needed: false, rows: [], prices: {}, stop: [{ item: 'ACCOUNT', reason: 'cash is negative (margin in use)' }] })
  const withShort = rows({ cash: '-5', equity: '10' }, [position({ symbol: 'BRAV', qty: '-1', current_price: '93.11', market_value: '-93.11', side: 'short' })])
  assert.equal(withShort.ok, false)
  assert.deepEqual(withShort.rows, [])
})

test('rows stops when what is left out outweighs the account, so the opening cash would be below zero', () => {
  // A written option owes 230 that equity already nets; the mirrored rows alone are worth less than the short sold for.
  const r = rows({ cash: '10', equity: '10' }, [position({ symbol: 'BRAV', qty: '-10', current_price: '20', market_value: '-200', side: 'short' })])
  assert.equal(r.ok, false)
  assert.equal(r.deposit, null)
  assert.match(r.stop.at(-1).reason, /outweighs the account/)
})

test('rows lists a position whose market value does not match quantity times price, so an option priced per contract is not mirrored', () => {
  const perContract = ex.positions.data.result.map((p) => (p.symbol === OPTION ? { ...p, current_price: '235' } : p))
  const r = rows(ex.account, perContract, ex.today)
  assert.deepEqual(r.stop, [{ item: OPTION, reason: 'market value does not match quantity times price' }])
  assert.equal(r.partial, true)
  assert.deepEqual(r.rows.map((x) => x.symbol), ['ALFA', 'BRAV'])
  // The same books with the premium right but a missing x100 in market_value.
  const noMultiplier = ex.positions.data.result.map((p) => (p.symbol === OPTION ? { ...p, market_value: '7.05' } : p))
  assert.equal(rows(ex.account, noMultiplier, ex.today).stop.length, 1)
  // A short whose market value is a different size is left out too.
  const wrongShort = ex.positions.data.result.map((p) => (p.symbol === 'BRAV' ? { ...p, market_value: '-195.53' } : p))
  assert.equal(rows(ex.account, wrongShort, ex.today).stop[0].item, 'BRAV')
})

test('rows reads the expiry from today: an option expiring today mirrors, the day before is left out, and with no today the clock is used', () => {
  const opt = (symbol) => position({ symbol, asset_class: 'us_option', qty: '1', current_price: '2', market_value: '200' })
  const onDay = rows({ cash: '5', equity: '205' }, [opt('ALFA261114C00050000')], '2026-11-14')
  assert.deepEqual(onDay.rows.map((x) => x.symbol), ['ALFA261114C00050000'])
  const dayBefore = rows({ cash: '5', equity: '205' }, [opt('ALFA261113C00050000')], '2026-11-14')
  assert.deepEqual(dayBefore.rows, [])
  assert.match(dayBefore.stop[0].reason, /past its expiry/)
  // No today (or one that is not a date): the US Eastern date from the clock. Far-future and far-past dates cannot flake.
  for (const today of [undefined, 'not a date', '2026-13-45 ']) {
    assert.equal(rows({ cash: '5', equity: '205' }, [opt('ALFA991218C00050000')], today).rows.length, 1)
    assert.equal(rows({ cash: '5', equity: '205' }, [opt('ALFA000101C00050000')], today).rows.length, 0)
  }
  assert.match(todayOf(), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(todayOf('2026-11-14'), '2026-11-14')
  // A date not on the calendar is not an expiry.
  assert.equal(expiryOf('ALFA261331C00050000'), null)
  assert.equal(expiryOf(OPTION), '2026-12-18')
})

test('percents gives a short a negative percent and an option its premium value, and the map sums to 100', () => {
  const p = percents(ex.account, ex.positions, {}, ex.today)
  assert.deepEqual(p.allocations, { ALFA: 16.1162, [OPTION]: 7.4228, BRAV: -20.587, CASH: 97.048 })
  assert.equal(sum(p.allocations), 100)
  assert.equal(p.ok, true)
  assert.equal(p.partial, false)
  assert.equal(p.unreconciled_pct, 0)
  assert.equal(p.skipped_pct, 0)
})

test('percents names Options for an option Allocait does not hold and no class for one it does', () => {
  assert.deepEqual(percents(ex.account, ex.positions, {}, ex.today).asset_classes, { ALFA: 'Equities', [OPTION]: 'Options', BRAV: 'Equities' })
  assert.deepEqual(percents(ex.account, ex.positions, { ALFA: 37 }, ex.today).asset_classes, { [OPTION]: 'Options', BRAV: 'Equities' })
  assert.deepEqual(percents(ex.account, ex.positions, { ALFA: 37, [OPTION]: 300, BRAV: -21 }, ex.today).asset_classes, {})
})

test('percents allows a negative skipped_pct when a written option is left out, and stays ok', () => {
  // Example 1 plus a written option and an expired one: equity is 225 below what the three rows add up to.
  const list = [...ex.positions.data.result, written(), expired()]
  const p = percents({ cash: '9217.43', equity: '9272.81' }, list, {}, ex.today)
  assert.equal(p.ok, true)
  assert.equal(p.partial, true)
  assert.ok(p.skipped_pct < 0)
  assert.equal(p.skipped_pct, round4(100 - sum(p.allocations)))
  assert.ok(Math.abs(p.skipped_pct - (-225 / 9272.81) * 100) < 0.001)
  assert.equal(p.allocations.CASH, round4(9217.43 / 9272.81 * 100))
  assert.equal(p.stop.length, 2)
  // Equity of 0 or less is still not ok.
  assert.equal(percents({ cash: '0', equity: '0' }, list, {}, ex.today).ok, false)
})

test('percents reports an equity that does not equal cash plus the positions as unreconciled_pct and partial, not folded into CASH', () => {
  const opt = position({ symbol: 'ALFA991218C00050000', asset_class: 'us_option', qty: '2', current_price: '1', market_value: '200' })
  const gap = percents({ cash: '800', equity: '1050' }, [opt], {}, '2026-11-14')
  assert.equal(gap.ok, true)
  assert.equal(gap.partial, true)
  assert.equal(gap.unreconciled_pct, 4.7619)
  assert.equal(gap.allocations.CASH, 76.1905)
  assert.deepEqual(gap.stop, [{ item: 'ACCOUNT', reason: 'equity does not equal cash plus the positions listed' }])
  assert.equal(gap.skipped_pct, 0)
  // 0.05 of 1000 is inside the tolerance: it folds into CASH and the map sums to 100.
  const near = percents({ cash: '800', equity: '1000.05' }, [opt], {}, '2026-11-14')
  assert.equal(near.partial, false)
  assert.equal(near.unreconciled_pct, 0)
  assert.equal(sum(near.allocations), 100)
  // rows names the same gap in stop.
  const r = rows({ cash: '800', equity: '1050' }, [opt], '2026-11-14')
  assert.equal(r.partial, true)
  assert.equal(r.stop.at(-1).item, 'ACCOUNT')
  assert.equal(r.equity_gap, 50)
})

test('a book of long stock and pairs keeps the old rule: a small gap folds into CASH and the output has no new key', () => {
  const list = [position({ qty: '10', current_price: '5', market_value: '50' })]
  const p = percents({ cash: '50', equity: '100.02' }, list)
  assert.deepEqual(Object.keys(p), ['ok', 'partial', 'equity', 'allocations', 'asset_classes', 'skipped_pct', 'stop'])
  assert.equal(p.partial, false)
  assert.equal(sum(p.allocations), 100)
  assert.deepEqual(p.allocations, { ALFA: 49.99, CASH: 50.01 })
  const r = rows({ cash: '50', equity: '100.02' }, list)
  assert.equal(r.partial, false)
  assert.equal(r.equity_gap, 0.02)
})

test('diff compares an option as contracts x 100 and a short as a negative count; a sign flip is a difference', () => {
  const book = ex.positions
  assert.equal(diff(book, { ALFA: 37, [OPTION]: 300, BRAV: -21 }, ex.today).in_step, true)
  const d = diff(book, { ALFA: 37, [OPTION]: 3, BRAV: 21 }, ex.today)
  assert.equal(d.in_step, false)
  assert.deepEqual(d.different, [{ symbol: OPTION, alpaca: 300, allocait: 3 }, { symbol: 'BRAV', alpaca: -21, allocait: 21 }])
  assert.equal('expired_allocait' in d, false)
  // A long option Alpaca does not list shows as only-Allocait; an option past its expiry is a ready zero-priced row instead.
  const others = diff(positions, { ALFA: 61, BRAV: 37.5, 'ECHO/USD': 2.5, ALFA991218C00050000: 100, DELT261016C00030000: 100 }, ex.today)
  assert.deepEqual(others.only_allocait, ['ALFA991218C00050000'])
  assert.deepEqual(others.expired_allocait, [{ symbol: 'DELT261016C00030000', shares: 0, price: 0 }])
  assert.equal(others.in_step, false)
})

test('diff names what Allocait holds that stop leaves out, so a replace that omits it is not sent', () => {
  // An expired option Alpaca still lists and Allocait still holds closes at 0. A written option Allocait holds cannot be replaced.
  const list = [position(), expired(), written()]
  const d = diff(list, { ALFA: 10, DELT261016C00030000: 100, CHAR261218P00090000: 200 }, ex.today)
  assert.deepEqual(d.expired_allocait, [{ symbol: 'DELT261016C00030000', shares: 0, price: 0 }])
  assert.deepEqual(d.held_left_out, [{ symbol: 'CHAR261218P00090000', reason: 'a written option is not mirrored: Allocait holds options long only' }])
  assert.deepEqual(d.only_allocait, [])
  assert.equal(d.in_step, false)
  // Not held in Allocait: nothing to close, nothing named.
  const none = diff(list, { ALFA: 10 }, ex.today)
  assert.equal('held_left_out' in none, false)
  assert.equal(none.in_step, true)
})

test('order says whether the skill places it: no option, no order in a short, no SELL of more than is held long', () => {
  const book = ex.positions
  const check = (o) => order(book, o, ex.today)
  assert.deepEqual(check({ symbol: 'ALFA', side: 'sell', qty: '37' }), { outside_skill: false, reason: null, held: 37 })
  assert.deepEqual(check({ symbol: 'ALFA', side: 'buy', qty: '5' }), { outside_skill: false, reason: null, held: 37 })
  assert.equal(check({ symbol: 'alfa', side: 'SELL', qty: '38' }).outside_skill, true)
  assert.match(check({ symbol: 'ALFA', side: 'sell', qty: '38' }).reason, /opens a short/)
  // A dollar amount is read at the position's price: 413.70 is 10 shares, 1700 is more than 37.
  assert.equal(check({ symbol: 'ALFA', side: 'sell', notional: '413.7' }).outside_skill, false)
  assert.equal(check({ symbol: 'ALFA', side: 'sell', notional: '1700' }).outside_skill, true)
  // Held short: a BUY covers it and a SELL extends it.
  assert.deepEqual([check({ symbol: 'BRAV', side: 'buy', qty: '1' }).outside_skill, check({ symbol: 'BRAV', side: 'sell', qty: '1' }).outside_skill, check({ symbol: 'BRAV', side: 'buy', qty: '1' }).held], [true, true, -21])
  // Not held: a BUY is fine, a SELL opens a short.
  assert.deepEqual(check({ symbol: 'DELT', side: 'buy', qty: '2' }), { outside_skill: false, reason: null, held: 0 })
  assert.equal(check({ symbol: 'DELT', side: 'sell', notional: '50' }).outside_skill, true)
  // Any option order, held or not.
  assert.equal(check({ symbol: OPTION, side: 'sell', qty: '1' }).outside_skill, true)
  assert.equal(check({ symbol: 'CHAR261218C00050000', side: 'buy', qty: '1' }).outside_skill, true)
  // A symbol the account holds that this example cannot read.
  const eur = order([position({ symbol: 'ECHOEUR', asset_class: 'crypto' })], { symbol: 'ECHOEUR', side: 'buy', qty: '1' })
  assert.equal(eur.outside_skill, true)
  assert.equal(check({ symbol: 'ALFA', side: 'hold', qty: '1' }).outside_skill, true)
  assert.equal(check({ symbol: 'ALFA', side: 'sell' }).outside_skill, true)
})

test('as a command: rows reads today from stdin and prints the new keys, and order is a command too', () => {
  const r = JSON.parse(run('rows', { account: ex.account, positions: ex.positions, today: ex.today }).stdout)
  assert.equal(r.deposit, 9497.81)
  assert.equal(r.allocait_total, 9497.81)
  assert.equal(r.allow_shorts_needed, true)
  assert.equal(r.rows.length, 3)
  // Without today the option is read against the clock: its 2026 expiry may or may not be past, so only the shape is checked.
  assert.ok(Array.isArray(JSON.parse(run('rows', { account: ex.account, positions: ex.positions }).stdout).rows))
  assert.equal(JSON.parse(run('order', { positions: ex.positions, order: { symbol: 'BRAV', side: 'buy', qty: '1' } }).stdout).outside_skill, true)
  assert.equal(JSON.parse(run('percents', { account: ex.account, positions: ex.positions, today: ex.today }).stdout).allocations.BRAV, -20.587)
  assert.equal(JSON.parse(run('diff', { positions: ex.positions, allocait: { ALFA: 37, [OPTION]: 300, BRAV: -21 }, today: ex.today }).stdout).in_step, true)
})

test('as a command: each subcommand reads stdin and prints JSON; bad input exits 2', () => {
  const r = run('rows', { account, positions })
  assert.equal(r.status, 0)
  assert.equal(JSON.parse(r.stdout).rows.length, 3)
  assert.equal(JSON.parse(run('percents', { account, positions }).stdout).ok, true)
  assert.equal(JSON.parse(run('diff', { positions, allocait: { ALFA: 61 } }).stdout).in_step, false)
  assert.equal(run('rows', 'not json').status, 2)
  // A file path as the last argument is read in place of stdin.
  const dir = mkdtempSync(join(tmpdir(), 'book-'))
  writeFileSync(join(dir, 'in.json'), JSON.stringify({ account, positions }))
  const viaFile = spawnSync('node', [BOOK, 'rows', join(dir, 'in.json')], { encoding: 'utf8' })
  assert.equal(JSON.parse(viaFile.stdout).rows.length, 3)
  assert.equal(spawnSync('node', [BOOK, 'rows', join(dir, 'missing.json')], { encoding: 'utf8' }).status, 2)
  assert.equal(run('nope', {}).status, 2)
})

// Allocait keeps a count as round(shares, 6), half away from zero (api.positions_apply), and refuses a replace that
// leaves cash below zero after rounding to 6 places. This models its cash effect on the rows rows() sends.
const cashAfter = (out) => out.deposit - out.rows.reduce((n, r) => n + round6(r.shares) * r.price, 0)

test('round6 rounds a decimal string on its digits, half away from zero', () => {
  assert.equal(round6('0.1234565'), 0.123457)
  assert.equal(round6('-0.1234565'), -0.123457)
  assert.equal(round6('0.1234564'), 0.123456)
  assert.equal(round6('0.123456789'), 0.123457)
  assert.equal(round6('12'), 12)
  assert.equal(round6('0.0000004'), 0)
  assert.equal(Object.is(round6('-0.0000004'), 0), true)
  assert.equal(round6(0.1234565), 0.123457)
})

test('rows sends a count with at most 6 decimals, so recorded cash ends at Alpaca cash within a cent, never below it', () => {
  const pair = (qty, mv) => position({ symbol: 'ECHO/USD', asset_class: 'crypto', qty, current_price: '60000', market_value: mv })
  const a = rows({ cash: '0', equity: '7407.39' }, [pair('0.1234565', '7407.39')], '2026-11-14')
  assert.equal(a.rows[0].shares, 0.123457)
  assert.equal(a.deposit, 7407.42)
  assert.ok(cashAfter(a) >= -1e-9)
  // A fully invested account is not short of cash after the database rounds the count.
  const b = rows({ cash: '10', equity: '7417.4' }, [pair('0.1234564', '7407.38')], '2026-11-14')
  assert.equal(b.rows[0].shares, 0.123456)
  assert.ok(cashAfter(b) >= 10 - 1e-9 && cashAfter(b) < 10.0101)
  // A quantity below the 6th decimal is named, not written as a row of 0.
  const dust = rows({ cash: '5', equity: '5' }, [pair('0.0000004', '0.02')], '2026-11-14')
  assert.deepEqual(dust.rows, [])
  assert.equal(dust.partial, true)
  assert.match(dust.stop[0].reason, /below 0\.000001/)
})

test('rows keeps cash within a cent of Alpaca cash and never below it, over 3000 generated books of long, short and option positions', () => {
  let seed = 7
  let counted = 0
  const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const dec = (max, places) => (next() * max).toFixed(places)
  for (let n = 0; n < 3000; n++) {
    const list = []
    for (let i = 0; i < 1 + Math.floor(next() * 4); i++) {
      const kind = Math.floor(next() * 4)
      const price = dec(900, 2)
      if (kind === 0) list.push(position({ symbol: `ALFA${i}`.replace(/\d/, ''), qty: dec(500, 9), current_price: price, market_value: '0' }))
      else if (kind === 1) list.push(position({ symbol: 'ECHO/USD', asset_class: 'crypto', qty: dec(5, 9), current_price: price, market_value: '0' }))
      else if (kind === 2) list.push(position({ symbol: 'BRAV', qty: `-${dec(300, 4)}`, side: 'short', current_price: price, market_value: '0' }))
      else list.push(position({ symbol: 'CHAR261218C00050000', asset_class: 'us_option', qty: String(1 + Math.floor(next() * 9)), current_price: dec(40, 2), market_value: '0' }))
    }
    // One position per symbol; market_value is what Alpaca would print, to the cent.
    const seen = new Set()
    const book = list.filter((p) => !seen.has(p.symbol) && seen.add(p.symbol)).map((p) => {
      const mult = p.asset_class === 'us_option' ? 100 : 1
      const v = Math.abs(Number(p.qty)) * mult * Number(p.current_price)
      return { ...p, market_value: (p.side === 'short' ? -v : v).toFixed(2) }
    })
    const cash = Number(dec(5000, 2))
    const out = rows({ cash: String(cash), equity: '1' }, book, '2026-11-14')
    if (!out.ok) continue
    counted++
    const end = cashAfter(out)
    assert.ok(end >= cash - 1e-6, `cash ends below Alpaca cash: ${end} < ${cash}`)
    assert.ok(end <= cash + 0.0101, `cash ends more than a cent above: ${end} vs ${cash}`)
  }
  assert.ok(counted > 1500, `only ${counted} of 3000 books were readable`)
})

test('rows, percents, diff and order stop on positions in a shape they do not read, and do not read them as an empty account', () => {
  const wrong = { positions: [position()] }
  const r = rows({ cash: '100', equity: '1000' }, wrong, '2026-11-14')
  assert.equal(r.ok, false)
  assert.deepEqual(r.rows, [])
  assert.equal(r.stop[0].item, 'POSITIONS')
  assert.equal(percents({ cash: '100', equity: '1000' }, wrong, {}, '2026-11-14').ok, false)
  const d = diff(wrong, { ALFA: 9 }, '2026-11-14')
  assert.equal(d.in_step, false)
  assert.equal(d.partial, true)
  assert.deepEqual(d.only_allocait, [])
  assert.equal(order(wrong, { symbol: 'ALFA', side: 'buy', qty: '1' }, '2026-11-14').outside_skill, true)
  // An empty list is an account holding nothing.
  assert.equal(rows({ cash: '100', equity: '100' }, [], '2026-11-14').ok, true)
  assert.equal(rows({ cash: '100', equity: '100' }, { data: { result: [] } }, '2026-11-14').deposit, 100)
})

test('percents says why when equity is zero or below', () => {
  const r = percents({ cash: '5', equity: '0' }, [position({ qty: '1', current_price: '10', market_value: '10' })], {}, '2026-11-14')
  assert.equal(r.ok, false)
  assert.deepEqual(r.stop, [{ item: 'ACCOUNT', reason: 'equity is zero or below, so no percent can be read' }])
})

test('a position of 0 is nothing held: no row, and no difference', () => {
  const zero = position({ qty: '0', market_value: '0' })
  const r = rows({ cash: '100', equity: '100' }, [zero], '2026-11-14')
  assert.deepEqual(r.rows, [])
  assert.equal(r.partial, false)
  assert.equal(diff([zero], {}, '2026-11-14').in_step, true)
  assert.equal(order([zero], { symbol: 'ALFA', side: 'buy', qty: '1' }, '2026-11-14').held, 0)
})

test('one symbol listed twice, or a pair in two spellings, is left out whole and named', () => {
  const pair = (symbol) => position({ symbol, asset_class: 'crypto', qty: '2', current_price: '100', market_value: '200' })
  const r = rows({ cash: '0', equity: '400' }, [pair('ECHO/USD'), pair('ECHOUSD'), position()], '2026-11-14')
  assert.deepEqual(r.rows.map((x) => x.symbol), ['ALFA'])
  assert.equal(r.partial, true)
  assert.match(r.stop[0].reason, /more than once/)
  assert.equal(diff([pair('ECHO/USD'), pair('ECHOUSD')], { 'ECHO/USD': 2 }, '2026-11-14').held_left_out.length, 1)
})

test('order does not read a held pair written without its slash as the held symbol', () => {
  const held = position({ symbol: 'ECHO/USD', asset_class: 'crypto', qty: '2', current_price: '100', market_value: '200' })
  for (const symbol of ['ECHOUSD', 'echousd']) {
    const o = order([held], { symbol, side: 'sell', qty: '1' }, '2026-11-14')
    assert.equal(o.outside_skill, true)
    assert.match(o.reason, /write the pair as ECHO\/USD, with the slash/)
  }
  assert.equal(order([held], { symbol: 'ECHO/USD', side: 'sell', qty: '1' }, '2026-11-14').outside_skill, false)
})

test('diff is not in step while a holding Allocait has is left out of the comparison', () => {
  const written = position({ symbol: 'CHAR261218P00090000', asset_class: 'us_option', qty: '-2', side: 'short', current_price: '1.15', market_value: '-230' })
  const d = diff([written], { CHAR261218P00090000: 200 }, '2026-11-14')
  assert.equal(d.held_left_out.length, 1)
  assert.equal(d.in_step, false)
  assert.equal(d.partial, true)
})
