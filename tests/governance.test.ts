import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAiReviewRequest, parseAiReviewResult } from '../src/ai-review'
import { createBurstActivity, updateBurstActivity } from '../src/spam-detection'
import { createSustainedRateActivity, updateSustainedRateActivity } from '../src/sustained-rate'
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
