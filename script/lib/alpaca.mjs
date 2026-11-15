// One broker adapter, for an Alpaca paper account. Any broker fits the same shape:
//   place(row) => { id, status, filledQty, filledPrice }
// This is your account and your code, and this adapter is the only code here that talks to Alpaca. Paper unless you opt in to live on purpose.
import { setTimeout as sleep } from 'node:timers/promises'
import { guarded } from './http.mjs'

export function alpacaHeaders() {
  const { ALPACA_API_KEY_ID: id, ALPACA_API_SECRET_KEY: secret } = process.env
  if (!id || !secret) throw new Error('Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY.')
  return { 'APCA-API-KEY-ID': id, 'APCA-API-SECRET-KEY': secret, 'content-type': 'application/json' }
}

const PAPER = 'https://paper-api.alpaca.markets'
const LIVE = 'https://api.alpaca.markets'

/**
 * The trading URL. Paper unless ALPACA_BASE_URL says otherwise. Alpaca's live URL needs ALLOW_LIVE_TRADING=1 too,
 * and no other host is ever accepted, so a stray variable or a lookalike host cannot get real orders or your keys.
 * For another broker, write your own adapter.
 */
export function tradingBase(env = process.env) {
  const url = (env.ALPACA_BASE_URL || PAPER).replace(/\/+$/, '')
  if (url === PAPER) return url
  if (url !== LIVE) throw new Error(`Refusing ${url}: only ${PAPER} and ${LIVE} are allowed. For another broker, write your own adapter.`)
  if (env.ALLOW_LIVE_TRADING !== '1') throw new Error(`Refusing ${url}: a live account needs ALLOW_LIVE_TRADING=1, and every order still waits for a person's explicit yes.`)
  return url
}

/** Where orders go, for the person to read before they answer: { host, live }. Refuses an unlisted URL like tradingBase. */
export function venue(env = process.env) {
  const base = tradingBase(env)
  return { host: new URL(base).host, live: base !== PAPER }
}

const DONE = new Set(['filled', 'canceled', 'expired', 'rejected', 'done_for_day'])

/**
 * Place a market order. `clientOrderId` makes a repeat of the same order a refusal at the broker, not a second order.
 * Once the broker has accepted it, this never throws: it returns what it last knew, and `open: true` when the order
 * had not reached a final state (the caller then says so; nothing about it is guessed).
 */
export async function placeOrder({ symbol, side, shares, clientOrderId }) {
  const base = tradingBase()
  const headers = alpacaHeaders()
  const res = await fetch(`${base}/v2/orders`, {
    method: 'POST',
    headers,
    ...guarded(),
    body: JSON.stringify({ symbol, qty: String(shares), side: side.toLowerCase(), type: 'market', time_in_force: symbol.includes('/') ? 'gtc' : 'day', client_order_id: clientOrderId }),
  })
  let order = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Alpaca refused the order: ${order.message ?? res.status}`)
  // Wait up to about eight seconds for a final state, so what is recorded is what filled. A failed poll keeps what we know.
  for (let wait = 250; !DONE.has(order.status) && wait <= 4000; wait *= 2) {
    await sleep(wait)
    try {
      const poll = await fetch(`${base}/v2/orders/${encodeURIComponent(order.id)}`, { headers, ...guarded() })
      if (poll.ok) order = await poll.json()
    } catch { /* keep the last known state */ }
  }
  return { id: order.id, status: order.status, open: !DONE.has(order.status), filledQty: Number(order.filled_qty) || 0, filledPrice: Number(order.filled_avg_price) || null }
}
