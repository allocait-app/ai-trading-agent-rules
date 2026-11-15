// npm test. The pre-order hook (hooks/require-check.mjs) and its Alpaca preset against made-up transcripts:
// no Claude Code, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decide, readTranscript } from '../hooks/require-check.mjs'

const HOOK = fileURLToPath(new URL('../hooks/require-check.mjs', import.meta.url))
const readJson = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'))
const preset = await readJson('../hooks/presets/alpaca.json')
const skillText = await readFile(new URL('../skills/ai-trading-agent-rules/SKILL.md', import.meta.url), 'utf8')
const fixture = await readJson('./fixtures/alpaca-tools.json')
const saved = await readJson('../script/result.example.json')
const inside = { ...saved, within_rules: true, newly_or_further_outside_count: 0, rules: [], not_covered: [] }
const O = { preset }

const CHECK_TOOL = 'mcp__allocait__check_trades'
const STOCK = 'mcp__alpaca__place_stock_order'
// One transcript line per message, in the shape Claude Code writes: an assistant tool_use, then a user tool_result.
const use = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const answer = (id, content, isError = false) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } })
const text = (r) => [{ type: 'text', text: JSON.stringify(r) }]
const checkCall = (id, symbols, result, name = CHECK_TOOL, side = 'BUY', shares = 7) => [
  use(id, name, { portfolio_id: 'p1', trades: symbols.map((symbol) => ({ symbol, side, shares })), prices: {} }),
  ...(result === undefined ? [] : [answer(id, typeof result === 'string' ? result : text(result), typeof result === 'string')]),
]
const placed = (id, input, result = 'accepted', tool = STOCK) => [use(id, tool, input), ...(result === null ? [] : [answer(id, result, /^(Error|No check_trades)/.test(result))])]
const jsonl = (...entries) => [{ type: 'summary', summary: 'made up' }, ...entries.flat()].map((e) => JSON.stringify(e)).join('\n') + '\nnot json\n'
const stock = (extra = {}) => ({ symbol: 'alfa', side: 'buy', qty: '7', client_order_id: 'ac-1', ...extra })
const call = (input = stock(), tool_name = STOCK, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input: input, tool_use_id: 'toolu_now', permission_mode: 'default', ...extra })
const run = (hook, transcript, options = O) => decide(hook, transcript, options)
const deny = (hook, transcript, options) => {
  const r = run(hook, transcript, options)
  assert.equal(r?.decision, 'deny', JSON.stringify(r))
  return r.reason
}
// Every refusal ends on the owner. None may end on a step that writes.
const ENDS_WITH_OWNER = /(Ask the owner[^.]*\.|Tell the owner and ask before any further call\.)$/
const COMMANDS_A_WRITE = /\bplace it\b|call close_position|then place|call again|do what it says|cancel_order_by_id|each after its own|only after their yes/i

test('with no check_trades call, the order tool is refused, naming the order and ending with the owner', () => {
  const r = deny(call(), jsonl())
  assert.equal(r, 'No check_trades result for BUY alfa 7 shares found in this session\'s transcript. Ask the owner whether to run check_trades for this order.')
  assert.match(r, ENDS_WITH_OWNER)
  assert.doesNotMatch(r, COMMANDS_A_WRITE)
})

test('an exact check (symbol, side, quantity) goes on to a question to the owner, under any server name', () => {
  for (const name of [CHECK_TOOL, 'mcp__plugin_allocait_allocait__check_trades', 'mcp__3f2a1b4c-0000-4000-8000-123456789abd__check_trades']) {
    const r = run(call(), jsonl(checkCall('t1', ['ALFA', 'ECHO/USD'], inside, name)))
    assert.equal(r.decision, 'ask')
    assert.equal(r.reason, 'This call places BUY alfa 7 shares. It matches an unused check_trades result in this session. That result names 0 rules newly or further outside range.')
  }
  // The same under another server name for the order tool.
  assert.equal(run(call(stock(), 'mcp__claude_ai_Alpaca__place_stock_order'), jsonl(checkCall('t1', ['ALFA'], inside))).decision, 'ask')
})

