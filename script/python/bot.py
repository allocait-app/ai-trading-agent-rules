"""The loop once, with a person in it: check, show the facts, ask, record. Standard library only.

    ORDER_FILE=order.example.json python3 python/bot.py

Prices come from PRICE_SOURCE=file:<path> (default prices.example.json); an order file's "prices" key is ignored.
Records the change in Allocait only (no broker): place the order with your own code between the check and the record.
With no one at the keyboard it places and records nothing. Exits 0, 1 or 3 as check.mjs does, 2 for no result,
and 4 when a record failed after the check succeeded.
"""
import sys

from allocait import Allocait, exit_code, format_result, normalize_trades, prices_from_env, run_cli
from strategy import propose


def main():
    order = propose()
    api = Allocait()
    trades = normalize_trades(order["trades"])
    if len({t["symbol"] for t in trades}) != len(trades):
        raise ValueError("One trade per symbol, so each fill records against its own row.")
    result = api.check(trades, prices_from_env())
    print(format_result(result))
    code = exit_code(result)

    if not sys.stdin.isatty():
        print("No one present: nothing placed, nothing recorded. It would place:")
        for t in result["trades"]:
            print(f"  {t['side']} {t['shares']} {t['symbol']} at {t['price']}")
        return code
    if input("Record this change in Allocait (no broker)? [y/N] ").strip().lower() != "y":
        return code

    # Sales first, so the cash they free is there when a buy is recorded on its own (sorted is stable).
    for row in sorted(result["trades"], key=lambda r: r["side"] != "SELL"):
        shares = row["shares_before"] + (1 if row["side"] == "BUY" else -1) * row["shares"]
        try:
            api.record_position(row["symbol"], shares, row["price"], trades[row["index"]].get("asset_class"))
            print(f"Recorded {row['symbol']}: {shares} at {row['price']}")
        except Exception as e:
            code = 4
            print(f"{row['symbol']}: not recorded in Allocait: {e}", file=sys.stderr)
    return code


if __name__ == "__main__":
    run_cli(main)  # an error here means nothing was checked
