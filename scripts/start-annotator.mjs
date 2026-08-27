#!/usr/bin/env node

import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(rootDir, 'tools', 'annotator')
const dataPath = resolve(rootDir, getArgument('--data') || 'testdata/data.unique.jsonl')
const progressPath = resolve(rootDir, getArgument('--progress') || 'testdata/data.annotation-progress.json')
const host = '127.0.0.1'
const port = parsePort(getArgument('--port') || '4173')
const samples = await loadJsonl(dataPath)
const sampleIds = new Set(samples.map((sample) => sample.id))
let annotations = await loadAnnotations(progressPath, sampleIds)
let saveQueue = Promise.resolve()

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${host}:${port}`)

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { ok: true, samples: samples.length })
    }

    if (request.method === 'GET' && url.pathname === '/api/dataset') {
      return sendJson(response, 200, {
        source: basename(dataPath),
        samples,
        annotations,
        stats: countAnnotations(samples, annotations),
      })
    }

    if (request.method === 'POST' && url.pathname === '/api/annotation') {
      const body = await readJsonBody(request)
      const id = typeof body.id === 'string' ? body.id : ''
      const status = typeof body.status === 'string' ? body.status : ''
      if (!sampleIds.has(id)) return sendJson(response, 404, { error: '样本不存在。' })
      if (!['violation', 'normal', 'skipped', 'unlabeled'].includes(status)) {
        return sendJson(response, 400, { error: '标注状态无效。' })
      }

      if (status === 'unlabeled') {
        delete annotations[id]
      } else {
        annotations[id] = { status, updatedAt: new Date().toISOString() }
      }
      await persistAnnotations()
      return sendJson(response, 200, { ok: true, stats: countAnnotations(samples, annotations) })
    }

    if (request.method === 'POST' && url.pathname === '/api/export') {
      const result = await exportAnnotations()
      return sendJson(response, 200, { ok: true, ...result })
    }

    if (request.method === 'GET' && url.pathname === '/api/progress') {
      return sendJson(response, 200, countAnnotations(samples, annotations))
    }

    if (request.method === 'GET') return serveStatic(url.pathname, response)
    return sendJson(response, 404, { error: '接口不存在。' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(response, 500, { error: message })
  }
})

server.listen(port, host, () => {
  process.stdout.write([
    '',
    '群聊内容标注台已启动',
    `地址：http://${host}:${port}`,
    `数据：${dataPath}`,
    `进度：${progressPath}`,
    '按 Ctrl+C 停止服务。',
    '',
  ].join('\n'))
})

process.on('SIGINT', () => server.close(() => process.exit(0)))
process.on('SIGTERM', () => server.close(() => process.exit(0)))

function getArgument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function parsePort(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`端口无效：${value}`)
  }
  return parsed
}

async function loadJsonl(path) {
  const content = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')
  const records = content.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`数据文件第 ${index + 1} 行不是有效 JSON。`)
    }
  })
  if (!records.length) throw new Error('数据文件没有可标注样本。')
  if (records.some((record) => typeof record.id !== 'string' || typeof record.text !== 'string')) {
    throw new Error('数据文件必须包含字符串类型的 id 和 text 字段。')
  }
  return records
}

async function loadAnnotations(path, ids) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([id, value]) => {
      return ids.has(id)
        && value
        && typeof value === 'object'
        && ['violation', 'normal', 'skipped'].includes(value.status)
    }))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw new Error(`无法读取标注进度：${error}`)
  }
}

function persistAnnotations() {
  const snapshot = JSON.stringify(annotations, null, 2) + '\n'
  saveQueue = saveQueue.then(async () => {
    await mkdir(dirname(progressPath), { recursive: true })
    await writeFile(progressPath, snapshot, 'utf8')
  })
  return saveQueue
}

async function exportAnnotations() {
  const stem = basename(dataPath).replace(/(?:\.unique)?\.jsonl$/i, '')
  const jsonlPath = join(dirname(dataPath), `${stem}.annotated.jsonl`)
  const csvPath = join(dirname(dataPath), `${stem}.annotated.csv`)
  const records = samples.map((sample) => ({
    ...sample,
    violation: toViolation(annotations[sample.id]?.status),
  }))
  const jsonl = records.map((record) => JSON.stringify(record)).join('\n') + '\n'
  const header = ['id', 'text', 'violation', 'category', 'tags', 'occurrences']
  const rows = records.map((record) => [
    record.id,
    record.text,
    record.violation ?? '',
    record.category ?? '',
    Array.isArray(record.tags) ? record.tags.join('|') : '',
    record.occurrences ?? 1,
  ])
  const csv = '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  await Promise.all([
    writeFile(jsonlPath, jsonl, 'utf8'),
    writeFile(csvPath, csv, 'utf8'),
  ])
  return {
    jsonlPath,
    csvPath,
    stats: countAnnotations(samples, annotations),
  }
}

function toViolation(status) {
  if (status === 'violation') return true
  if (status === 'normal') return false
  return null
}

function csvCell(value) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function countAnnotations(records, labels) {
  const stats = { total: records.length, violation: 0, normal: 0, skipped: 0, todo: 0 }
  for (const sample of records) {
    const status = labels[sample.id]?.status
    if (status === 'violation') stats.violation += 1
    else if (status === 'normal') stats.normal += 1
    else if (status === 'skipped') stats.skipped += 1
    else stats.todo += 1
  }
  stats.labeled = stats.violation + stats.normal
  return stats
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('请求内容过大。')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

async function serveStatic(pathname, response) {
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
  const filePath = resolve(publicDir, requested)
  if (filePath !== publicDir && !filePath.startsWith(publicDir + sep)) {
    return sendJson(response, 403, { error: '禁止访问。' })
  }
  try {
    const content = await readFile(filePath)
    response.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(content)
  } catch (error) {
    if (error?.code === 'ENOENT') return sendJson(response, 404, { error: '页面不存在。' })
    throw error
  }
}

function contentType(path) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  }
  return types[extname(path).toLowerCase()] || 'application/octet-stream'
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(data))
}