test('a check for another symbol, side, quantity or unit does not count, and the refusal names what was checked', () => {
  const near = (c) => deny(call(), jsonl(c))
  assert.match(near(checkCall('t1', ['BRAV'], inside)), /^No check_trades result for BUY alfa 7 shares found/)
  assert.match(near(checkCall('t1', ['ALFA'], inside, CHECK_TOOL, 'SELL')), /The checks for alfa were for SELL 7 shares\./)
  assert.match(near(checkCall('t1', ['ALFA'], inside, CHECK_TOOL, 'BUY', 5)), /The checks for alfa were for BUY 5 shares\./)
  const dollars = [use('t1', CHECK_TOOL, { trades: [{ symbol: 'ALFA', side: 'BUY', notional: 7 }] }), answer('t1', text(inside))]
  assert.match(near(dollars), /The checks for alfa were for BUY 7 dollars\./)
  assert.match(near(dollars), ENDS_WITH_OWNER)
})

test('"5.0" and 5 are one quantity, and ECHO/USD and ECHOUSD are two symbols, as in Allocait', () => {
  const t = jsonl(checkCall('t1', ['ECHO/USD'], inside, CHECK_TOOL, 'BUY', 5))
  assert.equal(run(call(stock({ symbol: 'echo/usd', qty: '5.0' }), 'mcp__alpaca__place_crypto_order'), t).decision, 'ask')
  assert.equal(run(call(stock({ symbol: 'echo/usd', qty: '5' }), 'mcp__alpaca__place_crypto_order'), t).decision, 'ask')
  // A check written without the slash does not clear a pair written with it, and the refusal shows the spelling checked.
  const slashless = jsonl(checkCall('t1', ['ECHOUSD'], inside, CHECK_TOOL, 'BUY', 5))
  const r = deny(call(stock({ symbol: 'ECHO/USD', qty: '5' }), 'mcp__alpaca__place_crypto_order'), slashless)
  assert.match(r, /^No check_trades result for BUY ECHO\/USD 5 shares found.*The checks for ECHO\/USD were for BUY ECHOUSD 5 shares\./)
  assert.match(deny(call(stock({ symbol: 'ECHOUSD', qty: '5' }), 'mcp__alpaca__place_crypto_order'), t), /^No check_trades result for BUY ECHOUSD 5 shares/)
  const dollars = jsonl([use('t1', CHECK_TOOL, { trades: [{ symbol: 'ECHO/USD', side: 'BUY', notional: 50 }] }), answer('t1', text(inside))])
  assert.equal(run(call({ symbol: 'ECHO/USD', side: 'buy', notional: '50', client_order_id: 'x' }, 'mcp__alpaca__place_crypto_order'), dollars).decision, 'ask')
})

test('a refused check, or a check with no answer, does not count', () => {
  const m = /^No check_trades result for BUY alfa 7 shares found/
  assert.match(deny(call(), jsonl(checkCall('t1', ['ALFA'], 'Error [PRICES_INCOMPLETE]: A price is needed for BRAV.'))), m)
  assert.match(deny(call(), jsonl(checkCall('t1', ['ALFA'], undefined))), m)
  assert.match(deny(call(), jsonl(checkCall('t1', ['ALFA'], inside, 'mcp__other__precheck_trades_log'))), m)
})

test('a missing client_order_id is refused with an example in the one id format', () => {
  const r = deny(call(stock({ client_order_id: '' })), jsonl(checkCall('t1', ['ALFA'], inside)))
  assert.match(r, /place_stock_order needs client_order_id, for example ac-<date>-<symbol without slash, lower case>-<side>-<quantity>-<n>, so a retry/)
  assert.match(r, ENDS_WITH_OWNER)
  // The skill tells the agent to send the same format.
  assert.ok(skillText.includes(preset.needsExample), 'SKILL.md and the preset give one client_order_id format')
})

