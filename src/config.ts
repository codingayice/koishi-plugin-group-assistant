import { Schema } from 'koishi'

export type ModerationAction = 'warn' | 'delete' | 'mute' | 'kick' | 'silent'
export type PunishmentAction = 'warn' | 'mute' | 'kick'

export interface PunishmentLevelConfig {
  offenseCount?: number
  action?: PunishmentAction
  muteDurationMinutes?: number
  messageTemplate?: string
}

export const DEFAULT_PUNISHMENT_LEVELS: Required<PunishmentLevelConfig>[] = [
  {
    offenseCount: 1,
    action: 'warn',
    muteDurationMinutes: 10,
    messageTemplate: '{at} {type}提醒：{evidence}\n命中关键词：{matched}\n消息内容：{content}\n当前同类违规 {offenseCount} 次。',
  },
  {
    offenseCount: 3,
    action: 'mute',
    muteDurationMinutes: 10,
    messageTemplate: '{at} 因{type}已被禁言 {muteMinutes} 分钟。\n命中关键词：{matched}\n检测证据：{evidence}\n消息内容：{content}\n当前同类违规 {offenseCount} 次。',
  },
  {
    offenseCount: 5,
    action: 'mute',
    muteDurationMinutes: 60,
    messageTemplate: '{at} 因多次{type}已被禁言 {muteMinutes} 分钟。\n命中关键词：{matched}\n检测证据：{evidence}\n消息内容：{content}\n当前同类违规 {offenseCount} 次。',
  },
]

const baseSchema = {
  welcomeMessage: Schema.string()
    .default('{username}，欢迎加入本群，我是群管家 {botName}。')
    .description('入群欢迎信息'),
  leaveMessage: Schema.string()
    .default('{userId} 退出了群聊。')
    .description('退群通知信息'),
  botName: Schema.string()
    .default('')
    .description('机器人名称'),
  signal: Schema.string()
    .default('')
    .description('入群同意暗号'),
  adminUserIds: Schema.array(Schema.string())
    .default([])
    .description('适配器无法识别群管理员时的补充管理员用户 ID'),
}

const moderationSchema = {
  enabled: Schema.boolean()
    .default(true)
    .description('启用群治理'),
  governancePreset: Schema.union([
    Schema.const('relaxed').description('宽松'),
    Schema.const('balanced').description('均衡'),
    Schema.const('strict').description('严格'),
    Schema.const('custom').description('自定义'),
  ])
    .default('balanced')
    .description('治理强度：宽松、均衡、严格或自定义'),
  punishmentLevels: Schema.array(Schema.object({
    offenseCount: Schema.number()
      .required()
      .min(1)
      .max(100)
      .description('达到该同类违规次数后启用本级处罚'),
    action: Schema.union([
      Schema.const('warn').description('警告'),
      Schema.const('mute').description('禁言'),
      Schema.const('kick').description('踢出'),
    ]).required().description('处罚动作'),
    muteDurationMinutes: Schema.number()
      .default(10)
      .min(1)
      .max(10080)
      .description('禁言时长，仅禁言动作生效'),
    messageTemplate: Schema.string()
    .default('')
    .description('提醒模板，留空则不通知；支持 {at}、{type}、{matched}、{evidence}、{content}、{action}、{muteMinutes}、{offenseCount}、{level}'),
  }))
    .default(DEFAULT_PUNISHMENT_LEVELS)
    .max(10)
    .description('累计处罚级别；数组项数量即处罚级数，留空可关闭累计处罚'),
  offenseWindowHours: Schema.number()
    .default(24)
    .min(1)
    .max(168)
    .description('自定义模式下，同类违规累计窗口，单位小时'),
  auditRetentionDays: Schema.number()
    .default(30)
    .min(1)
    .description('治理审计记录保留天数'),
}

const contentDetectionSchema = {
  contentDetectionEnabled: Schema.boolean()
    .default(true)
    .description('启用内容检测；红线词和敏感词在群治理词库页面维护'),
  spamModelEnabled: Schema.boolean()
    .default(false)
    .description('启用本地垃圾消息检测模型'),
  spamModelTrigger: Schema.union([
    Schema.const('sensitive').description('仅敏感词命中时检测'),
    Schema.const('always').description('所有未被立即拦截的消息都检测'),
  ])
    .default('sensitive')
    .description('本地垃圾消息检测模型触发策略'),
  spamModelPath: Schema.string()
    .default('')
    .description('本地垃圾消息检测模型目录，需包含 ONNX 模型和 tokenizer 文件'),
  spamModelReviewThreshold: Schema.number()
    .default(0.8)
    .min(0.5)
    .max(0.99)
    .description('垃圾消息检测模型进入 AI 复核的置信度阈值'),
  spamModelActionThreshold: Schema.number()
    .default(0.98)
    .min(0.5)
    .max(0.999)
    .description('垃圾消息检测模型直接处置的置信度阈值'),
}

