import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import * as ort from 'onnxruntime-node'
import type { SpamModelResult } from './spam-model-types'

export class SpamClassifier {
  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly tokenizer: BertTokenizer,
    private readonly spamIndex: number,
  ) {}

  static async load(modelPath: string) {
    const files = await resolveModelFiles(modelPath)
    const [configText, vocabText] = await Promise.all([
      readFile(files.configFile, 'utf8'),
      readFile(files.vocabFile, 'utf8'),
    ])
    const config = JSON.parse(configText) as { id2label?: Record<string, string> }
    const labels = config.id2label || {}
    const spamEntry = Object.entries(labels).find(([, label]) => label.toLowerCase() === 'spam')
    const spamIndex = spamEntry ? Number(spamEntry[0]) : 1
    if (!Number.isInteger(spamIndex) || spamIndex < 0) {
      throw new Error('模型配置中没有有效的 spam 标签。')
    }

    const session = await ort.InferenceSession.create(files.modelFile)
    const tokenizer = new BertTokenizer(vocabText)
    return new SpamClassifier(session, tokenizer, spamIndex)
  }

  async classify(text: string): Promise<SpamModelResult> {
    const encoded = this.tokenizer.encode(text)
    const feeds: Record<string, ort.Tensor> = {}
    for (const name of this.session.inputNames) {
      if (name === 'input_ids') {
        feeds[name] = createInt64Tensor(encoded.inputIds)
      } else if (name === 'attention_mask') {
        feeds[name] = createInt64Tensor(encoded.attentionMask)
      } else if (name === 'token_type_ids' || name === 'segment_ids') {
        feeds[name] = createInt64Tensor(encoded.tokenTypeIds)
      } else if (name === 'position_ids') {
        feeds[name] = createInt64Tensor(encoded.inputIds.map((_, index) => index))
      } else {
        throw new Error(`模型包含未支持的输入：${name}`)
      }
    }

    const outputName = this.session.outputNames[0]
    if (!outputName) throw new Error('模型没有可用的输出。')
    const outputs = await this.session.run(feeds)
    const output = outputs[outputName]
    if (!output) throw new Error(`模型输出不存在：${outputName}`)
    const logits = Array.from(output.data as ArrayLike<number | bigint>).map(Number)
    if (logits.length <= this.spamIndex) throw new Error('模型输出维度不足，无法读取 spam 标签。')

    const probabilities = softmax(logits)
    return {
      label: this.spamIndex === 1 ? 'spam' : `class_${this.spamIndex}`,
      spamProbability: probabilities[this.spamIndex],
    }
  }
}

export class SpamClassifierManager {
  private classifier: SpamClassifier | null = null
  private classifierPath = ''
  private loading: Promise<SpamClassifier> | null = null

  async classify(text: string, modelPath: string) {
    const normalizedPath = resolve(modelPath.trim())
    if (this.classifier && this.classifierPath !== normalizedPath) {
      this.classifier = null
    }
    if (!this.classifier) {
      this.loading ??= SpamClassifier.load(normalizedPath).then((classifier) => {
        this.classifier = classifier
        this.classifierPath = normalizedPath
        return classifier
      }).finally(() => {
        this.loading = null
      })
      this.classifier = await this.loading
    }
    return this.classifier.classify(text)
  }

  dispose() {
    this.classifier = null
    this.classifierPath = ''
    this.loading = null
  }
}

interface EncodedInput {
  inputIds: number[]
  attentionMask: number[]
  tokenTypeIds: number[]
}

class BertTokenizer {
  private readonly vocabulary = new Map<string, number>()
  private readonly unknownToken = '[UNK]'
  private readonly maxLength = 512

  constructor(vocabText: string) {
    for (const [index, token] of vocabText.split(/\r?\n/).entries()) {
      if (token) this.vocabulary.set(token, index)
    }
    if (!this.vocabulary.has('[CLS]') || !this.vocabulary.has('[SEP]') || !this.vocabulary.has(this.unknownToken)) {
      throw new Error('vocab.txt 缺少 [CLS]、[SEP] 或 [UNK] token。')
    }
  }

  encode(text: string): EncodedInput {
    const pieces = this.basicTokenize(text)
    const tokens = [
      '[CLS]',
      ...pieces.slice(0, this.maxLength - 2),
      '[SEP]',
    ]
    const inputIds = tokens.map((token) => this.vocabulary.get(token) ?? this.vocabulary.get(this.unknownToken)!)
    return {
      inputIds,
      attentionMask: inputIds.map(() => 1),
      tokenTypeIds: inputIds.map(() => 0),
    }
  }

  private basicTokenize(text: string) {
    const normalized = text.normalize('NFKC').toLowerCase()
    const tokens: string[] = []
    let buffer = ''
    const flush = () => {
      if (!buffer) return
      tokens.push(...this.wordPieceTokenize(buffer))
      buffer = ''
    }

    for (const character of normalized) {
      if (/\s/u.test(character)) {
        flush()
      } else if (isControl(character)) {
        continue
      } else if (isChineseCharacter(character) || /[\p{P}\p{S}]/u.test(character)) {
        flush()
        tokens.push(...this.wordPieceTokenize(character))
      } else {
        buffer += character
      }
    }
    flush()
    return tokens
  }

  private wordPieceTokenize(word: string) {
    if (this.vocabulary.has(word)) return [word]
    const characters = [...word]
    const pieces: string[] = []
    let start = 0
    while (start < characters.length) {
      let end = characters.length
      let matched: string | null = null
      while (start < end) {
        const fragment = characters.slice(start, end).join('')
        const candidate = start === 0 ? fragment : `##${fragment}`
        if (this.vocabulary.has(candidate)) {
          matched = candidate
          break
        }
        end -= 1
      }
      if (!matched) return [this.unknownToken]
      pieces.push(matched)
      start = end
    }
    return pieces
  }
}

async function resolveModelFiles(modelPath: string) {
  const inputPath = resolve(modelPath.trim())
  let modelRoot = inputPath
  try {
    if ((await stat(inputPath)).isFile()) modelRoot = dirname(inputPath)
  } catch {
    throw new Error(`找不到垃圾消息检测模型路径：${inputPath}`)
  }

  const modelFile = extname(inputPath).toLowerCase() === '.onnx'
    ? inputPath
    : await findFirstExisting(modelRoot, ['model_optimized.onnx', 'model.onnx'])
  const configFile = join(modelRoot, 'config.json')
  const vocabFile = join(modelRoot, 'vocab.txt')
  await Promise.all([stat(modelFile), stat(configFile), stat(vocabFile)])
  return { modelFile, configFile, vocabFile }
}

async function findFirstExisting(root: string, filenames: string[]) {
  for (const filename of filenames) {
    const candidate = join(root, filename)
    try {
      await stat(candidate)
      return candidate
    } catch {
      continue
    }
  }
  throw new Error(`模型目录中未找到 ONNX 文件：${root}`)
}

function createInt64Tensor(values: number[]) {
  return new ort.Tensor('int64', BigInt64Array.from(values, BigInt), [1, values.length])
}

function softmax(logits: number[]) {
  const maximum = Math.max(...logits)
  const exponentials = logits.map((value) => Math.exp(value - maximum))
  const total = exponentials.reduce((sum, value) => sum + value, 0)
  return exponentials.map((value) => value / total)
}

function isChineseCharacter(character: string) {
  const codePoint = character.codePointAt(0) || 0
  return (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x20000 && codePoint <= 0x2a6df)
}

function isControl(character: string) {
  return /[\u0000-\u001f\u007f]/u.test(character) && !/\s/u.test(character)
}
