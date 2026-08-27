const elements = {
  saveStatus: document.querySelector('#save-status'),
  exportButton: document.querySelector('#export-button'),
  railProgress: document.querySelector('#rail-progress'),
  railPercent: document.querySelector('#rail-percent'),
  railNormal: document.querySelector('#rail-normal'),
  railViolation: document.querySelector('#rail-violation'),
  railSkipped: document.querySelector('#rail-skipped'),
  statusFilter: document.querySelector('#status-filter'),
  tagFilter: document.querySelector('#tag-filter'),
  orderFilter: document.querySelector('#order-filter'),
  searchInput: document.querySelector('#search-input'),
  queueCount: document.querySelector('#queue-count'),
  messageCard: document.querySelector('#message-card'),
  emptyState: document.querySelector('#empty-state'),
  sampleId: document.querySelector('#sample-id'),
  samplePosition: document.querySelector('#sample-position'),
  sampleState: document.querySelector('#sample-state'),
  sampleTags: document.querySelector('#sample-tags'),
  sampleText: document.querySelector('#sample-text'),
  sampleOccurrences: document.querySelector('#sample-occurrences'),
  sampleFirstTime: document.querySelector('#sample-first-time'),
  sampleLastTime: document.querySelector('#sample-last-time'),
  violationButton: document.querySelector('#violation-button'),
  normalButton: document.querySelector('#normal-button'),
  previousButton: document.querySelector('#previous-button'),
  skipButton: document.querySelector('#skip-button'),
  undoButton: document.querySelector('#undo-button'),
  nextButton: document.querySelector('#next-button'),
  statTodo: document.querySelector('#stat-todo'),
  statViolation: document.querySelector('#stat-violation'),
  statNormal: document.querySelector('#stat-normal'),
  statSkipped: document.querySelector('#stat-skipped'),
  toast: document.querySelector('#toast'),
}

const tagLabels = {
  has_url: '链接',
  has_mention: '@ 提及',
  has_contact_signal: '联系方式信号',
  multiline: '多行消息',
  has_emoji: 'Emoji',
}

const statusLabels = {
  violation: '违规',
  normal: '正常',
  skipped: '已跳过',
  unlabeled: '待标注',
}

const state = {
  samples: [],
  annotations: {},
  sourceOrder: new Map(),
  queue: [],
  cursor: 0,
  history: [],
  pendingWrites: 0,
  writeQueue: Promise.resolve(),
  toastTimer: null,
}

bindEvents()
boot()

async function boot() {
  try {
    const response = await fetch('/api/dataset')
    if (!response.ok) throw new Error(await readError(response))
    const data = await response.json()
    state.samples = Array.isArray(data.samples) ? data.samples : []
    state.annotations = data.annotations || {}
    state.sourceOrder = new Map(state.samples.map((sample, index) => [sample.id, index]))
    populateTagFilter()
    rebuildQueue()
    render()
  } catch (error) {
    elements.sampleText.textContent = `载入失败：${error.message}`
    setSyncState('error', '无法读取数据')
    disableDecisionButtons(true)
  }
}

function bindEvents() {
  elements.statusFilter.addEventListener('change', () => rebuildAndRender())
  elements.tagFilter.addEventListener('change', () => rebuildAndRender())
  elements.orderFilter.addEventListener('change', () => rebuildAndRender())
  elements.searchInput.addEventListener('input', () => rebuildAndRender())
  elements.violationButton.addEventListener('click', () => annotateCurrent('violation'))
  elements.normalButton.addEventListener('click', () => annotateCurrent('normal'))
  elements.skipButton.addEventListener('click', () => annotateCurrent('skipped'))
  elements.undoButton.addEventListener('click', undoLastAction)
  elements.previousButton.addEventListener('click', () => moveCursor(-1))
  elements.nextButton.addEventListener('click', () => moveCursor(1))
  elements.exportButton.addEventListener('click', exportResults)
  document.addEventListener('keydown', handleShortcut)
}

function populateTagFilter() {
  const tags = [...new Set(state.samples.flatMap((sample) => sample.tags || []))].sort()
  for (const tag of tags) {
    const option = document.createElement('option')
    option.value = tag
    option.textContent = tagLabels[tag] || tag
    elements.tagFilter.append(option)
  }
}

function rebuildAndRender(preferredId) {
  rebuildQueue(preferredId)
  render()
}

