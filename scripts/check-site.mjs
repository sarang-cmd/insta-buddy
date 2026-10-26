import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const distRoot = join(repoRoot, 'site', 'dist')
const failures = []
const passes = []

const check = (condition, message) => {
  if (condition) passes.push(message)
  else failures.push(message)
}

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else files.push(full)
  }
  return files
}

const exists = async (path) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const resolveTarget = (value, sourceFile) => {
  if (!value) return null
  const trimmed = value.trim()
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('http:') ||
    trimmed.startsWith('https:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('javascript:')
  ) {
    return null
  }
  const clean = trimmed.split('#')[0].split('?')[0]
  if (!clean) return null
  if (clean.startsWith('/')) return join(distRoot, clean)
  return resolve(dirname(sourceFile), clean)
}

const collectRefs = (text, regex, sourceFile, refs, valueIndex = 1) => {
  for (const match of text.matchAll(regex)) {
    const value = match[valueIndex]
    const target = resolveTarget(value, sourceFile)
    if (target) refs.push({ value, target, sourceFile })
  }
}

const files = await walk(distRoot)
const isSiteFile = (file) => !file.includes(`${sep}app${sep}`)
const htmlFiles = files.filter((f) => extname(f) === '.html')
const cssFiles = files.filter((f) => extname(f) === '.css')
const textFiles = files.filter((f) => ['.html', '.css', '.js', '.svg', '.txt'].includes(extname(f)))
const siteTextFiles = textFiles.filter(isSiteFile)
const siteHtmlFiles = htmlFiles.filter(isSiteFile)
const siteCssFiles = cssFiles.filter(isSiteFile)

check(files.length > 0, 'site/dist contains built files')
for (const page of ['index.html', 'demo.html', 'terms.html', 'privacy.html']) {
  check(await exists(join(distRoot, page)), `built page exists: ${page}`)
}
check(await exists(join(distRoot, 'app', 'index.html')), 'working demo app is bundled at /app/')

const refs = []
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8')
  collectRefs(html, /(?:href|src)="([^"]+)"/g, file, refs)
  collectRefs(html, /(?:href|src)='([^']+)'/g, file, refs)
}
for (const file of cssFiles) {
  const css = await readFile(file, 'utf8')
  collectRefs(css, /url\((['"]?)([^'")]+)\1\)/g, file, refs, 2)
}

const missing = []
for (const ref of refs) {
  let target = ref.target
  // A trailing slash points at a directory index.
  if (ref.value.endsWith('/')) target = join(target, 'index.html')
  if (!(await exists(target))) missing.push(`${ref.value} (from ${ref.sourceFile.replace(distRoot, 'site/dist')})`)
}
check(missing.length === 0, `all ${refs.length} local page, asset and app references resolve`)

const allText = []
for (const file of siteTextFiles) allText.push(await readFile(file, 'utf8'))
const combined = allText.join('\n')

check(!/[—–]/.test(combined), 'no em dash or en dash in built site copy')
for (const forbidden of ['Inter', 'Geist', 'Space Grotesk', 'Lucide', '→', '✅', 'linear-gradient', 'radial-gradient']) {
  check(!combined.includes(forbidden), `forbidden pattern absent: ${forbidden}`)
}
check((combined.match(/box-shadow/g) ?? []).length <= 2, 'box shadows are limited to the two product frames')
check(combined.includes('prefers-reduced-motion'), 'reduced motion preference is handled in CSS')

const badBlank = [...combined.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].filter(
  (match) => !match[0].includes('rel="noreferrer"') && !match[0].includes('rel="noopener'),
)
check(badBlank.length === 0, 'external blank-target links have rel protection')

const terms = await readFile(join(distRoot, 'terms.html'), 'utf8')
const privacy = await readFile(join(distRoot, 'privacy.html'), 'utf8')
check(terms.includes('Draft for review'), 'Terms page is marked as a draft')
check(privacy.includes('Draft for review'), 'Privacy page is marked as a draft')
check(terms.includes('[Publisher legal name]'), 'Terms page keeps publisher placeholder')
check(privacy.includes('[Controller legal name and address]'), 'Privacy page keeps controller placeholder')

const css = siteCssFiles.length
  ? (await Promise.all(siteCssFiles.map((f) => readFile(f, 'utf8')))).join('\n')
  : ''
const variable = (name) => {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  return match?.[1] ?? null
}
const luminance = (hex) => {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
const paper = variable('paper')
const porcelain = variable('porcelain')
const ink = variable('ink')
const slate = variable('slate')
const accent = variable('accent')
check(Boolean(paper && porcelain && ink && slate && accent), 'palette variables are present in built CSS')
if (paper && porcelain && ink && slate && accent) {
  check(contrast(ink, paper) >= 7, `ink on paper contrast ${contrast(ink, paper).toFixed(2)}:1`)
  check(contrast(slate, paper) >= 4.5, `slate on paper contrast ${contrast(slate, paper).toFixed(2)}:1`)
  check(contrast(accent, paper) >= 4.5, `accent on paper contrast ${contrast(accent, paper).toFixed(2)}:1`)
  check(contrast(ink, porcelain) >= 7, `ink on porcelain contrast ${contrast(ink, porcelain).toFixed(2)}:1`)
  check(contrast(slate, porcelain) >= 4.5, `slate on porcelain contrast ${contrast(slate, porcelain).toFixed(2)}:1`)
  check(contrast(accent, porcelain) >= 4.5, `accent on porcelain contrast ${contrast(accent, porcelain).toFixed(2)}:1`)
}

if (missing.length) {
  console.log('\nMissing local references:')
  for (const item of missing) console.log(`  - ${item}`)
}
console.log(`\nSite checks: ${passes.length} passed, ${failures.length} failed.`)
for (const pass of passes) console.log(`  pass  ${pass}`)
for (const failure of failures) console.log(`  FAIL  ${failure}`)
process.exitCode = failures.length ? 1 : 0
