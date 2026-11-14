// npm test. No network: a fake Allocait answers in-process. The repo this is published from also runs the
// example against a real local Allocait.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, client, exitCode, formatResult, normalizeTrades, secureBase } from '../lib/allocait.mjs'
import { tradingBase } from '../lib/alpaca.mjs'
import { propose } from '../strategy.mjs'
import { clientOrderId, run } from '../lib/loop.mjs'
import { source } from '../lib/prices.mjs'

const row = { index: 0, symbol: 'ALFA', side: 'BUY', shares: 3, price: 41.37, shares_before: 61, shares_after: 64 }
const result = (over = {}) => ({
  portfolio_id: 'p1',
  newly_or_further_outside_count: 0,
  rules_judged_count: 3,
  rules: [],
  not_covered: [],
  cash: { before: 1000, after: 875.89, sufficient: true },
  trades: [row],
  ...over,
})
const order = { portfolio_id: 'p1', trades: [{ symbol: 'ALFA', side: 'BUY', shares: 3 }] }
const prices = async (symbols) => Object.fromEntries(symbols.map((s) => [s, 41.37]))
const fakeApi = (r = result()) => ({ checkTrades: mock.fn(async () => r), recordPosition: mock.fn(async () => ({})), portfolios: mock.fn(async () => []) })
const yes = async () => true

test('exitCode: 0 inside, 1 outside or short of cash, 3 a traded symbol no rule judges', () => {
  const uncovered = { not_covered: [{ symbol: 'ECHO/USD', reason: 'NO_CLASS_RULE', traded: true }] }
  assert.equal(exitCode(result()), 0)
  assert.equal(exitCode(result({ not_covered: [{ symbol: 'GOLF', reason: 'NO_SIZE_RANGE', traded: false }] })), 0)
  assert.equal(exitCode(result({ newly_or_further_outside_count: 1, ...uncovered })), 1)
  assert.equal(exitCode(result({ cash: { before: 1, after: -5, sufficient: false } })), 1)
  assert.equal(exitCode(result({ rules_judged_count: 0 })), 3)
  assert.equal(exitCode(result(uncovered)), 3)
})

test('formatResult states each rule row as a fact', () => {
  const text = formatResult(result({
    newly_or_further_outside_count: 1,
    rules: [{ kind: 'class_band', asset_class: 'Crypto', min_pct: 0, max_pct: 7, before_pct: 0, after_pct: 9.13, change: 'newly_outside' }],
  }))
  assert.match(text, /Newly or further outside: 1\./)
  assert.match(text, /Crypto band: 0% -> 9.13% \(your range 0% to 7%\), newly outside/)
})

test('check prices the traded symbols, then the held symbols Allocait names', async () => {
  const api = fakeApi()
  const refusal = Object.assign(new Error('A price is needed'), { code: 'PRICES_INCOMPLETE', body: { missing_symbols: ['BRAV'] } })
  api.checkTrades.mock.mockImplementationOnce(async () => { throw refusal })
  const source = mock.fn(prices)
  await check({ ...order, trades: [{ symbol: ' alfa ', side: 'BUY', shares: 3 }] }, { api, prices: source })
  assert.deepEqual(source.mock.calls.map((c) => c.arguments[0]), [['ALFA'], ['BRAV']])
  assert.deepEqual(api.checkTrades.mock.calls[1].arguments[0].prices, { ALFA: 41.37, BRAV: 41.37 })
})

test('check with no portfolio id lists the portfolios', async () => {
  const api = fakeApi()
  api.portfolios.mock.mockImplementation(async () => [{ portfolio_id: 'p9', name: 'Test' }])
  await assert.rejects(check({ trades: order.trades }, { api, prices }), /p9  Test/)
})

test('a price source chain fills from each in turn and names what none priced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'allocait-'))
  const [a, b] = [join(dir, 'a.json'), join(dir, 'b.json')]
  await writeFile(a, JSON.stringify({ alfa: 41.37 }))
  await writeFile(b, JSON.stringify({ ALFA: 1, 'ECHO/USD': 3.19 }))
  assert.deepEqual(await source(`file:${a},file:${b}`)(['ALFA', 'ECHO/USD']), { ALFA: 41.37, 'ECHO/USD': 3.19 })
  await assert.rejects(source(`file:${a}`)(['ALFA', 'GOLF']), /No price for GOLF/)
})

