# The script bot

Reference for [Rules for AI Trading Agents](../README.md). A second path, for people with REST keys and no connector. The `script/` folder holds a script bot in JavaScript and Python (`script/python/`). It needs no install: Node 22.9 or later, or the Python standard library.

From the repo root, `node script/check.mjs --demo` prints a saved result with no account, no key and no network. The rest of this page runs from inside `script/` (`cd script`). `check.mjs` reads an order from a file or stdin and exits:

| Exit | Meaning |
| --- | --- |
| 0 | No rule newly or further outside, enough cash, and a rule of yours judges every traded symbol |
| 1 | One or more rules newly or further outside, or not enough cash |
| 2 | No result: the request was refused or failed, so nothing was checked |
| 3 | No rule of yours judges a traded symbol (it is in `not_covered`), or the scenario judged none |

To run it for real, create a key on the API keys tab of Allocait Settings (Read only checks, Read and change also records), copy `example.env` to `.env`, fill in the key and a portfolio's id, and run `node --env-file=.env check.mjs order.example.json`. The example order uses made-up symbols, so give them a portfolio of their own.

`bot.mjs` checks, asks, places in an Alpaca paper account if you set `BROKER=alpaca`, and records the fill. It exits 4 when an order was not placed or not fully recorded. `PRICE_SOURCE` picks where its prices come from (a file, Coinbase or Alpaca, in `lib/prices.mjs`). Live orders need `ALPACA_BASE_URL`, `ALLOW_LIVE_TRADING=1` and your typed `live`. `lib/allocait.mjs` has `check(order)` for your own bot, `tool.json` is a function definition for any tool-calling model, and `strategy.mjs` is where your logic goes.

## Reading a result

These fields come back from a check, in the script and in Claude's report:

- `newly_or_further_outside_count`: rules this order puts outside range, or leaves further outside
- `rules`: each rule outside range before or after, with its range, the percent before and after, and `change`
- `rules_judged_count` and `not_covered`: how much of the order your rules judge (`traded: true` marks this order's symbols)
- `cash.sufficient`: recorded cash covers it
- `within_rules`: no rule that was judged is outside its range after the order, at least one rule was judged, and cash stays at 0 or more. Check `not_covered` for what no rule judges.
