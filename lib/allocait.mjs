// The Allocait side of a trading bot: one client, one check, one way to read the result.
// Node 22.9+, no dependencies.
import { readFile } from 'node:fs/promises'
import { guarded } from './http.mjs'
import { source } from './prices.mjs'

/** A symbol goes into a URL path and a request body: the server's own forms, a ticker or BASE/QUOTE (3 or 4 letters). */
const SYMBOL = /^(?:[A-Z0-9][A-Z0-9.-]{0,20}|[A-Z0-9]{2,10}\/[A-Z]{3,4})$/

/** Trim and upper-case each symbol, and refuse one that is not a plain ticker or BASE/USD pair. */
export function normalizeTrades(trades) {
  if (!Array.isArray(trades) || !trades.length) throw new Error('The order needs at least one trade.')
  return trades.map((t) => {
    const symbol = String(t.symbol ?? '').trim().toUpperCase()
    if (!SYMBOL.test(symbol)) throw new Error(`"${t.symbol}" is not a symbol. Write a ticker, or a pair as BASE/USD.`)
    return { ...t, symbol }
  })
}

/** The key travels in a header, so the base URL must be https (plain http only for this machine). */
export function secureBase(url) {
  const u = new URL(url)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error(`Refusing to send the API key to ${u.origin}: use https.`)
  return url.replace(/\/+$/, '')
}

export function client({ apiKey = process.env.ALLOCAIT_API_KEY, baseUrl = process.env.ALLOCAIT_BASE_URL || 'https://allocait.app/api/v1' } = {}) {
  if (!apiKey) throw new Error('Set ALLOCAIT_API_KEY (Allocait app, Settings > Agents).')
  const base = secureBase(baseUrl)

  /** Any REST call (https://allocait.app/docs/api/). A refusal throws with its error_code and body. */
  async function request(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
      ...guarded(30_000),
    })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch { json = { error: text.slice(0, 200) } }
    if (res.ok) return json
    const missing = json?.missing_symbols?.length ? ` Missing: ${json.missing_symbols.join(', ')}.` : ''
    throw Object.assign(new Error((json?.error || `Allocait answered HTTP ${res.status}`) + missing), { status: res.status, code: json?.error_code, body: json })
  }

  return {
    request,
    portfolios: async () => (await request('GET', '/portfolios')).data,
    /** trades: see tool.json. prices: { SYMBOL: number } for every held and every traded symbol. */
    checkTrades: ({ portfolioId, trades, prices, scenarioId }) =>
      request('POST', '/trades/check', { portfolio_id: portfolioId, trades, prices, scenario_id: scenarioId }),
    /** Record a holding's new total. Needs a Read and change key; it records the change in Allocait only. */
    recordPosition: ({ portfolioId, symbol, shares, price, assetClass }) =>
      request('POST', `/positions/${symbol}?portfolio_id=${encodeURIComponent(portfolioId)}`, { shares, price, asset_class: assetClass }),
  }
}

/**
 * Check an order: { portfolio_id?, scenario_id?, trades, prices? }. It prices the traded symbols from your source,
 * and when Allocait names held symbols that still need a price, prices those and asks once more.
 */
export async function check(order, { api = client(), prices = source() } = {}) {
  const portfolioId = order.portfolio_id || process.env.ALLOCAIT_PORTFOLIO_ID
  if (!portfolioId) {
    const list = (await api.portfolios()).map((p) => `  ${p.portfolio_id}  ${p.name}`).join('\n')
    throw new Error(`Set ALLOCAIT_PORTFOLIO_ID (or "portfolio_id" in the order) to one of:\n${list}`)
  }
  const trades = normalizeTrades(order.trades)
  const ask = (p) => api.checkTrades({ portfolioId, trades, prices: p, scenarioId: order.scenario_id })
  const first = order.prices ?? (await prices(trades.map((t) => t.symbol)))
  try {
    return await ask(first)
  } catch (e) {
    if (e.code !== 'PRICES_INCOMPLETE' || !e.body?.missing_symbols?.length || order.prices) throw e
    return ask({ ...first, ...(await prices(e.body.missing_symbols)) })
  }
}

/**
 * The exit status a bot reads:
 *   0  no rule newly or further outside, enough cash, and a rule of yours judges every traded symbol
 *   1  one or more rules newly or further outside, or not enough cash
 *   2  no result: the request was refused or failed, so nothing was checked
 *   3  no rule of yours judges a traded symbol (it is in not_covered), or the scenario judged none
 */
export function exitCode(r) {
  if (r.newly_or_further_outside_count > 0 || !r.cash.sufficient) return 1
  if (r.rules_judged_count === 0 || r.not_covered.some((n) => n.traded)) return 3
  return 0
}

/** The facts of a result, one line each. */
export function formatResult(r) {
  const lines = [`Rules judged: ${r.rules_judged_count}. Newly or further outside: ${r.newly_or_further_outside_count}.`]
  for (const x of r.rules) {
    const what = x.kind === 'class_band' ? `${x.asset_class} band` : `${x.symbol} size`
    lines.push(`  ${what}: ${x.before_pct}% -> ${x.after_pct}% (your range ${x.min_pct}% to ${x.max_pct}%), ${x.change.replace('_', ' ')}`)
  }
  for (const n of r.not_covered) lines.push(`  ${n.symbol}: no rule covers it (${n.reason})`)
  if (!r.cash.sufficient) lines.push(`  Cash after the change: ${r.cash.after} (not enough)`)
  return lines.join('\n')
}

/**
 * --demo: the saved example result, read from result.example.json and printed through formatResult like a real one.
 * Nothing is computed here: the file is a result in the shape POST /trades/check returns, for order.example.json and
 * prices.example.json against the made-up book in the README, with made-up numbers.
 */
export const DEMO_HEADER = [
  'Example result, saved in result.example.json. No account, no key, no network: nothing was checked.',
  'Order: order.example.json. Prices: prices.example.json. The book and its rules are made up.',
  '',
].join('\n')

export async function demoResult() {
  return JSON.parse(await readFile(new URL('../result.example.json', import.meta.url), 'utf8'))
}

/** An order from a file, or from stdin when the path is "-". */
export async function readOrder(path) {
  if (!path) throw new Error('Give an order file, or - to read it from stdin.')
  return JSON.parse(path === '-' ? await new Response(process.stdin).text() : await readFile(path, 'utf8'))
}

/** Run a command-line entry: exit with the status it returns, or 2 when there is no result. */
export function cli(main) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`No result: ${e.message}`)
      process.exit(2)
    },
  )
}
