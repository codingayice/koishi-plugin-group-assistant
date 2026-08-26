export type SpamDecision = 'pass' | 'review' | 'action'

export function resolveSpamDecision(
  spamProbability: number,
  reviewThreshold: number,
  actionThreshold: number,
): SpamDecision {
  if (spamProbability >= Math.max(reviewThreshold, actionThreshold)) return 'action'
  if (spamProbability >= reviewThreshold) return 'review'
  return 'pass'
}
