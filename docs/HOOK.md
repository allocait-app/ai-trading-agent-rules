# The order hook (Claude Code)

The hook is a script on your machine. It refuses a tool call that has no matching check in the session. It does not promise to stop an order, and the limits are listed below. This page is reference for [Rules for AI Trading Agents](../README.md).

`hooks/require-check.mjs` is a Claude Code `PreToolUse` hook. The plugin turns it on for Alpaca's order tools. Before one runs, the hook reads the session's transcript and refuses the call unless an Allocait `check_trades` call for that exact order returned a result earlier in the session: same symbol, same side, same quantity or dollars. Each check covers one order, so a second identical order needs a new check. In the default and acceptEdits permission modes, the hook then asks you before a matched order runs. In any other mode it refuses the order instead of asking. Each Alpaca order tool has a rule in `hooks/presets/alpaca.json`:

| Alpaca tool | The hook |
| --- | --- |
| `place_stock_order`, `place_crypto_order`, `place_option_order` | Needs a `client_order_id`, one finite quantity or dollar amount, and a matching unused check, then asks you. Option contracts count as 100 shares each, and every leg needs its own check. |
| `close_position` | A sale: needs a numeric `qty` that was checked as a SELL, then asks you. A percentage, an asset id or no `qty` is refused. A contract count on an option symbol is multiplied by 100. Closing a short buys to cover, and the hook cannot tell: it reads every close as a SELL, and the skill tells Claude not to call `close_position` for a short or an option. |
| `close_all_positions` | Always refused. |
| `replace_order_by_id` | Refused when it changes `qty` or `notional`. A price change goes on. |
| `exercise_options_position`, `do_not_exercise_options_position`, `update_account_config` | Asks you. Refused when the mode cannot ask. |
| Any other `place_` tool | Asks you. |

Every refusal ends by sending Claude to you. None tells it to place anything. The question the hook puts to you names the order and states how many rules the check put newly or further outside range.

## Try it without placing anything

To check that the hook is loaded, ask Claude: `Call place_stock_order to buy 1 share of ALFA with client_order_id test-1.` ALFA is not tradable on Alpaca (read 2026-11-14), so Alpaca would reject it anyway. With the hook loaded, Claude reads `No check_trades result for BUY ALFA 1 share found in this session's transcript.` To run the script alone, from a clone (it waits two seconds, then exits 2):

```bash
echo '{"tool_use_id":"t1","tool_name":"mcp__alpaca__place_stock_order","tool_input":{"symbol":"ALFA","side":"buy","qty":"5","client_order_id":"test-1"},"transcript_path":"/dev/null","permission_mode":"default"}' | node hooks/require-check.mjs; echo "exit $?"
```

## Without the plugin

Copy `hooks/require-check.mjs` and `hooks/presets/` to `.claude/hooks/` in your project and merge `hooks/settings.example.json` into `.claude/settings.json`. Its `"onFailure": "block"` makes a script Claude Code cannot start, such as `node` missing from `PATH`, refuse the call too. The hook has run under Node 26.8 only; `package.json` asks for Node 22.9 or later.

## Options

Added to the `command` line:

| Option | What it does |
| --- | --- |
| `--refuse-outside` | Also refuse when the newest matching result names a rule newly or further outside. Off by default: Allocait states facts and you decide. |
| `--preset <file>` | The rules for each order tool. A broker whose order tools take the same shapes (a symbol, a side, and a quantity or dollars) is a copy of `hooks/presets/alpaca.json`. A different shape needs a new rule kind in the script. |
| `--reread-ms <n>` | How long the hook waits before it reads the transcript a second time, in milliseconds. Default 2000. 0 skips the second read. |
| `--check-tool <regex>` | The check tool's name. Default: `check_trades` under any server name. |

## What it cannot do

- It refuses a call that has no matching check, which covers an unprompted skip. It does not hold against an agent set on evading it: the agent can edit your settings or remove the plugin.
- Its question needs a person at the prompt. A `claude -p` run, an Agent SDK permission callback or an installed mod can answer it without you.
- It sees Claude Code tool calls only. The Alpaca dashboard, its command line, a REST call, claude.ai chat and another client with the same account all bypass it. In chat the skill tells Claude to run the check, and nothing refuses a skipped one.
- It matches the request: symbol, side and quantity or dollars. It does not compare the portfolio, the prices Claude sent, the order type or a limit price. A check from any tool named `check_trades` counts. It reads the symbol as written, so a check for `ECHOUSD` does not match an order for `ECHO/USD`.
- It does not see the exit legs of a bracket, OCO or OTO order, only the parent. `cancel_order_by_id`, `cancel_all_orders` and the watchlist tools have no rule, and a cancel can remove a stop order you set.
- It reads the session transcript at `transcript_path`. Claude Code documents the path and that the file is written asynchronously, but not its line format, so a Claude Code update can change what the hook sees. The hook waits two seconds and reads again, and refuses when it cannot read. It has not been tested inside a subagent, after compaction or with parallel tool calls.
- It does not know paper from live. The skill takes the connector's name, Paper Trading, as the evidence that an account is paper. A self-hosted server with live keys places live orders: use paper keys.
- It matches Alpaca's order tools by name. A new write tool that has no rule is not matched until it gets one, and the self-hosted server's locate tools have none.
