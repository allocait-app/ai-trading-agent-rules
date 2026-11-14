"""Check an order file against your own Allocait rules. Standard library only.

    python3 python/check.py order.example.json
    python3 python/check.py --demo        the saved example result (result.example.json): no account, no key, no network

Exits 0, 1, 2 or 3 as check.mjs does (see the README). Prices come from PRICE_SOURCE=file:<path>, or from the
order file's "prices" key, as in check.mjs.
"""
import sys

from allocait import DEMO_HEADER, Allocait, demo_result, exit_code, format_result, prices_from_env, read_order, run_cli


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if "--demo" in args:
        result = demo_result()
        print(DEMO_HEADER)
    else:
        order = read_order(args[0] if args else None)
        result = Allocait(portfolio_id=order.get("portfolio_id")).check(
            order["trades"], order.get("prices") or prices_from_env(), order.get("scenario_id")
        )
    print(format_result(result))
    return exit_code(result)


if __name__ == "__main__":
    run_cli(main)