const behaviorDetectionSchema = {
  behaviorDetectionEnabled: Schema.boolean()
    .default(true)
    .description('启用行为检测'),
  burstDetectionEnabled: Schema.boolean()
    .default(true)
    .description('启用瞬时刷屏检测'),
  burstWindowSeconds: Schema.number()
    .default(10)
    .min(5)
    .max(60)
    .description('自定义模式下，瞬时刷屏统计窗口，单位秒'),
  burstMessageCount: Schema.number()
    .default(6)
    .min(3)
    .max(20)
    .description('自定义模式下，窗口内达到该消息数时判定刷屏'),
  burstCooldownSeconds: Schema.number()
    .default(60)
    .min(10)
    .max(3600)
    .description('自定义模式下，同一轮刷屏重复拦截的处罚冷却时间，单位秒'),
  burstRecoverySeconds: Schema.number()
    .default(15)
    .min(5)
    .max(300)
    .description('自定义模式下，连续多久未再次达到刷屏阈值后恢复正常，单位秒'),
  sustainedRateDetectionEnabled: Schema.boolean()
    .default(true)
    .description('启用长期发送速率检测'),
  sustainedBucketCapacity: Schema.number()
    .default(30)
    .min(10)
    .max(200)
    .description('自定义模式下，长期速率令牌桶容量，每条消息消耗一个令牌'),
  sustainedRefillPerMinute: Schema.number()
    .default(18)
    .min(1)
    .max(240)
    .description('自定义模式下，长期速率令牌补充速度，单位条/分钟'),
  sustainedConfirmSeconds: Schema.number()
    .default(20)
    .min(5)
    .max(300)
    .description('自定义模式下，令牌耗尽后持续超速多久才确认刷屏，单位秒'),
}

const deepseekSchema = {
  aiReviewEnabled: Schema.boolean()
    .default(false)
    .description('启用敏感规则异步 AI 复核'),
  apiKey: Schema.string()
    .default('')
    .role('secret')
    .description('DeepSeek API Key'),
  model: Schema.union(['deepseek-v4-flash', 'deepseek-v4-pro'] as const)
    .default('deepseek-v4-flash')
    .description('AI 复核模型'),
}

export interface Config {
  base: {
    welcomeMessage?: string
    leaveMessage?: string
    botName?: string
    signal?: string
    adminUserIds?: string[]
  }
  moderation: {
    enabled?: boolean
    governancePreset?: 'relaxed' | 'balanced' | 'strict' | 'custom'
    punishmentLevels?: PunishmentLevelConfig[]
    offenseWindowHours?: number
    auditRetentionDays?: number
  }
  content: {
    contentDetectionEnabled?: boolean
    spamModelEnabled?: boolean
    spamModelTrigger?: 'sensitive' | 'always'
    spamModelPath?: string
    spamModelReviewThreshold?: number
    spamModelActionThreshold?: number
  }
  behavior: {
    behaviorDetectionEnabled?: boolean
    burstDetectionEnabled?: boolean
    burstWindowSeconds?: number
    burstMessageCount?: number
    burstCooldownSeconds?: number
    burstRecoverySeconds?: number
    sustainedRateDetectionEnabled?: boolean
    sustainedBucketCapacity?: number
    sustainedRefillPerMinute?: number
    sustainedConfirmSeconds?: number
  }
  deepseek: {
    aiReviewEnabled?: boolean
    apiKey?: string
    model?: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  }
}

export const ConfigSchema = Schema.object({
  base: Schema.object(baseSchema).description('基础设置'),
  moderation: Schema.object(moderationSchema).description('群治理设置'),
  content: Schema.object(contentDetectionSchema).description('内容检测'),
  behavior: Schema.object(behaviorDetectionSchema).description('行为检测'),
  deepseek: Schema.object(deepseekSchema).description('AI 复核设置'),
})
