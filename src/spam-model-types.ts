export interface GroupAssistantModelRequest {
  text: string
  sensitiveMatched: boolean
}

export interface CompletedGroupAssistantModelResult {
  status: 'pass' | 'review' | 'action'
  label: string
  spamProbability: number
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