test('run with no one present places and records nothing', async (t) => {
  t.mock.method(console, 'log', () => {})
  const api = fakeApi()
  const place = mock.fn()
  await run(order, { api, prices, confirm: null, place })
  assert.equal(place.mock.callCount() + api.recordPosition.mock.callCount(), 0)
})

test('run after a no records nothing; after a yes records the new total', async (t) => {
  t.mock.method(console, 'log', () => {})
  const no = fakeApi()
  await run(order, { api: no, prices, confirm: async () => false })
  assert.equal(no.recordPosition.mock.callCount(), 0)
  const api = fakeApi()
  assert.equal(await run(order, { api, prices, confirm: yes }), 0)
  assert.deepEqual(api.recordPosition.mock.calls[0].arguments[0], { portfolioId: 'p1', symbol: 'ALFA', shares: 64, price: 41.37, assetClass: undefined })
})

test('a broker fill is recorded at its own quantity and price; an unfilled order records nothing', async (t) => {
  t.mock.method(console, 'log', () => {})
  const api = fakeApi(result({ trades: [{ ...row, side: 'SELL', shares: 5, shares_after: 56 }] }))
  await run(order, { api, prices, confirm: yes, place: async () => ({ id: 'o1', status: 'partially_filled', filledQty: 3, filledPrice: 41.29 }) })
  assert.deepEqual(api.recordPosition.mock.calls[0].arguments[0], { portfolioId: 'p1', symbol: 'ALFA', shares: 58, price: 41.29, assetClass: undefined })
  const open = fakeApi()
  const err = t.mock.method(console, 'error', () => {})
  assert.equal(await run(order, { api: open, prices, confirm: yes, place: async () => ({ id: 'o2', status: 'accepted', open: true, filledQty: 0, filledPrice: null }) }), 4)
  assert.match(err.mock.calls[0].arguments[0], /still accepted/)
  assert.equal(open.recordPosition.mock.callCount(), 0)
})

test('a placed order that fails to record exits 4 and says so', async (t) => {
  t.mock.method(console, 'log', () => {})
  const err = t.mock.method(console, 'error', () => {})
  const api = fakeApi()
  api.recordPosition.mock.mockImplementation(async () => { throw new Error('Write permission required') })
  const code = await run(order, { api, prices, confirm: yes, place: async () => ({ id: 'o3', status: 'filled', filledQty: 3, filledPrice: 41.31 }) })
  assert.equal(code, 4)
  assert.match(err.mock.calls[0].arguments[0], /placed \(order o3\), but not recorded/)
})

test('a broker error stops the loop, exits 4, and records nothing it did not place', async (t) => {
  t.mock.method(console, 'log', () => {})
  const err = t.mock.method(console, 'error', () => {})
  const two = result({ trades: [{ ...row, side: 'BUY' }, { ...row, index: 1, symbol: 'GOLF', side: 'SELL', shares: 2, shares_before: 9 }] })
  const api = fakeApi(two)
  const place = mock.fn(async (r) => { if (r.symbol === 'GOLF') return { id: 'o4', status: 'filled', filledQty: 2, filledPrice: 41.37 }; throw new Error('timeout') })
  const code = await run({ ...order, trades: [{ symbol: 'ALFA', side: 'BUY', shares: 3 }, { symbol: 'GOLF', side: 'SELL', shares: 2 }] }, { api, prices, confirm: yes, place })
  assert.equal(code, 4)
  assert.deepEqual(place.mock.calls.map((c) => c.arguments[0].symbol), ['GOLF', 'ALFA']) // the sale goes first
  assert.equal(api.recordPosition.mock.callCount(), 1)
  assert.match(err.mock.calls[0].arguments[0], /ALFA: not placed: timeout/)
})

test('sales are recorded before buys, and an order file cannot bring its own prices', async (t) => {
  t.mock.method(console, 'log', () => {})
  const two = result({ trades: [{ ...row, side: 'BUY' }, { ...row, index: 1, symbol: 'GOLF', side: 'SELL', shares: 2, shares_before: 9 }] })
  const api = fakeApi(two)
  const source = mock.fn(prices)
  await run({ trades: [{ symbol: 'ALFA', side: 'BUY', shares: 3 }, { symbol: 'GOLF', side: 'SELL', shares: 2 }], portfolio_id: 'p1', prices: { ALFA: 1, GOLF: 1 } }, { api, prices: source, confirm: yes })
  assert.deepEqual(api.recordPosition.mock.calls.map((c) => c.arguments[0].symbol), ['GOLF', 'ALFA'])
  assert.equal(source.mock.callCount(), 1)
  assert.deepEqual(api.checkTrades.mock.calls[0].arguments[0].prices, { ALFA: 41.37, GOLF: 41.37 })
})

