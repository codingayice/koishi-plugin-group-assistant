import assert from 'node:assert/strict'
import test from 'node:test'
import { createBurstActivity, updateBurstActivity } from '../src/spam-detection'
import { createSustainedRateActivity, updateSustainedRateActivity } from '../src/sustained-rate'
import { resolveSpamDecision } from '../src/spam-policy'
import { parseWordlist } from '../src/wordlist-import'

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

test('垃圾消息模型按置信度分流', () => {
  assert.equal(resolveSpamDecision(0.79, 0.8, 0.98), 'pass')
  assert.equal(resolveSpamDecision(0.9, 0.8, 0.98), 'review')
  assert.equal(resolveSpamDecision(0.99, 0.8, 0.98), 'action')
})
