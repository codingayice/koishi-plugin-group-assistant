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
    messageTemplate: '{at} {type}提醒：{evidence}\n消息内容：{content}\n当前同类违规 {offenseCount} 次。',
  },
  {
    offenseCount: 3,
    action: 'mute',
    muteDurationMinutes: 10,
    messageTemplate: '{at} 因{type}已被禁言 {muteMinutes} 分钟。\n检测证据：{evidence}\n消息内容：{content}\n当前同类违规 {offenseCount} 次。',
  },
  {
    offenseCount: 5,
    action: 'mute',
    muteDurationMinutes: 60,
    messageTemplate: '{at} 因多次{type}已被禁言 {muteMinutes} 分钟。\n检测证据：{evidence}\n消息内容：{content}\n当前同类违规 {offenseCount} 次。',
  },
]

const baseSchema = {
  guildIds: Schema.array(Schema.string())
    .default([])
    .description('生效群号；留空表示对所有群生效，可通过插件别名创建多套群级配置'),
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
    .description('提醒模板，留空则不通知；支持 {at}、{type}、{evidence}、{content}、{action}、{muteMinutes}、{offenseCount}、{level}'),
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
}

const behaviorDetectionSchema = {
  behaviorDetectionEnabled: Schema.boolean()
    .default(true)
    .description('启用单人刷屏检测'),
  floodRatePerMinute: Schema.number()
    .default(15)
    .min(1)
    .max(240)
    .description('自定义模式下，单个用户允许长期保持的发送速度，单位条/分钟'),
  floodBurstAllowance: Schema.number()
    .default(8)
    .min(1)
    .max(50)
    .description('自定义模式下，单个用户允许短时间连续发送的消息数'),
  floodCooldownSeconds: Schema.number()
    .default(60)
    .min(10)
    .max(3600)
    .description('自定义模式下，同一轮刷屏重复拦截的处罚冷却时间，单位秒'),
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
    guildIds?: string[]
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
  }
  behavior: {
    behaviorDetectionEnabled?: boolean
    floodRatePerMinute?: number
    floodBurstAllowance?: number
    floodCooldownSeconds?: number
  }
  deepseek: {
    aiReviewEnabled?: boolean
    apiKey?: string
    model?: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  }
}

export type FlatConfig = Config['base'] & Config['moderation'] & Config['content'] & Config['behavior'] & Config['deepseek']

export function flattenConfig(config: Config): FlatConfig {
  return {
    ...(config.base || {}),
    ...(config.moderation || {}),
    ...(config.content || {}),
    ...(config.behavior || {}),
    ...(config.deepseek || {}),
  }
}

export function isGuildInScope(config: Pick<FlatConfig, 'guildIds'>, guildId: string) {
  const guildIds = config.guildIds || []
  return guildIds.length === 0 || guildIds.includes(guildId)
}

export const ConfigSchema = Schema.object({
  base: Schema.object(baseSchema).description('基础设置'),
  moderation: Schema.object(moderationSchema).description('群治理设置'),
  content: Schema.object(contentDetectionSchema).description('内容检测'),
  behavior: Schema.object(behaviorDetectionSchema).description('行为检测'),
  deepseek: Schema.object(deepseekSchema).description('AI 复核设置'),
})
