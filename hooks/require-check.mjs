#!/usr/bin/env node
// A Claude Code PreToolUse hook. Before an order tool runs, it reads this session's transcript and refuses the call
// (exit 2) unless a check_trades call for that exact order (symbol, side, and shares or dollars) returned a result
// earlier in the session, and no earlier order call has used that result. What each order tool needs is a rule in a
// preset file (hooks/presets/alpaca.json). A broker whose order tools take the same shapes is another preset; a new
// shape is a new rule kind in wantsOf. With --refuse-outside it also refuses when the newest matching result names a
// rule newly or further outside.
//
// An order tool is attended: in the default and acceptEdits permission modes a matched order is put to the person as
// a question, and in every other mode the hook refuses it instead of asking. The question needs a person at the prompt:
// a headless run (claude -p), an Agent SDK permission callback or an installed mod can answer it without one.
//
// Allocait states facts and decides nothing. This script is yours: it reads the transcript and refuses a tool call.
// The transcript is read from transcript_path. Claude Code documents that path and that the file is written
// asynchronously, but not the format of its lines, so an update of Claude Code can change what this script sees.
// No dependencies. Run under Node 26.8 only; no older Node has run it here. See docs/HOOK.md.
//
//   node require-check.mjs [--preset <file>] [--refuse-outside] [--check-tool <regex>] [--reread-ms <n>]
//
// Exit 0 with no output: the call goes on to the normal permission flow. Exit 0 with a permissionDecision of "ask":
// the person is asked, with the reason. Exit 2: Claude Code refuses the call and shows the message on stderr to Claude.
// A fault inside this script, or anything it cannot read, is exit 2 too. A script that cannot start or runs past its
// timeout is Claude Code's to handle: keep "onFailure": "block" in the settings that run it.
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

/** Allocait's check tool under any server name: check_trades, mcp__allocait__check_trades, mcp__plugin_x_allocait__check_trades. */
const DEFAULT_CHECK_TOOL = '(^|__)check_trades$'
const DEFAULT_PRESET = fileURLToPath(new URL('./presets/alpaca.json', import.meta.url))
/** How a missing-check refusal starts. The transcript is written asynchronously, so main() reads it once more first. */
const NO_RESULT = 'No check_trades result for'
/** How a refusal starts when every matching check was used by an earlier order. main() reads again on this one too. */
const USED_RESULT = 'The check_trades result for'
/** How long main() waits before that second read. --reread-ms changes it; 0 skips the second read. */
const REREAD_MS = 2000
/** Modes in which Claude Code can show a person the question. Anywhere else an ask is a refusal. */
const CAN_ASK = new Set(['default', 'acceptEdits'])
const OUTSIDE = new Set(['newly_outside', 'further_outside'])
// An asset id with or without its dashes. A symbol is never 32 hex digits.
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
// An option symbol ends in a date, C or P, and a strike, whatever its root looks like (an adjusted root has a digit).
const OCC_TAIL = /\d{6}[CP]\d{8}$/
const NOBODY = 'The hook asks only in the default and acceptEdits permission modes, so'
const ASK_OWNER = 'Ask the owner.'
const ASK_CHECK = 'Ask the owner whether to run check_trades for this order'
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/

