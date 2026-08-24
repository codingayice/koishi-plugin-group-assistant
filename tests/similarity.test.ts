import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateBigramDice, isSimilarByEditDistance, isSimilarText } from '../src/similarity'
import { parseWordlist } from '../src/wordlist-import'

test('Bigram Dice 能识别词组换序', () => {
  const score = calculateBigramDice('加微信领取福利', '领取福利加微信')
  assert.equal(Number(score.toFixed(2)), 0.83)
  assert.equal(isSimilarText('加微信领取福利', '领取福利加微信', {
    dice: 0.75,
    edit: 0.86,
  }), true)
})

test('Bigram Dice 按出现次数计算重复片段', () => {
  assert.equal(calculateBigramDice('aaaa', 'aaa'), 0.8)
})

test('Dice 未命中时由编辑距离识别分散改字', () => {
  const left = '今晚八点群里直播课程记得准时参加'
  const right = '今晚八点群内直播课程记得按时参加'
  assert.ok(calculateBigramDice(left, right) < 0.75)
  assert.equal(isSimilarByEditDistance(left, right, 0.86), true)
  assert.equal(isSimilarText(left, right, { dice: 0.75, edit: 0.86 }), true)
})

test('无关消息不会被判定为相似', () => {
  assert.equal(isSimilarText('今晚八点群里直播课程记得准时参加', '服务器维护完成后请重新登录账号', {
    dice: 0.75,
    edit: 0.86,
  }), false)
})

test('词库解析会过滤注释并按生产归一化规则去重', () => {
  const parsed = parseWordlist('\uFEFF# 说明\n微信返利\n微 信 返 利\n\n!!!\n兼职')
  assert.notEqual(typeof parsed, 'string')
  if (typeof parsed === 'string') return
  assert.deepEqual(parsed.patterns, ['微信返利', '兼职'])
  assert.equal(parsed.readCount, 4)
  assert.equal(parsed.duplicateCount, 1)
  assert.equal(parsed.invalidCount, 1)
})
