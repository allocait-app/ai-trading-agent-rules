# Brand sheet: Rules for AI Trading Agents

One page for anyone who edits the pictures, the manifests or the README of this example. It follows Allocait's own app tokens and says plainly that this is a free example, not a product.

## Name

- Title: **Rules for AI Trading Agents**. Id: `ai-trading-agent-rules` (skill, plugin, zip). No other company's name in any id, file or folder name.
- Tagline: **Your own rules, checked before a paper order.**
- The repository and folder keep their older names for now (open owner decision). The title, the pill and the notice carry the meaning.

## The notice

Full form, in the README under the hero, as text: "An open-source example from the Allocait team, shared as is under the MIT license. It is not an Allocait product or service. Alpaca and Anthropic didn't make it and don't sponsor or endorse it."

Short form, in every image and one-line field, word for word: "An example from the Allocait team. Shared as is. Not an Allocait product. Not made or endorsed by Alpaca or Anthropic."

Never write "not affiliated with Allocait": the example runs on Allocait's own check and is published under its name. Allocait's legal sentences stay in the README, once each, and in no image.

## Voice

1. Result first, short clauses, sentence case, US English, no em dashes.
2. Facts about the reader's own rules: "1 of your rules is newly outside range". No advice or approval words.
3. No promise words and no promise imagery. The hook asks you; the picture says so and no more.
4. Say who acts: you decide, Claude carries, Allocait states, Alpaca holds the paper account.
5. Say "the skill tells Claude to" for anything that depends on Claude following the skill.
6. Fictional symbols only (ALFA BRAV CHAR DELT ECHO FOXT HOTL, `ECHO/USD`, `$CASH`) with made-up odd numbers. No money words.

## Palette and type (Allocait tokens)

| Role | Light | Dark |
| --- | --- | --- |
| Ground | `#f9fafb` | `#09090b` |
| Card | `#ffffff` | `#18181b` |
| Edge (hairline, no shadow) | `#09090b` at 14% | `#ffffff` at 16% |
| Heading and text | `#111827` | `#ffffff`, `#f4f4f5` |
| Secondary text | `#4b5563` | `#a1a1aa` |
| Marker (bar, disc, arrows) | `#111827` | `#f4f4f5` |
| Wing mark | `#0b0b0b` | `#ffc629` |

Contrast (WCAG AA body text needs 4.5): text on ground 17.0 light, 18.1 dark; text on card 17.7 and 16.1; secondary on ground 7.2 and 7.8; secondary on card 7.6 and 6.9; wing mark on ground 18.8 and 12.7; icon glyph on tile 17.9. Figures come from `node images/brand/build.mjs`.

Type is Inter, then the system stack (`Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`), live text, tabular where numbers sit in a column. GitHub readers see their system sans. Every line was checked in Arial for overflow. Radii: cards 12 px (24 units at the 2x size), pills round, 1 px hairline. No glow, shadow, divider line, tint wash or gradient. No green, red, orange or blue.

## Files

| File | Size | Use |
| --- | --- | --- |
| `images/hero.svg`, `images/hero-dark.svg` | 1760 x 760, shown at 880 | README top: the chat, the title, the notice, and a line that the symbols and numbers are made up |
| `images/flow.svg`, `images/flow-dark.svg` | 1760 x 880, shown at 880 | docs/HOW-IT-WORKS.md "A run, start to finish": seven steps. Put the steps beside it as a numbered list too |
| `images/brand/social-preview.svg`, `.png` | 1280 x 640, solid dark | Set by hand in the repository settings |
| `images/brand/icon.svg`, `icon-512.png` | 128, 512 | Plugin icon source and export, with transparent corners (RGBA) |
| `images/brand/tile.svg` | 128 | Spare: light tile of the same glyph, for dark grounds. Nothing uses it yet |
| `images/brand/lockup.svg`, `lockup-dark.svg` | 1000 x 200, transparent | Spare, for a docs header: tile, title, "Open-source example" label. Nothing uses them yet |

Embed: `<picture><source media="(prefers-color-scheme: dark)" srcset="images/hero-dark.svg"><img src="images/hero.svg" width="880" alt="..."></picture>`

## Do

- Write Alpaca, Claude and Anthropic as plain text in the same type as the words around them, only to say what this works with.
- Keep the wing mark small, beside "An example from the Allocait team." only, ink on light and yellow on dark, at least 16 px tall, one band of clear space.
- Keep the lines that name other companies on their own rows, apart from the mark.
- Keep the icon and tile neutral: three range rows and a disc, no company mark.

## Do not

- Use Alpaca's logo, llama, colors or typeface, or Anthropic's or Claude's logo, spark or orange. No trademark symbol, no badge, and no "official", "partner", "certified", "verified", "powered by" or "built with" beside either name.
- Put the wing mark above a title, in the icon, in a lockup, or in a box with another company's name. Use yellow nowhere but inside the mark (Alpaca's own color is a near neighbor).
- Draw a shield, lock, key, check mark, stop sign, candle chart or rising line, or any picture that promises an order cannot go out.
- Make "Allocait Example" or any combined name.
- Use a real ticker, a real number or an em dash.

## Rebuild

`node images/brand/build.mjs` writes every SVG (add `--out DIR --arial` to test in Arial). `node images/brand/render.mjs [DIR]` writes `social-preview.png` (1280 x 640) and `icon-512.png` (transparent corners) with headless Chrome; the window size must equal the SVG size. Every output path is absolute: Chrome writes `screenshot.png` into the working directory when it gets none, and that file must never be committed.

Not verified: how GitHub draws these SVGs (checked in Chrome only), the title as outlined paths (no font tool on hand, so text is live), and Alpaca's and Anthropic's rules for third-party names beyond plain text.