test('an option order: qty x 100 is the share count, each leg needs its own check, a leg with no readable side asks', () => {
  const opt = 'mcp__alpaca__place_option_order'
  const single = { symbol: 'ALFA261120C00027000', side: 'buy', qty: '2', client_order_id: 'ac-1' }
  assert.match(deny(call(single, opt), jsonl(checkCall('t1', ['ALFA261120C00027000'], inside, CHECK_TOOL, 'BUY', 2))), /The checks for ALFA261120C00027000 were for BUY 2 shares\./)
  assert.equal(run(call(single, opt), jsonl(checkCall('t1', ['ALFA261120C00027000'], inside, CHECK_TOOL, 'BUY', 200))).decision, 'ask')
  const legs = { qty: '2', client_order_id: 'ac-1', legs: [{ symbol: 'ALFA261120C00027000', ratio_qty: '1', side: 'buy' }, { symbol: 'ALFA261120C00031000', ratio_qty: '2', position_intent: 'sell_to_open' }] }
  const one = jsonl(checkCall('t1', ['ALFA261120C00027000'], inside, CHECK_TOOL, 'BUY', 200))
  assert.match(deny(call(legs, opt), one), /^No check_trades result for SELL ALFA261120C00031000 400 shares/)
  const both = jsonl(
    [use('t1', CHECK_TOOL, { trades: [{ symbol: 'ALFA261120C00027000', side: 'BUY', shares: 200 }, { symbol: 'ALFA261120C00031000', side: 'SELL', shares: 400 }] }), answer('t1', text(inside))],
  )
  assert.equal(run(call(legs, opt), both).decision, 'ask')
  // A leg whose side cannot be read is refused, not asked: no check was matched to it.
  const noSide = { symbol: 'ALFA261120C00027000', qty: '2', client_order_id: 'ac-1' }
  assert.match(deny(call(noSide, opt), jsonl()), /^The side of option leg ALFA261120C00027000 cannot be read from the call.*Ask the owner\.$/)
  // A side and a position_intent that disagree are refused too.
  const conflict = { qty: '1', client_order_id: 'ac-1', legs: [{ symbol: 'ALFA261120C00027000', ratio_qty: '1', side: 'buy', position_intent: 'sell_to_open' }] }
  assert.match(deny(call(conflict, opt), jsonl(checkCall('t1', ['ALFA261120C00027000'], inside, CHECK_TOOL, 'BUY', 100))), /^The side and the position_intent of option leg ALFA261120C00027000 disagree.*Ask the owner\.$/)
  const agree = { qty: '1', client_order_id: 'ac-1', legs: [{ symbol: 'ALFA261120C00027000', ratio_qty: '1', side: 'buy', position_intent: 'buy_to_open' }] }
  assert.equal(run(call(agree, opt), jsonl(checkCall('t1', ['ALFA261120C00027000'], inside, CHECK_TOOL, 'BUY', 100))).decision, 'ask')
})

test('two identical legs need two checks, because each leg uses one', () => {
  const opt = 'mcp__alpaca__place_option_order'
  const leg = { symbol: 'ALFA261120C00027000', ratio_qty: '1', side: 'buy' }
  const twice = { qty: '1', client_order_id: 'ac-1', legs: [leg, leg] }
  const one = jsonl(checkCall('t1', ['ALFA261120C00027000'], inside, CHECK_TOOL, 'BUY', 100))
  assert.match(deny(call(twice, opt), one), /^The check_trades result for BUY ALFA261120C00027000 100 shares was used by your earlier order\./)
  const two = jsonl(checkCall('t1', ['ALFA261120C00027000'], inside, CHECK_TOOL, 'BUY', 100), checkCall('t2', ['ALFA261120C00027000'], inside, CHECK_TOOL, 'BUY', 100))
  assert.equal(run(call(twice, opt), two).decision, 'ask')
})

