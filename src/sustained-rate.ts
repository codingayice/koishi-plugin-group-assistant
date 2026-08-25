export interface SustainedRateActivity {
  tokens: number
  lastRefillAt: number
  overLimitSince: number
  lastTriggeredAt: number
}

export interface SustainedRateResult extends SustainedRateActivity {
  overLimit: boolean
  confirmed: boolean
}

export function createSustainedRateActivity(capacity: number, now: number): SustainedRateActivity {
  return {
    tokens: capacity,
    lastRefillAt: now,
    overLimitSince: 0,
    lastTriggeredAt: 0,
  }
}

/**
 * Consumes one token and confirms sustained over-limit traffic only after it
 * remains over the long-term rate for the configured confirmation period.
 */
export function updateSustainedRateActivity(
  activity: SustainedRateActivity,
  now: number,
  capacity: number,
  refillPerMinute: number,
  confirmMs: number,
): SustainedRateResult {
  const elapsed = Math.max(0, now - activity.lastRefillAt)
  const refilled = elapsed * refillPerMinute / 60_000
  const tokens = Math.min(capacity, activity.tokens + refilled)

  if (tokens >= 1) {
    return {
      tokens: tokens - 1,
      lastRefillAt: now,
      overLimitSince: 0,
      lastTriggeredAt: activity.lastTriggeredAt,
      overLimit: false,
      confirmed: false,
    }
  }

  const overLimitSince = activity.overLimitSince || now
  return {
    tokens,
    lastRefillAt: now,
    overLimitSince,
    lastTriggeredAt: activity.lastTriggeredAt,
    overLimit: true,
    confirmed: now - overLimitSince >= confirmMs,
  }
}
