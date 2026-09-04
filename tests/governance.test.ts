import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAiReviewRequest, parseAiReviewResult } from '../src/ai-review'
import { detectBehaviorSignals } from '../src/content-moderation'
import { createGcraActivity, updateGcraActivity } from '../src/flood-detection'
import { parseWordlist } from '../src/wordlist-import'
import { getTemplateViolationType } from '../src/moderation-template'

test('处罚提醒模板会显示具体内容类别并提示普通广告甄别', () => {
  assert.equal(getTemplateViolationType({ source: 'content', contentLabel: '欺诈' }), '内容违规：疑似欺诈内容')
  assert.equal(getTemplateViolationType({ source: 'content', contentLabel: '普通广告' }), '内容违规：疑似普通广告内容，请仔细甄别')
  assert.equal(getTemplateViolationType({ source: 'content' }), '内容违规')
  assert.equal(getTemplateViolationType({ source: 'behavior' }), '行为违规')
})

test('生产链路使用结构化 AI 复核请求', () => {
  const request = buildAiReviewRequest({
    model: 'deepseek-v4-flash',
    content: '测试消息',
    patterns: ['违规消息检测模型'],
    evidence: ['违规消息检测模型置信度 85.0%'],
  })

  assert.equal(request.model, 'deepseek-v4-flash')
  assert.equal(request.messages[0].role, 'system')
  assert.match(request.messages[0].content, /先完成 category 分类，再由 category 推导 violation/)
  assert.match(request.messages[0].content, /普通广告：商品、服务、课程、正常招聘、兼职/)
  assert.match(request.messages[0].content, /讨论兼职风险.*不违规；实际发起招募/)
  assert.match(request.messages[1].content, /测试消息/)
  assert.match(request.messages[1].content, /85\.0%/)
})

