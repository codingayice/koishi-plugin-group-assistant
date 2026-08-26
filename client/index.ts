import { Context, receive, send } from '@koishijs/client'
import { computed, defineComponent, h, ref, resolveComponent } from 'vue'
import './style.css'

const MAX_WORDLIST_BYTES = 2 * 1024 * 1024

type RuleScope = 'redline' | 'sensitive'

interface RuleRecord {
  id: number
  guildId: string
  scope: RuleScope
  pattern: string
  enabled: boolean
  createdAt: string
}

interface RulePageResponse {
  items: RuleRecord[]
  total: number
  page: number
  pageSize: number
}

interface AuditRecord {
  id: number
  guildId: string
  channelId: string
  userId: string
  messageId: string
  ruleId: number
  signalCode: string
  source: string
  pattern: string
  evidence: string
  action: string
  status: string
  offenseCount: number
  reviewedByAi: boolean
  aiReason: string
  content: string
  createdAt: string
  updatedAt: string
}

interface OffenseRecord {
  id: number
  guildId: string
  userId: string
  category: string
  offenseCount: number
  lastSignalCode: string
  lastPattern: string
  lastAction: string
  createdAt: string
  updatedAt: string
}

type ConsoleView = 'rules' | 'audits' | 'offenses'

interface GroupRecord {
  guildId: string
}

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function nextDateBoundary(value: string) {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() + 1)
  return date.toISOString()
}

const SIGNAL_LABELS: Record<string, string> = {
  blacklist_user: '黑名单',
  redline_keyword: '红线词',
  sensitive_keyword: '敏感词',
  spam_model: '垃圾消息模型',
  spam_burst: '刷屏',
  similar_repeat: '相似复读',
  manual_action: '手动处置',
}

const ACTION_LABELS: Record<string, string> = {
  silent: '放行',
  warn: '警告',
  delete: '撤回',
  mute: '禁言',
  kick: '踢出',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待复核',
  confirmed: '已确认',
  dismissed: '已排除',
  skipped: '未复核',
  failed: '复核失败',
  duplicate: '重复任务',
}

