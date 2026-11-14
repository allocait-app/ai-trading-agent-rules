// Price sources. A source is one function, (symbols) => ({ SYMBOL: price }), that leaves out what it cannot
// price. Allocait supplies no prices, so the bot brings its own. Add yours with the same shape. Pairs are BASE/USD.
import { readFile } from 'node:fs/promises'
import { alpacaHeaders } from './alpaca.mjs'
import { guarded } from './http.mjs'

const priced = (map, s) => map[s] > 0

/** A JSON file you keep: { "SYMBOL": 123.45 }. */
export async function fromFile(path, symbols) {
  const all = Object.fromEntries(Object.entries(JSON.parse(await readFile(path, 'utf8'))).map(([k, v]) => [k.toUpperCase(), Number(v)]))
  return Object.fromEntries(symbols.filter((s) => priced(all, s)).map((s) => [s, all[s]]))
}

/** Coinbase Exchange public ticker, no key. Pairs only. */
export async function fromCoinbase(symbols) {
  const pairs = symbols.filter((s) => s.includes('/'))
  const got = await Promise.all(
    pairs.map(async (s) => {
      const res = await fetch(`https://api.exchange.coinbase.com/products/${encodeURIComponent(s.replace('/', '-'))}/ticker`, guarded())
      return res.ok ? [s, Number((await res.json()).price)] : null
    }),
  )
  return Object.fromEntries(got.filter(Boolean))
}

/** Alpaca market data: stocks (IEX feed) and pairs. */
export async function fromAlpaca(symbols) {
  const latest = async (path, list) => {
    if (!list.length) return {}
    const res = await fetch(`https://data.alpaca.markets${path}symbols=${encodeURIComponent(list.join(','))}`, { headers: alpacaHeaders(), ...guarded() })
    const trades = res.ok ? (await res.json()).trades ?? {} : {}
    return Object.fromEntries(Object.entries(trades).map(([s, t]) => [s, Number(t.p)]))
  }
  const [stocks, pairs] = await Promise.all([
    latest('/v2/stocks/trades/latest?feed=iex&', symbols.filter((s) => !s.includes('/'))),
    latest('/v1beta3/crypto/us/latest/trades?', symbols.filter((s) => s.includes('/'))),
  ])
  return { ...stocks, ...pairs }
}

const SOURCES = { coinbase: fromCoinbase, alpaca: fromAlpaca }

/**
 * The source PRICE_SOURCE names: file:<path>, coinbase or alpaca. A comma list tries each in turn for what the
 * earlier ones left out (coinbase,file:prices.json). Throws naming every symbol no source priced.
 */
export function source(spec = process.env.PRICE_SOURCE || 'file:prices.example.json') {
  const chain = spec.split(',').map((s) => s.trim()).map((s) => {
    if (s.startsWith('file:')) return (symbols) => fromFile(s.slice(5), symbols)
    if (SOURCES[s]) return SOURCES[s]
    throw new Error(`Unknown price source "${s}". Use file:<path>, coinbase or alpaca.`)
  })
  return async (symbols) => {
    const out = {}
    let failure = ''
    for (const get of chain) {
      const left = symbols.filter((s) => !priced(out, s))
      if (!left.length) break
      try {
        Object.assign(out, await get(left))
      } catch (e) {
        failure = ` (${e.message})` // a source that is down leaves its symbols to the next one
      }
    }
    const missing = symbols.filter((s) => !priced(out, s))
    if (missing.length) throw new Error(`No price for ${missing.join(', ')} from ${spec}${failure}`)
    return Object.fromEntries(symbols.map((s) => [s, out[s]]))
  }
}