test('live asks for the word "live" and says so; the client order id repeats for the same order', async (t) => {
  const out = t.mock.method(console, 'log', () => {})
  const ask = mock.fn(async () => false)
  await run(order, { api: fakeApi(), prices, confirm: ask, place: async () => ({}), venue: { host: 'api.alpaca.markets', live: true } })
  assert.equal(ask.mock.calls[0].arguments[1], 'live')
  assert.ok(out.mock.calls.some((c) => /LIVE: this places real orders/.test(c.arguments[0])))
  assert.equal(clientOrderId('p1', row, '2026-11-08'), clientOrderId('p1', { ...row }, '2026-11-08'))
  assert.notEqual(clientOrderId('p1', row, '2026-11-08'), clientOrderId('p1', row, '2026-11-09'))
})

test('a price source that is down leaves its symbols to the next one in the chain', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'allocait-'))
  const file = join(dir, 'p.json')
  await writeFile(file, JSON.stringify({ 'ECHO/USD': 3.19 }))
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('fetch failed') })
  assert.deepEqual(await source(`coinbase,file:${file}`)(['ECHO/USD']), { 'ECHO/USD': 3.19 })
  await assert.rejects(source('coinbase')(['ECHO/USD']), /No price for ECHO\/USD from coinbase \(fetch failed\)/)
})

test('the client never follows a redirect with the key', async (t) => {
  const f = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }))
  await client({ apiKey: 'k', baseUrl: 'https://allocait.app/api/v1' }).request('GET', '/portfolios')
  assert.equal(f.mock.calls[0].arguments[1].redirect, 'error')
})

test('run refuses two trades in one symbol', async () => {
  await assert.rejects(run({ ...order, trades: [{ symbol: 'ALFA', side: 'BUY', shares: 1 }, { symbol: 'alfa', side: 'SELL', shares: 1 }] }, { api: fakeApi(), prices }), /One trade per symbol/)
})

test('client sends x-api-key and names the missing symbols', async (t) => {
  const body = { error: 'A price is needed for GOLF.', error_code: 'PRICES_INCOMPLETE', missing_symbols: ['GOLF'] }
  const f = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status: 400 }))
  const api = client({ apiKey: 'k', baseUrl: 'http://127.0.0.1:9/api/v1/' })
  await assert.rejects(api.checkTrades({ portfolioId: 'p1', trades: [], prices: {} }), (e) => e.code === 'PRICES_INCOMPLETE' && /Missing: GOLF\./.test(e.message))
  assert.equal(f.mock.calls[0].arguments[0], 'http://127.0.0.1:9/api/v1/trades/check')
  assert.equal(f.mock.calls[0].arguments[1].headers['x-api-key'], 'k')
})

test('check.mjs exits 2 with no result when the call fails', () => {
  const here = fileURLToPath(new URL('..', import.meta.url))
  const env = { ...process.env, ALLOCAIT_API_KEY: 'k', ALLOCAIT_BASE_URL: 'http://127.0.0.1:9', ALLOCAIT_PORTFOLIO_ID: 'p1' }
  const out = spawnSync(process.execPath, [join(here, 'check.mjs'), join(here, 'order.example.json')], { env, encoding: 'utf8' })
  assert.equal(out.status, 2)
  assert.match(out.stderr, /^No result: /)
})

