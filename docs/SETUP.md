# More setup

The [README](../README.md) has the three steps. This page has the details, the chat app and the fixes. You need an [Alpaca paper account](https://app.alpaca.markets/signup), an [Allocait account](https://allocait.app) and Claude. Each has its own terms. Allocait is in early access, so you may need to request an account at allocait.app first.

## In Claude Code

Needs Claude Code 2.1.295 or later, and `node` on your `PATH` for the hook.

1. Add the Alpaca Paper Trading connector from the Claude directory (claude.ai/directory/alpaca-paper-trading) and sign in with Alpaca. Without a claude.ai login, see [Alpaca's own server](ALPACA.md).
2. If `/mcp` already lists Allocait, skip this step. Otherwise run `claude mcp add --transport http allocait https://api.allocait.app/functions/v1/mcp`, then `/mcp`, pick `allocait` and sign in. On the consent screen, choose Read and change, because prompts 1 and 2 write to Allocait. Checks and prompt 3 need only Read. Claude Code asks before each tool's first use, so expect a few permission prompts.
3. Install the skill and the hook:

   ```
   /plugin marketplace add allocait-app/ai-trading-agent-rules
   /plugin install ai-trading-agent-rules@allocait-examples
   ```

   In a session, `/plugin install` opens the plugin's panel so you can pick a scope. Run `/reload-plugins` if Claude Code says to. From a clone of this repo, `claude --plugin-dir .` loads the same plugin for one session.

Claude Code on the desktop and on the web is Claude Code, so use these steps. A cloud session does not load a plugin you installed on your machine.

## In claude.ai chat or Claude's desktop chat

There is no hook in chat, so nothing refuses an order that should have been checked. The skill tells Claude to run the check.

1. Add the two connectors. Alpaca Paper Trading is in the Claude directory. Add Allocait as a [custom connector](https://claude.com/docs/connectors/custom/add-unlisted) with the URL `https://api.allocait.app/functions/v1/mcp`, and choose Read and change when it asks.
2. Download `ai-trading-agent-rules.zip` from this repo and add it under Customize > Skills > Upload a skill.
3. Turn on code execution, which skills need. The skill runs a small Node script for arithmetic. If Claude cannot run it, the skill says to do the arithmetic by hand and show the numbers (not tried here).

## The prompts in detail

1. **Copy your account.** Claude shows a table of what it will write, names what it leaves out, and waits for your yes. Then it asks for each range in your words and writes none of its own. Options, short stock and your active scenario are in [ALPACA.md](ALPACA.md).
2. **Check an order.** This needs the ranges from prompt 1. Replace the placeholder with your own symbol. Claude gets the prices from Alpaca, runs the check, states the facts, asks, places the order, reads it back, and records what filled.
3. **See where you stand.** Claude only reads. For a schedule, see [ALPACA.md](ALPACA.md).

## If something is off

- **A check judges nothing.** The portfolio has no active scenario. Claude offers to make one active, by its name, after your yes ([ALPACA.md](ALPACA.md)).
- **The hook refuses an order.** Either no matching check ran earlier in the session, so ask Claude to run the check first, or the permission mode is not default or accept-edits, where the hook refuses instead of asking ([HOOK.md](HOOK.md)).
