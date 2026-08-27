import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const inputPath = resolve(process.argv[2] || 'testdata/data.txt')
const outputDir = dirname(inputPath)
const sourceBase = basename(inputPath, '.txt')
const replayPath = join(outputDir, `${sourceBase}.cleaned.jsonl`)
const uniquePath = join(outputDir, `${sourceBase}.unique.jsonl`)
const annotationPath = join(outputDir, `${sourceBase}.annotation.csv`)
const reportPath = join(outputDir, `${sourceBase}.cleaning-report.md`)

const source = (await readFile(inputPath, 'utf8')).replace(/^\uFEFF/, '')
const lines = source.split(/\r?\n/)
const parsed = parseMessages(lines)
const senderNames = [...new Set(parsed.messages.map((message) => message.sender).filter(Boolean))]
  .sort((left, right) => [...right].length - [...left].length)
const senderAliases = new Map()
const dropCounts = new Map()
const cleaned = []

for (const message of parsed.messages) {
  const prepared = prepareMessage(message, senderNames)
  if (prepared.dropReason) {
    increment(dropCounts, prepared.dropReason)
    continue
  }

  const alias = getSenderAlias(senderAliases, message.sender)
  const anonymized = anonymizeText(prepared.text, senderNames)
  if (!anonymized || anonymized === '<MENTION>') {
    increment(dropCounts, 'empty_after_anonymization')
    continue
  }

  const tags = detectTags(prepared.text)
  cleaned.push({
    id: `m${String(cleaned.length + 1).padStart(6, '0')}`,
    timestamp: message.timestamp,
    user: alias,
    role: normalizeRole(message.level),
    text: anonymized,
    tags,
    sourceLine: message.sourceLine,
  })
}

// QQ 导出的多段记录可能按导出批次拼接，而不是严格按消息时间排列。
// 稳定排序后再编号，确保回放集可直接用于频率、延迟和时序测试。
cleaned.sort((left, right) => {
  const byTime = Date.parse(left.timestamp) - Date.parse(right.timestamp)
  return byTime || left.sourceLine - right.sourceLine
})
cleaned.forEach((message, index) => {
  message.id = `m${String(index + 1).padStart(6, '0')}`
})

const uniqueByText = new Map()
for (const message of cleaned) {
  const key = message.text
  const existing = uniqueByText.get(key)
  if (existing) {
    existing.occurrences += 1
    existing.lastTimestamp = message.timestamp || existing.lastTimestamp
    existing.tags = [...new Set([...existing.tags, ...message.tags])].sort()
    continue
  }

  uniqueByText.set(key, {
    id: `u${String(uniqueByText.size + 1).padStart(6, '0')}`,
    text: message.text,
    tags: [...message.tags],
    occurrences: 1,
    firstTimestamp: message.timestamp,
    lastTimestamp: message.timestamp,
    violation: null,
    category: null,
  })
}

const uniqueMessages = [...uniqueByText.values()]
await Promise.all([
  writeFile(replayPath, toJsonl(cleaned), 'utf8'),
  writeFile(uniquePath, toJsonl(uniqueMessages), 'utf8'),
  writeFile(annotationPath, toAnnotationCsv(uniqueMessages), 'utf8'),
  writeFile(reportPath, createReport({
    inputPath,
    lines,
    parsed,
    cleaned,
    uniqueMessages,
    senderAliases,
    dropCounts,
  }), 'utf8'),
])

process.stdout.write([
  `input=${inputPath}`,
  `parsed_messages=${parsed.messages.length}`,
  `cleaned_messages=${cleaned.length}`,
  `unique_messages=${uniqueMessages.length}`,
  `users=${senderAliases.size}`,
  `replay=${replayPath}`,
  `annotation=${annotationPath}`,
  `report=${reportPath}`,
].join('\n') + '\n')

function parseMessages(inputLines) {
  const messages = []
  const stats = {
    fullHeaders: 0,
    timeOnlyHeaders: 0,
    systemEventLines: 0,
    orphanLines: 0,
  }
  let current = null
  let currentDate = null
  let lastTimeSeconds = null

  const flush = () => {
    if (!current) return
    current.text = current.content.join('\n')
    delete current.content
    messages.push(current)
    current = null
  }

  for (let index = 0; index < inputLines.length; index += 1) {
    const rawLine = inputLines[index]
    const header = parseHeader(rawLine)
    if (header) {
      flush()
      if (header.date) {
        currentDate = parseDateParts(header.date)
        stats.fullHeaders += 1
      } else {
        stats.timeOnlyHeaders += 1
        const seconds = parseTimeSeconds(header.time)
        if (currentDate && lastTimeSeconds != null && lastTimeSeconds - seconds > 12 * 60 * 60) {
          currentDate = addDays(currentDate, 1)
        }
      }
      lastTimeSeconds = parseTimeSeconds(header.time)
      current = {
        sender: cleanSender(header.sender),
        level: header.level,
        timestamp: currentDate ? formatTimestamp(currentDate, header.time) : null,
        sourceLine: index + 1,
        content: [],
      }
      continue
    }

    if (isSystemEvent(rawLine)) {
      stats.systemEventLines += 1
      continue
    }

    if (current) {
      current.content.push(rawLine)
    } else if (rawLine.trim()) {
      stats.orphanLines += 1
    }
  }
  flush()
  return { messages, stats }
}

