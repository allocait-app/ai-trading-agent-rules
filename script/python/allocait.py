"""The Allocait side of a Python trading bot. Standard library only, Python 3.9+.

    from allocait import Allocait
    api = Allocait()                                   # ALLOCAIT_API_KEY, ALLOCAIT_PORTFOLIO_ID
    result = api.check(trades, my_prices)              # my_prices(symbols) -> {SYMBOL: price}, your own source
    if result["newly_or_further_outside_count"] > 0: ...   # your bot's own rule

"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

# A symbol goes into a URL path and a request body: the server's own forms, a ticker or BASE/QUOTE (3 or 4 letters).
SYMBOL = re.compile(r"^(?:[A-Z0-9][A-Z0-9.-]{0,20}|[A-Z0-9]{2,10}/[A-Z]{3,4})$")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """The key must not follow a redirect to another host."""

    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def normalize_trades(trades):
    """Trim and upper-case each symbol, and refuse one that is not a plain ticker or BASE/USD pair."""
    if not trades:
        raise ValueError("The order needs at least one trade.")
    out = []
    for t in trades:
        symbol = str(t.get("symbol", "")).strip().upper()
        if not SYMBOL.match(symbol):
            raise ValueError(f'"{t.get("symbol")}" is not a symbol. Write a ticker, or a pair as BASE/USD.')
        out.append({**t, "symbol": symbol})
    return out


def secure_base(url):
    """The key travels in a header, so the base URL must be https (plain http only for this machine)."""
    u = urllib.parse.urlparse(url)
    if u.scheme != "https" and not (u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1", "::1")):
        raise ValueError(f"Refusing to send the API key to {u.scheme}://{u.netloc}: use https.")
    return url.rstrip("/")


def file_prices(path):
    """A price source from a JSON file you keep: { "SYMBOL": 123.45 }. Raises naming what it cannot price."""
    def prices(symbols):
        with open(path) as f:
            known = {k.upper(): float(v) for k, v in json.load(f).items()}
        missing = [s for s in symbols if not known.get(s, 0) > 0]
        if missing:
            raise ValueError(f"No price for {', '.join(missing)} in {path}")
        return {s: known[s] for s in symbols}
    return prices


def prices_from_env(env=None):
    """The price source PRICE_SOURCE names, the same variable the Node side reads. Only file:<path> here; for
    anything else, pass your own function to Allocait.check."""
    default = "file:" + os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "prices.example.json")
    spec = (env if env is not None else os.environ).get("PRICE_SOURCE") or default
    if not spec.startswith("file:") or "," in spec:
        raise ValueError(f'PRICE_SOURCE "{spec}" is not supported in Python: use file:<path>, or pass a function of your own to check().')
    return file_prices(spec[5:])


DEMO_HEADER = "\n".join([
    "Example result, saved in result.example.json. No account, no key, no network: nothing was checked.",
    "Order: order.example.json. Prices: prices.example.json. The book and its rules are made up.",
    "",
])


def demo_result():
    """--demo: the saved example result, printed through format_result like a real one. Nothing is computed here: the
    file is a result in the shape POST /trades/check returns, with made-up numbers."""
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "result.example.json")) as f:
        return json.load(f)


def read_order(path):
    """An order from a file, or from stdin when the path is "-"."""
    if not path:
        raise ValueError("Give an order file, or - to read it from stdin.")
    if path == "-":
        return json.load(sys.stdin)
    with open(path) as f:
        return json.load(f)


def run_cli(main):
    """Run a command-line entry: exit with the status it returns, or 2 when there is no result."""
    try:
        sys.exit(main())
    except Exception as e:
        print(f"No result: {e}", file=sys.stderr)
        sys.exit(2)


def exit_code(r):
    """0 inside and covered, 1 newly or further outside or short of cash, 3 a traded symbol no rule judges."""
    if r["newly_or_further_outside_count"] > 0 or not r["cash"]["sufficient"]:
        return 1
    if r["rules_judged_count"] == 0 or any(n.get("traded") for n in r["not_covered"]):
        return 3
    return 0


def format_result(r):
    """The facts of a result, one line each."""
    lines = [f"Rules judged: {r['rules_judged_count']}. Newly or further outside: {r['newly_or_further_outside_count']}."]
    for x in r["rules"]:
        what = f"{x['asset_class']} band" if x["kind"] == "class_band" else f"{x['symbol']} size"
        lines.append(f"  {what}: {x['before_pct']}% -> {x['after_pct']}% (your range {x['min_pct']}% to {x['max_pct']}%), {x['change'].replace('_', ' ')}")
    for n in r["not_covered"]:
        lines.append(f"  {n['symbol']}: no rule covers it ({n['reason']})")
    if not r["cash"]["sufficient"]:
        lines.append(f"  Cash after the change: {r['cash']['after']} (not enough)")
    return "\n".join(lines)


class AllocaitError(Exception):
    def __init__(self, status, body):
        missing = body.get("missing_symbols") or []
        super().__init__((body.get("error") or f"Allocait answered HTTP {status}") + (f" Missing: {', '.join(missing)}." if missing else ""))
        self.status, self.code, self.body = status, body.get("error_code"), body


class Allocait:
    def __init__(self, api_key=None, portfolio_id=None, base_url=None):
        self.api_key = api_key or os.environ.get("ALLOCAIT_API_KEY")
        if not self.api_key:
            raise ValueError("Set ALLOCAIT_API_KEY (Allocait app, Settings > Agents).")
        self.portfolio_id = portfolio_id or os.environ.get("ALLOCAIT_PORTFOLIO_ID")
        self.base = secure_base(base_url or os.environ.get("ALLOCAIT_BASE_URL") or "https://allocait.app/api/v1")

    def request(self, method, path, body=None):
        """Any REST call (https://allocait.app/docs/api/). A refusal raises AllocaitError with its code and body."""
        data = json.dumps(body).encode() if body is not None else None
        headers = {"x-api-key": self.api_key, "content-type": "application/json"}
        try:
            with _OPENER.open(urllib.request.Request(self.base + path, data, headers, method=method), timeout=30) as res:
                return json.loads(res.read() or b"null")
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                body = json.loads(raw)
            except ValueError:
                body = {"error": raw[:200].decode(errors="replace")}
            raise AllocaitError(e.code, body or {}) from None

    def check(self, trades, prices, scenario_id=None):
        """prices is a function (symbols) -> {SYMBOL: price}, or a dict covering every held and traded symbol. A function prices the
        traded symbols; when Allocait names held symbols still to price, it prices those and asks once more."""
        trades = normalize_trades(trades)
        if not self.portfolio_id:
            raise ValueError("Set ALLOCAIT_PORTFOLIO_ID to a portfolio id (api.request('GET', '/portfolios') lists them).")
        body = {"portfolio_id": self.portfolio_id, "trades": trades, "prices": prices if isinstance(prices, dict) else prices([t["symbol"] for t in trades])}
        if scenario_id:
            body["scenario_id"] = scenario_id
        try:
            return self.request("POST", "/trades/check", body)
        except AllocaitError as e:
            if isinstance(prices, dict) or e.code != "PRICES_INCOMPLETE" or not e.body.get("missing_symbols"):
                raise
            body["prices"] = {**body["prices"], **prices(e.body["missing_symbols"])}
            return self.request("POST", "/trades/check", body)

    def record_position(self, symbol, shares, price, asset_class=None):
        """Record a holding's new total. Needs a Read and change key; it records the change in Allocait only."""
        body = {"shares": shares, "price": price}
        if asset_class:
            body["asset_class"] = asset_class
        return self.request("POST", f"/positions/{symbol}?portfolio_id=" + urllib.parse.quote(self.portfolio_id), body)