test('close_position matches a SELL only; a percentage, no qty and an asset id are refused with the next step', () => {
  const close = 'mcp__alpaca__close_position'
  const input = { symbol_or_asset_id: 'ALFA', qty: 5 }
  assert.equal(run(call(input, close), jsonl(checkCall('t1', ['ALFA'], inside, CHECK_TOOL, 'SELL', 5))).decision, 'ask')
  // A purchase check says nothing about the sale a close places.
  assert.match(deny(call(input, close), jsonl(checkCall('t1', ['ALFA'], inside, CHECK_TOOL, 'BUY', 5))), /^No check_trades result for SELL ALFA 5 shares found.*The checks for ALFA were for BUY 5 shares\./)
  for (const bad of [{ symbol_or_asset_id: 'ALFA', percentage: 50 }, { symbol_or_asset_id: 'ALFA' }, { symbol_or_asset_id: 'ALFA', qty: 5, percentage: 5 }, { symbol_or_asset_id: 'ALFA', qty: 0 }]) {
    const r = deny(call(bad, close), jsonl())
    assert.equal(r, 'close_position with a percentage, an asset id or no qty cannot be matched to a check. Ask the owner which quantity of one symbol to close.')
  }
  // An asset id is refused with or without its dashes.
  for (const id of ['3b5f2c1e-8a4d-4e7b-9c6a-1d2e3f4a5b6c', '3b5f2c1e8a4d4e7b9c6a1d2e3f4a5b6c']) {
    const uuid = deny(call({ symbol_or_asset_id: id, qty: 5 }, close), jsonl(checkCall('t1', [id], inside, CHECK_TOOL, 'SELL', 5)))
    assert.match(uuid, /must be a symbol, not an asset id/)
    assert.match(uuid, ENDS_WITH_OWNER)
  }
})

test('an option close counts contracts x 100 in both directions', () => {
  const close = 'mcp__alpaca__close_position'
  const sym = 'ALFA261120C00027000'
  const input = { symbol_or_asset_id: sym, qty: 2 }
  assert.equal(run(call(input, close), jsonl(checkCall('t1', [sym], inside, CHECK_TOOL, 'SELL', 200))).decision, 'ask')
  assert.match(deny(call(input, close), jsonl(checkCall('t1', [sym], inside, CHECK_TOOL, 'SELL', 2))), /^No check_trades result for SELL ALFA261120C00027000 200 shares.*were for SELL 2 shares/)
  // An option is read by its tail, so a root with a digit (an adjusted series) still counts contracts x 100.
  const adjusted = 'ALFA1261120C00027000'
  assert.match(deny(call({ symbol_or_asset_id: adjusted, qty: 2 }, close), jsonl(checkCall('t1', [adjusted], inside, CHECK_TOOL, 'SELL', 2))), /^No check_trades result for SELL ALFA1261120C00027000 200 shares/)
  assert.equal(run(call({ symbol_or_asset_id: adjusted, qty: 2 }, close), jsonl(checkCall('t1', [adjusted], inside, CHECK_TOOL, 'SELL', 200))).decision, 'ask')
  // A stock close keeps its own count.
  assert.equal(run(call({ symbol_or_asset_id: 'ALFA', qty: 2 }, close), jsonl(checkCall('t1', ['ALFA'], inside, CHECK_TOOL, 'SELL', 2))).decision, 'ask')
})

test('close_all_positions is always refused; replace_order_by_id is refused with qty and goes on with a price change', () => {
  const closeAll = deny(call({ cancel_orders: true }, 'mcp__alpaca__close_all_positions'), jsonl(checkCall('t1', ['ALFA'], inside)))
  assert.equal(closeAll, 'No single check covers closing every holding. Ask the owner which holdings they want closed.')
  const replace = 'mcp__alpaca__replace_order_by_id'
  assert.equal(deny(call({ order_id: 'o1', qty: '9' }, replace), jsonl()), 'A new quantity is a new order. Ask the owner whether to cancel this order and place a new one.')
  // A new dollar amount is a new order too, in any permission mode.
  assert.match(deny(call({ order_id: 'o1', notional: '1000000' }, replace, { permission_mode: 'bypassPermissions' }), jsonl()), /^A new quantity is a new order\./)
  assert.equal(run(call({ order_id: 'o1', limit_price: '9.10' }, replace), jsonl()), null)
})

test('exercise, do-not-exercise and update_account_config ask; an unknown place_ tool asks', () => {
  for (const tool of ['exercise_options_position', 'do_not_exercise_options_position', 'update_account_config']) {
    assert.equal(run(call({}, `mcp__alpaca__${tool}`), jsonl()).decision, 'ask')
  }
  const r = run(call({ symbol: 'ALFA' }, 'mcp__alpaca__place_future_order'), jsonl())
  assert.equal(r.decision, 'ask')
  assert.match(r.reason, /^place_future_order: A place_ tool this preset has no rule for\./)
  assert.equal(run(call({}, 'mcp__alpaca__get_clock'), jsonl()).decision, 'ask')
})