function rebuildQueue(preferredId) {
  const previousCursor = state.cursor
  const statusFilter = elements.statusFilter.value
  const tagFilter = elements.tagFilter.value
  const query = elements.searchInput.value.trim().toLocaleLowerCase('zh-CN')

  state.queue = state.samples.filter((sample) => {
    const status = getStatus(sample.id)
    const statusMatches = statusFilter === 'all'
      || statusFilter === status
      || (statusFilter === 'todo' && status === 'unlabeled')
      || (statusFilter === 'labeled' && (status === 'violation' || status === 'normal'))
    const tagMatches = tagFilter === 'all' || (sample.tags || []).includes(tagFilter)
    const queryMatches = !query || sample.text.toLocaleLowerCase('zh-CN').includes(query)
    return statusMatches && tagMatches && queryMatches
  })

  if (elements.orderFilter.value === 'frequency') {
    state.queue.sort((left, right) => {
      return (right.occurrences || 1) - (left.occurrences || 1)
        || state.sourceOrder.get(left.id) - state.sourceOrder.get(right.id)
    })
  } else if (elements.orderFilter.value === 'risk') {
    state.queue.sort((left, right) => {
      return riskScore(right) - riskScore(left)
        || state.sourceOrder.get(left.id) - state.sourceOrder.get(right.id)
    })
  }

  const preferredIndex = preferredId
    ? state.queue.findIndex((sample) => sample.id === preferredId)
    : -1
  state.cursor = preferredIndex >= 0
    ? preferredIndex
    : Math.max(0, Math.min(previousCursor, state.queue.length - 1))
}

function riskScore(sample) {
  const tags = new Set(sample.tags || [])
  let score = Math.log2((sample.occurrences || 1) + 1)
  if (tags.has('has_url')) score += 5
  if (tags.has('has_contact_signal')) score += 4
  if (tags.has('multiline')) score += 1.5
  if (tags.has('has_mention')) score += 0.5
  return score
}

function render() {
  const sample = currentSample()
  const stats = calculateStats()
  const total = stats.total || 1
  const labeled = stats.violation + stats.normal
  const percent = Math.round(labeled / total * 100)

  elements.statTodo.textContent = stats.todo
  elements.statViolation.textContent = stats.violation
  elements.statNormal.textContent = stats.normal
  elements.statSkipped.textContent = stats.skipped
  elements.queueCount.textContent = state.queue.length
  elements.railProgress.textContent = `${labeled} / ${stats.total}`
  elements.railPercent.textContent = `${percent}%`
  elements.railNormal.style.width = `${stats.normal / total * 100}%`
  elements.railViolation.style.width = `${stats.violation / total * 100}%`
  elements.railSkipped.style.width = `${stats.skipped / total * 100}%`
  elements.undoButton.disabled = state.history.length === 0

  if (!sample) {
    elements.messageCard.hidden = true
    elements.emptyState.hidden = false
    disableDecisionButtons(true)
    elements.previousButton.disabled = true
    elements.nextButton.disabled = true
    return
  }

  elements.messageCard.hidden = false
  elements.emptyState.hidden = true
  disableDecisionButtons(false)
  elements.previousButton.disabled = state.cursor <= 0
  elements.nextButton.disabled = state.cursor >= state.queue.length - 1

  const status = getStatus(sample.id)
  elements.sampleId.textContent = sample.id
  elements.samplePosition.textContent = `队列 ${state.cursor + 1} / ${state.queue.length}`
  elements.sampleState.textContent = statusLabels[status]
  elements.sampleState.className = `state-badge state-${status}`
  elements.sampleText.textContent = sample.text
  elements.sampleOccurrences.textContent = sample.occurrences || 1
  elements.sampleFirstTime.textContent = formatTime(sample.firstTimestamp)
  elements.sampleLastTime.textContent = formatTime(sample.lastTimestamp)
  renderTags(sample.tags || [])
}

function renderTags(tags) {
  elements.sampleTags.replaceChildren()
  if (!tags.length) {
    const empty = document.createElement('span')
    empty.className = 'tag-empty'
    empty.textContent = '无自动特征标签'
    elements.sampleTags.append(empty)
    return
  }
  for (const tag of tags) {
    const chip = document.createElement('span')
    chip.className = 'tag'
    chip.textContent = tagLabels[tag] || tag
    elements.sampleTags.append(chip)
  }
}

