import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(name => name && existsSync(resolve(root, name)))
const slug = text => text.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-')
const stripCode = text => text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '')
const cache = new Map()
function anchors(path) {
  if (cache.has(path)) return cache.get(path)
  const ids = new Set(), counts = new Map()
  for (const match of stripCode(readFileSync(path, 'utf8')).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const id = slug(match[1]), count = counts.get(id) ?? 0
    ids.add(count ? `${id}-${count}` : id)
    counts.set(id, count + 1)
  }
  cache.set(path, ids)
  return ids
}
const errors = []
for (const file of files) {
  const path = resolve(root, file)
  for (const match of stripCode(readFileSync(path, 'utf8')).matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1].replace(/^<|>$/g, '')
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue
    const [destination, fragment] = href.split('#')
    const target = destination ? resolve(dirname(path), decodeURIComponent(destination.split('?')[0])) : path
    if (!existsSync(target)) errors.push(`${file}: missing target ${href}`)
    else if (fragment && statSync(target).isFile() && extname(target) === '.md' && !anchors(target).has(decodeURIComponent(fragment))) errors.push(`${file}: missing heading ${href}`)
  }
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else console.log(`Documentation links and headings checked in ${files.length} Markdown files.`)