/** A symbol as the comparison reads it: no whitespace, upper-cased, slash kept. ECHO/USD and ECHOUSD are two symbols, as in Allocait. */
const keyOf = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
const present = (v) => v !== undefined && v !== null && v !== ''
/** A finite decimal from a number or a plain decimal string. Anything else (an exponent, a boolean, a list, Infinity) is NaN. */
const num = (v) => ((typeof v === 'number' || (typeof v === 'string' && DECIMAL.test(v.trim()))) && Number.isFinite(Number(v)) ? Number(v) : NaN)
/** Equal up to float noise (0.07 x 100), never up to a different quantity. */
const same = (a, b) => Math.abs(a - b) <= Math.max(1e-9, 1e-12 * Math.max(Math.abs(a), Math.abs(b)))
const toolOf = (name) => String(name ?? '').replace(/^.*__/, '')
const deny = (reason) => ({ decision: 'deny', reason })
const ask = (reason) => ({ decision: 'ask', reason })
const unit = (u, amount) => (u === 'notional' ? (amount === 1 ? ' dollar' : ' dollars') : amount === 1 ? ' share' : ' shares')
const isOrderRule = (r) => r?.kind === 'order' || r?.kind === 'legs' || r?.kind === 'close'
/** One trade as the comparison reads it, from a check or from an order call. */
const want = (symbol, side, unit, amount) => ({ symbol, key: keyOf(symbol), side, unit, amount })
/** An order call whose symbol, side or size cannot be read. */
const unmatched = (what) => ({ stop: deny(`${what}, so no check can be matched to it. ${ASK_OWNER}`) })
// The spelling of a pair with its slash dropped, to show a near miss: ECHOUSD checked, ECHO/USD ordered.
const loose = (k) => k.replace(/\//g, '')

/** The text of a tool_result block: a string, or a list of { type: 'text', text }. */
const resultText = (content) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('') : ''

/** A check_trades result is the JSON Allocait returned. A refusal ("Error [CODE]: ...", or is_error) is not a result. */
function parseResult(block) {
  if (!block || block.is_error) return null
  try {
    const r = JSON.parse(resultText(block.content))
    return r && Array.isArray(r.rules) ? r : null
  } catch {
    return null
  }
}

/** The trades a check_trades call asked about: { key, side, unit, amount }, in the units it was sent in. */
function tradesOf(input) {
  return (Array.isArray(input?.trades) ? input.trades : []).flatMap((t) => {
    const side = String(t?.side ?? '').toUpperCase()
    if (!keyOf(t?.symbol) || !side) return []
    const symbol = String(t.symbol).trim()
    const shares = num(t?.shares)
    const notional = num(t?.notional)
    if (!Number.isNaN(shares)) return [want(symbol, side, 'shares', shares)]
    if (!Number.isNaN(notional)) return [want(symbol, side, 'notional', notional)]
    return []
  })
}

/**
 * Reads a transcript (JSON Lines, oldest first) once. Returns { checks, orders }.
 * checks: every check_trades call, { trades, result } (result is null when it was refused or has no answer). When
 * stopId names a tool call that is in the transcript, a check that starts after that call, or a result that arrives after
 * it, is not read: the call could not have known it.
 * orders: every call to a tool the preset holds an order rule for, { id, tool, input, failed }. failed is true when the
 * call's result is an error (a refusal by this hook, a declined question, or an error from the broker). A call with no
 * result yet has failed false: it may be in flight, so it counts.
 * Lines that are not JSON, or carry no tool blocks, are skipped.
 */
export function readTranscript(text, preset, checkTool = new RegExp(DEFAULT_CHECK_TOOL), stopId = null) {
  const checks = new Map()
  const orders = new Map()
  let late = false
  for (const line of text.split('\n')) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    const content = entry?.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type === 'tool_use') {
        const name = block.name ?? ''
        if (stopId && block.id === stopId) late = true
        if (checkTool.test(name)) {
          if (!late) checks.set(block.id, { trades: tradesOf(block.input), result: null })
        } else if (isOrderRule(preset?.tools?.[toolOf(name)])) orders.set(block.id, { id: block.id, tool: toolOf(name), input: block.input ?? {}, failed: false })
      } else if (block?.type === 'tool_result') {
        if (checks.has(block.tool_use_id)) {
          if (!late) checks.get(block.tool_use_id).result = parseResult(block)
        } else if (orders.has(block.tool_use_id)) orders.get(block.tool_use_id).failed = block.is_error === true
      }
    }
  }
  return { checks: [...checks.values()], orders: [...orders.values()] }
}

/** The side a leg or order names: { side: 'BUY' | 'SELL' }, or { unreadable } or { conflict } when side and position_intent do not give one. */
function sideOf(leg) {
  const read = (v) => (v === 'buy' || v === 'sell' ? v.toUpperCase() : null)
  const side = String(leg?.side ?? '').toLowerCase()
  const intent = String(leg?.position_intent ?? '').split('_')[0].toLowerCase()
  const a = side ? read(side) : undefined
  const b = intent ? read(intent) : undefined
  if (a === null || b === null) return { unreadable: true }
  if (a && b && a !== b) return { conflict: true }
  return a ?? b ? { side: a ?? b } : { unreadable: true }
}

