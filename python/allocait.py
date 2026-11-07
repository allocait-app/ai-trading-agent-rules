"""The Allocait side of a Python trading bot. Standard library only, Python 3.9+.

    from allocait import Allocait
    api = Allocait()                                   # ALLOCAIT_API_KEY, ALLOCAIT_PORTFOLIO_ID
    result = api.check(trades, my_prices)              # my_prices(symbols) -> {SYMBOL: price}, your own source
    if result["newly_or_further_outside_count"] > 0: ...   # your bot's own rule

Every price is yours: Allocait supplies none and stores none.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request


class AllocaitError(Exception):
    def __init__(self, status, body):
        missing = body.get("missing_symbols") or []
        super().__init__((body.get("error") or f"Allocait answered HTTP {status}") + (f" Missing: {', '.join(missing)}." if missing else ""))
        self.status, self.code, self.body = status, body.get("error_code"), body


class Allocait:
    def __init__(self, api_key=None, portfolio_id=None, base_url=None):
        self.api_key = api_key or os.environ["ALLOCAIT_API_KEY"]
        self.portfolio_id = portfolio_id or os.environ.get("ALLOCAIT_PORTFOLIO_ID")
        self.base = (base_url or os.environ.get("ALLOCAIT_BASE_URL") or "https://allocait.app/api/v1").rstrip("/")

    def request(self, method, path, body=None):
        """Any REST call (https://allocait.app/docs/api/). A refusal raises AllocaitError with its code and body."""
        data = json.dumps(body).encode() if body is not None else None
        headers = {"x-api-key": self.api_key, "content-type": "application/json"}
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base + path, data, headers, method=method), timeout=30) as res:
                return json.loads(res.read() or b"null")
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                body = json.loads(raw)
            except ValueError:
                body = {"error": raw[:200].decode(errors="replace")}
            raise AllocaitError(e.code, body or {}) from None

    def check(self, trades, prices, scenario_id=None):
        """Price the traded symbols with prices(symbols); when Allocait names held symbols still to price, price those and ask once more."""
        trades = [{**t, "symbol": t["symbol"].strip().upper()} for t in trades]
        body = {"portfolio_id": self.portfolio_id, "trades": trades, "prices": prices([t["symbol"] for t in trades])}
        if scenario_id:
            body["scenario_id"] = scenario_id
        try:
            return self.request("POST", "/trades/check", body)
        except AllocaitError as e:
            if e.code != "PRICES_INCOMPLETE" or not e.body.get("missing_symbols"):
                raise
            body["prices"] = {**body["prices"], **prices(e.body["missing_symbols"])}
            return self.request("POST", "/trades/check", body)

    def record_position(self, symbol, shares, price, asset_class=None):
        """Record a holding's new total. Needs a Read and change key; it records the change in Allocait only."""
        body = {"shares": shares, "price": price}
        if asset_class:
            body["asset_class"] = asset_class
        return self.request("POST", f"/positions/{symbol}?portfolio_id=" + urllib.parse.quote(self.portfolio_id), body)
