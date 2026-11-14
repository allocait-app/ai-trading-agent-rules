# Alpaca notes

Reference for [Rules for AI Trading Agents](../README.md): how to run Alpaca's own server instead of its connector, how to run a read-only report on a schedule, the Alpaca facts the skill uses, and what the skill leaves out. Alpaca's data, account and orders follow your agreement with Alpaca.

## Alpaca's own server instead of the connector

Claude Code shows the connectors of the claude.ai account you are logged in with. Without that login, run Alpaca's own server with paper keys instead. It needs `uv` and Python 3.10 or later, paper is its default, and its order tools have the same names:

```bash
claude mcp add alpaca --scope user --transport stdio uvx alpaca-mcp-server --env ALPACA_API_KEY=... --env ALPACA_SECRET_KEY=...
```

## A read-only report on a schedule

Prompt 3 in the README only reads. For a schedule, use an Allocait connection set to Read only (or a Read only key) and the Alpaca connector for the account you want read, in a session that can use both. The skill may read with the Alpaca Live connector. What that connector can do beyond reads is UNVERIFIED here, so the prompt below tells Claude to place and write nothing, and a Read only Allocait connection cannot write. Try it once by hand first, and send: `Use the ai-trading-agent-rules skill to report where my Alpaca account stands against my Allocait rules. Report counts first. Say what changed since your last report if you can see it, otherwise state the whole picture. Place nothing and write nothing.`

## The mirror in detail

The mirror (prompt 1 in the README) records holdings and cash. A long option is recorded at its premium, as contracts times 100 shares. A short stock position is recorded as a negative share count, which needs Allow shorts on the portfolio, so Claude asks you before it turns that on. After the ranges are written, Claude offers to make that scenario the portfolio's active one, by its name, and does so only after your yes. Without an active scenario a check judges nothing.

## Saying your ranges

A rule in Allocait belongs to an asset class, not to a symbol. A range for a class is its band, and a range for one holding in it is a size range. Say them in your own words, for example: `Equities between 41 and 73 percent of the account, each holding in it 3 to 9 percent. Crypto 0 to 5 percent.` Those numbers only show the format. Write your own: Claude asks for every number and writes none of its own.

## Alpaca facts this uses (read 2026-11-14)

- Paper fills are simulated, and about one in ten eligible orders fills in part. An order acknowledgment is not a fill, so read the order back.
- A paper-only account gets IEX market data, and quotes are unusable outside market hours, so the skill uses the last trade. A symbol that is no longer active can still return an old last trade, so the skill reads its time.
- A crypto pair is `BASE/USD` in orders and may be listed without the slash in positions. Allocait stores a pair without the slash as a different symbol, so the skill writes the slash every time. The Paper connector's tool list includes `place_crypto_order`; Alpaca's launch post names stocks, ETFs and options.
- Option quantities are contracts. Allocait counts shares, so 2 contracts are 200 shares.
- An option position is listed with `asset_class` `us_option` and its OCC symbol. Alpaca's docs show its `current_price` per share and its `market_value` including the 100 multiplier (read 2026-11-14 in the options overview). No option was held on the account used to write this, so that shape is UNVERIFIED on a live position. The skill checks each market value against quantity times price and leaves out a position that does not match.
- A short stock position has `side` `short`. Alpaca's docs do not say whether its `qty` or `market_value` is negative, and no short was held on the account used to write this. `book.mjs` takes the direction from `side` and recomputes the value itself. It also compares Alpaca's `equity` with `cash` plus the positions and reports a gap instead of hiding it. Whether short sale proceeds sit inside Alpaca's `cash` is UNVERIFIED here, so the skill calls `CASH` Alpaca's cash figure and reports a gap as unreconciled.
- An option's last trade through the market data tools is read as `p` and `t`, like a stock's. A call for two option contracts on 2026-11-14 returned an empty `trades` object, so that shape is UNVERIFIED, and the skill asks for the premium when a trade is missing or old. A position's `current_price` for an option has the same unverified source.
- Allocait keeps a share count to 6 decimals, half away from zero, so `book.mjs` sends that count. Alpaca may list more decimals for a pair (UNVERIFIED here).

## What the skill leaves out

The skill names what it leaves out in the mirror's table before you say yes, and states the gap again afterward. One case stops a mirror with a plain message: negative cash on margin (Allocait's cash cannot go below zero). Five kinds are named in `stop` and left out, and the mirror goes on after the owner's yes: a pair not quoted in USD (Allocait is USD only), a written option (Allocait holds options long only), an option past its expiry (Allocait counts it 0), a short pair, and a symbol listed twice (two spellings of one pair). So are a position that cannot be read and a long position worth 0 when there is no cash to record it against. A position of 0 is nothing held and is not listed. Positions in a shape `book.mjs` does not read stop the run, and are never read as an empty account. The skill states the gap in Allocait's total each time. The deposit is Alpaca's cash plus the rows at their prices, rounded up to the cent, so recorded cash ends at Alpaca's cash or at most a cent above it. It places no option order and no order that opens, extends or covers a short.

## Sources

[Alpaca's launch post for the Claude connectors](https://alpaca.markets/blog/alpaca-launches-claude-connectors-for-trading-api/), and its docs on [paper trading](https://docs.alpaca.markets/us/docs/paper-trading), [market data](https://docs.alpaca.markets/us/docs/about-market-data-api), [crypto](https://docs.alpaca.markets/us/docs/crypto-trading-1), [options](https://docs.alpaca.markets/us/docs/options-trading), [the options overview](https://docs.alpaca.markets/us/docs/options-trading-overview) and [margin and short selling](https://docs.alpaca.markets/us/docs/margin-and-short-selling).