const WordlistPage = defineComponent({
  setup() {
    const KIcon = resolveComponent('k-icon')
    const KLayout = resolveComponent('k-layout')
    const guildId = ref('')
    const view = ref<ConsoleView>('rules')
    const scope = ref<RuleScope>('sensitive')
    const groups = ref<GroupRecord[]>([])
    const groupsLoading = ref(false)
    const rules = ref<RuleRecord[]>([])
    const ruleSearch = ref('')
    const rulePattern = ref('')
    const rulesLoading = ref(false)
    const rulesStatus = ref('填写群号后加载词库。')
    const currentPage = ref(1)
    const pageSize = ref(50)
    const totalRules = ref(0)
    let searchTimer: ReturnType<typeof setTimeout> | undefined
    const editingRuleId = ref<number>()
    const editingPattern = ref('')

    const showImport = ref(false)
    const selectedFile = ref<File>()
    const busy = ref(false)
    const dragging = ref(false)
    const status = ref('等待选择词库文件。')
    const statusTone = ref<'idle' | 'working' | 'success' | 'error'>('idle')
    const jobId = ref('')

    const audits = ref<AuditRecord[]>([])
    const auditPage = ref(1)
    const auditPageSize = ref(25)
    const auditTotal = ref(0)
    const auditLoading = ref(false)
    const auditStatus = ref('')
    const auditUserId = ref('')
    const auditSignalCode = ref('')
    const auditState = ref('')
    const auditSearch = ref('')
    const auditFrom = ref('')
    const auditTo = ref('')
    const selectedAudit = ref<AuditRecord>()

    const offenses = ref<OffenseRecord[]>([])
    const offensePage = ref(1)
    const offensePageSize = ref(25)
    const offenseTotal = ref(0)
    const offenseLoading = ref(false)
    const offenseStatus = ref('')
    const offenseUserId = ref('')

    const scopeLabel = computed(() => scope.value === 'redline' ? '红线词库' : '敏感词库')
    const fileSize = computed(() => selectedFile.value ? formatFileSize(selectedFile.value.size) : '')
    const visibleRules = computed(() => {
      return rules.value.filter((rule) => rule.scope === scope.value)
    })
    const pageCount = computed(() => totalRules.value ? Math.ceil(totalRules.value / pageSize.value) : 0)
    const auditPageCount = computed(() => auditTotal.value ? Math.ceil(auditTotal.value / auditPageSize.value) : 0)
    const offensePageCount = computed(() => offenseTotal.value ? Math.ceil(offenseTotal.value / offensePageSize.value) : 0)
    const viewLoading = computed(() => view.value === 'rules' ? rulesLoading.value : view.value === 'audits' ? auditLoading.value : offenseLoading.value)

    receive('group-assistant/import-progress', (data: { jobId?: string; message?: string }) => {
      if (data?.jobId !== jobId.value || !data.message) return
      status.value = data.message
      statusTone.value = 'working'
    })

    const loadRules = async (page = currentPage.value) => {
      const targetGuildId = guildId.value.trim()
      if (!targetGuildId) {
        rules.value = []
        totalRules.value = 0
        rulesStatus.value = '请先填写群号。'
        return
      }
      const targetPage = Math.max(1, page)
      currentPage.value = targetPage
      rulesLoading.value = true
      rulesStatus.value = `正在加载${scopeLabel.value}第 ${targetPage} 页。`
      try {
        const result = await send('group-assistant/list-rules', {
          guildId: targetGuildId,
          scope: scope.value,
          page: targetPage,
          pageSize: pageSize.value,
          search: ruleSearch.value.trim(),
        })
        const response = result as RulePageResponse
        const total = Number(response?.total) || 0
        const lastPage = total ? Math.ceil(total / pageSize.value) : 1
        if (targetPage > lastPage) {
          await loadRules(lastPage)
          return
        }
        rules.value = Array.isArray(response?.items) ? response.items : []
        totalRules.value = total
        currentPage.value = targetPage
        rulesStatus.value = `已加载第 ${targetPage} 页，共 ${total} 条关键词。`
      } catch (error) {
        rulesStatus.value = `加载失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
    }

    const loadAudits = async (page = auditPage.value) => {
      const targetGuildId = guildId.value.trim()
      if (!targetGuildId) {
        audits.value = []
        auditTotal.value = 0
        auditStatus.value = '请先选择群聊。'
        return
      }
      const targetPage = Math.max(1, page)
      auditPage.value = targetPage
      auditLoading.value = true
      auditStatus.value = `正在加载第 ${targetPage} 页。`
      try {
        const result = await send('group-assistant/list-audits', {
          guildId: targetGuildId,
          page: targetPage,
          pageSize: auditPageSize.value,
          userId: auditUserId.value.trim(),
          signalCode: auditSignalCode.value,
          status: auditState.value,
          search: auditSearch.value.trim(),
          from: auditFrom.value ? new Date(`${auditFrom.value}T00:00:00`).toISOString() : '',
          to: nextDateBoundary(auditTo.value),
        })
        const response = result as { items?: AuditRecord[]; total?: number }
        const total = Number(response?.total) || 0
        const lastPage = total ? Math.ceil(total / auditPageSize.value) : 1
        if (targetPage > lastPage) {
          await loadAudits(lastPage)
          return
        }
        audits.value = Array.isArray(response?.items) ? response.items : []
        auditTotal.value = total
        auditPage.value = targetPage
        auditStatus.value = `已加载第 ${targetPage} 页，共 ${total} 条记录。`
      } catch (error) {
        auditStatus.value = `加载失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        auditLoading.value = false
      }
    }

    const loadOffenses = async (page = offensePage.value) => {
      const targetGuildId = guildId.value.trim()
      if (!targetGuildId) {
        offenses.value = []
        offenseTotal.value = 0
        offenseStatus.value = '请先选择群聊。'
        return
      }
      const targetPage = Math.max(1, page)
      offensePage.value = targetPage
      offenseLoading.value = true
      offenseStatus.value = `正在加载第 ${targetPage} 页。`
      try {
        const result = await send('group-assistant/list-offenses', {
          guildId: targetGuildId,
          page: targetPage,
          pageSize: offensePageSize.value,
          userId: offenseUserId.value.trim(),
        })
        const response = result as { items?: OffenseRecord[]; total?: number }
        const total = Number(response?.total) || 0
        const lastPage = total ? Math.ceil(total / offensePageSize.value) : 1
        if (targetPage > lastPage) {
          await loadOffenses(lastPage)
          return
        }
        offenses.value = Array.isArray(response?.items) ? response.items : []
        offenseTotal.value = total
        offensePage.value = targetPage
        offenseStatus.value = `已加载第 ${targetPage} 页，共 ${total} 个有效违规用户。`
      } catch (error) {
        offenseStatus.value = `加载失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        offenseLoading.value = false
      }
    }

    const refreshCurrentView = () => {
      if (view.value === 'rules') return void loadRules()
      if (view.value === 'audits') return void loadAudits()
      return void loadOffenses()
    }

    const loadGroups = async () => {
      groupsLoading.value = true
      try {
        const result = await send('group-assistant/list-groups')
        const records = Array.isArray(result) ? result as GroupRecord[] : []
        if (guildId.value && !records.some((group) => group.guildId === guildId.value)) {
          records.unshift({ guildId: guildId.value })
        }
        groups.value = records
        if (!guildId.value && records[0]?.guildId) {
          guildId.value = records[0].guildId
          await loadRules()
        }
      } catch (error) {
        rulesStatus.value = `群列表读取失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        groupsLoading.value = false
      }
    }

    const selectGroup = (group: GroupRecord) => {
      if (guildId.value === group.guildId) return
      guildId.value = group.guildId
      ruleSearch.value = ''
      currentPage.value = 1
      editingRuleId.value = undefined
      editingPattern.value = ''
      if (view.value === 'rules') void loadRules()
      else if (view.value === 'audits') void loadAudits(1)
      else void loadOffenses(1)
    }

    const addGroup = () => {
      const targetGuildId = window.prompt('请输入群号：')?.trim()
      if (!targetGuildId) return
      if (!groups.value.some((group) => group.guildId === targetGuildId)) {
        groups.value = [...groups.value, { guildId: targetGuildId }]
      }
      selectGroup({ guildId: targetGuildId })
    }

    const deleteGroup = async (event: MouseEvent, group: GroupRecord) => {
      event.stopPropagation()
      if (!window.confirm(`确定删除群 ${group.guildId} 的全部红线和敏感关键词吗？`)) return
      groupsLoading.value = true
      try {
        const result = await send('group-assistant/delete-group', { guildId: group.guildId })
        if (guildId.value === group.guildId) {
          guildId.value = ''
          rules.value = []
          totalRules.value = 0
          currentPage.value = 1
          ruleSearch.value = ''
          cancelEdit()
        }
        await loadGroups()
        rulesStatus.value = String(result || `已删除群 ${group.guildId} 的词库。`)
      } catch (error) {
        rulesStatus.value = `删除群词库失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        groupsLoading.value = false
      }
    }

    void loadGroups()

    const switchScope = (nextScope: RuleScope) => {
      if (scope.value === nextScope) return
      scope.value = nextScope
      ruleSearch.value = ''
      currentPage.value = 1
      editingRuleId.value = undefined
      editingPattern.value = ''
      void loadRules()
    }

    const createRule = async () => {
      const targetGuildId = guildId.value.trim()
      const pattern = rulePattern.value.trim()
      if (!targetGuildId) {
        rulesStatus.value = '请先填写群号。'
        return
      }
      if (!pattern) {
        rulesStatus.value = '请输入关键词。'
        return
      }
      rulesLoading.value = true
      rulesStatus.value = '正在添加关键词。'
      try {
        await send('group-assistant/create-rule', {
          guildId: targetGuildId,
          scope: scope.value,
          pattern,
        })
        rulePattern.value = ''
        await loadRules()
        await loadGroups()
      } catch (error) {
        rulesStatus.value = `添加失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
    }

    const beginEdit = (rule: RuleRecord) => {
      editingRuleId.value = rule.id
      editingPattern.value = rule.pattern
    }

    const cancelEdit = () => {
      editingRuleId.value = undefined
      editingPattern.value = ''
    }

    const saveEdit = async (rule: RuleRecord) => {
      const pattern = editingPattern.value.trim()
      if (!pattern) {
        rulesStatus.value = '关键词不能为空。'
        return
      }
      rulesLoading.value = true
      rulesStatus.value = '正在保存关键词。'
      try {
        await send('group-assistant/update-rule', {
          guildId: guildId.value.trim(),
          id: rule.id,
          scope: scope.value,
          pattern,
          enabled: rule.enabled,
        })
        cancelEdit()
        await loadRules()
      } catch (error) {
        rulesStatus.value = `保存失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
    }

    const toggleRule = async (rule: RuleRecord) => {
      rulesLoading.value = true
      rulesStatus.value = `${rule.enabled ? '正在停用' : '正在启用'}关键词。`
      try {
        await send('group-assistant/update-rule', {
          guildId: guildId.value.trim(),
          id: rule.id,
          scope: scope.value,
          pattern: rule.pattern,
          enabled: !rule.enabled,
        })
        await loadRules()
        await loadGroups()
      } catch (error) {
        rulesStatus.value = `操作失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
    }

    const deleteRule = async (rule: RuleRecord) => {
      if (!window.confirm(`确定删除关键词「${rule.pattern}」吗？`)) return
      rulesLoading.value = true
      rulesStatus.value = '正在删除关键词。'
      try {
        await send('group-assistant/delete-rule', {
          guildId: guildId.value.trim(),
          id: rule.id,
        })
        await loadRules()
        await loadGroups()
      } catch (error) {
        rulesStatus.value = `删除失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
    }

    const scheduleSearch = (value: string) => {
      ruleSearch.value = value
      currentPage.value = 1
      if (searchTimer) clearTimeout(searchTimer)
      searchTimer = setTimeout(() => { void loadRules(1) }, 250)
    }

    const changePageSize = (value: string) => {
      const nextSize = Number(value)
      if (!Number.isInteger(nextSize) || nextSize <= 0 || nextSize === pageSize.value) return
      pageSize.value = nextSize
      currentPage.value = 1
      void loadRules(1)
    }

    const goToPage = (page: number) => {
      if (rulesLoading.value || page < 1 || page > pageCount.value || page === currentPage.value) return
      void loadRules(page)
    }

    const applyAuditFilters = () => {
      auditPage.value = 1
      void loadAudits(1)
    }

    const changeAuditPageSize = (value: string) => {
      const nextSize = Number(value)
      if (!Number.isInteger(nextSize) || nextSize <= 0 || nextSize === auditPageSize.value) return
      auditPageSize.value = nextSize
      applyAuditFilters()
    }

    const changeOffensePageSize = (value: string) => {
      const nextSize = Number(value)
      if (!Number.isInteger(nextSize) || nextSize <= 0 || nextSize === offensePageSize.value) return
      offensePageSize.value = nextSize
      offensePage.value = 1
      void loadOffenses(1)
    }

    const clearOffense = async (offense: OffenseRecord) => {
      if (!window.confirm(`确定清零用户 ${offense.userId} 的累计违规状态吗？`)) return
      offenseLoading.value = true
      offenseStatus.value = `正在清零用户 ${offense.userId}。`
      try {
        await send('group-assistant/clear-offense', { guildId: guildId.value.trim(), userId: offense.userId })
        await loadOffenses(offensePage.value)
        offenseStatus.value = `已清零用户 ${offense.userId} 的违规状态。`
      } catch (error) {
        offenseStatus.value = `清零失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        offenseLoading.value = false
      }
    }

    const switchView = (nextView: ConsoleView) => {
      if (view.value === nextView) return
      view.value = nextView
      if (nextView === 'audits') void loadAudits(1)
      if (nextView === 'offenses') void loadOffenses(1)
    }

    const setFile = (file?: File) => {
      selectedFile.value = file
      if (!file) {
        status.value = '等待选择词库文件。'
        statusTone.value = 'idle'
        return
      }
      status.value = `已选择 ${file.name}。`
      statusTone.value = 'idle'
    }

    const chooseFile = (event: Event) => {
      setFile((event.target as HTMLInputElement).files?.[0])
    }

    const dropFile = (event: DragEvent) => {
      event.preventDefault()
      dragging.value = false
      if (!busy.value) setFile(event.dataTransfer?.files?.[0])
    }

    const submit = async () => {
      const file = selectedFile.value
      const targetGuildId = guildId.value.trim()
      if (!targetGuildId) {
        status.value = '请先填写群号。'
        statusTone.value = 'error'
        return
      }
      if (!file) {
        status.value = '请先选择 TXT 文件。'
        statusTone.value = 'error'
        return
      }
      if (!file.name.toLowerCase().endsWith('.txt')) {
        status.value = '文件格式不正确，请选择 TXT 文件。'
        statusTone.value = 'error'
        return
      }
      if (file.size > MAX_WORDLIST_BYTES) {
        status.value = '文件超过 2 MB 导入上限。'
        statusTone.value = 'error'
        return
      }

      busy.value = true
      jobId.value = Math.random().toString(36).slice(2)
      status.value = '正在上传并导入词库。'
      statusTone.value = 'working'
      try {
        const content = encodeBase64(await file.arrayBuffer())
        const result = await send('group-assistant/import-wordlist', {
          guildId: targetGuildId,
          scope: scope.value,
          filename: file.name,
          content,
          jobId: jobId.value,
        })
        status.value = String(result || `${scopeLabel.value}导入完成。`)
        statusTone.value = 'success'
        selectedFile.value = undefined
        showImport.value = false
        await loadRules()
        await loadGroups()
      } catch (error) {
        status.value = `导入失败：${error instanceof Error ? error.message : String(error)}`
        statusTone.value = 'error'
      } finally {
        busy.value = false
      }
    }

    const renderRuleRow = (rule: RuleRecord) => {
      const editing = editingRuleId.value === rule.id
      return h('div', { class: ['word-row', { disabled: !rule.enabled, editing }], key: rule.id }, [
        h('div', { class: 'word-cell' }, [editing
          ? h('input', {
            class: 'console-input row-input',
            value: editingPattern.value,
            disabled: rulesLoading.value,
            onInput: (event: Event) => { editingPattern.value = (event.target as HTMLInputElement).value },
            onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') void saveEdit(rule) },
          })
          : h('span', { class: 'word-pattern', title: rule.pattern }, rule.pattern),
        ]),
        h('div', { class: 'operation-cell' }, editing ? [
          h('button', { class: 'link-button primary', type: 'button', disabled: rulesLoading.value, onClick: () => void saveEdit(rule) }, '保存'),
          h('button', { class: 'link-button', type: 'button', disabled: rulesLoading.value, onClick: cancelEdit }, '取消'),
        ] : [
          h('button', { class: 'link-button', type: 'button', disabled: rulesLoading.value, onClick: () => beginEdit(rule) }, '编辑'),
          h('button', { class: 'link-button', type: 'button', disabled: rulesLoading.value, onClick: () => void toggleRule(rule) }, rule.enabled ? '停用' : '启用'),
          h('button', { class: 'link-button danger', type: 'button', disabled: rulesLoading.value, onClick: () => void deleteRule(rule) }, '删除'),
        ]),
      ])
    }

    const renderGroupSidebar = () => h('div', { class: 'group-sidebar' }, [
      h('button', {
        class: 'group-add-button',
        type: 'button',
        onClick: addGroup,
      }, '添加群聊'),
      h('div', { class: 'group-list' }, groupsLoading.value
        ? [h('div', { class: 'group-list-empty' }, '加载中...')]
        : groups.value.length
          ? groups.value.map((group) => h('div', {
            class: ['group-item', { active: guildId.value === group.guildId }],
            role: 'button',
            tabindex: 0,
            onClick: () => selectGroup(group),
            onKeydown: (event: KeyboardEvent) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              selectGroup(group)
            },
          }, [
            h('span', { class: 'group-item-label' }, group.guildId),
            h('button', {
              class: 'group-delete-button',
              type: 'button',
              disabled: groupsLoading.value,
              title: `删除群 ${group.guildId} 的词库`,
              'aria-label': `删除群 ${group.guildId} 的词库`,
              onClick: (event: MouseEvent) => void deleteGroup(event, group),
            }, '×'),
          ]))
          : [h('div', { class: 'group-list-empty' }, '暂无群聊')]),
    ])

    const renderImportDialog = () => showImport.value ? h('div', {
      class: 'import-backdrop',
      onClick: () => { if (!busy.value) showImport.value = false },
    }, [h('section', {
      class: 'import-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'wordlist-import-title',
      onClick: (event: MouseEvent) => { event.stopPropagation() },
    }, [
      h('header', { class: 'dialog-header' }, [
        h('h2', { id: 'wordlist-import-title' }, `导入${scopeLabel.value}`),
        h('button', {
          class: 'dialog-close',
          type: 'button',
          disabled: busy.value,
          title: '关闭',
          onClick: () => { showImport.value = false },
        }, '×'),
      ]),
      h('div', { class: 'dialog-body' }, [
        h('label', {
          class: ['file-dropzone', { dragging: dragging.value, selected: !!selectedFile.value }],
          onDragover: (event: DragEvent) => { event.preventDefault(); if (!busy.value) dragging.value = true },
          onDragleave: () => { dragging.value = false },
          onDrop: dropFile,
        }, [
          h('input', { type: 'file', accept: '.txt,text/plain', disabled: busy.value, onChange: chooseFile }),
          h('strong', selectedFile.value ? selectedFile.value.name : '选择或拖入 TXT 文件'),
          h('span', selectedFile.value ? `${fileSize.value} · UTF-8` : '每行一个关键词，最大 2 MB'),
        ]),
        h('p', { class: ['dialog-status', `tone-${statusTone.value}`] }, status.value),
      ]),
      h('footer', { class: 'dialog-footer' }, [
        selectedFile.value ? h('button', {
          class: 'console-button',
          type: 'button',
          disabled: busy.value,
          onClick: () => setFile(),
        }, '移除文件') : null,
        h('span', { class: 'dialog-spacer' }),
        h('button', {
          class: 'console-button',
          type: 'button',
          disabled: busy.value,
          onClick: () => { showImport.value = false },
        }, '取消'),
        h('button', {
          class: 'console-button primary',
          type: 'button',
          disabled: busy.value,
          onClick: submit,
        }, busy.value ? '导入中...' : '开始导入'),
      ]),
    ])]) : null

    const renderRulesView = () => [
      h('section', { class: 'control-bar' }, [
        h('input', {
          class: 'console-input search-input',
          value: ruleSearch.value,
          placeholder: '搜索关键词',
          onInput: (event: Event) => scheduleSearch((event.target as HTMLInputElement).value),
        }),
      ]),
      h('nav', { class: 'scope-tabs', 'aria-label': '词库分类' }, [
        h('button', {
          class: ['scope-tab', { active: scope.value === 'sensitive' }],
          type: 'button',
          onClick: () => switchScope('sensitive'),
        }, '敏感词库'),
        h('button', {
          class: ['scope-tab', { active: scope.value === 'redline' }],
          type: 'button',
          onClick: () => switchScope('redline'),
        }, '红线词库'),
      ]),
      h('section', { class: 'word-table' }, [
        h('div', { class: 'word-table-head' }, [
          h('span', '关键词'),
          h('span', '操作'),
        ]),
        h('div', { class: 'word-create-row' }, [
          h('div', { class: 'word-cell' }, [h('input', {
              class: 'console-input row-input',
              value: rulePattern.value,
              placeholder: `添加${scopeLabel.value}关键词`,
              disabled: rulesLoading.value,
              onInput: (event: Event) => { rulePattern.value = (event.target as HTMLInputElement).value },
              onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') void createRule() },
            })]),
          h('div', { class: 'operation-cell' }, [h('button', {
              class: 'link-button primary',
              type: 'button',
              disabled: rulesLoading.value,
              onClick: () => void createRule(),
            }, '添加')]),
        ]),
        visibleRules.value.length
          ? visibleRules.value.map(renderRuleRow)
          : h('div', { class: 'word-table-empty' }, guildId.value.trim() ? `当前${scopeLabel.value}暂无关键词。` : '请先填写群号。'),
      ]),
      h('div', { class: 'pagination-bar' }, [
        h('span', { class: 'pagination-summary' }, totalRules.value ? `共 ${totalRules.value} 条` : '暂无关键词'),
        h('div', { class: 'pagination-controls' }, [
          h('select', {
            class: 'page-size-select',
            value: String(pageSize.value),
            'aria-label': '每页条数',
            disabled: rulesLoading.value,
            onChange: (event: Event) => changePageSize((event.target as HTMLSelectElement).value),
          }, [25, 50, 100].map((size) => h('option', { value: String(size) }, `${size} 条/页`))),
          h('button', {
            class: 'pagination-button',
            type: 'button',
            disabled: rulesLoading.value || currentPage.value <= 1,
            onClick: () => goToPage(currentPage.value - 1),
          }, '上一页'),
          h('span', { class: 'pagination-current' }, pageCount.value ? `${currentPage.value} / ${pageCount.value}` : '0 / 0'),
          h('button', {
            class: 'pagination-button',
            type: 'button',
            disabled: rulesLoading.value || currentPage.value >= pageCount.value,
            onClick: () => goToPage(currentPage.value + 1),
          }, '下一页'),
        ]),
      ]),
      h('footer', { class: 'table-footer', 'aria-live': 'polite' }, [
        h('span', rulesStatus.value),
      ]),
    ]

    const renderPagination = (
      total: number,
      page: number,
      count: number,
      size: number,
      loading: boolean,
      onSize: (value: string) => void,
      onPage: (value: number) => void,
    ) => h('div', { class: 'pagination-bar' }, [
      h('span', { class: 'pagination-summary' }, total ? `共 ${total} 条` : '暂无记录'),
      h('div', { class: 'pagination-controls' }, [
        h('select', {
          class: 'page-size-select',
          value: String(size),
          'aria-label': '每页条数',
          disabled: loading,
          onChange: (event: Event) => onSize((event.target as HTMLSelectElement).value),
        }, [25, 50, 100].map((item) => h('option', { value: String(item) }, `${item} 条/页`))),
        h('button', {
          class: 'pagination-button',
          type: 'button',
          disabled: loading || page <= 1,
          onClick: () => onPage(page - 1),
        }, '上一页'),
        h('span', { class: 'pagination-current' }, count ? `${page} / ${count}` : '0 / 0'),
        h('button', {
          class: 'pagination-button',
          type: 'button',
          disabled: loading || page >= count,
          onClick: () => onPage(page + 1),
        }, '下一页'),
      ]),
    ])

    const renderAuditDetail = () => selectedAudit.value ? h('div', {
      class: 'detail-backdrop',
      onClick: () => { selectedAudit.value = undefined },
    }, [h('section', {
      class: 'detail-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'audit-detail-title',
      onClick: (event: MouseEvent) => { event.stopPropagation() },
    }, [
      h('header', { class: 'dialog-header' }, [
        h('h2', { id: 'audit-detail-title' }, `违规记录 #${selectedAudit.value.id}`),
        h('button', {
          class: 'dialog-close',
          type: 'button',
          title: '关闭',
          onClick: () => { selectedAudit.value = undefined },
        }, '×'),
      ]),
      h('div', { class: 'detail-body' }, [
        h('div', { class: 'detail-grid' }, [
          h('span', { class: 'detail-label' }, '用户'), h('span', selectedAudit.value.userId),
          h('span', { class: 'detail-label' }, '时间'), h('span', formatDateTime(selectedAudit.value.createdAt)),
          h('span', { class: 'detail-label' }, '信号'), h('span', SIGNAL_LABELS[selectedAudit.value.signalCode] || selectedAudit.value.signalCode),
          h('span', { class: 'detail-label' }, '处置'), h('span', ACTION_LABELS[selectedAudit.value.action] || selectedAudit.value.action),
          h('span', { class: 'detail-label' }, '状态'), h('span', STATUS_LABELS[selectedAudit.value.status] || selectedAudit.value.status),
          h('span', { class: 'detail-label' }, '同类累计'), h('span', `${selectedAudit.value.offenseCount} 次`),
          h('span', { class: 'detail-label' }, '规则'), h('span', selectedAudit.value.ruleId ? `#${selectedAudit.value.ruleId}` : '行为或名单信号'),
          h('span', { class: 'detail-label' }, '消息'), h('span', selectedAudit.value.messageId || '未知'),
        ]),
        h('div', { class: 'detail-section' }, [
          h('strong', '命中关键词'), h('p', selectedAudit.value.pattern || '无'),
        ]),
        h('div', { class: 'detail-section' }, [
          h('strong', '检测证据'), h('p', selectedAudit.value.evidence || '无'),
        ]),
        h('div', { class: 'detail-section' }, [
          h('strong', '消息内容'), h('p', { class: 'detail-content' }, selectedAudit.value.content || '无'),
        ]),
        selectedAudit.value.aiReason ? h('div', { class: 'detail-section' }, [
          h('strong', 'AI 复核'), h('p', selectedAudit.value.aiReason),
        ]) : null,
      ]),
    ])]) : null

    const renderAuditsView = () => [
      h('section', { class: 'filter-bar audit-filter-bar' }, [
        h('input', {
          class: 'console-input filter-input',
          value: auditUserId.value,
          placeholder: '用户 ID',
          onInput: (event: Event) => { auditUserId.value = (event.target as HTMLInputElement).value },
        }),
        h('input', {
          class: 'console-input filter-input',
          value: auditSearch.value,
          placeholder: '关键词',
          onInput: (event: Event) => { auditSearch.value = (event.target as HTMLInputElement).value },
        }),
        h('select', {
          class: 'filter-select',
          value: auditSignalCode.value,
          'aria-label': '信号类型',
          onChange: (event: Event) => { auditSignalCode.value = (event.target as HTMLSelectElement).value },
        }, [
          h('option', { value: '' }, '全部信号'),
          ...Object.entries(SIGNAL_LABELS).map(([value, label]) => h('option', { value }, label)),
        ]),
        h('select', {
          class: 'filter-select',
          value: auditState.value,
          'aria-label': '记录状态',
          onChange: (event: Event) => { auditState.value = (event.target as HTMLSelectElement).value },
        }, [
          h('option', { value: '' }, '全部状态'),
          ...Object.entries(STATUS_LABELS).map(([value, label]) => h('option', { value }, label)),
        ]),
        h('input', {
          class: 'filter-date',
          type: 'date',
          value: auditFrom.value,
          'aria-label': '开始日期',
          onChange: (event: Event) => { auditFrom.value = (event.target as HTMLInputElement).value },
        }),
        h('input', {
          class: 'filter-date',
          type: 'date',
          value: auditTo.value,
          'aria-label': '结束日期',
          onChange: (event: Event) => { auditTo.value = (event.target as HTMLInputElement).value },
        }),
        h('button', { class: 'console-button primary filter-submit', type: 'button', disabled: auditLoading.value, onClick: applyAuditFilters }, '筛选'),
      ]),
      h('section', { class: 'audit-table' }, [
        h('div', { class: 'audit-table-head' }, ['时间', '用户', '信号', '消息内容', '处置', '状态', '操作'].map((label) => h('span', label))),
        audits.value.length
          ? audits.value.map((record) => h('div', { class: 'audit-row', key: record.id }, [
            h('span', { title: record.createdAt }, formatDateTime(record.createdAt)),
            h('span', { title: record.userId }, record.userId),
            h('span', { title: record.signalCode }, SIGNAL_LABELS[record.signalCode] || record.signalCode),
            h('span', { class: 'audit-pattern', title: record.content }, record.content || '无'),
            h('span', ACTION_LABELS[record.action] || record.action),
            h('span', { class: ['status-badge', `status-${record.status}`] }, STATUS_LABELS[record.status] || record.status),
            h('span', { class: 'audit-operation' }, [h('button', {
              class: 'link-button primary',
              type: 'button',
              onClick: () => { selectedAudit.value = record },
            }, '查看详情')]),
          ]))
          : h('div', { class: 'audit-empty' }, guildId.value.trim() ? '暂无符合条件的违规记录。' : '请先选择群聊。'),
      ]),
      renderPagination(auditTotal.value, auditPage.value, auditPageCount.value, auditPageSize.value, auditLoading.value, changeAuditPageSize, (page) => {
        if (page >= 1 && page <= auditPageCount.value) void loadAudits(page)
      }),
      h('footer', { class: 'table-footer', 'aria-live': 'polite' }, [h('span', auditStatus.value)]),
    ]

    const renderOffensesView = () => [
      h('section', { class: 'filter-bar' }, [
        h('input', {
          class: 'console-input filter-input',
          value: offenseUserId.value,
          placeholder: '按用户 ID 筛选',
          onInput: (event: Event) => { offenseUserId.value = (event.target as HTMLInputElement).value },
        }),
        h('button', { class: 'console-button primary filter-submit', type: 'button', disabled: offenseLoading.value, onClick: () => { offensePage.value = 1; void loadOffenses(1) } }, '筛选'),
      ]),
      h('section', { class: 'offense-table' }, [
        h('div', { class: 'offense-table-head' }, ['用户', '类别', '次数', '最近信号', '最近命中', '最近处置', '更新时间', '操作'].map((label) => h('span', label))),
        offenses.value.length
          ? offenses.value.map((record) => h('div', { class: 'offense-row', key: record.id }, [
            h('span', { title: record.userId }, record.userId),
            h('span', record.category || '未分类'),
            h('span', { class: 'offense-count' }, String(record.offenseCount)),
            h('span', SIGNAL_LABELS[record.lastSignalCode] || record.lastSignalCode),
            h('span', { class: 'audit-pattern', title: record.lastPattern }, record.lastPattern || '无'),
            h('span', ACTION_LABELS[record.lastAction] || record.lastAction),
            h('span', formatDateTime(record.updatedAt)),
            h('span', { class: 'audit-operation' }, [h('button', {
              class: 'link-button danger',
              type: 'button',
              disabled: offenseLoading.value,
              onClick: () => void clearOffense(record),
            }, '清零')]),
          ]))
          : h('div', { class: 'audit-empty' }, guildId.value.trim() ? '暂无有效违规用户。' : '请先选择群聊。'),
      ]),
      renderPagination(offenseTotal.value, offensePage.value, offensePageCount.value, offensePageSize.value, offenseLoading.value, changeOffensePageSize, (page) => {
        if (page >= 1 && page <= offensePageCount.value) void loadOffenses(page)
      }),
      h('footer', { class: 'table-footer', 'aria-live': 'polite' }, [h('span', offenseStatus.value)]),
    ]

    const renderMain = () => h('div', { class: 'wordlist-main' }, [
      h('nav', { class: 'view-tabs', 'aria-label': '群治理视图' }, [
        h('button', { class: ['view-tab', { active: view.value === 'rules' }], type: 'button', onClick: () => switchView('rules') }, '词库管理'),
        h('button', { class: ['view-tab', { active: view.value === 'audits' }], type: 'button', onClick: () => switchView('audits') }, '审计记录'),
        h('button', { class: ['view-tab', { active: view.value === 'offenses' }], type: 'button', onClick: () => switchView('offenses') }, '违规用户'),
      ]),
      ...(view.value === 'rules' ? renderRulesView() : view.value === 'audits' ? renderAuditsView() : renderOffensesView()),
    ])

    return () => h(KLayout, { class: 'wordlist-layout' }, {
      header: () => [
        h('span', { class: 'wordlist-header-title' }, '群治理词库'),
        guildId.value.trim()
          ? h('span', { class: 'wordlist-header-group' }, `群 ${guildId.value.trim()}`)
          : null,
      ],
      menu: () => [
        view.value === 'rules' ? h('span', {
            class: ['menu-item', { disabled: busy.value }],
            role: 'button',
            tabindex: 0,
            title: '导入词库',
            onClick: () => { if (!busy.value) showImport.value = true },
            onKeydown: (event: KeyboardEvent) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              if (!busy.value) showImport.value = true
            },
          }, [h('span', { class: 'wordlist-menu-text' }, '导入')]) : null,
        h('span', {
          class: ['menu-item', { disabled: viewLoading.value }],
          role: 'button',
          tabindex: 0,
          title: '刷新当前视图',
          onClick: () => { if (!viewLoading.value) refreshCurrentView() },
          onKeydown: (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            if (!viewLoading.value) refreshCurrentView()
          },
        }, [h(KIcon, { class: 'menu-icon', name: 'refresh' })]),
      ],
      left: renderGroupSidebar,
      default: () => [renderMain(), renderImportDialog(), renderAuditDetail()],
    })
  },
})

export default function apply(ctx: Context) {
  ctx.page({
    path: '/group-assistant-wordlists',
    name: '群治理词库',
    desc: '管理群治理关键词词库',
    component: WordlistPage,
    authority: 4,
  })
}
