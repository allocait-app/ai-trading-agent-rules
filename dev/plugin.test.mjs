import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))
const hooks = read('hooks/hooks.json')
const settings = read('hooks/settings.example.json')
const preset = read('hooks/presets/alpaca.json')
const fixture = read('dev/fixtures/alpaca-tools.json')
const plugin = read('.claude-plugin/plugin.json')
const market = read('.claude-plugin/marketplace.json')

const entry = hooks.hooks.PreToolUse[0]
const matcher = entry.matcher
const re = new RegExp(matcher)
const prefixes = ['', 'mcp__3f2a1b4c-0000-4000-8000-123456789abc__', 'mcp__claude_ai_Alpaca_Paper_Trading__', 'mcp__alpaca__', 'mcp__plugin_x_alpaca__']

test('the matcher in hooks.json and settings.example.json are equal, are a regex, and match every ruled tool under five prefixes and none of Allocait\'s tools or close_pane', () => {
  assert.equal(settings.hooks.PreToolUse[0].matcher, matcher)
  const project = settings.hooks.PreToolUse[0].hooks[0]
  assert.deepEqual([project.type, project.onFailure], ['command', 'block'])
  assert.match(project.command, /require-check\.mjs/)
  // Claude Code reads a matcher with anything beyond letters, digits, _, -, comma and | as a regex.
  assert.ok(/[^A-Za-z0-9_\-, |]/.test(matcher), 'matcher must be in regex mode')
  for (const tool of Object.keys(preset.tools)) {
    for (const p of prefixes) assert.equal(re.test(p + tool), true, p + tool)
  }
  const inert = Object.keys(fixture.tools).filter((t) => !(t in preset.tools) && !/^place_/.test(t))
  assert.ok(inert.length > 0)
  const others = [...inert, 'get_all_positions', 'get_account_info', 'check_trades', 'check_allocations', 'save_position', 'replace_positions',
    'record_cash_movement', 'get_portfolio_snapshot', 'close_pane', 'close_page', 'place_']
  for (const t of others) for (const p of prefixes) assert.equal(re.test(p + t), false, p + t)
  assert.equal(re.test('mcp__x__place_futures_order'), true)
})

test('hooks.json, plugin.json and marketplace.json parse; hooks.json has the top-level hooks key; the command quotes CLAUDE_PLUGIN_ROOT; the entry has onFailure block and a timeout', () => {
  assert.ok(hooks.hooks && typeof hooks.hooks === 'object')
  assert.equal(Object.keys(hooks).filter((k) => k !== 'description').join(), 'hooks')
  assert.equal(hooks.hooks.PreToolUse.length, 1)
  const h = entry.hooks[0]
  assert.equal(h.type, 'command')
  assert.match(h.command, /"\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/require-check\.mjs"/)
  assert.equal(h.onFailure, 'block')
  assert.ok(Number.isInteger(h.timeout) && h.timeout > 0)
  assert.ok(existsSync(new URL('../hooks/require-check.mjs', import.meta.url)))
  assert.ok(existsSync(new URL('../skills/ai-trading-agent-rules/SKILL.md', import.meta.url)), 'skills/ is found by default at the plugin root')
  // Nothing in the manifest redirects the default locations.
  for (const k of ['hooks', 'skills', 'commands', 'agents', 'mcpServers']) assert.equal(k in plugin, false, k)
})

test('the plugin name has no reserved prefix; the marketplace name is not the GitHub folder name; the marketplace source is ./ and names the plugin', () => {
  assert.match(plugin.name, /^[a-z0-9]+(-[a-z0-9]+)*$/)
  assert.doesNotMatch(plugin.name, /^(claude|anthropic|anthropics|cc-plugin)(-|$)/)
  assert.notEqual(market.name, 'allocait-app-ai-trading-agent-rules')
  assert.doesNotMatch(market.name, /^(claude|anthropic)/)
  assert.ok(market.owner && market.owner.name)
  assert.equal(market.plugins.length, 1)
  assert.equal(market.plugins[0].source, './')
  assert.equal(market.plugins[0].name, plugin.name)
  assert.equal(plugin.author.name, 'RidgeXAI')
  assert.doesNotThrow(() => new URL(plugin.homepage))
})

test('settings.example.json points at .claude/hooks/require-check.mjs and keeps onFailure block', () => {
  const h = settings.hooks.PreToolUse[0].hooks[0]
  assert.match(h.command, /\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/require-check\.mjs/)
  assert.equal(h.onFailure, 'block')
  assert.ok(Number.isInteger(h.timeout))
})