test('AI 复核结果只接受受约束的 JSON', () => {
  assert.deepEqual(parseAiReviewResult('```json\n{"violation":false,"category":"不违规","reason":"正常讨论"}\n```'), {
    violation: false,
    category: '不违规',
    reason: '正常讨论',
  })
  assert.deepEqual(parseAiReviewResult('{"violation":true,"category":"欺诈","reason":"诱导转账"}'), {
    violation: true,
    category: '欺诈',
    reason: '诱导转账',
  })
  assert.equal(parseAiReviewResult('{"violation":true,"category":"fraud","reason":"旧版本分类"}'), null)
  assert.equal(parseAiReviewResult('{"violation":true,"category":"unknown","reason":"无效类别"}'), null)
  assert.equal(parseAiReviewResult('{"violation":false,"category":"普通广告","reason":"类别不一致"}'), null)
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

test('GCRA 允许配置数量的瞬时消息并拦截下一条', () => {
  let activity = createGcraActivity()
  for (let index = 0; index < 4; index++) {
    activity = updateGcraActivity(activity, 0, 12, 4, 60_000)
    assert.equal(activity.exceeded, false)
  }

  const result = updateGcraActivity(activity, 0, 12, 4, 60_000)
  assert.equal(result.exceeded, true)
  assert.equal(result.triggered, true)
  assert.equal(result.retryAfterMs, 5_000)

  const continued = updateGcraActivity(result, 1_000, 12, 4, 60_000)
  assert.equal(continued.exceeded, true)
  assert.equal(continued.triggered, false)
  assert.equal(continued.theoreticalArrivalTime, result.theoreticalArrivalTime)
})

test('GCRA 能累计略高于长期限制的慢速刷屏', () => {
  let activity = createGcraActivity()
  let firstExceededAt = -1
  for (let now = 0; now <= 80_000; now += 4_000) {
    activity = updateGcraActivity(activity, now, 12, 4, 60_000)
    if (activity.exceeded && firstExceededAt < 0) firstExceededAt = now
  }

  assert.equal(firstExceededAt, 64_000)
})

test('GCRA 允许不超过长期限制的稳定发送', () => {
  let activity = createGcraActivity()
  for (let index = 0; index < 100; index++) {
    activity = updateGcraActivity(activity, index * 5_000, 12, 4, 60_000)
    assert.equal(activity.exceeded, false)
  }
})

test('GCRA 恢复后重新获得完整突发额度', () => {
  let activity = createGcraActivity()
  for (let index = 0; index < 4; index++) {
    activity = updateGcraActivity(activity, 0, 12, 4, 60_000)
  }
  activity = updateGcraActivity(activity, 0, 12, 4, 60_000)
  assert.equal(activity.exceeded, true)

  activity = updateGcraActivity(activity, 60_000, 12, 4, 60_000)
  assert.equal(activity.exceeded, false)
  assert.equal(activity.episodeActive, false)

  for (let index = 0; index < 3; index++) {
    activity = updateGcraActivity(activity, 60_000, 12, 4, 60_000)
    assert.equal(activity.exceeded, false)
  }
  const next = updateGcraActivity(activity, 60_000, 12, 4, 60_000)
  assert.equal(next.exceeded, true)
  assert.equal(next.triggered, true)
})

test('GCRA 处罚冷却期间继续拦截但不重复累计', () => {
  let activity = createGcraActivity()
  let triggeredCount = 0
  let exceededCount = 0
  for (let now = 0; now <= 130_000; now += 1_000) {
    activity = updateGcraActivity(activity, now, 12, 4, 60_000)
    if (activity.exceeded) exceededCount++
    if (activity.triggered) triggeredCount++
  }

  assert.ok(exceededCount > triggeredCount)
  assert.equal(triggeredCount, 3)
})

test('生产行为链路按群和用户隔离 GCRA 状态', () => {
  const activity = new Map()
  const policy = {
    floodRatePerMinute: 15,
    floodBurstAllowance: 8,
    floodCooldownMs: 60_000,
    offenseWindowMs: 86_400_000,
    punishmentLevels: [],
  }
  const session = (guildId: string, userId: string) => ({ guildId, userId }) as any

  for (let index = 0; index < 8; index++) {
    assert.equal(detectBehaviorSignals(session('guild-1', 'user-1'), activity, policy, 0).length, 0)
  }

  const [signal] = detectBehaviorSignals(session('guild-1', 'user-1'), activity, policy, 0)
  assert.equal(signal.code, 'spam_flood')
  assert.equal(signal.action, 'delete')
  assert.equal(signal.countsAsOffense, true)
  assert.equal(signal.writeAudit, true)
  assert.match(signal.evidence, /允许长期 15 条\/分钟/)
  assert.match(signal.evidence, /短时连续 8 条/)
  assert.match(signal.evidence, /虚拟积压 32\.0 秒/)
  assert.match(signal.evidence, /超出容忍 4\.0 秒/)
  assert.match(signal.evidence, /是否新增违规：是/)

  const [continued] = detectBehaviorSignals(session('guild-1', 'user-1'), activity, policy, 0)
  assert.equal(continued.countsAsOffense, false)
  assert.equal(continued.writeAudit, false)
  assert.match(continued.evidence, /是否新增违规：否/)

  assert.equal(detectBehaviorSignals(session('guild-1', 'user-2'), activity, policy, 0).length, 0)
  assert.equal(detectBehaviorSignals(session('guild-2', 'user-1'), activity, policy, 0).length, 0)
})

test('生产行为链路在策略变化后重置旧 GCRA 状态', () => {
  const activity = new Map()
  const session = { guildId: 'guild-1', userId: 'user-1' } as any
  const strictPolicy = {
    floodRatePerMinute: 12,
    floodBurstAllowance: 2,
    floodCooldownMs: 45_000,
    offenseWindowMs: 86_400_000,
    punishmentLevels: [],
  }

  detectBehaviorSignals(session, activity, strictPolicy, 0)
  detectBehaviorSignals(session, activity, strictPolicy, 0)
  assert.equal(detectBehaviorSignals(session, activity, strictPolicy, 0).length, 1)

  const changedPolicy = { ...strictPolicy, floodBurstAllowance: 3 }
  assert.equal(detectBehaviorSignals(session, activity, changedPolicy, 0).length, 0)
})

test('生产行为链路在处罚冷却结束后重新累计违规', () => {
  const activity = new Map()
  const session = { guildId: 'guild-1', userId: 'user-1' } as any
  const policy = {
    floodRatePerMinute: 60,
    floodBurstAllowance: 1,
    floodCooldownMs: 10_000,
    offenseWindowMs: 86_400_000,
    punishmentLevels: [],
  }

  detectBehaviorSignals(session, activity, policy, 0)
  const [first] = detectBehaviorSignals(session, activity, policy, 0)
  const [continued] = detectBehaviorSignals(session, activity, policy, 0)
  assert.equal(first.countsAsOffense, true)
  assert.equal(continued.countsAsOffense, false)

  detectBehaviorSignals(session, activity, policy, 10_000)
  const [nextEpisode] = detectBehaviorSignals(session, activity, policy, 10_000)
  assert.equal(nextEpisode.countsAsOffense, true)
  assert.equal(nextEpisode.writeAudit, true)
})