function annotateCurrent(status) {
  const sample = currentSample()
  if (!sample) return
  const oldCursor = state.cursor
  const previous = state.annotations[sample.id] ? { ...state.annotations[sample.id] } : null
  state.history.push({ id: sample.id, previous })
  state.annotations[sample.id] = { status, updatedAt: new Date().toISOString() }
  queueAnnotationWrite(sample.id, status)

  rebuildQueue()
  const stillVisible = state.queue.findIndex((item) => item.id === sample.id)
  state.cursor = stillVisible >= 0
    ? Math.min(stillVisible + 1, state.queue.length - 1)
    : Math.min(oldCursor, Math.max(0, state.queue.length - 1))
  render()
}

function undoLastAction() {
  const entry = state.history.pop()
  if (!entry) return
  if (entry.previous) state.annotations[entry.id] = entry.previous
  else delete state.annotations[entry.id]
  queueAnnotationWrite(entry.id, entry.previous?.status || 'unlabeled')
  rebuildAndRender(entry.id)
  showToast('已撤销上一条标注。')
}

function queueAnnotationWrite(id, status) {
  state.pendingWrites += 1
  setSyncState('saving', '正在保存')
  state.writeQueue = state.writeQueue.catch(() => {}).then(async () => {
    try {
      const response = await fetch('/api/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!response.ok) throw new Error(await readError(response))
    } catch (error) {
      setSyncState('error', '保存失败')
      showToast(`保存失败：${error.message}`)
      throw error
    } finally {
      state.pendingWrites -= 1
      if (state.pendingWrites === 0 && !elements.saveStatus.classList.contains('is-error')) {
        setSyncState('saved', '进度已同步')
      }
    }
  })
}

async function exportResults() {
  elements.exportButton.disabled = true
  elements.exportButton.textContent = '正在导出…'
  try {
    await state.writeQueue.catch(() => {})
    const response = await fetch('/api/export', { method: 'POST' })
    if (!response.ok) throw new Error(await readError(response))
    const result = await response.json()
    showToast(`已导出：${shortPath(result.jsonlPath)} 和 ${shortPath(result.csvPath)}`)
  } catch (error) {
    showToast(`导出失败：${error.message}`)
  } finally {
    elements.exportButton.disabled = false
    elements.exportButton.textContent = '导出结果'
  }
}

function moveCursor(offset) {
  if (!state.queue.length) return
  state.cursor = Math.max(0, Math.min(state.cursor + offset, state.queue.length - 1))
  render()
}

function handleShortcut(event) {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
  const tag = event.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  const key = event.key.toLocaleLowerCase()
  if (key === 'a') annotateCurrent('violation')
  else if (key === 'd') annotateCurrent('normal')
  else if (key === 's') annotateCurrent('skipped')
  else if (key === 'z') undoLastAction()
  else if (event.key === 'ArrowLeft') moveCursor(-1)
  else if (event.key === 'ArrowRight') moveCursor(1)
  else return
  event.preventDefault()
}

function currentSample() {
  return state.queue[state.cursor] || null
}

function getStatus(id) {
  return state.annotations[id]?.status || 'unlabeled'
}

function calculateStats() {
  const stats = { total: state.samples.length, todo: 0, violation: 0, normal: 0, skipped: 0 }
  for (const sample of state.samples) {
    const status = getStatus(sample.id)
    if (status === 'unlabeled') stats.todo += 1
    else stats[status] += 1
  }
  return stats
}

function disableDecisionButtons(disabled) {
  elements.violationButton.disabled = disabled
  elements.normalButton.disabled = disabled
  elements.skipButton.disabled = disabled
}

function setSyncState(status, text) {
  elements.saveStatus.classList.toggle('is-saving', status === 'saving')
  elements.saveStatus.classList.toggle('is-error', status === 'error')
  elements.saveStatus.lastChild.textContent = text
}

function formatTime(value) {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function showToast(message) {
  elements.toast.textContent = message
  elements.toast.classList.add('is-visible')
  clearTimeout(state.toastTimer)
  state.toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3200)
}

function shortPath(path) {
  return String(path || '').replace(/^.*[\\/](testdata[\\/])/, '$1')
}

async function readError(response) {
  try {
    const body = await response.json()
    return body.error || `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}
