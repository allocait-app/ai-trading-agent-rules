# Allocait trading agent example

Your bot proposes an order. Before it places it, one call asks Allocait which of your own written rules the order would put outside range, or leave further outside. Then your bot, or you, decides. No dependencies: Node 22.9 or Python 3.9.

Allocait checks your holdings against rules you wrote. It does not give investment advice or recommend trades.

It is not a broker and not a trading bot. It places no order, connects to no brokerage, picks nothing and supplies no prices: your bot brings its own, from whatever source you trust.

```
 strategy, model or you ──> your bot ──> Allocait check ──> you or your bot decide ──> your broker
                                          your rules,                                      │
                                          your prices         record the fill in Allocait <┘
```

Nothing here cares how the order was made: a rule-based script, an agent on Grok, OpenAI or Claude, or a signal you typed. Each produces a list of trades, and the check reads the same list, for stocks and crypto pairs alike. Allocait holds your rules (an allocation band per asset class, a size range per holding) and the holdings you record. Everything else in your stack stays yours.

## Try it

The example order and prices use made-up symbols (ALFA, ECHO/USD), so give them a portfolio of their own:

1. In the Allocait app, create a portfolio, deposit some cash, make a scenario active and write a band for Equities and one for Crypto. Under Settings > Agents, create a key: Read only checks, Read and change also records.
2. `cp example.env .env` and fill in the key and the portfolio's id. Leave the id blank and the first check lists your portfolios.
3. Run it:

```bash
node --env-file=.env check.mjs order.example.json
```

```
Rules judged: 3. Newly or further outside: 1.
  Crypto band: 0% -> 9.13% (your range 0% to 7%), newly outside
```

That is one made-up book; yours states your own rules. To check a real portfolio, use your own symbols and set `PRICE_SOURCE` (below). The check prices the traded symbols first; if Allocait names held symbols that still need a price, it prices those and asks once more.

## Plug it in

**From any language, by exit status.** `check.mjs` reads an order from a file or stdin (`-`) and exits:

| Exit | Meaning |
| --- | --- |
| 0 | No rule newly or further outside, enough cash, and a rule of yours judges every traded symbol |
| 1 | One or more rules newly or further outside, or not enough cash |
| 2 | No result: the request was refused or failed, so nothing was checked |
| 3 | No rule of yours judges a traded symbol (it is in `not_covered`), or the scenario judged none |

```bash
echo '{"trades":[{"symbol":"ALFA","side":"BUY","shares":7}]}' | node --env-file=.env check.mjs -
```

What each status means for an order is up to your code.

**As a library.** In JavaScript, `check(order)` from `lib/allocait.mjs`. In Python, copy `python/allocait.py` next to your bot:

```python
from allocait import Allocait
api = Allocait()                                   # ALLOCAIT_API_KEY, ALLOCAIT_PORTFOLIO_ID
result = api.check(trades, my_prices)              # my_prices(symbols) -> {SYMBOL: price}, your own source
```

**As a tool your model calls.** `tool.json` is a function definition. The model sends only the trades; your code adds the prices and the key, so the model never supplies a price or sees the key. With an OpenAI-compatible client (OpenAI, or xAI at `https://api.x.ai/v1`):

```python
tools = [{"type": "function", "function": json.load(open("tool.json"))}]
# Anthropic: {"name": ..., "description": ..., "input_schema": tool["parameters"]}

def on_check_trades(args):                         # when the model calls the tool
    return json.dumps(api.check(args["trades"], my_prices))
```

Send that string back as the tool result. The schema is not written for strict mode, so leave that off.

**Over MCP.** `https://api.allocait.app/functions/v1/mcp` with the key in an `x-api-key` header, for clients that can send one, such as Claude Code (`claude mcp add --transport http allocait <url> --header "x-api-key: ..."`). A client that sends only a bearer token, like Anthropic's Messages API connector, uses the tool above instead.

## The loop with a person in it

`bot.mjs` checks, shows the facts, asks, places (optional) and records the new holding with `POST /positions/{symbol}`, so the next check starts from it. It needs a Read and change key. With no one at the keyboard it places and records nothing and prints what it would place. A yes on the example order records ALFA and ECHO/USD, so use the try-it portfolio.

```bash
node --env-file=.env bot.mjs order.example.json                  # record only
BROKER=alpaca node --env-file=.env bot.mjs order.example.json    # place in an Alpaca paper account first
```

A broker is one function, `place(row) => { id, status, filledQty, filledPrice }`. The bot records what filled, at the fill price, and nothing for an order not yet filled. `lib/alpaca.mjs` is one adapter, an example of the shape and not a pick; write yours for any broker or exchange. `ALPACA_LIVE=1` switches it to live on purpose.

## Prices

`PRICE_SOURCE` is `file:<path>` (a JSON map you keep), `coinbase` (Coinbase Exchange's public ticker, pairs, no key) or `alpaca` (Alpaca market data, stocks and pairs, with `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY`). A comma list tries each in turn for what the earlier ones left out: `coinbase,file:prices.json`. A source is one function, `(symbols) => ({ SYMBOL: price })`, in `lib/prices.mjs`. Allocait uses a price for that one call and stores none. The provider endpoints were read from their documentation in November 2026.

Write every pair as `BASE/USD`, the same way each time: another spelling is stored as a different symbol. The first trade in a symbol you do not hold carries `"asset_class"` (`"Crypto"`, `"Equities"` or a class you made). Quantities may be fractional, to six decimal places, or send `notional` in dollars.

## Reading a result

- `newly_or_further_outside_count`: rules this order puts outside range, or leaves further outside
- `rules`: each rule outside range before or after, with its range, the percent before and after, and `change`
- `rules_judged_count` and `not_covered`: how much of the order your rules judge (`traded: true` marks this order's symbols)
- `cash.sufficient` and `within_rules`: recorded cash covers it; the whole book is inside every rule afterward

A result inside every range does not say a change is advisable. Allocait cannot approve, stop or place an order. The check is arithmetic on your rules, the holdings you recorded and the prices you sent, and it runs only when your bot calls it.

## Keeping Allocait in step with your broker

Allocait holds only what you record. To start, send your holdings once with `POST /portfolios/{id}/positions/apply` and your cash with `POST /portfolios/{id}/cash-movements` (both through `client().request`). Then record every fill, as `bot.mjs` does, and anything else that changes the account. This records the change in Allocait only. It moves no money and places no order.

## Files

```
check.mjs            check an order, exit with a status
bot.mjs              check, ask, place (optional), record
lib/allocait.mjs     client, check, exitCode, formatResult
lib/loop.mjs         the loop bot.mjs runs
lib/prices.mjs       price sources: file, Coinbase, Alpaca, and a chain of them
lib/alpaca.mjs       one broker adapter (Alpaca paper)
python/allocait.py   the client for Python
tool.json            a function definition for any tool-calling model
test/                npm test, no network
```

API reference: https://allocait.app/docs/api/

## License

MIT
