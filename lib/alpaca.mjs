// One broker adapter, for an Alpaca paper account. Any broker fits the same shape:
//   place(row) => { id, status, filledQty, filledPrice }
// This is your account and your code; Allocait never connects to it. ALPACA_LIVE=1 switches to live on purpose.
import { setTimeout as sleep } from 'node:timers/promises'

export function alpacaHeaders() {
  const { ALPACA_API_KEY_ID: id, ALPACA_API_SECRET_KEY: secret } = process.env
  if (!id || !secret) throw new Error('Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY.')
  return { 'APCA-API-KEY-ID': id, 'APCA-API-SECRET-KEY': secret, 'content-type': 'application/json' }
}

const DONE = new Set(['filled', 'canceled', 'expired', 'rejected', 'done_for_day'])

export async function placeOrder({ symbol, side, shares }) {
  const base = process.env.ALPACA_LIVE === '1' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets'
  const headers = alpacaHeaders()
  const res = await fetch(`${base}/v2/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ symbol, qty: String(shares), side: side.toLowerCase(), type: 'market', time_in_force: symbol.includes('/') ? 'gtc' : 'day' }),
  })
  let order = await res.json()
  if (!res.ok) throw new Error(`Alpaca refused the order: ${order.message ?? res.status}`)
  // Wait up to about eight seconds for a final state, so what is recorded is what filled.
  for (let wait = 250; !DONE.has(order.status) && wait <= 4000; wait *= 2) {
    await sleep(wait)
    const poll = await fetch(`${base}/v2/orders/${order.id}`, { headers })
    if (poll.ok) order = await poll.json()
  }
  return { id: order.id, status: order.status, filledQty: Number(order.filled_qty) || 0, filledPrice: Number(order.filled_avg_price) || null }
}
