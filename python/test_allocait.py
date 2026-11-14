"""python3 -m unittest discover -s python. No network: the request method is replaced by a fake."""
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

import allocait
from allocait import Allocait, AllocaitError, exit_code, file_prices, format_result, normalize_trades, prices_from_env, secure_base

ROW = {"index": 0, "symbol": "ALFA", "side": "BUY", "shares": 3, "price": 41.37, "shares_before": 61, "shares_after": 64}


def result(**over):
    base = {"portfolio_id": "p1", "newly_or_further_outside_count": 0, "rules_judged_count": 3, "rules": [], "not_covered": [],
            "cash": {"before": 1000, "after": 875.89, "sufficient": True}, "trades": [ROW]}
    return {**base, **over}


def prices(symbols):
    return {s: 41.37 for s in symbols}


class CheckTest(unittest.TestCase):
    def setUp(self):
        self.api = Allocait(api_key="k", portfolio_id="p1", base_url="https://example.test/api/v1/")

    def test_exit_code(self):
        uncovered = {"not_covered": [{"symbol": "ECHO/USD", "reason": "NO_CLASS_RULE", "traded": True}]}
        self.assertEqual(exit_code(result()), 0)
        self.assertEqual(exit_code(result(not_covered=[{"symbol": "GOLF", "reason": "NO_SIZE_RANGE", "traded": False}])), 0)
        self.assertEqual(exit_code(result(newly_or_further_outside_count=1, **uncovered)), 1)
        self.assertEqual(exit_code(result(cash={"before": 1, "after": -5, "sufficient": False})), 1)
        self.assertEqual(exit_code(result(rules_judged_count=0)), 3)
        self.assertEqual(exit_code(result(**uncovered)), 3)

    def test_format_result_states_facts(self):
        rule = {"kind": "class_band", "asset_class": "Crypto", "min_pct": 0, "max_pct": 7, "before_pct": 0, "after_pct": 9.13, "change": "newly_outside"}
        text = format_result(result(newly_or_further_outside_count=1, rules=[rule]))
        self.assertIn("Newly or further outside: 1.", text)
        self.assertIn("Crypto band: 0% -> 9.13% (your range 0% to 7%), newly outside", text)

    def test_check_prices_traded_then_the_held_symbols_named(self):
        refusal = AllocaitError(400, {"error": "A price is needed", "error_code": "PRICES_INCOMPLETE", "missing_symbols": ["BRAV"]})
        calls = []

        def fake(method, path, body=None):
            calls.append(body["prices"])
            if len(calls) == 1:
                raise refusal
            return result()

        with mock.patch.object(self.api, "request", fake):
            self.api.check([{"symbol": " alfa ", "side": "BUY", "shares": 3}], prices)
        self.assertEqual(calls, [{"ALFA": 41.37}, {"ALFA": 41.37, "BRAV": 41.37}])

    def test_other_refusals_raise(self):
        with mock.patch.object(self.api, "request", side_effect=AllocaitError(403, {"error": "Read only", "error_code": "FORBIDDEN"})):
            with self.assertRaises(AllocaitError):
                self.api.check([{"symbol": "ALFA", "side": "BUY", "shares": 1}], prices)

    def test_symbols_are_validated(self):
        self.assertEqual(normalize_trades([{"symbol": "echo/usd"}])[0]["symbol"], "ECHO/USD")
        for bad in ["", "../x", "ALFA?x=1", "AL FA", "A/B/C", "BRK.B/USD", "$X/AB", "$CASH"]:
            with self.assertRaises(ValueError, msg=bad):
                normalize_trades([{"symbol": bad}])

    def test_the_key_goes_only_over_https_or_this_machine(self):
        self.assertEqual(secure_base("http://127.0.0.1:54321/x/"), "http://127.0.0.1:54321/x")
        with self.assertRaises(ValueError):
            secure_base("http://example.test/api")

    def test_file_prices_names_what_is_missing(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"alfa": 41.37}, f)
        try:
            self.assertEqual(file_prices(f.name)(["ALFA"]), {"ALFA": 41.37})
            with self.assertRaisesRegex(ValueError, "No price for GOLF"):
                file_prices(f.name)(["ALFA", "GOLF"])
        finally:
            os.unlink(f.name)

    def test_a_price_dict_is_used_as_given_with_no_retry(self):
        refusal = AllocaitError(400, {"error": "A price is needed", "error_code": "PRICES_INCOMPLETE", "missing_symbols": ["BRAV"]})
        with mock.patch.object(self.api, "request", side_effect=refusal) as req:
            with self.assertRaises(AllocaitError):
                self.api.check([{"symbol": "ALFA", "side": "BUY", "shares": 1}], {"ALFA": 41.37})
        self.assertEqual(req.call_args[0][2]["prices"], {"ALFA": 41.37})
        self.assertEqual(req.call_count, 1)

    def test_price_source_is_the_one_variable_node_reads(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"alfa": 41.37}, f)
        try:
            self.assertEqual(prices_from_env({"PRICE_SOURCE": "file:" + f.name})(["ALFA"]), {"ALFA": 41.37})
            for bad in ["coinbase", "file:a.json,coinbase"]:
                with self.assertRaisesRegex(ValueError, "not supported in Python"):
                    prices_from_env({"PRICE_SOURCE": bad})
        finally:
            os.unlink(f.name)
        self.assertIn("ALFA", prices_from_env({})(["ALFA"]))  # the default file resolves from any directory

    def test_a_redirect_is_not_followed(self):
        self.assertIsNone(allocait._NoRedirect().redirect_request(None, None, 302, "Found", {}, "http://x"))

    def test_record_position_sends_the_new_total(self):
        with mock.patch.object(self.api, "request") as req:
            self.api.record_position("ECHO/USD", 31.5, 3.19, "Crypto")
        req.assert_called_once_with("POST", "/positions/ECHO/USD?portfolio_id=p1", {"shares": 31.5, "price": 3.19, "asset_class": "Crypto"})


