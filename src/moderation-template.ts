export type ModerationTemplateSource = 'content' | 'behavior' | 'access' | 'manual'

export function getTemplateViolationType(input: {
  source: ModerationTemplateSource
  contentLabel?: string
}) {
  if (input.source !== 'content' || !input.contentLabel) {
    return input.source === 'content' ? '内容违规' : '行为违规'
  }
  const caution = input.contentLabel === '普通广告' ? '，请仔细甄别' : ''
  return `内容违规：疑似${input.contentLabel}内容${caution}`
}
