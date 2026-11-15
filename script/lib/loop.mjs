// The loop with a person in it: check, show the facts, ask, place (optional), record.
import { createHash } from 'node:crypto'
import { client, check, exitCode, formatResult, normalizeTrades } from './allocait.mjs'
import { source } from './prices.mjs'

/** Same order, same day, same book: the same id, so a repeat after a timeout is refused by the broker, not placed twice. */
export function clientOrderId(portfolioId, row, day = new Date().toISOString().slice(0, 10)) {
  const key = [portfolioId, row.symbol, row.side, row.shares, row.shares_before, day].join('|')
  return `ac-${createHash('sha256').update(key).digest('hex').slice(0, 40)}`
}

/**
 * order: { trades, portfolio_id?, scenario_id? }. A "prices" key in it is ignored here: prices come from `prices`.
 * confirm: (question, word = 'y') => Promise<boolean>, or null when no one is present (then nothing is placed or recorded).
 * place: a broker adapter (see alpaca.mjs), or null to record the change in Allocait only.
 * venue: { host, live } describing the broker, shown before the question; live asks for the word "live".
 * Returns the check's exit status, or 4 when an order was not placed, or placed and not fully recorded.
 */
export async function run({ prices: _ignored, ...order }, { api = client(), prices = source(), confirm = null, place = null, venue = null } = {}) {
  const trades = normalizeTrades(order.trades)
  if (new Set(trades.map((t) => t.symbol)).size !== trades.length) throw new Error('One trade per symbol, so each fill records against its own row.')
  const result = await check({ ...order, trades }, { api, prices })
  console.log(formatResult(result))
  let code = exitCode(result)

  // Sales first, so the cash they free is there when a buy is recorded on its own. Stable, and `index` keeps each row's order line.
  const rows = [...result.trades].sort((a, b) => (a.side === 'SELL' ? 0 : 1) - (b.side === 'SELL' ? 0 : 1))
  const lines = rows.map((t) => `  ${t.side} ${t.shares} ${t.symbol} at ${t.price}`)
  if (!confirm) {
    console.log('No one present: nothing placed, nothing recorded. It would place:')
    console.log(lines.join('\n'))
    return code
  }
  console.log(`${place ? 'Orders' : 'Changes'} for portfolio ${result.portfolio_id}${place && venue ? ` at ${venue.host}` : ''}:\n${lines.join('\n')}`)
  const live = place && venue?.live
  if (live) console.log('LIVE: this places real orders with real money.')
  const ok = live
    ? await confirm('Type "live" to place these orders: ', 'live')
    : await confirm(place ? 'Place this order and record it in Allocait? [y/N] ' : 'Record this change in Allocait (no broker)? [y/N] ')
  if (!ok) return code

  for (const [n, row] of rows.entries()) {
    let fill
    if (place) {
      try {
        fill = await place({ ...row, clientOrderId: clientOrderId(result.portfolio_id, row) })
      } catch (e) {
        // Not placed, or placed and the answer lost: say so and stop, since a later row may depend on this one.
        console.error(`${row.symbol}: not placed: ${e.message}. Check your broker before you retry.`)
        const rest = rows.slice(n + 1).map((r) => r.symbol)
        if (rest.length) console.error(`Not attempted: ${rest.join(', ')}.`)
        return 4
      }
    } else {
      fill = { filledQty: row.shares, filledPrice: row.price }
    }
    if (fill.open) {
      code = 4
      console.error(`${row.symbol}: order ${fill.id} is still ${fill.status}, ${fill.filledQty} filled so far.${fill.filledQty ? ' That part is recorded;' : ''} Record the rest once it fills.`)
    }
    if (!fill.filledQty) {
      if (!fill.open) console.log(`${row.symbol}: order ${fill.id} ended ${fill.status} with nothing filled. Nothing recorded.`)
      continue
    }
    const shares = row.shares_before + (row.side === 'BUY' ? 1 : -1) * fill.filledQty
    const price = fill.filledPrice ?? row.price
    try {
      await api.recordPosition({ portfolioId: result.portfolio_id, symbol: row.symbol, shares, price, assetClass: trades[row.index].asset_class })
      console.log(`Recorded ${row.symbol}: ${shares} at ${price}${fill.id ? ` (order ${fill.id}, ${fill.status})` : ''}`)
    } catch (e) {
      code = 4
      console.error(`${row.symbol}: ${fill.id ? `placed (order ${fill.id}), but ` : ''}not recorded in Allocait: ${e.message}`)
    }
  }
  return code
}
