"""YOUR STRATEGY GOES HERE. bot.py calls propose() and checks what it returns before anything is recorded.

Return an order: {"trades": [{"symbol": ..., "side": "BUY" or "SELL", "shares": ... or "notional": ..., "asset_class": ...}]}
Build it from your own logic: a model's answer, a rebalancer, a signal, a queue. Nothing about how the order was
made matters to the check, and this file never suggests a trade: the shipped version only reads one you wrote.
"""
import os

from allocait import read_order


def propose():
    path = os.environ.get("ORDER_FILE")
    if not path:
        raise ValueError("No strategy yet. Write one in strategy.py, or set ORDER_FILE to an order file.")
    return read_order(path)
