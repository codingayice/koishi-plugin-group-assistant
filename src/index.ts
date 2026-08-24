import { Context } from 'koishi'
import { Config, ConfigSchema } from './config'
import { registerEventHandlers } from './event-handlers'
import { registerContentModeration } from './content-moderation'

export const name = 'group-assistant'
export const inject = ['database', 'http']
export { ConfigSchema as Config }

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
  registerEventHandlers(ctx, flatConfig)
  registerContentModeration(ctx, flatConfig)
}