test('a matched order is asked in default and acceptEdits, and refused in every other mode or none', () => {
  const t = jsonl(checkCall('t1', ['ALFA'], inside))
  for (const permission_mode of ['default', 'acceptEdits']) assert.equal(run(call(stock(), STOCK, { permission_mode }), t).decision, 'ask')
  for (const permission_mode of ['bypassPermissions', 'dontAsk', 'auto', 'acceptAll', '', undefined, 5]) {
    const r = deny(call(stock(), STOCK, { permission_mode }), t)
    assert.equal(r, 'This call places BUY alfa 7 shares. It matches an unused check_trades result in this session. That result names 0 rules newly or further outside range. The hook asks only in the default and acceptEdits permission modes, so the order is refused. Ask the owner.')
  }
  // An ask kind follows the same rule.
  const ex = call({}, 'mcp__alpaca__exercise_options_position', { permission_mode: 'bypassPermissions' })
  assert.match(deny(ex, jsonl()), /The hook asks only in the default and acceptEdits permission modes, so the call is refused\. Ask the owner\.$/)
})

test('a check is single-use: a second identical order is refused, an errored order does not use one up', () => {
  const t = (...rest) => jsonl(checkCall('t1', ['ALFA'], inside), ...rest)
  // One earlier order that placed.
  const r = deny(call(), t(placed('p1', stock({ client_order_id: 'ac-1' }))))
  assert.match(r, /^The check_trades result for BUY alfa 7 shares was used by your earlier order\. /)
  assert.match(r, /Ask the owner whether to run check_trades for this order again\.$/)
  // A second check after the order lets the next one go on.
  assert.equal(run(call(), t(placed('p1', stock()), checkCall('t2', ['ALFA'], inside))).decision, 'ask')
  // An order the broker or this hook answered with an error used no check.
  assert.equal(run(call(), t(placed('p1', stock(), 'Error: insufficient buying power'))).decision, 'ask')
  assert.equal(run(call(), t(placed('p1', stock(), 'No check_trades result for BUY alfa 7 shares found.'))).decision, 'ask')
  // The call being decided is in the transcript already: it does not use its own check.
  assert.equal(run(call(stock(), STOCK, { tool_use_id: 'p1' }), t(placed('p1', stock(), null))).decision, 'ask')
  // Another order still in flight does.
  assert.match(deny(call(), t(placed('p0', stock(), null))), /was used by your earlier order/)
  // A different quantity, side or symbol used nothing.
  assert.equal(run(call(), t(placed('p1', stock({ qty: '3' })), placed('p2', stock({ side: 'sell' })), placed('p3', stock({ symbol: 'brav' })))).decision, 'ask')
  // A close of the same shares uses a SELL check, and an order tool of another name counts too.
  const sell = jsonl(checkCall('t1', ['ALFA'], inside, CHECK_TOOL, 'SELL', 5))
  assert.equal(run(call({ symbol_or_asset_id: 'ALFA', qty: 5 }, 'mcp__alpaca__close_position'), sell).decision, 'ask')
  const closed = jsonl(checkCall('t1', ['ALFA'], inside, CHECK_TOOL, 'SELL', 5), placed('c1', { symbol_or_asset_id: 'alfa', qty: 5 }, 'accepted', 'mcp__alpaca__close_position'))
  assert.match(deny(call(stock({ side: 'sell', qty: '5' })), closed), /was used by your earlier order/)
  // Two checks, one order: one left.
  assert.equal(run(call(), jsonl(checkCall('t1', ['ALFA'], inside), checkCall('t2', ['ALFA'], inside), placed('p1', stock()))).decision, 'ask')
})

test('an order with no tool_use_id cannot be told from an earlier one and is refused', () => {
  const { tool_use_id, ...noId } = call()
  assert.match(deny(noId, jsonl(checkCall('t1', ['ALFA'], inside))), /names no tool_use_id.*Ask the owner\.$/)
})

test('an order with no symbol, side or quantity is refused naming the missing part', () => {
  const t = jsonl(checkCall('t1', ['ALFA'], inside))
  assert.match(deny(call(stock({ symbol: undefined })), t), /names no symbol or side, so no check can be matched to it\. Ask the owner\.$/)
  assert.match(deny(call(stock({ side: 'hold' })), t), /names no symbol or side/)
  assert.match(deny(call(stock({ qty: undefined })), t), /carries neither qty nor notional.*Ask the owner\.$/)
  assert.match(deny(call(stock({ qty: '' })), t), /carries neither qty nor notional/)
})

