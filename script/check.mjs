#!/usr/bin/env node
// Check a proposed order against your own Allocait rules, from any bot in any language.
//
//   node check.mjs order.json           an order file: { "trades": [...], "portfolio_id"?, "scenario_id"?, "prices"? }
//   echo '{...}' | node check.mjs -     the order on stdin
//   node check.mjs order.json --json    the raw result
//   node check.mjs --demo               the saved example result (result.example.json): no account, no key, no network
//
// Exits 0, 1, 2 or 3; lib/allocait.mjs (exitCode) says what each means.
import { parseArgs } from 'node:util'
import { check, cli, demoResult, DEMO_HEADER, exitCode, formatResult, readOrder } from './lib/allocait.mjs'

cli(async () => {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'boolean' }, demo: { type: 'boolean' } } })
  const result = values.demo ? await demoResult() : await check(await readOrder(positionals[0]))
  if (values.demo && !values.json) console.log(DEMO_HEADER)
  console.log(values.json ? JSON.stringify(result, null, 2) : formatResult(result))
  return exitCode(result)
})
