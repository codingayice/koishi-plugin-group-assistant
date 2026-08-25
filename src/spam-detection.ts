export type BurstState = 'normal' | 'active' | 'cooldown'

export interface BurstActivity {
  timestamps: number[]
  state: BurstState
  lastTriggeredAt: number
  lastActiveAt: number
}

export interface BurstDetectionResult extends BurstActivity {
  thresholdReached: boolean
  triggered: boolean
}

export function createBurstActivity(): BurstActivity {
  return {
    timestamps: [],
    state: 'normal',
    lastTriggeredAt: 0,
    lastActiveAt: 0,
  }
}

/**
 * Updates one user's sliding-window burst state.
 * `triggered` is true only when a new burst incident should count as an offense.
 */
export function updateBurstActivity(
  activity: BurstActivity,
  now: number,
  windowMs: number,
  messageCount: number,
  cooldownMs: number,
  recoveryMs: number,
): BurstDetectionResult {
  const timestamps = activity.timestamps.filter((time) => now - time <= windowMs)
  timestamps.push(now)

  const thresholdReached = timestamps.length >= messageCount
  let state = activity.state
  let triggered = false
  let lastTriggeredAt = activity.lastTriggeredAt
  let lastActiveAt = activity.lastActiveAt

  if (thresholdReached) {
    const cooldownExpired = now - lastTriggeredAt >= cooldownMs
    if (state === 'normal' || (state === 'cooldown' && cooldownExpired)) {
      triggered = true
      lastTriggeredAt = now
    }
    state = 'active'
    lastActiveAt = now
  } else if (state === 'active' && now - lastActiveAt >= recoveryMs) {
    state = now - lastTriggeredAt >= cooldownMs ? 'normal' : 'cooldown'
  } else if (state === 'cooldown' && now - lastTriggeredAt >= cooldownMs) {
    state = 'normal'
  }

  return {
    timestamps,
    state,
    lastTriggeredAt,
    lastActiveAt,
    thresholdReached,
    triggered,
  }
}