test('a quantity must be one finite positive decimal; the hook judges what the broker would read, or refuses', () => {
  const t = jsonl(checkCall('t1', ['ALFA'], inside, CHECK_TOOL, 'BUY', 5), checkCall('t2', ['ALFA'], inside, CHECK_TOOL, 'BUY', 1))
  // Infinity, an exponent, trailing text, a boolean, a list, zero and a negative are not quantities.
  for (const qty of ['1e999', '5e0', '5abc', 'Infinity', 'NaN', '0x5', true, [5], { n: 5 }, '0', '-5', 0]) {
    assert.match(deny(call(stock({ qty })), t), /^The qty of place_stock_order is not a positive number, so no check can be matched to it\. Ask the owner\.$/, String(qty))
  }
  assert.match(deny(call(stock({ qty: undefined, notional: '1e999' })), t), /^The notional of place_stock_order is not a positive number/)
  // Both qty and notional: one check cannot cover two amounts.
  assert.match(deny(call(stock({ notional: '1000000' })), t), /^place_stock_order carries both qty and notional/)
  assert.match(deny(call(stock({ qty: '5abc', notional: '250' })), t), /^place_stock_order carries both qty and notional/)
  // Only float noise is tolerated: 0.07 x 100 is 7.000000000000001, and 5000000000 is not 5000000004.
  assert.equal(run(call({ symbol: 'ALFA261120C00027000', side: 'buy', qty: '0.07', client_order_id: 'c' }, 'mcp__alpaca__place_option_order'), jsonl(checkCall('t1', ['ALFA261120C00027000'], inside, CHECK_TOOL, 'BUY', 7))).decision, 'ask')
  assert.match(deny(call(stock({ qty: '5000000000' })), jsonl(checkCall('t1', ['ALFA'], inside, CHECK_TOOL, 'BUY', 5000000004))), /^No check_trades result for BUY alfa 5000000000 shares/)
  // A plain decimal string and a number are the same quantity.
  assert.equal(run(call(stock({ qty: 5 })), t).decision, 'ask')
  assert.equal(run(call(stock({ qty: ' 5.0 ' })), t).decision, 'ask')
})

test('a check that starts or answers after the order call was made does not count', () => {
  const order = use('toolu_now', STOCK, stock())
  assert.match(deny(call(), jsonl(order, checkCall('t1', ['ALFA'], inside))), /^No check_trades result for BUY alfa 7 shares/)
  // A check that began earlier but answered after the call is not an answer the call could know.
  assert.match(deny(call(), jsonl(checkCall('t1', ['ALFA'], undefined), order, [answer('t1', text(inside))])), /^No check_trades result for BUY alfa 7 shares/)
  // A check before the call counts, as before.
  assert.equal(run(call(), jsonl(checkCall('t1', ['ALFA'], inside), order)).decision, 'ask')
})

test('the question to the owner says "1 share", and a dollar order says dollars', () => {
  const one = [use('t1', CHECK_TOOL, { trades: [{ symbol: 'ALFA', side: 'BUY', shares: 1 }] }), answer('t1', text(inside))]
  assert.match(run(call(stock({ qty: '1' })), jsonl(one)).reason, /^This call places BUY alfa 1 share\. /)
})

test('--refuse-outside refuses when the newest matching result names a rule newly or further outside', () => {
  const t = jsonl(checkCall('t1', ['ALFA', 'ECHO/USD'], saved))
  assert.equal(run(call(), t).decision, 'ask')
  const r = deny(call(), t, { ...O, refuseOutside: true })
  assert.match(r, /^The latest check_trades for alfa states: Crypto band 0% -> 7\.29% \(range 0% to 7%\), newly outside\./)
  // Without the flag the owner's question carries the same facts, and the hook decides nothing.
  const asked = run(call(), t)
  assert.match(asked.reason, /That result names 1 rule newly or further outside range: Crypto band 0% -> 7\.29% \(range 0% to 7%\), newly outside\.$/)
  assert.match(r, /Tell the owner and ask before any further call\.$/)
  const later = jsonl(checkCall('t1', ['ALFA'], saved), checkCall('t2', ['ALFA'], inside))
  assert.equal(run(call(stock({ client_order_id: 'x' })), later, { ...O, refuseOutside: true }).decision, 'ask')
})

