import { Context, Logger } from 'koishi'
import { Config, ConfigSchema, flattenConfig, resolveGroupConfig } from './config'
import { registerEventHandlers } from './event-handlers'
import { registerContentModeration } from './content-moderation'

export const name = 'group-assistant'
export const inject = ['database', 'http']
export { ConfigSchema as Config }

const logger = new Logger('group-assistant')

export function apply(ctx: Context, config: Config) {
  const flatConfig = flattenConfig(config)
  const resolveConfig = (guildId: string) => resolveGroupConfig(config, guildId)
  logger.info(`插件初始化：治理${flatConfig.enabled === false ? '关闭' : '开启'}，内容检测${flatConfig.contentDetectionEnabled === false ? '关闭' : '开启'}，行为检测${flatConfig.behaviorDetectionEnabled === false ? '关闭' : '开启'}，预设 ${flatConfig.governancePreset || 'balanced'}，AI 复核${flatConfig.aiReviewEnabled ? '开启' : '关闭'}，模型 ${flatConfig.model || 'deepseek-v4-flash'}`)
  registerEventHandlers(ctx, resolveConfig)
  registerContentModeration(ctx, resolveConfig, flatConfig, (config.groupConfigs || []).map((item) => item.guildId))
  ctx.on('dispose', () => logger.info('插件已销毁'))
}
