import { Context, h, Logger } from 'koishi'
import { isUserInAccessList } from './content-moderation'
import type { FlatConfig } from './config'

const logger = new Logger('event-handlers')

export function registerEventHandlers(ctx: Context, resolveConfig: (guildId: string) => FlatConfig) {
  // 入群审核
  ctx.on('guild-member-request', async (session) => {
    const guildId = session.guildId || ''
    const userId = session.userId || ''
    const config = resolveConfig(guildId)
    try {
      if (config.enabled === false) {
        logger.debug(`跳过入群审核：群治理已关闭，群 ${guildId}`)
        return
      }
      if (await isUserInAccessList(ctx, guildId, userId, 'blacklist')) {
        await session.bot.handleGuildRequest(session.messageId, false)
        logger.info(`入群申请被黑名单拒绝：群 ${guildId}，用户 ${userId}`)
        return
      }

      if (!config.signal) {
        logger.debug(`入群申请未配置暗号，跳过自动审核：群 ${guildId}，用户 ${userId}`)
        return
      }

      const approved = (session.content || '').includes(config.signal)
      await session.bot.handleGuildRequest(session.messageId, approved)
      logger.info(`入群申请已处理：群 ${guildId}，用户 ${userId}，结果 ${approved ? '同意' : '拒绝'}`)
    } catch (err) {
      logger.error(`处理入群申请失败：群 ${guildId}，用户 ${userId}，${err}`)
    }
  })

  // 欢迎新成员
  ctx.on('guild-member-added', async (session) => {
    try {
      const config = resolveConfig(session.guildId || '')
      if (config.enabled === false) return
      const welcomeMessage = (config.welcomeMessage || '{username}，欢迎加入本群。')
        .replace('{username}', session.username || session.userId || '')
        .replace('{botName}', config.botName || '')
      await session.send(welcomeMessage + h('at', { id: session.userId }))
      logger.info(`已发送入群欢迎：群 ${session.guildId || ''}，用户 ${session.userId || ''}`)
    } catch (err) {
      logger.error(`发送入群欢迎失败：群 ${session.guildId || ''}，用户 ${session.userId || ''}，${err}`)
    }
  })

  // 退群提示
  ctx.on('guild-member-removed', async (session) => {
    try {
      const config = resolveConfig(session.guildId || '')
      if (config.enabled === false) return
      await session.send((config.leaveMessage || '{userId} 退出了群聊。').replace('{userId}', session.userId || ''))
      logger.info(`已发送退群提示：群 ${session.guildId || ''}，用户 ${session.userId || ''}`)
    } catch (err) {
      logger.error(`发送退群提示失败：群 ${session.guildId || ''}，用户 ${session.userId || ''}，${err}`)
    }
  })
}