class BotTest(unittest.TestCase):
    def run_bot(self, tty, answer="n"):
        import bot
        api = mock.Mock()
        api.check.return_value = result()
        env = {"ORDER_FILE": "order.example.json"}
        with mock.patch.dict(os.environ, env), mock.patch.object(bot, "Allocait", return_value=api), \
                mock.patch.object(bot, "propose", return_value={"trades": [{"symbol": "ALFA", "side": "BUY", "shares": 3}]}), \
                mock.patch.object(bot.sys.stdin, "isatty", return_value=tty), mock.patch("builtins.input", return_value=answer), \
                mock.patch.object(bot, "prices_from_env", return_value=prices), redirect_stdout(io.StringIO()):
            code = bot.main()
        return code, api

    def test_no_one_present_records_nothing(self):
        code, api = self.run_bot(tty=False)
        self.assertEqual(code, 0)
        api.record_position.assert_not_called()

    def test_a_failed_record_exits_4_and_sales_go_first(self):
        import bot
        trades = [{"symbol": "ALFA", "side": "BUY", "shares": 3}, {"symbol": "GOLF", "side": "SELL", "shares": 2}]
        rows = [{**ROW}, {**ROW, "index": 1, "symbol": "GOLF", "side": "SELL", "shares": 2, "shares_before": 9}]
        api = mock.Mock()
        api.check.return_value = result(trades=rows)
        api.record_position.side_effect = [RuntimeError("refused"), None]
        with mock.patch.object(bot, "Allocait", return_value=api), mock.patch.object(bot, "propose", return_value={"trades": trades}), \
                mock.patch.object(bot.sys.stdin, "isatty", return_value=True), mock.patch("builtins.input", return_value="y"), \
                mock.patch.object(bot, "prices_from_env", return_value=prices), redirect_stdout(io.StringIO()), mock.patch.object(bot.sys, "stderr", io.StringIO()):
            code = bot.main()
        self.assertEqual(code, 4)
        self.assertEqual([c.args[0] for c in api.record_position.call_args_list], ["GOLF", "ALFA"])

    def test_a_no_records_nothing_and_a_yes_records_the_new_total(self):
        _, api = self.run_bot(tty=True, answer="n")
        api.record_position.assert_not_called()
        _, api = self.run_bot(tty=True, answer="y")
        api.record_position.assert_called_once_with("ALFA", 64, 41.37, None)


class DemoTest(unittest.TestCase):
    def test_demo_prints_the_saved_result_with_no_key(self):
        import check

        with mock.patch.dict(os.environ, {"ALLOCAIT_API_KEY": "", "ALLOCAIT_PORTFOLIO_ID": ""}), \
                mock.patch.object(Allocait, "request", side_effect=AssertionError("no request in --demo")):
            out = io.StringIO()
            with redirect_stdout(out):
                code = check.main(["--demo"])
        self.assertEqual(code, 1)
        self.assertTrue(out.getvalue().startswith("Example result, saved in result.example.json. No account, no key, no network"))
        self.assertIn("Crypto band: 0% -> 7.29% (your range 0% to 7%), newly outside", out.getvalue())


if __name__ == "__main__":
    unittest.main()
