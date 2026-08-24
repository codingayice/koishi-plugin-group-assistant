import { Context, Logger } from 'koishi'
import { Config, ConfigSchema } from './config'
import { registerEventHandlers } from './event-handlers'
import { registerContentModeration } from './content-moderation'

export const name = 'group-assistant'
export const inject = ['database', 'http']
export { ConfigSchema as Config }

const logger = new Logger('group-assistant')

// 拍平成扁平 config，便于各功能直接访问字段
function flattenConfig(config: Config) {
  return {
    ...config.base,
    ...config.moderation,
    ...config.deepseek,
  }
}

export function apply(ctx: Context, config: Config) {
  const flatConfig = flattenConfig(config)
  logger.info(`插件初始化：治理${flatConfig.enabled === false ? '关闭' : '开启'}，预设 ${flatConfig.governancePreset || 'balanced'}，AI 复核${flatConfig.aiReviewEnabled ? '开启' : '关闭'}，模型 ${flatConfig.model || 'deepseek-v4-flash'}`)
  registerEventHandlers(ctx, flatConfig)
  registerContentModeration(ctx, flatConfig)
  ctx.on('dispose', () => logger.info('插件已销毁'))
}
