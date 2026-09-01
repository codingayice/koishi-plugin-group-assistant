export type ContentLabel =
  | '不违规'
  | '普通广告'
  | '黑产广告'
  | '谩骂引战'
  | '低俗色情'
  | '博彩'
  | '欺诈'

export type ContentProbabilities = Record<ContentLabel, number>

export interface GroupAssistantModelRequest {
  text: string
  sensitiveMatched: boolean
}

export interface CompletedGroupAssistantModelResult {
  status: 'pass' | 'review' | 'action'
  label: ContentLabel
  confidence: number
  violationProbability: number
  probabilities: ContentProbabilities
}

export type GroupAssistantModelResult =
  | { status: 'skipped' }
  | CompletedGroupAssistantModelResult

export interface GroupAssistantModelService {
  evaluate(request: GroupAssistantModelRequest): Promise<GroupAssistantModelResult>
}

declare module 'koishi' {
  interface Context {
    groupAssistantModel?: GroupAssistantModelService
  }
}