test('every refusal ends by sending the agent to the owner, and none commands a further write', () => {
  const t = jsonl(checkCall('t1', ['ALFA'], saved), placed('p1', stock()))
  const messages = [
    deny(call(), jsonl()),
    deny(call(), t),
    deny(call(), jsonl(checkCall('t1', ['ALFA'], saved)), { ...O, refuseOutside: true }),
    deny(call(stock({ client_order_id: '' })), jsonl()),
    deny(call({ cancel_orders: true }, 'mcp__alpaca__close_all_positions'), jsonl()),
    deny(call({ order_id: 'o', qty: '1' }, 'mcp__alpaca__replace_order_by_id'), jsonl()),
    deny(call({ symbol_or_asset_id: 'ALFA' }, 'mcp__alpaca__close_position'), jsonl()),
    deny(call(stock({ side: '' })), jsonl()),
    deny(call(stock(), STOCK, { permission_mode: 'dontAsk' }), jsonl(checkCall('t1', ['ALFA'], inside))),
    deny(call(stock({ qty: '1e999' })), jsonl(checkCall('t1', ['ALFA'], inside))),
    deny(call(stock({ notional: '5' })), jsonl(checkCall('t1', ['ALFA'], inside))),
    deny(call({ qty: '1', client_order_id: 'c', symbol: 'ALFA261120C00027000' }, 'mcp__alpaca__place_option_order'), jsonl()),
  ]
  for (const m of messages) {
    assert.match(m, ENDS_WITH_OWNER, m)
    assert.doesNotMatch(m, COMMANDS_A_WRITE, m)
    // No advice or approval words, no em dash, and no word from the repo's banned list.
    assert.doesNotMatch(m, /\b(block(ed|s)?|approv\w*|safe|prevent\w*|en[f]orc\w*|allowed|recommend\w*|should|best)\b|\u2014|\bplan\b/i, m)
  }
})

test('the transcript reader skips lines that are not JSON, pairs results with calls, and reads a real-shaped string result', () => {
  const { checks: calls } = readTranscript(jsonl(checkCall('t1', ['alfa'], inside), checkCall('t2', ['BRAV'], 'Error [INVALID_INPUT]: no.')))
  assert.deepEqual(calls.map((c) => [c.trades.map((x) => x.key), Boolean(c.result)]), [[['ALFA'], true], [['BRAV'], false]])
  // Claude Code stores an MCP result as one JSON string (not a list of blocks), and the server name can be a uuid.
  const asString = jsonl([use('t1', 'mcp__0a1b2c3d-0000-4000-8000-000000000001__check_trades', { trades: [{ symbol: 'ALFA', side: 'BUY', shares: 7 }] }), answer('t1', JSON.stringify(inside))])
  assert.equal(readTranscript(asString, preset).checks[0].result.within_rules, true)
  assert.equal(run(call(), asString).decision, 'ask')
})

// Every Alpaca write tool has a rule in the preset or a reason on the inert list in the fixture.
test('every Alpaca write tool in the fixture has a preset rule or an inert reason, and the two lists do not overlap', () => {
  const ruled = new Set(Object.keys(preset.tools))
  for (const [name, t] of Object.entries(fixture.tools)) {
    const inert = typeof t.inert === 'string' && t.inert.length > 20
    assert.ok(ruled.has(name) !== inert, `${name} needs a rule in hooks/presets/alpaca.json, or a reason on the inert list in dev/fixtures/alpaca-tools.json (not both)`)
  }
  for (const name of ruled) assert.ok(fixture.tools[name], `${name} is in the preset but not in the fixture`)
  // The keys a rule reads exist on the tool.
  for (const [name, rule] of Object.entries(preset.tools)) {
    const keys = fixture.tools[name].keys
    for (const k of [rule.symbolKey, ...(rule.needs ?? []), ...(rule.denyKeys ?? [])].filter(Boolean)) assert.ok(keys.includes(k), `${name} has no input key ${k}`)
  }
  // Every order-placing kind is attended, and the rest are not.
  for (const [name, rule] of Object.entries(preset.tools)) assert.equal(Boolean(rule.attended), ['order', 'legs', 'close'].includes(rule.kind), name)
})

