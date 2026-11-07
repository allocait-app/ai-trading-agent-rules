// npm test. No network: a fake Allocait answers in-process. The repo this is published from also runs the
// example against a real local Allocait.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, client, exitCode, formatResult } from '../lib/allocait.mjs'
import { run } from '../lib/loop.mjs'
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
  await run(order, { api: open, prices, confirm: yes, place: async () => ({ id: 'o2', status: 'accepted', filledQty: 0, filledPrice: null }) })
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

test('run refuses two trades in one symbol', async () => {
  await assert.rejects(run({ ...order, trades: [{ symbol: 'ALFA', side: 'BUY', shares: 1 }, { symbol: 'alfa', side: 'SELL', shares: 1 }] }, { api: fakeApi(), prices }), /One trade per symbol/)
})

test('client sends x-api-key and names the missing symbols', async (t) => {
  const body = { error: 'A price is needed for GOLF.', error_code: 'PRICES_INCOMPLETE', missing_symbols: ['GOLF'] }
  const f = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status: 400 }))
  const api = client({ apiKey: 'k', baseUrl: 'http://x/api/v1/' })
  await assert.rejects(api.checkTrades({ portfolioId: 'p1', trades: [], prices: {} }), (e) => e.code === 'PRICES_INCOMPLETE' && /Missing: GOLF\./.test(e.message))
  assert.equal(f.mock.calls[0].arguments[0], 'http://x/api/v1/trades/check')
  assert.equal(f.mock.calls[0].arguments[1].headers['x-api-key'], 'k')
})

test('check.mjs exits 2 with no result when the call fails', () => {
  const here = fileURLToPath(new URL('..', import.meta.url))
  const env = { ...process.env, ALLOCAIT_API_KEY: 'k', ALLOCAIT_BASE_URL: 'http://127.0.0.1:9', ALLOCAIT_PORTFOLIO_ID: 'p1' }
  const out = spawnSync(process.execPath, [join(here, 'check.mjs'), join(here, 'order.example.json')], { env, encoding: 'utf8' })
  assert.equal(out.status, 2)
  assert.match(out.stderr, /^No result: /)
})
