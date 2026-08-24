export const WORDLIST_IMPORT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxLines: 100_000,
  maxPatternLength: 200,
} as const

export interface ParsedWordlist {
  patterns: string[]
  readCount: number
  duplicateCount: number
  invalidCount: number
}

export function parseWordlist(content: string): ParsedWordlist | string {
  if (getByteLength(content) > WORDLIST_IMPORT_LIMITS.maxBytes) {
    return `词库文件不能超过 ${formatBytes(WORDLIST_IMPORT_LIMITS.maxBytes)}。`
  }

  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines.length > WORDLIST_IMPORT_LIMITS.maxLines) {
    return `词库文件不能超过 ${WORDLIST_IMPORT_LIMITS.maxLines} 行。`
  }

  const patterns: string[] = []
  const seen = new Set<string>()
  let readCount = 0
  let duplicateCount = 0
  let invalidCount = 0

  for (const line of lines) {
    const pattern = line.trim()
    if (!pattern || pattern.startsWith('#')) continue
    readCount += 1

    if (Array.from(pattern).length > WORDLIST_IMPORT_LIMITS.maxPatternLength) {
      invalidCount += 1
      continue
    }

    const normalized = normalizeWordlistPattern(pattern)
    if (!normalized) {
      invalidCount += 1
      continue
    }
    if (seen.has(normalized)) {
      duplicateCount += 1
      continue
    }

    seen.add(normalized)
    patterns.push(pattern)
  }

  return { patterns, readCount, duplicateCount, invalidCount }
}

export function normalizeWordlistPattern(pattern: string) {
  let normalized = pattern
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .toLowerCase()
  normalized = normalized.replace(/薇信|微\s*信|v\s*x|v\s*信/gi, '微信')
  normalized = normalized.replace(/扣扣|企鹅号/gi, 'qq')
  normalized = normalized.replace(/\s+/gu, '')
  normalized = normalized.replace(/[\p{P}\p{S}]/gu, '')
  return normalized.replace(/(.)\1{2,}/gu, '$1$1')
}

function getByteLength(content: string) {
  return new TextEncoder().encode(content).byteLength
}

function formatBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}