test('check.mjs --demo prints the saved example result, labelled, with no key and no network', async () => {
  const here = fileURLToPath(new URL('..', import.meta.url))
  // No key, and a base URL nothing answers on: the demo must touch neither.
  const env = { ...process.env, ALLOCAIT_API_KEY: '', ALLOCAIT_BASE_URL: 'http://127.0.0.1:9', ALLOCAIT_PORTFOLIO_ID: '' }
  const out = spawnSync(process.execPath, [join(here, 'check.mjs'), '--demo'], { env, encoding: 'utf8' })
  assert.equal(out.status, 1)
  assert.equal(out.stderr, '')
  assert.match(out.stdout, /^Example result, saved in result\.example\.json\. No account, no key, no network: nothing was checked\./)
  assert.match(out.stdout, /Crypto band: 0% -> 7\.29% \(your range 0% to 7%\), newly outside/)
  const raw = spawnSync(process.execPath, [join(here, 'check.mjs'), '--demo', '--json'], { env, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(raw.stdout), JSON.parse(await readFile(join(here, 'result.example.json'), 'utf8')))
})

test('the saved example result is the example order at the example prices, in the response shape', async () => {
  const here = fileURLToPath(new URL('..', import.meta.url))
  const load = async (f) => JSON.parse(await readFile(join(here, f), 'utf8'))
  const [saved, order, prices] = await Promise.all(['result.example.json', 'order.example.json', 'prices.example.json'].map(load))
  for (const k of ['portfolio_id', 'scenario_id', 'within_rules', 'newly_or_further_outside_count', 'rules_judged_count', 'rules', 'not_covered', 'trades', 'cash', 'total_value', 'positions_updated_at', 'basis', 'checked_at']) assert.ok(k in saved, k)
  assert.deepEqual(saved.trades.map((t) => [t.index, t.symbol, t.side]), order.trades.map((t, i) => [i, t.symbol, t.side]))
  for (const t of saved.trades) assert.equal(t.price, prices[t.symbol], t.symbol)
  assert.equal(saved.newly_or_further_outside_count, saved.rules.filter((r) => ['newly_outside', 'further_outside'].includes(r.change)).length)
})

test('symbols are validated before they reach a URL or a request', () => {
  assert.equal(normalizeTrades([{ symbol: ' echo/usd ' }])[0].symbol, 'ECHO/USD')
  for (const bad of ['', '../x', 'ALFA?x=1', 'AL FA', 'A/B/C', 'ALFA#', 'BRK.B/USD', '$X/AB', '$CASH', 'ECHO/US', 'A'.repeat(22)]) assert.throws(() => normalizeTrades([{ symbol: bad }]), /not a symbol/, bad)
  assert.throws(() => normalizeTrades([]), /at least one trade/)
})

test('the key goes only over https, or to this machine', () => {
  assert.equal(secureBase('https://allocait.app/api/v1/'), 'https://allocait.app/api/v1')
  assert.equal(secureBase('http://127.0.0.1:54321/x'), 'http://127.0.0.1:54321/x')
  assert.throws(() => secureBase('http://example.com/api'), /use https/)
})

test('the broker is paper unless live is opted into twice', () => {
  const paper = 'https://paper-api.alpaca.markets'
  assert.equal(tradingBase({}), paper)
  assert.throws(() => tradingBase({ ALPACA_BASE_URL: 'https://api.alpaca.markets' }), /ALLOW_LIVE_TRADING=1/)
  assert.throws(() => tradingBase({ ALPACA_BASE_URL: 'https://evil.example', ALLOW_LIVE_TRADING: '1' }), /Refusing/)
  assert.throws(() => tradingBase({ ALPACA_BASE_URL: 'https://paper-api.alpaca.markets.evil.example', ALLOW_LIVE_TRADING: '1' }), /Refusing/)
  assert.throws(() => tradingBase({ ALPACA_BASE_URL: 'https://api.alpaca.markets@evil.example', ALLOW_LIVE_TRADING: '1' }), /Refusing/)
  assert.equal(tradingBase({ ALPACA_BASE_URL: 'https://api.alpaca.markets', ALLOW_LIVE_TRADING: '1' }), 'https://api.alpaca.markets')
  assert.throws(() => tradingBase({ ALPACA_BASE_URL: 'http://api.alpaca.markets', ALLOW_LIVE_TRADING: '1' }), /Refusing/)
})

test('the shipped strategy proposes nothing of its own: it reads an order file or says it has none', async () => {
  const saved = process.env.ORDER_FILE
  delete process.env.ORDER_FILE
  try {
    await assert.rejects(propose(), /No strategy yet/)
    process.env.ORDER_FILE = fileURLToPath(new URL('../order.example.json', import.meta.url))
    assert.equal((await propose()).trades[0].symbol, 'ALFA')
  } finally {
    if (saved === undefined) delete process.env.ORDER_FILE
    else process.env.ORDER_FILE = saved
  }
})
