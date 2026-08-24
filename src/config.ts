import { Schema } from 'koishi'

export type ModerationAction = 'warn' | 'delete' | 'mute' | 'kick' | 'silent'

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
  shortMuteMinutes: Schema.number()
    .default(10)
    .min(1)
    .description('同类违规累计 3 次后的禁言时长，单位分钟'),
  longMuteMinutes: Schema.number()
    .default(60)
    .min(1)
    .description('同类违规累计 5 次后的禁言时长，单位分钟'),
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
    shortMuteMinutes?: number
    longMuteMinutes?: number
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
