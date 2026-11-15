# AGENTS.md

Instructions for a coding agent (Claude Code, Codex, Cursor or any other) working in a clone of this repo. People: start with README.md.

## What this is

A small example that asks Allocait one question before an order is placed: which of the owner's own written rules would this order put outside range, or leave further outside. It has two paths. The Claude path is a skill and an order hook for Alpaca's Paper Trading connector. The script path is a bot with REST keys, in Node and Python. Allocait checks and states facts. It is not a broker, places no order, supplies no prices and gives no advice.

## Layout

See "What is in this repo" in `docs/HOW-IT-WORKS.md`. README.md is the first screen and the path to a first result; reference lives in `docs/SETUP.md` (setup details), `docs/HOW-IT-WORKS.md` (the picture, what it writes, questions), `docs/HOOK.md` (the hook), `docs/ALPACA.md` (Alpaca facts) and `docs/SCRIPT.md` (the script bot). The script path is the `script/` folder, the Claude-path tests and the zip builder are in `dev/`, and the brand files are in `images/brand/`. The notice at the top of README.md is one wording, pinned by a test. The plugin id, the skill id, the skill folder and the zip carry no other company's name (the broker adapters, `script/lib/alpaca.mjs` and the preset, and `docs/ALPACA.md` name their broker because they are about it). `skills/ai-trading-agent-rules/SKILL.md` is the source of the Claude path: change it there, then run `npm run skill:zip` (it runs `dev/zip-skill.mjs`). `hooks/presets/alpaca.json` holds one rule per Alpaca order tool. `script/strategy.mjs` is where the owner's logic goes (`script/python/strategy.py` in Python): `propose()` returns `{ trades: [...] }`, and the shipped version only reads an order file. `script/tool.json` takes trades only; the code adds prices and the key.

## Commands

- `npm test`: Node tests. `npm run test:py`: Python tests. Both run offline in seconds and need no install. `npm test` includes the zip check: the committed `ai-trading-agent-rules.zip` must be what `dev/zip-skill.mjs` builds from `skills/ai-trading-agent-rules/`.
- `node script/check.mjs --demo`: prints the saved `script/result.example.json` with no key or network. It formats a saved result and computes nothing; never add a local verdict, a second copy of the check, to it or anywhere else. `skills/ai-trading-agent-rules/book.mjs` computes percents and totals from Alpaca's numbers; it states no verdict either. It converts an option to contracts x 100 and a short to a negative count, and it checks every position, and the account when it holds an option or a short, against Alpaca's own totals.
- `hooks/require-check.mjs`: the order hook. Its messages state facts only; it refuses with exit 2, and any fault inside it must also exit 2. A fault before it runs (a wrong path, a timeout) is refused only through `"onFailure": "block"` in `hooks/hooks.json` and `hooks/settings.example.json`; keep it in both.
- `cd script && node --env-file=.env check.mjs order.example.json`: a real check. Needs a key; do not run it unless the owner gave you one.
- `claude plugin validate .`: passes with one warning, that `CLAUDE.md` at the plugin root is not loaded as project context (the plugin is the whole folder, because the marketplace entry's source is `./`). `icon` in `.claude-plugin/plugin.json` is read for Anthropic's directory listing only; Claude Code ignores it.
- No build, no lint, no dependencies. Keep it that way: Node 22.9 `.mjs` and the Python standard library only.

## Rules that do not bend

1. **Check before every order.** No code path places or records an order without calling the check first.
2. **Prices come from the owner's own source** (`script/lib/prices.mjs`, set by `PRICE_SOURCE` in both languages, or Alpaca's own tools in the skill). Never invent a price, take one from memory or from a model, or add a default price. A missing price is an error.
3. **Record the fill afterward**, at the quantity and price that filled. An order still open is flagged (exit 4), never guessed at. Sales go before buys. `run` ignores an order file's `prices`.
4. **Never place a live order without an explicit human yes.** Paper and dry run are the defaults. Do not add a flag, environment variable or schedule that places unattended. Do not weaken the live-URL refusal or the paper/live host list in `script/lib/alpaca.mjs`, or the `live` word and client order id in `script/lib/loop.mjs`. The skill places only after a yes in the chat, and a run with no one present writes nothing. The hook asks the owner before a matched order in the default and acceptEdits modes and refuses it in every other mode instead of asking: keep `attended: true` on every order, legs and close rule.
5. **Send the key nowhere but Allocait and the broker.** Every request that carries a key sets `redirect: 'error'` (Python: no redirect handler). **No secrets in code, tests, logs or commits.** Keys come from the environment. `.env` stays out of git. Do not print a key or a request header. Tests use fake values.
6. **Fictional symbols only** in examples, tests and docs: ALFA BRAV CHAR DELT ECHO FOXT GOLF HOTL, `ECHO/USD` for a pair, `$CASH`, an option as an OCC symbol built on one of them (for example `ALFA261218C00050000`), with made-up odd numbers. No real ticker. Text a reader might run against Alpaca uses a placeholder such as `<symbol>`. ALFA appears there only as a format placeholder or in the hook proof, where the README says it is not tradable on Alpaca.
7. **Do not write trading advice.** The shipped strategy must not propose a trade, and no text here says a trade is good, safe or recommended. A passing check is not an approval. Do not retype the sentences in README.md that say what Allocait is not; leave them as they are, and keep them out of SKILL.md and the hook's messages.
8. **Do not add** self-hosted runners, secrets or a `pull_request_target` trigger to `.github/workflows/`. Actions stay pinned to a commit SHA.
9. **The hook never fails open.** Do not give an order tool a rule that lets it through with no matching check, do not add a pass list, and keep every fault path at exit 2. A refusal ends by sending the agent to the owner (`Ask the owner...`, in a fault message too) and never tells it to write. A quantity the hook cannot read as one finite positive number, or a call that carries both `qty` and `notional`, is refused, never matched loosely. Symbols are compared as written: `ECHO/USD` and `ECHOUSD` are two. When Alpaca adds a write tool, add its rule to `hooks/presets/alpaca.json`, or an inert reason, and its name to `dev/fixtures/alpaca-tools.json` in the same change.

## Where to plug in

- A new bot: edit `propose()` in `script/strategy.mjs` or `script/python/strategy.py`. Keep it free of keys; `script/bot.mjs` calls Allocait.
- An existing bot: leave it alone and call the check before each order, by exit status, by `check(order)` or `Allocait.check`, or as `script/tool.json` (`docs/SCRIPT.md`).
- A broker for the script path: one function, `place(row) => { id, status, filledQty, filledPrice }`, passed to `run` in `script/lib/loop.mjs`. Follow `script/lib/alpaca.mjs`, including its timeouts and its refusal of unlisted URLs.
- A broker for the hook: a preset file like `hooks/presets/alpaca.json`, passed with `--preset`. No code change.
- A price source: one function, `(symbols) => ({ SYMBOL: price })`, registered in `script/lib/prices.mjs`. Leave out what you cannot price; do not guess.

## Changing code

Add or change a test with the code. Keep README.md short and plain: no em dashes, US English, no marketing words. Run both test commands before you say it works.
