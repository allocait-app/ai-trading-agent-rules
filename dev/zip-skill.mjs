#!/usr/bin/env node
// Builds ai-trading-agent-rules.zip from skills/ai-trading-agent-rules/ for claude.ai's "Upload a skill". Node's own zlib, no
// dependency. The bytes are fixed (stored entries, fixed timestamp, sorted names), so a second run writes the same file
// and dev/skill.test.mjs can require that the committed zip is what this script writes. Needs Node 22.2 or later
// (zlib.crc32). Run: node dev/zip-skill.mjs. Pass --check to compare without writing.
import { readFileSync, readdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { crc32 } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const SKILL = 'ai-trading-agent-rules'
const ZIP = fileURLToPath(new URL(`${SKILL}.zip`, ROOT))
const DOS_TIME = 0
const DOS_DATE = 0x21 // 1980-01-01

/** The zip's bytes for these files: [{ name, data }]. Stored entries, UTF-8 names, no extra fields. */
export function zipBytes(files) {
  const local = []
  const central = []
  let offset = 0
  for (const { name, data } of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6)
    head.writeUInt16LE(0, 8)
    head.writeUInt16LE(DOS_TIME, 10)
    head.writeUInt16LE(DOS_DATE, 12)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(data.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBytes.length, 26)
    const entry = Buffer.concat([head, nameBytes, data])
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(0, 10)
    dir.writeUInt16LE(DOS_TIME, 12)
    dir.writeUInt16LE(DOS_DATE, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBytes.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([dir, nameBytes]))
    local.push(entry)
    offset += entry.length
  }
  const centralBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(local.length, 8)
  end.writeUInt16LE(local.length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, centralBytes, end])
}

/** The skill folder's files, as the zip holds them: ai-trading-agent-rules/<file>. */
export function skillFiles() {
  const dir = new URL(`skills/${SKILL}/`, ROOT)
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => ({ name: `${SKILL}/${e.name}`, data: readFileSync(new URL(e.name, dir)) }))
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const bytes = zipBytes(skillFiles())
  if (process.argv.includes('--check')) {
    if (!existsSync(ZIP) || !readFileSync(ZIP).equals(bytes)) {
      process.stderr.write(`${SKILL}.zip is not what skills/${SKILL}/ builds. Run: node dev/zip-skill.mjs\n`)
      process.exit(1)
    }
  } else writeFileSync(ZIP, bytes)
}
