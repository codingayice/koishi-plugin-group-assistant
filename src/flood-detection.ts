export interface GcraActivity {
  theoreticalArrivalTime: number
  episodeActive: boolean
  lastTriggeredAt: number | null
}

export interface GcraDetectionResult extends GcraActivity {
  exceeded: boolean
  triggered: boolean
  retryAfterMs: number
  virtualDebtMs: number
}

export function createGcraActivity(): GcraActivity {
  return {
    theoreticalArrivalTime: 0,
    episodeActive: false,
    lastTriggeredAt: null,
  }
}

/**
 * Applies GCRA to one user's message stream.
 *
 * Accepted messages reserve one emission interval on a virtual timeline.
 * Messages arriving earlier than the configured burst tolerance are rejected.
 * Rejected messages do not advance the timeline, so an attacker cannot extend
 * the recovery period indefinitely by continuing to send messages.
 */
export function updateGcraActivity(
  activity: GcraActivity,
  now: number,
  ratePerMinute: number,
  burstAllowance: number,
  cooldownMs: number,
): GcraDetectionResult {
  const intervalMs = 60_000 / Math.max(1, ratePerMinute)
  const toleranceMs = Math.max(0, burstAllowance - 1) * intervalMs
  const previousTat = activity.theoreticalArrivalTime || now
  const recovered = now >= previousTat
  const episodeActive = recovered ? false : activity.episodeActive
  const earliestAllowedAt = previousTat - toleranceMs
  const exceeded = now < earliestAllowedAt

  if (exceeded) {
    const triggered = activity.lastTriggeredAt === null || now - activity.lastTriggeredAt >= cooldownMs
    return {
      theoreticalArrivalTime: previousTat,
      episodeActive: true,
      lastTriggeredAt: triggered ? now : activity.lastTriggeredAt,
      exceeded: true,
      triggered,
      retryAfterMs: Math.ceil(earliestAllowedAt - now),
      virtualDebtMs: Math.ceil(previousTat - now),
    }
  }

  return {
    theoreticalArrivalTime: Math.max(now, previousTat) + intervalMs,
    episodeActive,
    lastTriggeredAt: activity.lastTriggeredAt,
    exceeded: false,
    triggered: false,
    retryAfterMs: 0,
    virtualDebtMs: Math.max(0, Math.ceil(previousTat - now)),
  }
}
