// Rasterizes images/brand/social-preview.svg to images/brand/social-preview.png (1280 x 640, solid ground) and images/brand/icon.svg to
// images/brand/icon-512.png (transparent corners) with headless Chrome. The window size must equal the SVG's size.
//   node images/brand/render.mjs [DIR]    with DIR, every SVG in images/ and images/brand/ is also written there as a PNG for review
import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dir = process.argv[2]

// out is always an absolute path: with none, headless Chrome writes screenshot.png into the working directory.
function shot(svg, w, h, scale, out, transparent = false) {
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${scale}`, `--window-size=${w},${h}`, `--screenshot=${out}`]
  if (transparent) args.push('--default-background-color=00000000')
  const r = spawnSync(CHROME, [...args, `file://${svg}`], { stdio: 'ignore' })
  if (r.status !== 0) throw new Error(`Chrome failed for ${svg}`)
  console.log(`${out} ${statSync(out).size} bytes`)
}

shot(join(HERE, 'social-preview.svg'), 1280, 640, 1, join(HERE, 'social-preview.png'))
shot(join(HERE, 'icon.svg'), 128, 128, 4, join(HERE, 'icon-512.png'), true)
if (dir) {
  mkdirSync(dir, { recursive: true })
  const img = (f) => join(HERE, '..', f)
  shot(img('hero.svg'), 1760, 760, 1, join(dir, 'hero.png'))
  shot(img('hero-dark.svg'), 1760, 760, 1, join(dir, 'hero-dark.png'))
  shot(img('flow.svg'), 1760, 880, 1, join(dir, 'flow.png'))
  shot(img('flow-dark.svg'), 1760, 880, 1, join(dir, 'flow-dark.png'))
  shot(join(HERE, 'lockup.svg'), 1000, 200, 1, join(dir, 'lockup.png'), true)
  shot(join(HERE, 'lockup-dark.svg'), 1000, 200, 1, join(dir, 'lockup-dark.png'), true)
  shot(join(HERE, 'tile.svg'), 128, 128, 4, join(dir, 'tile.png'), true)
  shot(join(HERE, 'icon.svg'), 128, 128, 4, join(dir, 'icon.png'), true)
}
