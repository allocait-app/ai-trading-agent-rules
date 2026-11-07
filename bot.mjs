#!/usr/bin/env node
// The whole loop once, with a person in it: check, show the facts, ask, place (optional), record.
//
//   node bot.mjs order.json                 records the change in Allocait after a yes
//   BROKER=alpaca node bot.mjs order.json   places it in your Alpaca paper account first
//
// With no one at the keyboard it places and records nothing. Exits as check.mjs does, or 4 when something
// placed was not recorded.
import { createInterface } from 'node:readline/promises'
import { cli, readOrder } from './lib/allocait.mjs'
import { run } from './lib/loop.mjs'

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try { return (await rl.question(question)).trim().toLowerCase() === 'y' } finally { rl.close() }
}

cli(async () => {
  const broker = process.env.BROKER || 'none'
  if (broker !== 'none' && broker !== 'alpaca') throw new Error(`Unknown BROKER "${broker}". Use none or alpaca, or write your own adapter.`)
  const place = broker === 'alpaca' ? (await import('./lib/alpaca.mjs')).placeOrder : null
  return run(await readOrder(process.argv[2]), { confirm: process.stdin.isTTY ? ask : null, place })
})