// The script as Claude Code runs it: the hook input on stdin, exit 0 or 2, the fact on stderr.
async function runHook(transcript, args = [], hook = call()) {
  const dir = await mkdtemp(join(tmpdir(), 'allocait-hook-'))
  const path = join(dir, 'session.jsonl')
  if (transcript !== null) await writeFile(path, transcript)
  return spawnSync(process.execPath, [HOOK, ...args], { input: JSON.stringify({ ...hook, session_id: 's1', transcript_path: path, cwd: dir }), encoding: 'utf8' })
}

test('as a command: a missing transcript, bad input, a bad flag or a bad preset exits 2', async () => {
  const missing = await runHook(null)
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /Could not read the session transcript.*Ask the owner\./)
  assert.equal(spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' }).status, 2)
  assert.equal((await runHook(jsonl(), ['--no-such-flag'])).status, 2)
  assert.equal((await runHook(jsonl(), ['--check-tool', '('])).status, 2)
  assert.equal((await runHook(jsonl(), ['--reread-ms', 'soon'])).status, 2)
  const bad = await runHook(jsonl(), ['--preset', '/no/such/preset.json'])
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /The preset could not be read/)
})

test('as a command: no check exits 2; a match in default prints an ask; a match in bypassPermissions exits 2; an ask kind follows the mode', async () => {
  // --reread-ms 0: nothing will be written, so there is no second read to wait for.
  const none = await runHook(jsonl(), ['--reread-ms', '0'], call(stock(), STOCK, { permission_mode: 'bypassPermissions' }))
  assert.equal(none.status, 2)
  assert.match(none.stderr, /^No check_trades result for BUY alfa 7 shares/)
  const t = jsonl(checkCall('t1', ['ALFA'], inside))
  const asked = await runHook(t)
  assert.equal(asked.status, 0)
  assert.equal(asked.stderr, '')
  const out = JSON.parse(asked.stdout).hookSpecificOutput
  assert.deepEqual(Object.keys(out).sort(), ['hookEventName', 'permissionDecision', 'permissionDecisionReason'])
  assert.equal(out.permissionDecision, 'ask')
  assert.match(out.permissionDecisionReason, /^This call places BUY alfa 7 shares\./)
  const bypass = await runHook(t, [], call(stock(), STOCK, { permission_mode: 'bypassPermissions' }))
  assert.equal(bypass.status, 2)
  assert.equal(bypass.stdout, '')
  assert.match(bypass.stderr, /The hook asks only in the default and acceptEdits permission modes, so the order is refused\. Ask the owner\.$/m)
  assert.equal((await runHook(jsonl(), [], call({}, 'mcp__alpaca__update_account_config'))).status, 0)
  assert.equal((await runHook(jsonl(), [], call({}, 'mcp__alpaca__update_account_config', { permission_mode: 'dontAsk' }))).status, 2)
  assert.equal((await runHook(jsonl(checkCall('t1', ['ALFA'], saved)), ['--refuse-outside'])).status, 2)
  // A step with a neutral tool: replace with a price only goes on with no output.
  const replace = await runHook(jsonl(), [], call({ order_id: 'o1', limit_price: '9.10' }, 'mcp__alpaca__replace_order_by_id'))
  assert.equal(replace.status, 0)
  assert.equal(replace.stdout, '')
})

test('as a command: a check written to the transcript after the hook starts is read on the second look', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'allocait-hook-'))
  const path = join(dir, 'session.jsonl')
  await writeFile(path, jsonl())
  const run2 = spawn(process.execPath, [HOOK, '--reread-ms', '600'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  run2.stdout.on('data', (d) => (stdout += d))
  run2.stdin.end(JSON.stringify({ ...call(), session_id: 's1', transcript_path: path, cwd: dir }))
  setTimeout(() => writeFile(path, jsonl(checkCall('t1', ['ALFA'], inside))), 100)
  const [status] = await once(run2, 'close')
  assert.equal(status, 0)
  assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'ask')
})
