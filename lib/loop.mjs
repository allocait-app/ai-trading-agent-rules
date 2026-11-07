// The loop with a person in it: check, show the facts, ask, place (optional), record.
import { client, check, exitCode, formatResult } from './allocait.mjs'
import { source } from './prices.mjs'

/**
 * confirm: (question) => Promise<boolean>, or null when no one is present (then nothing is placed or recorded).
 * place: a broker adapter (see alpaca.mjs), or null to record the change in Allocait only.
 * Returns the check's exit status, or 4 when something placed was not recorded.
 */
export async function run(order, { api = client(), prices = source(), confirm = null, place = null } = {}) {
  const symbols = order.trades.map((t) => t.symbol.trim().toUpperCase())
  if (new Set(symbols).size !== symbols.length) throw new Error('One trade per symbol, so each fill records against its own row.')
  const result = await check(order, { api, prices })
  console.log(formatResult(result))
  let code = exitCode(result)

  if (!confirm) {
    console.log('No one present: nothing placed, nothing recorded. It would place:')
    for (const t of result.trades) console.log(`  ${t.side} ${t.shares} ${t.symbol} at ${t.price}`)
    return code
  }
  if (!(await confirm(place ? 'Place this order and record it in Allocait? [y/N] ' : 'Record this change in Allocait (no broker)? [y/N] '))) return code

  // One row at a time, in order: a sale can fund the buy after it.
  for (const row of result.trades) {
    const fill = place ? await place(row) : { filledQty: row.shares, filledPrice: row.price }
    if (!fill.filledQty) {
      console.log(`${row.symbol}: order ${fill.id} is ${fill.status} with nothing filled. Record it once it fills.`)
      continue
    }
    const shares = row.shares_before + (row.side === 'BUY' ? 1 : -1) * fill.filledQty
    const price = fill.filledPrice ?? row.price
    try {
      await api.recordPosition({ portfolioId: result.portfolio_id, symbol: row.symbol, shares, price, assetClass: order.trades[row.index].asset_class })
      console.log(`Recorded ${row.symbol}: ${shares} at ${price}${fill.id ? ` (order ${fill.id}, ${fill.status})` : ''}`)
    } catch (e) {
      code = 4
      console.error(`${row.symbol}: ${fill.id ? `placed (order ${fill.id}), but ` : ''}not recorded in Allocait: ${e.message}`)
    }
  }
  return code
}