function parseHeader(line) {
  const full = line.match(/^(?:【(?<level>[^】]+)】)?(?<sender>.*?)\s+(?<date>\d{4}\/\d{1,2}\/\d{1,2})\s+(?<time>\d{1,2}:\d{2}:\d{2})\s*$/u)
  if (full?.groups) return full.groups
  const timeOnly = line.match(/^(?:【(?<level>[^】]+)】)?(?<sender>.*?)\s+(?<time>\d{1,2}:\d{2}:\d{2})\s*$/u)
  return timeOnly?.groups || null
}

function cleanSender(sender) {
  return sender
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .trim() || '<UNKNOWN>'
}

function prepareMessage(message, senderNames) {
  let text = message.text
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .split('\n')
    .filter((line) => !isSystemEvent(line) && !isUnsupportedContent(line.trim()))
    .map((line) => line.replace(/[\t ]+$/gu, ''))
    .join('\n')
    .replace(/^\s+|\s+$/gu, '')
    .replace(/\n{3,}/gu, '\n\n')

  if (!text) return { text: '', dropReason: 'empty_message' }
  if (isBotSender(message.sender)) return { text, dropReason: 'bot_message' }
  if (isUnsupportedContent(text)) return { text, dropReason: 'unsupported_or_attachment' }

  text = stripReplyQuote(text, senderNames)
  if (!text.trim()) return { text: '', dropReason: 'empty_after_quote_cleanup' }
  return { text: text.trim(), dropReason: null }
}

function stripReplyQuote(text, senderNames) {
  const parts = text.split('\n').map((line) => line.trim()).filter(Boolean)
  if (parts.length < 2) return text
  const quotedSender = senderNames.find((sender) => sender !== '<UNKNOWN>' && parts[0] === sender)
  if (!quotedSender) return text

  for (let index = parts.length - 1; index >= 1; index -= 1) {
    if (parts[index].startsWith(`@${quotedSender}`)) return parts.slice(index).join('\n')
  }
  return text
}

function isBotSender(sender) {
  return /^(?:Q?群管家|QQ管家|机器人|群助手)$/iu.test(sender.trim())
}

function isUnsupportedContent(text) {
  const compact = text.trim()
  return compact === '[暂不支持该消息类型，请用手机QQ查看]'
    || compact === '【小程序】请升级最新版本QQ查看'
    || /^\[[^\]]+\]+\s*请使用最新版手机QQ体验新功能$/u.test(compact)
    || /^\[戳一戳\]版本低不支持查看/u.test(compact)
    || /^\[(?:图片|视频|语音|文件|表情|动画表情)\]$/u.test(compact)
    || /^\[.+的聊天记录\]$/u.test(compact)
}

function isSystemEvent(line) {
  const compact = line.trim()
  if (!compact) return false
  return /撤回了.*消息/u.test(compact)
    || /加入本群[。.]?$/u.test(compact)
    || /退出了群聊[。.]?$/u.test(compact)
    || /被(?:管理员)?移出(?:了)?群聊/u.test(compact)
}

function anonymizeText(text, senderNames) {
  let output = text
    .replace(/https?:\/\/[^\s]+/giu, '<URL>')
    .replace(/\bwww\.[^\s]+/giu, '<URL>')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<EMAIL>')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, '<PHONE>')
    .replace(/(?<!\d)\d{6,12}(?!\d)/gu, '<NUMBER_ID>')
    .replace(/(?:微信|微\s*信|薇信|V信|v信|VX|vx)\s*[:：]?\s*[A-Za-z][A-Za-z0-9_-]{5,19}/gu, '<CONTACT>')

  for (const sender of senderNames) {
    if (!sender || sender === '<UNKNOWN>') continue
    const escapedSender = sender.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    output = output.replace(new RegExp(`@\\s*${escapedSender}`, 'gu'), '<MENTION>')
  }
  output = output
    .replace(/@[^\s@]+/gu, '<MENTION>')
    .replace(/@/gu, '<MENTION>')
  output = output
    .split('\n')
    .map((line) => senderNames.includes(line.trim()) ? '<USER_REF>' : line)
    .join('\n')
    .replace(/[\t ]{3,}/gu, '  ')
    .trim()
  return output
}

