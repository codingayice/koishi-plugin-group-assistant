import fs from 'node:fs'
import path from 'node:path'

const sourceDir = path.resolve(process.argv[2] || 'Sensitive-lexicon/Vocabulary')
const outputPath = path.resolve(process.argv[3] || 'wordlists/sensitive-lexicon.txt')
const excludedFiles = new Set(['非法网址.txt'])

function normalizePattern(value) {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/薇信|微\s*信|v\s*x|v\s*信/g, '微信')
    .replace(/扣扣|企鹅号/g, 'qq')
    .replace(/\s+/gu, '')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/(.)\1{2,}/gu, '$1$1')
}

function shouldSkipLine(line) {
  return !line || line.startsWith('#') || line.startsWith('//') || line.startsWith('```') || line === '---'
}

function looksLikeUrl(line) {
  return /(?:https?:\/\/|www\.)/iu.test(line) ||
    /(?:[a-z0-9-]+\.)+(?:com|cn|net|org|cc|top|xyz|vip|club|site|info|me|io|tk)(?:[/:?#]|$)/iu.test(line)
}

if (!fs.existsSync(sourceDir)) {
  throw new Error(`词库目录不存在: ${sourceDir}`)
}

const entries = new Map()
const stats = {
  sourceFiles: 0,
  sourceLines: 0,
  skippedFiles: 0,
  skippedLines: 0,
  skippedUrls: 0,
  skippedShort: 0,
  duplicateLines: 0,
}

for (const fileName of fs.readdirSync(sourceDir).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))) {
  if (!fileName.endsWith('.txt')) continue
  if (excludedFiles.has(fileName)) {
    stats.skippedFiles++
    continue
  }

  stats.sourceFiles++
  const filePath = path.join(sourceDir, fileName)
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  for (const rawLine of content.split(/\r?\n/u)) {
    stats.sourceLines++
    const line = rawLine.trim()
    if (shouldSkipLine(line)) {
      stats.skippedLines++
      continue
    }
    if (looksLikeUrl(line)) {
      stats.skippedUrls++
      continue
    }

    const normalized = normalizePattern(line)
    if (Array.from(normalized).length < 2) {
      stats.skippedShort++
      continue
    }
    if (entries.has(normalized)) {
      stats.duplicateLines++
      continue
    }
    entries.set(normalized, { source: fileName })
  }
}

const words = [...entries.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${words.join('\n')}\n`, 'utf8')

console.log(JSON.stringify({
  outputPath,
  ...stats,
  outputWords: words.length,
  outputBytes: fs.statSync(outputPath).size,
}, null, 2))