/** What an order call asks Allocait to have judged: { wants: [{ symbol, key, side, unit, amount }] } or { stop }. */
function wantsOf(rule, input, name) {
  const sideProblem = (s, where) => (s.conflict ? `The side and the position_intent of ${where} disagree` : `The side of ${where} cannot be read from the call`)
  if (rule.kind === 'order') {
    const symbol = String(input[rule.symbolKey] ?? '').trim()
    const s = sideOf(input)
    if (!symbol || s.unreadable) return unmatched(`${name} names no ${rule.symbolKey} or side`)
    if (s.conflict) return unmatched(sideProblem(s, name))
    if (present(input.qty) && present(input.notional)) return { stop: deny(`${name} carries both qty and notional, so no single check can be matched to it. ${ASK_OWNER}`) }
    const field = present(input.qty) ? 'qty' : present(input.notional) ? 'notional' : null
    if (!field) return unmatched(`${name} carries neither qty nor notional`)
    const amount = num(input[field])
    if (!(amount > 0)) return unmatched(`The ${field} of ${name} is not a positive number`)
    return { wants: [field === 'qty' ? want(symbol, s.side, 'shares', amount * (rule.multiplier ?? 1)) : want(symbol, s.side, 'notional', amount)] }
  }
  if (rule.kind === 'legs') {
    const legs = Array.isArray(input.legs) && input.legs.length ? input.legs : [{ symbol: input.symbol, side: input.side, position_intent: input.position_intent, ratio_qty: 1 }]
    const wants = []
    for (const leg of legs) {
      const symbol = String(leg?.symbol ?? '').trim()
      const amount = num(input.qty) * num(leg?.ratio_qty ?? 1) * (rule.multiplier ?? 100)
      if (!symbol || !(amount > 0)) return unmatched(`An option leg of ${name} has no symbol or a quantity that is not a positive number`)
      const s = sideOf(leg)
      if (!s.side) return unmatched(sideProblem(s, `option leg ${symbol}`))
      wants.push(want(symbol, s.side, 'shares', amount))
    }
    return { wants }
  }
  if (rule.kind === 'close') {
    const symbol = String(input[rule.symbolKey] ?? '').trim()
    if (rule.side !== 'BUY' && rule.side !== 'SELL') return { stop: deny(`The preset rule for ${name} names no side, so no check can be matched to it. ${ASK_OWNER}`) }
    if (!symbol || UUID.test(symbol)) return { stop: deny(`${rule.symbolKey} must be a symbol, not an asset id, so a check can be matched to it. ${rule.message}`) }
    const qty = num(input.qty)
    if (!(qty > 0) || input.percentage !== undefined) return { stop: deny(rule.message) }
    // Alpaca counts an option position in contracts and Allocait counts shares: contracts x 100.
    const multiplier = OCC_TAIL.test(keyOf(symbol)) ? (rule.occMultiplier ?? 1) : 1
    return { wants: [want(symbol, rule.side, 'shares', qty * multiplier)] }
  }
  return { stop: deny(`The preset has no rule kind "${rule.kind}" for ${name}. ${ASK_OWNER}`) }
}

const describe = (x) =>
  `${x.kind === 'class_band' ? `${x.asset_class} band` : `${x.symbol} size`} ${x.before_pct}% -> ${x.after_pct}% (range ${x.min_pct}% to ${x.max_pct}%), ${String(x.change).replace('_', ' ')}`
const label = (w) => `${w.side} ${w.symbol} ${w.amount}${unit(w.unit, w.amount)}`.replace(/\s+/g, ' ')
const sameWant = (a, w) => a.key === w.key && a.side === w.side && a.unit === w.unit && same(a.amount, w.amount)

/**
 * The hook's answer for one tool call: null to let it go on, or { decision: 'deny' | 'ask', reason }.
 * An ask is returned only when hook.permission_mode is default or acceptEdits; in any other mode, or with no mode
 * named, the same question is a deny.
 * hook: the PreToolUse input. transcript: the file's text. options: { preset, refuseOutside, checkTool }.
 */
export function decide(hook, transcript, { preset, refuseOutside = false, checkTool = new RegExp(DEFAULT_CHECK_TOOL) } = {}) {
  const name = toolOf(hook?.tool_name)
  const rule = preset?.tools?.[name]
  const answer = decideRule(hook, transcript, name, rule, { preset, refuseOutside, checkTool })
  if (answer?.decision === 'ask' && !CAN_ASK.has(hook?.permission_mode)) {
    return deny(`${answer.reason} ${NOBODY} the ${rule?.attended ? 'order' : 'call'} is refused. ${ASK_OWNER}`)
  }
  return answer
}