function detectTags(text) {
  const tags = []
  if (/https?:\/\/|\bwww\./iu.test(text)) tags.push('has_url')
  if (/@[^\s@]+/u.test(text)) tags.push('has_mention')
  if (/(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{6,12}(?!\d)|(?:微信|微\s*信|薇信|V信|v信|VX|vx|QQ|qq|扣扣|企鹅号)/u.test(text)) tags.push('has_contact_signal')
  if (text.includes('\n')) tags.push('multiline')
  if (/\p{Extended_Pictographic}/u.test(text)) tags.push('has_emoji')
  return tags
}

function getSenderAlias(aliases, sender) {
  if (!aliases.has(sender)) aliases.set(sender, `<USER_${String(aliases.size + 1).padStart(4, '0')}>`)
  return aliases.get(sender)
}

function normalizeRole(level) {
  if (/管理员|群主/u.test(level || '')) return 'admin'
  return 'member'
}

function parseDateParts(value) {
  const [year, month, day] = value.split('/').map(Number)
  return { year, month, day }
}

function parseTimeSeconds(value) {
  const [hour, minute, second] = value.split(':').map(Number)
  return hour * 3600 + minute * 60 + second
}

function addDays(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function formatTimestamp(parts, time) {
  const [hour, minute, second] = time.split(':').map((value) => value.padStart(2, '0'))
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${hour}:${minute}:${second}+08:00`
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1)
}

function toJsonl(records) {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n'
}

function toAnnotationCsv(records) {
  const header = ['id', 'text', 'violation', 'category', 'tags', 'occurrences']
  const rows = records.map((record) => [
    record.id,
    record.text,
    '',
    '',
    record.tags.join('|'),
    record.occurrences,
  ])
  return '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

function csvCell(value) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function createReport({ inputPath: sourcePath, lines: sourceLines, parsed: parseResult, cleaned: replay, uniqueMessages: unique, senderAliases: aliases, dropCounts: drops }) {
  const timestampValues = replay.map((message) => message.timestamp).filter(Boolean).sort()
  const duplicateCount = replay.length - unique.length
  const tagCounts = new Map()
  for (const message of replay) {
    for (const tag of message.tags) increment(tagCounts, tag)
  }
  const digest = createHash('sha256').update(source).digest('hex')
  const dropRows = [...drops.entries()].sort((left, right) => right[1] - left[1])
  const tagRows = [...tagCounts.entries()].sort((left, right) => right[1] - left[1])

  return `# QQ 聊天记录清洗报告

- 输入文件：\`${sourcePath}\`
- 输入 SHA-256：\`${digest}\`
- 原始行数：${sourceLines.length}
- 完整日期消息头：${parseResult.stats.fullHeaders}
- 仅时间消息头：${parseResult.stats.timeOnlyHeaders}
- 解析消息数：${parseResult.messages.length}
- 清洗后回放消息数：${replay.length}
- 去重后待标注消息数：${unique.length}
- 精确重复消息数：${duplicateCount}
- 匿名用户数：${aliases.size}
- 时间范围：${timestampValues[0] || '未知'} ～ ${timestampValues.at(-1) || '未知'}
- 系统事件行：${parseResult.stats.systemEventLines}
- 无消息头孤立行：${parseResult.stats.orphanLines}

## 丢弃统计

${dropRows.length ? dropRows.map(([reason, count]) => `- ${reason}: ${count}`).join('\n') : '- 无'}

## 标签统计

${tagRows.length ? tagRows.map(([tag, count]) => `- ${tag}: ${count}`).join('\n') : '- 无'}

## 输出说明

- \`${basename(replayPath)}\`：保留重复消息和时间顺序，用于真实流量回放、调用率与延迟测试。
- \`${basename(uniquePath)}\`：按脱敏后的正文精确去重，用于程序化评测。
- \`${basename(annotationPath)}\`：Excel 可打开的 UTF-8 CSV，用于人工填写 \`violation\` 和 \`category\`。

## 注意事项

- 自动脱敏会替换用户、@、URL、邮箱、手机号和 6～12 位数字 ID，但仍需人工抽查少量样本。
- 去重仅用于内容分类标注；刷屏或频率治理评测应使用保留重复消息的回放集。
- 不要将未经人工检查的原始聊天记录直接发送给外部模型。
`
}
