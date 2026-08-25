import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateBigramDice, isSimilarByEditDistance, isSimilarText } from '../src/similarity'
import { createBurstActivity, updateBurstActivity } from '../src/spam-detection'
import { createSustainedRateActivity, updateSustainedRateActivity } from '../src/sustained-rate'
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

test('刷屏同一轮只产生一次处罚触发', () => {
  let activity = createBurstActivity()
  activity = updateBurstActivity(activity, 0, 10_000, 3, 60_000, 15_000)
  activity = updateBurstActivity(activity, 1_000, 10_000, 3, 60_000, 15_000)
  const result = updateBurstActivity(activity, 2_000, 10_000, 3, 60_000, 15_000)

  assert.equal(result.thresholdReached, true)
  assert.equal(result.triggered, true)

  const continued = updateBurstActivity(result, 3_000, 10_000, 3, 60_000, 15_000)
  assert.equal(continued.thresholdReached, true)
  assert.equal(continued.triggered, false)
  assert.equal(continued.state, 'active')
})

test('冷却期间再次刷屏只拦截，不重复处罚', () => {
  let activity = createBurstActivity()
  activity = updateBurstActivity(activity, 0, 10_000, 3, 60_000, 15_000)
  activity = updateBurstActivity(activity, 1_000, 10_000, 3, 60_000, 15_000)
  activity = updateBurstActivity(activity, 2_000, 10_000, 3, 60_000, 15_000)
  activity = updateBurstActivity(activity, 20_000, 10_000, 3, 60_000, 15_000)
  activity = updateBurstActivity(activity, 21_000, 10_000, 3, 60_000, 15_000)
  const result = updateBurstActivity(activity, 22_000, 10_000, 3, 60_000, 15_000)

  assert.equal(result.thresholdReached, true)
  assert.equal(result.triggered, false)
  assert.equal(result.state, 'active')
})

test('恢复并结束冷却后可以开启新一轮处罚', () => {
  let activity = createBurstActivity()
  activity = updateBurstActivity(activity, 0, 10_000, 3, 60_000, 15_000)
  activity = updateBurstActivity(activity, 1_000, 10_000, 3, 60_000, 15_000)
  activity = updateBurstActivity(activity, 2_000, 10_000, 3, 60_000, 15_000)
  activity = updateBurstActivity(activity, 20_000, 10_000, 3, 60_000, 15_000)
  activity = updateBurstActivity(activity, 63_000, 10_000, 3, 60_000, 15_000)
  activity = updateBurstActivity(activity, 64_000, 10_000, 3, 60_000, 15_000)
  const result = updateBurstActivity(activity, 65_000, 10_000, 3, 60_000, 15_000)

  assert.equal(result.thresholdReached, true)
  assert.equal(result.triggered, true)
  assert.equal(result.state, 'active')
})

test('持续高频发送会在冷却结束后再次累计违规', () => {
  let activity = createBurstActivity()
  let triggeredCount = 0
  for (let index = 0; index < 70; index++) {
    activity = updateBurstActivity(activity, index * 2_000, 10_000, 3, 60_000, 15_000)
    if (activity.triggered) triggeredCount++
  }

  assert.equal(triggeredCount, 3)
  assert.equal(activity.state, 'active')
})

test('长期令牌桶允许初始突发并确认持续超速', () => {
  let activity = createSustainedRateActivity(3, 0)
  activity = updateSustainedRateActivity(activity, 0, 3, 6, 5_000)
  activity = updateSustainedRateActivity(activity, 1_000, 3, 6, 5_000)
  activity = updateSustainedRateActivity(activity, 2_000, 3, 6, 5_000)
  activity = updateSustainedRateActivity(activity, 3_000, 3, 6, 5_000)

  assert.equal(activity.overLimit, true)
  assert.equal(activity.confirmed, false)

  const confirmed = updateSustainedRateActivity(activity, 8_000, 3, 6, 5_000)
  assert.equal(confirmed.overLimit, true)
  assert.equal(confirmed.confirmed, true)
})

test('长期速率停止后令牌恢复并结束超速状态', () => {
  let activity = createSustainedRateActivity(3, 0)
  activity = updateSustainedRateActivity(activity, 0, 3, 6, 5_000)
  activity = updateSustainedRateActivity(activity, 1_000, 3, 6, 5_000)
  activity = updateSustainedRateActivity(activity, 2_000, 3, 6, 5_000)
  activity = updateSustainedRateActivity(activity, 3_000, 3, 6, 5_000)
  activity = updateSustainedRateActivity(activity, 8_000, 3, 6, 5_000)

  const recovered = updateSustainedRateActivity(activity, 60_000, 3, 6, 5_000)
  assert.equal(recovered.overLimit, false)
  assert.equal(recovered.confirmed, false)
  assert.equal(recovered.overLimitSince, 0)
})
