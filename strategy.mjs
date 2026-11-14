// YOUR STRATEGY GOES HERE. bot.mjs calls propose() and checks what it returns before anything is placed.
//
// Return an order: { trades: [{ symbol, side: 'BUY' | 'SELL', shares | notional, asset_class? }] }
// Build it from your own logic: a model's answer, a rebalancer, a signal, a queue. Nothing about how the order
// was made matters to the check, and this file never suggests a trade: the shipped version only reads one you wrote.
import { readOrder } from './lib/allocait.mjs'

export async function propose() {
  const file = process.env.ORDER_FILE
  if (!file) throw new Error('No strategy yet. Write one in strategy.mjs, set ORDER_FILE to an order file, or pass the file: node bot.mjs order.json')
  return readOrder(file)
}
