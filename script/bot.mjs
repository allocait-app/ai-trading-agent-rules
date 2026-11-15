#!/usr/bin/env node
// The whole loop once, with a person in it: check, show the facts, ask, place (optional), record.
//
//   node bot.mjs order.json                 records the change in Allocait after a yes
//   node bot.mjs                            the same, for the order strategy.mjs proposes
//   BROKER=alpaca node bot.mjs order.json   places it in your Alpaca paper account first
//
// With no one at the keyboard it places and records nothing. Exit status: see ../docs/SCRIPT.md.
import { createInterface } from 'node:readline/promises'
import { cli, readOrder } from './lib/allocait.mjs'
import { run } from './lib/loop.mjs'
import { propose } from './strategy.mjs'

async function ask(question, word = 'y') {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try { return (await rl.question(question)).trim().toLowerCase() === word } finally { rl.close() }
}

cli(async () => {
  const broker = process.env.BROKER || 'none'
  if (broker !== 'none' && broker !== 'alpaca') throw new Error(`Unknown BROKER "${broker}". Use none or alpaca, or write your own adapter.`)
  const alpaca = broker === 'alpaca' ? await import('./lib/alpaca.mjs') : null
  const venue = alpaca?.venue() // refuses an unlisted URL before anything is checked
  return run(process.argv[2] ? await readOrder(process.argv[2]) : await propose(), { confirm: process.stdin.isTTY ? ask : null, place: alpaca?.placeOrder ?? null, venue })
})
