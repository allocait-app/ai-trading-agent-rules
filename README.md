<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/hero-dark.svg">
  <img src="images/hero.svg" width="880" alt="A chat. You ask Claude to check a buy of ECHO/USD. Claude reports a rule newly outside range, then asks whether to place the order in your Alpaca paper account.">
</picture>

# Rules for AI Trading Agents

**Claude checks an Alpaca paper order against rules you wrote, and the skill tells it to ask you before it places the order.**

- Claude reads your Alpaca paper account and its last prices.
- Allocait states what the order does to your ranges, the limits you set, such as the most you may hold in crypto. Prompt 1 below asks you for them.
- You say yes or no. Claude places the paper order only after your yes.

An open-source example from the Allocait team, shared as is under the MIT license. It is not an Allocait product or service. Alpaca and Anthropic didn't make it and don't sponsor or endorse it.

## Set up

You need an [Alpaca paper account](https://app.alpaca.markets/signup), an [Allocait account](https://allocait.app) and Claude. Each has its own terms. Allocait is in early access, so you may need to request an account first. After that, setup takes a few minutes.

1. Add the **Alpaca Paper Trading** connector from the [Claude directory](https://claude.ai/directory/alpaca-paper-trading) and sign in with Alpaca.
2. Add the **Allocait** connector, sign in and choose Read and change.
   - Claude Code (2.1.295 or later): run `claude mcp add --transport http allocait https://api.allocait.app/functions/v1/mcp`, then `/mcp` and pick `allocait`.
   - Claude's chat app: add `https://api.allocait.app/functions/v1/mcp` as a [custom connector](https://claude.com/docs/connectors/custom/add-unlisted).
3. Add the skill.
   - Claude Code: run `/plugin marketplace add allocait-app/ai-trading-agent-rules`, then `/plugin install ai-trading-agent-rules@allocait-examples`. This also installs an [order hook](docs/HOOK.md), a script Claude Code runs before an order tool. It asks you once more if the permission mode can ask. It does not promise to stop an order.
   - Claude's chat app: upload [`ai-trading-agent-rules.zip`](ai-trading-agent-rules.zip) under Customize > Skills and turn on code execution. There is no hook in chat.

Stuck? See [more setup](docs/SETUP.md).

## Three prompts

Paste these into Claude, in order.

1. **Copy your account.** The skill tells Claude to show what it will write and wait for your yes, then ask for each range in your words.
   ```
   Mirror my Alpaca paper account into Allocait, then ask me for my ranges.
   ```
   This records the change in Allocait only. It moves no money and places no order.
2. **Check an order.** Replace `<symbol>` with one from your account. The skill tells Claude to read prices from Alpaca, state what the order does to your ranges, and ask you.
   ```
   Check an order to buy 5 shares of <symbol> against my rules. If I say yes, place it in my paper account and record the fill.
   ```
3. **See where you stand.** Claude only reads.
   ```
   Where does my Alpaca account stand against my Allocait rules?
   ```

Allocait checks your holdings against rules you wrote. It does not give investment advice or recommend trades. A result inside every range does not say a change is advisable. Allocait cannot approve, stop or place an order.

## More

- [How it works](docs/HOW-IT-WORKS.md): the picture, a sample result and what it writes.
- [The script path](docs/SCRIPT.md): for people with REST keys and no Claude.
- [Working in this repo](AGENTS.md) and [security](.github/SECURITY.md).

MIT license, see `LICENSE`. Alpaca and Claude are the names of their owners and appear only to say what this works with.
