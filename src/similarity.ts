export interface SimilarityThresholds {
  dice: number
  edit: number
}

export function isSimilarText(left: string, right: string, thresholds: SimilarityThresholds) {
  if (left === right) return true
  if (calculateBigramDice(left, right) >= thresholds.dice) return true
  return isSimilarByEditDistance(left, right, thresholds.edit)
}

export function calculateBigramDice(left: string, right: string) {
  if (left === right) return left ? 1 : 0
  const leftChars = Array.from(left)
  const rightChars = Array.from(right)
  if (leftChars.length < 2 || rightChars.length < 2) return 0

  const leftCounts = new Map<string, number>()
  for (let index = 0; index < leftChars.length - 1; index += 1) {
    const bigram = leftChars[index] + leftChars[index + 1]
    leftCounts.set(bigram, (leftCounts.get(bigram) || 0) + 1)
  }

  let intersection = 0
  for (let index = 0; index < rightChars.length - 1; index += 1) {
    const bigram = rightChars[index] + rightChars[index + 1]
    const remaining = leftCounts.get(bigram) || 0
    if (!remaining) continue
    intersection += 1
    leftCounts.set(bigram, remaining - 1)
  }

  const total = leftChars.length + rightChars.length - 2
  return (2 * intersection) / total
}

export function isSimilarByEditDistance(left: string, right: string, threshold: number) {
  if (left === right) return true
  const leftChars = Array.from(left)
  const rightChars = Array.from(right)
  const maxLength = Math.max(leftChars.length, rightChars.length)
  if (!maxLength) return false

  const maxDistance = Math.floor(maxLength * (1 - threshold))
  if (Math.abs(leftChars.length - rightChars.length) > maxDistance) return false
  return boundedLevenshtein(leftChars, rightChars, maxDistance) <= maxDistance
}

function boundedLevenshtein(leftInput: string[], rightInput: string[], maxDistance: number) {
  let left = leftInput
  let right = rightInput
  if (left.length > right.length) {
    left = rightInput
    right = leftInput
  }

  if (right.length - left.length > maxDistance) return maxDistance + 1
  let previous = Array(right.length + 1).fill(Number.POSITIVE_INFINITY)
  let current = Array(right.length + 1).fill(Number.POSITIVE_INFINITY)
  for (let column = 0; column <= Math.min(right.length, maxDistance); column += 1) {
    previous[column] = column
  }

  for (let row = 1; row <= left.length; row += 1) {
    current.fill(Number.POSITIVE_INFINITY)
    const from = Math.max(1, row - maxDistance)
    const to = Math.min(right.length, row + maxDistance)
    if (from === 1) current[0] = row

    let rowMin = Number.POSITIVE_INFINITY
    for (let column = from; column <= to; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + cost,
      )
      rowMin = Math.min(rowMin, current[column])
    }
    if (rowMin > maxDistance) return maxDistance + 1
    ;[previous, current] = [current, previous]
  }
  return previous[right.length]
}
