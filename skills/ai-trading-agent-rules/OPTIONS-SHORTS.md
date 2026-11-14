# Options and shorts

Read this when `book.mjs rows` has `allow_shorts_needed` true or a row in Options, when `percents` has a negative allocation or an option symbol, or when `diff` names an option or a short. SKILL.md still governs every step. This file adds to it.

## What the numbers mean

- An option row has `shares` equal to contracts x 100, `price` equal to the per-share premium, `mark` equal to the same premium, and `asset_class` Options. Allocait counts an option at its stored premium (its mark). A price sent to check_trades replaces the mark for that call only and stores nothing.
- A short is a negative `shares`. It needs Allow shorts on the portfolio. Allocait holds options long only, so it records no written option.
- `book.mjs` checks each position's market value against quantity x multiplier x price, and the account's `equity` against `cash` plus the rows. It lists a mismatch in `stop` and does not fold it into CASH. CASH is Alpaca's cash figure; it reconciles with `equity` or `book.mjs` reports it as unreconciled.
- An option's `current_price` is Alpaca's per-share figure for the position. Its source (UNVERIFIED here) may be an old last trade that sits outside the quoted spread. Name its source and time (rule 2). The owner can type their own premium.

## Mirror

1. Table (step 3): an option shows its contracts as well as its shares, and a short shows a negative count.
2. If `allow_shorts_needed` is true, ask a second question after the table, and wait for its own answer: "Turn on Allow shorts for this portfolio so the short positions can be recorded? Yes or no." A yes to the table is not a yes to this. If the answer is no, write nothing and say the shorts cannot be recorded while Allow shorts is off.
3. Step 4, a new portfolio: call save_portfolio with `initial_cash` 0 and `allow_shorts` true. If the result has `allow_shorts` not true or carries `allow_shorts_error`, say so and write no holdings: the portfolio is empty, and the existing-portfolio path below takes it. Then call record_cash_movement as in step 4 (only when `deposit` is above 0), then replace_positions.
4. Step 4 or 5, an existing portfolio: read `allow_shorts` on it in list_portfolios (the key is not in the tool's declared output, so ask the owner if it is missing). If it is not true, call save_portfolio with `portfolio_id` and `allow_shorts` true.
5. Tell the owner afterward that Allow shorts is on and stays on.
6. Step 5, what Allocait holds and Alpaca does not: a row in `expired_allocait` goes in as it is (shares 0, price 0; Allocait counts an expired option 0 and books no cash). For an option in `only_allocait`, the closing `price` is `p` under `data.trades.<symbol>` from get_option_latest_trade (`symbols` is the OCC symbol); name its `t`. If `trades` has no entry for the option, or `t` is not from the last session, ask the owner for the closing premium and write nothing until they give one (the shape of an option's `p` and `t` is UNVERIFIED here: a call for two option contracts, read 2026-11-14, returned an empty `trades` object). An option missing from Alpaca may have been closed, exercised or assigned, so say Allocait books the close at the last trade shown, and that the owner can type their own price. A short in `only_allocait` closes at Alpaca's last trade through get_stock_latest_trade, and in Allocait's ledger that is a purchase: say so in the table.

## Check an order

- A short is judged by its absolute size against the class's short size range. If `not_covered` names a short with `NO_SIZE_RANGE`, say so. The tools give no signed percent for a short, so state none.
- An option is a holding in Options at the premium sent. Read its rule rows like any other.
- An option Allocait records that Alpaca no longer lists needs no price, and one past its expiry counts 0.

## Where the account stands

- check_allocations judges a negative entry as a short, by absolute size, against the class's short size range, and counts a class as the net of its shorts, not below 0.
- A short in a class with no short size range is not judged, and check_allocations does not list it. Name the shorts you sent and say which classes have no short size range (get_rules, `short_position_size`).
- State Alpaca's `equity` and `unreconciled_pct` from `percents`, and make no call about them. `percents` reads Alpaca's numbers only: the total Allocait holds now is not in it.

## Not covered

This skill reads and mirrors long options and short stock. It places no option order and no order that opens, extends or covers a short. It does not call close_position for an option or a short, and it exercises nothing. It records no written option, because Allocait holds options long only. Negative cash on margin stops the mirror, because Allocait's cash cannot go below zero: `book.mjs` returns `ok` false and no rows. It leaves out a pair not quoted in USD (Allocait is USD only), a short pair, a written option, an option past its expiry, and a symbol listed twice, and names each in `stop`. Say what it leaves out, and how much of the account that is: `equity_gap` from `rows`, or `skipped_pct` from `percents`.
