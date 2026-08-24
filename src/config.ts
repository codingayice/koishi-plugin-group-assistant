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
    messageTemplate: '{at} 因【{reason}】受到警告，当前同类违规 {offenseCount} 次。',
  },
  {
    offenseCount: 3,
    action: 'mute',
    muteDurationMinutes: 10,
    messageTemplate: '{at} 因【{reason}】已被禁言 {muteMinutes} 分钟，当前同类违规 {offenseCount} 次。',
  },
  {
    offenseCount: 5,
    action: 'mute',
    muteDurationMinutes: 60,
    messageTemplate: '{at} 因多次【{reason}】已被禁言 {muteMinutes} 分钟，当前同类违规 {offenseCount} 次。',
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
      .description('提醒模板，留空则不通知；支持 {at}、{reason}、{action}、{muteMinutes}、{offenseCount}、{level}'),
  }))
    .default(DEFAULT_PUNISHMENT_LEVELS)
    .max(10)
    .description('累计处罚级别；数组项数量即处罚级数，留空可关闭累计处罚'),
  offenseWindowHours: Schema.number()
    .default(24)
    .min(1)
    .max(168)
    .description('自定义模式下，同类违规累计窗口，单位小时'),
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
  similarDetectionEnabled: Schema.boolean()
    .default(true)
    .description('启用相似复读检测'),
  similarWindowMinutes: Schema.number()
    .default(60)
    .min(10)
    .max(1440)
    .description('自定义模式下，相似消息统计窗口，单位分钟'),
  similarMessageCount: Schema.number()
    .default(3)
    .min(2)
    .max(10)
    .description('自定义模式下，达到该相似消息数时判定复读'),
  similarityThreshold: Schema.number()
    .default(0.86)
    .min(0.75)
    .max(0.95)
    .step(0.01)
    .role('slider')
    .description('自定义模式下，编辑距离相似度阈值'),
  diceSimilarityThreshold: Schema.number()
    .default(0.75)
    .min(0.6)
    .max(0.95)
    .step(0.01)
    .role('slider')
    .description('自定义模式下，字符 Bigram Dice 相似度阈值'),
  similarMinLength: Schema.number()
    .default(10)
    .min(4)
    .max(50)
    .description('自定义模式下，参与相似检测的最短文本长度'),
  auditRetentionDays: Schema.number()
    .default(30)
    .min(1)
    .description('治理审计记录保留天数'),
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
    burstDetectionEnabled?: boolean
    burstWindowSeconds?: number
    burstMessageCount?: number
    similarDetectionEnabled?: boolean
    similarWindowMinutes?: number
    similarMessageCount?: number
    similarityThreshold?: number
    diceSimilarityThreshold?: number
    similarMinLength?: number
    auditRetentionDays?: number
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
  deepseek: Schema.object(deepseekSchema).description('AI 复核设置'),
})
