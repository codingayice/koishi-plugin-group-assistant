import { Context, h } from 'koishi'
import { isUserInAccessList } from './content-moderation'

export function registerEventHandlers(ctx: Context, config: any) {
  // 入群审核
  ctx.on('guild-member-request', async (session) => {
    const guildId = session.guildId || ''
    const userId = session.userId || ''
    if (await isUserInAccessList(ctx, guildId, userId, 'blacklist')) {
      await session.bot.handleGuildRequest(session.messageId, false)
      return
    }

    if (!config.signal) return

    if ((session.content || '').includes(config.signal)) {
      await session.bot.handleGuildRequest(session.messageId, true)
    } else {
      await session.bot.handleGuildRequest(session.messageId, false)
    }
  })

  // 欢迎新成员
  ctx.on('guild-member-added', async (session) => {
    const welcomeMessage = (config.welcomeMessage || '{username}，欢迎加入本群。')
      .replace('{username}', session.username || session.userId || '')
      .replace('{botName}', config.botName || '')
    await session.send(welcomeMessage + h('at', { id: session.userId }))
  })

  // 退群提示
  ctx.on('guild-member-removed', async (session) => {
    await session.send((config.leaveMessage || '{userId} 退出了群聊。').replace('{userId}', session.userId || ''))
  })
}