function decideRule(hook, transcript, name, rule, { preset, refuseOutside, checkTool }) {
  const input = hook?.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {}
  if (!rule) return ask(name.startsWith('place_') && preset?.unknownPlace ? `${name}: ${preset.unknownPlace}` : `${name} has no rule in the preset, so no check can be matched to it.`)
  if (rule.kind === 'deny') return deny(rule.message)
  if (rule.kind === 'ask') return ask(rule.message)
  if (rule.kind === 'replace') return (rule.denyKeys ?? []).some((k) => input[k] !== undefined) ? deny(rule.message) : null
  for (const k of rule.needs ?? []) {
    if (!input[k]) return deny(`${name} needs ${k}, for example ${preset.needsExample ?? '<unique id>'}, so a retry cannot place the order twice. ${ASK_OWNER}`)
  }
  const wanted = wantsOf(rule, input, name)
  if (wanted.stop) return wanted.stop
  if (typeof hook.tool_use_id !== 'string' || !hook.tool_use_id) {
    return deny(`The hook input names no tool_use_id, so earlier orders cannot be told from this call. ${ASK_OWNER}`)
  }

  const { checks, orders } = readTranscript(transcript, preset, checkTool, hook.tool_use_id)
  const answered = checks.filter((c) => c.result)
  const earlier = orders
    .filter((o) => o.id !== hook.tool_use_id && !o.failed)
    .flatMap((o) => {
      const w = wantsOf(preset.tools[o.tool], o.input && typeof o.input === 'object' ? o.input : {}, o.tool)
      return w.wants ? [w.wants] : []
    })
  const facts = new Set()
  const stated = new Set()
  const prior = []
  for (const want of wanted.wants) {
    const hits = answered.filter((c) => c.trades.some((t) => sameWant(t, want)))
    if (!hits.length) {
      // The spelling of the symbol is shown as it was checked, so ECHOUSD for an ECHO/USD order is visible.
      const near = [...new Set(answered.flatMap((c) => c.trades.filter((t) => loose(t.key) === loose(want.key)).map((t) => `${t.side}${t.key === want.key ? '' : ` ${t.symbol}`} ${t.amount}${unit(t.unit, t.amount)}`)))]
      return deny(
        `${NO_RESULT} ${label(want)} found in this session's transcript.` +
        (near.length ? ` The checks for ${want.symbol} were for ${near.slice(0, 3).join('; ')}.` : '') +
        ` ${ASK_CHECK}.`
      )
    }
    // Each earlier order, and each earlier identical leg of this call, uses one check.
    const used = earlier.filter((wants) => wants.some((w) => sameWant(w, want))).length + prior.filter((p) => sameWant(p, want)).length
    prior.push(want)
    if (hits.length <= used) {
      return deny(`${USED_RESULT} ${label(want)} was used by your earlier order. ${ASK_CHECK} again.`)
    }
    for (const x of hits.at(-1).result.rules.filter((r) => OUTSIDE.has(r.change))) (refuseOutside ? facts : stated).add(describe(x))
  }
  if (facts.size) return deny(`The latest check_trades for ${wanted.wants.map((w) => w.symbol).join(', ')} states: ${[...facts].join('; ')}. Tell the owner and ask before any further call.`)
  if (rule.attended) {
    // With --refuse-outside a rule outside range already refused above, so what is left to say here is the count.
    const n = stated.size
    const said = `That result names ${n} ${n === 1 ? 'rule' : 'rules'} newly or further outside range${n ? `: ${[...stated].join('; ')}` : ''}.`
    return ask(`This call places ${wanted.wants.map(label).join(', ')}. It matches an unused check_trades result in this session. ${said}`)
  }
  return null
}

function main() {
  const { values } = parseArgs({
    options: { preset: { type: 'string' }, 'refuse-outside': { type: 'boolean' }, 'check-tool': { type: 'string' }, 'reread-ms': { type: 'string' } },
  })
  const rereadMs = Number(values['reread-ms'] ?? REREAD_MS)
  if (!(rereadMs >= 0 && rereadMs <= 10000)) return refuse(`--reread-ms must be a number of milliseconds from 0 to 10000. ${ASK_OWNER}`)
  let hook
  try { hook = JSON.parse(readFileSync(0, 'utf8')) } catch { return refuse(`The hook input on stdin is not JSON. ${ASK_OWNER}`) }
  let preset
  try { preset = JSON.parse(readFileSync(values.preset ?? DEFAULT_PRESET, 'utf8')) } catch (e) { return refuse(`The preset could not be read: ${e.message} ${ASK_OWNER}`) }
  const options = { preset, refuseOutside: values['refuse-outside'] ?? false, checkTool: new RegExp(values['check-tool'] ?? DEFAULT_CHECK_TOOL) }
  let transcript
  const read = () => {
    try { transcript = readFileSync(hook.transcript_path, 'utf8'); return true } catch { return false }
  }
  const unread = `Could not read the session transcript at ${hook.transcript_path}. ${ASK_OWNER}`
  if (!read()) return refuse(unread)
  let answer = decide(hook, transcript, options)
  // A check made in the same turn may not be on disk yet: wait once and read the transcript again.
  if (rereadMs > 0 && (answer?.reason.startsWith(NO_RESULT) || answer?.reason.startsWith(USED_RESULT))) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, rereadMs)
    if (!read()) return refuse(unread)
    answer = decide(hook, transcript, options)
  }
  if (!answer) process.exit(0)
  if (answer.decision === 'ask') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: answer.reason } }) + '\n')
    process.exit(0)
  }
  refuse(answer.reason)
}

function refuse(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

// Any other exit status lets the call go on, so every failure here, a bad flag or regex included, ends in exit 2.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (e) { refuse(`The check hook could not run: ${e.message} ${ASK_OWNER}`) }
}
