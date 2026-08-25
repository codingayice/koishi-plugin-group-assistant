import { Context, receive, send } from '@koishijs/client'
import { computed, defineComponent, h, ref } from 'vue'
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

interface GroupRecord {
  guildId: string
  ruleCount: number
  enabledCount: number
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

function formatRuleDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

const WordlistImportPage = defineComponent({
  setup() {
    const guildId = ref('')
    const scope = ref<'redline' | 'sensitive'>('sensitive')
    const selectedFile = ref<File>()
    const busy = ref(false)
    const dragging = ref(false)
    const status = ref('等待选择词库文件。')
    const statusTone = ref<'idle' | 'working' | 'success' | 'error'>('idle')
    const jobId = ref('')
    const rules = ref<RuleRecord[]>([])
    const groups = ref<GroupRecord[]>([])
    const groupsLoading = ref(false)
    const guildInputElement = ref<HTMLInputElement>()
    const ruleFilter = ref<'all' | RuleScope>('all')
    const ruleSearch = ref('')
    const rulePattern = ref('')
    const rulesLoading = ref(false)
    const rulesStatus = ref('填写群号后刷新规则列表。')
    const editingRuleId = ref<number>()
    const editingPattern = ref('')
    const editingScope = ref<RuleScope>('sensitive')
    const showImport = ref(false)

    const fileSize = computed(() => selectedFile.value ? formatFileSize(selectedFile.value.size) : '')
    const scopeLabel = computed(() => scope.value === 'redline' ? '红线词库' : '敏感词库')
    const visibleRules = computed(() => {
      const search = ruleSearch.value.trim().toLowerCase()
      return rules.value.filter((rule) => {
        const matchesScope = ruleFilter.value === 'all' || rule.scope === ruleFilter.value
        const matchesSearch = !search || rule.pattern.toLowerCase().includes(search)
        return matchesScope && matchesSearch
      })
    })

    receive('group-assistant/import-progress', (data: { jobId?: string; message?: string }) => {
      if (data?.jobId !== jobId.value || !data.message) return
      status.value = data.message
      statusTone.value = 'working'
    })

    const setFile = (file?: File) => {
      selectedFile.value = file
      if (!file) {
        status.value = '等待选择词库文件。'
        statusTone.value = 'idle'
        return
      }
      status.value = `已选择 ${file.name}，确认配置后即可导入。`
      statusTone.value = 'idle'
    }

    const chooseFile = (event: Event) => {
      const input = event.target as HTMLInputElement
      setFile(input.files?.[0])
    }

    const dropFile = (event: DragEvent) => {
      event.preventDefault()
      dragging.value = false
      if (busy.value) return
      setFile(event.dataTransfer?.files?.[0])
    }

    const loadGroups = async () => {
      groupsLoading.value = true
      try {
        const result = await send('group-assistant/list-groups')
        groups.value = Array.isArray(result) ? result as GroupRecord[] : []
        if (!guildId.value.trim() && groups.value.length) {
          guildId.value = groups.value[0].guildId
          await loadRules()
        }
      } catch (error) {
        rulesStatus.value = `群列表读取失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        groupsLoading.value = false
      }
    }

    const selectGroup = (group: GroupRecord) => {
      guildId.value = group.guildId
      ruleSearch.value = ''
      ruleFilter.value = 'all'
      void loadRules()
    }

    const focusGroupInput = () => {
      guildInputElement.value?.focus()
      guildInputElement.value?.select()
    }

    const loadRules = async () => {
      const targetGuildId = guildId.value.trim()
      if (!targetGuildId) {
        rules.value = []
        rulesStatus.value = '请先填写目标群号。'
        return
      }
      rulesLoading.value = true
      rulesStatus.value = '正在读取规则列表。'
      try {
        const result = await send('group-assistant/list-rules', {
          guildId: targetGuildId,
          scope: ruleFilter.value === 'all' ? undefined : ruleFilter.value,
        })
        rules.value = Array.isArray(result) ? result as RuleRecord[] : []
        rulesStatus.value = `已加载 ${rules.value.length} 条规则。`
      } catch (error) {
        rulesStatus.value = `读取失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
    }

    void loadGroups()

    const createRule = async () => {
      const targetGuildId = guildId.value.trim()
      const pattern = rulePattern.value.trim()
      if (!targetGuildId) {
        rulesStatus.value = '请先填写目标群号。'
        return
      }
      if (!pattern) {
        rulesStatus.value = '请输入要添加的关键词。'
        return
      }
      rulesLoading.value = true
      rulesStatus.value = '正在创建规则。'
      try {
        await send('group-assistant/create-rule', {
          guildId: targetGuildId,
          scope: scope.value,
          pattern,
        })
        rulePattern.value = ''
        rulesStatus.value = '规则创建成功。'
        await loadRules()
        await loadGroups()
      } catch (error) {
        rulesStatus.value = `创建失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
    }

    const beginEdit = (rule: RuleRecord) => {
      editingRuleId.value = rule.id
      editingPattern.value = rule.pattern
      editingScope.value = rule.scope
    }

    const cancelEdit = () => {
      editingRuleId.value = undefined
      editingPattern.value = ''
    }

    const saveEdit = async (rule: RuleRecord) => {
      const targetGuildId = guildId.value.trim()
      const pattern = editingPattern.value.trim()
      if (!pattern) {
        rulesStatus.value = '规则内容不能为空。'
        return
      }
      rulesLoading.value = true
      rulesStatus.value = `正在更新规则 #${rule.id}。`
      try {
        await send('group-assistant/update-rule', {
          guildId: targetGuildId,
          id: rule.id,
          scope: editingScope.value,
          pattern,
          enabled: rule.enabled,
        })
        cancelEdit()
        rulesStatus.value = '规则更新成功。'
        await loadRules()
      } catch (error) {
        rulesStatus.value = `更新失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
    }

    const toggleRule = async (rule: RuleRecord) => {
      const targetGuildId = guildId.value.trim()
      rulesLoading.value = true
      rulesStatus.value = `${rule.enabled ? '正在禁用' : '正在启用'}规则 #${rule.id}。`
      try {
        await send('group-assistant/update-rule', {
          guildId: targetGuildId,
          id: rule.id,
          scope: rule.scope,
          pattern: rule.pattern,
          enabled: !rule.enabled,
        })
        rulesStatus.value = `规则 #${rule.id} 已${rule.enabled ? '禁用' : '启用'}。`
        await loadRules()
      } catch (error) {
        rulesStatus.value = `更新失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
    }

    const deleteRule = async (rule: RuleRecord) => {
      if (!window.confirm(`确定删除规则 #${rule.id}「${rule.pattern}」吗？`)) return
      rulesLoading.value = true
      rulesStatus.value = `正在删除规则 #${rule.id}。`
      try {
        await send('group-assistant/delete-rule', {
          guildId: guildId.value.trim(),
          id: rule.id,
        })
        rulesStatus.value = `规则 #${rule.id} 已删除。`
        await loadRules()
        await loadGroups()
      } catch (error) {
        rulesStatus.value = `删除失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
    }

    const renderRuleRow = (rule: RuleRecord) => {
      const editing = editingRuleId.value === rule.id
      return h('div', { class: ['rule-row', { disabled: !rule.enabled, editing }], key: rule.id }, [
        h('span', { class: 'rule-id' }, `#${rule.id}`),
        editing
          ? h('input', {
            class: 'rule-edit-input',
            value: editingPattern.value,
            disabled: rulesLoading.value,
            onInput: (event: Event) => { editingPattern.value = (event.target as HTMLInputElement).value },
            onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') void saveEdit(rule) },
          })
          : h('span', { class: 'rule-pattern', title: rule.pattern }, rule.pattern),
        editing
          ? h('select', {
            class: 'rule-scope-select',
            value: editingScope.value,
            disabled: rulesLoading.value,
            onChange: (event: Event) => { editingScope.value = (event.target as HTMLSelectElement).value as RuleScope },
          }, [
            h('option', { value: 'sensitive' }, '敏感'),
            h('option', { value: 'redline' }, '红线'),
          ])
          : h('span', { class: ['rule-scope', rule.scope] }, rule.scope === 'redline' ? '红线' : '敏感'),
        h('span', { class: ['rule-state', rule.enabled ? 'enabled' : 'disabled'] }, rule.enabled ? '启用' : '停用'),
        h('span', { class: 'rule-date' }, formatRuleDate(rule.createdAt)),
        h('div', { class: 'rule-actions' }, editing ? [
          h('button', { class: 'text-button primary', type: 'button', disabled: rulesLoading.value, onClick: () => void saveEdit(rule) }, '保存'),
          h('button', { class: 'text-button', type: 'button', disabled: rulesLoading.value, onClick: cancelEdit }, '取消'),
        ] : [
          h('button', { class: 'text-button', type: 'button', disabled: rulesLoading.value, onClick: () => beginEdit(rule) }, '编辑'),
          h('button', { class: 'text-button', type: 'button', disabled: rulesLoading.value, onClick: () => void toggleRule(rule) }, rule.enabled ? '停用' : '启用'),
          h('button', { class: 'text-button danger', type: 'button', disabled: rulesLoading.value, onClick: () => void deleteRule(rule) }, '删除'),
        ]),
      ])
    }

    const submit = async () => {
      const file = selectedFile.value
      const targetGuildId = guildId.value.trim()
      if (!targetGuildId) {
        status.value = '请先填写目标群号。'
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
      status.value = '正在上传文件，准备解析词库。'
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

    return () => h('main', { class: 'group-assistant-wordlist-page' }, [
      h('div', { class: 'module-sidebar', 'aria-label': '模块导航' }, [
        h('div', { class: 'module-symbol' }, '✣'),
        h('div', { class: 'module-symbol' }, '▣'),
        h('div', { class: ['module-symbol', 'active'] }, '▤'),
        h('div', { class: 'module-symbol' }, '⚙'),
      ]),
      h('aside', { class: 'group-sidebar' }, [
        h('div', { class: 'group-sidebar-header' }, [
          h('span', `群聊词库 (${groups.value.length})`),
          h('button', {
            class: 'group-add-button',
            type: 'button',
            title: '输入群号',
            onClick: focusGroupInput,
          }, '+'),
        ]),
        h('div', { class: 'group-list' }, groupsLoading.value
          ? [h('div', { class: 'group-list-empty' }, '加载中...')]
          : groups.value.length
            ? groups.value.map((group) => h('button', {
              class: ['group-item', { active: guildId.value === group.guildId }],
              type: 'button',
              onClick: () => selectGroup(group),
            }, [
              h('span', { class: 'group-item-id' }, group.guildId),
            ]))
            : [h('div', { class: 'group-list-empty' }, '暂无线库群聊')]),
      ]),
      h('div', { class: 'workspace-shell' }, [
      h('header', { class: 'workspace-header' }, [
        h('div', { class: 'workspace-title' }, [
          h('h1', guildId.value.trim() || '未选择群聊'),
          h('span', `(${scopeLabel.value})`),
        ]),
        h('div', { class: 'header-actions' }, [
          h('button', {
            class: 'header-button',
            type: 'button',
            disabled: busy.value,
            onClick: () => { showImport.value = true },
          }, '导入'),
          h('button', {
            class: 'header-button primary',
            type: 'button',
            disabled: rulesLoading.value,
            onClick: () => void loadRules(),
          }, rulesLoading.value ? '读取中...' : '刷新列表'),
        ]),
      ]),
      h('section', { class: 'workspace-toolbar' }, [
        h('label', { class: 'toolbar-field', for: 'group-assistant-guild-id' }, [
          h('span', '目标群号'),
          h('input', {
            id: 'group-assistant-guild-id',
            class: 'ks-input guild-input',
            ref: guildInputElement,
            value: guildId.value,
            placeholder: '例如 1047767828',
            disabled: busy.value,
            onInput: (event: Event) => { guildId.value = (event.target as HTMLInputElement).value },
            onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') void loadRules() },
          }),
        ]),
        h('label', { class: 'toolbar-field scope-field' }, [
          h('span', '当前词库'),
          h('select', {
            class: 'ks-input scope-select',
            value: scope.value,
            disabled: busy.value,
            onChange: (event: Event) => { scope.value = (event.target as HTMLSelectElement).value as RuleScope },
          }, [
            h('option', { value: 'sensitive' }, '敏感词库'),
            h('option', { value: 'redline' }, '红线词库'),
          ]),
        ]),
        h('span', { class: 'toolbar-hint' }, '规则仅作用于当前群聊，敏感词进入异步复核，红线词直接处置。'),
      ]),
      h('section', { class: 'rules-workspace' }, [
        h('div', { class: 'rules-toolbar' }, [
          h('div', { class: 'rules-toolbar-title' }, [
            h('strong', '规则列表'),
            h('span', `${visibleRules.value.length} 条`),
          ]),
          h('span', { class: 'rules-status' }, rulesStatus.value),
          h('button', {
            class: 'compact-refresh',
            type: 'button',
            disabled: rulesLoading.value,
            title: '刷新规则列表',
            onClick: () => void loadRules(),
          }, '↻'),
        ]),
        h('div', { class: 'rules-table' }, [
          h('div', { class: 'rules-table-head' }, [
            h('span', '#'),
            h('span', '关键词 (word)'),
            h('span', '分类 (scope)'),
            h('span', '状态'),
            h('span', '创建时间 (createdAt)'),
            h('span', { class: 'table-actions-title' }, '操作'),
          ]),
          h('div', { class: 'rule-filter-row' }, [
            h('span'),
            h('input', {
              class: 'ks-input',
              value: ruleSearch.value,
              placeholder: '搜索关键词...',
              onInput: (event: Event) => { ruleSearch.value = (event.target as HTMLInputElement).value },
            }),
            h('select', {
              class: 'ks-input',
              value: ruleFilter.value,
              disabled: rulesLoading.value,
              onChange: (event: Event) => { ruleFilter.value = (event.target as HTMLSelectElement).value as typeof ruleFilter.value; void loadRules() },
            }, [
              h('option', { value: 'all' }, '全部'),
              h('option', { value: 'sensitive' }, '敏感'),
              h('option', { value: 'redline' }, '红线'),
            ]),
            h('span'),
            h('span'),
            h('span', { class: 'insert-label' }, '筛选'),
          ]),
          h('div', { class: 'rule-quick-row' }, [
            h('span', { class: 'quick-add-mark' }, '+'),
            h('input', {
              class: 'ks-input quick-input',
              value: rulePattern.value,
              placeholder: '输入新关键词...',
              disabled: rulesLoading.value,
              onInput: (event: Event) => { rulePattern.value = (event.target as HTMLInputElement).value },
              onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') void createRule() },
            }),
            h('span', { class: ['scope-tag', scope.value] }, scopeLabel.value),
            h('span', { class: 'quick-auto' }, '启用'),
            h('span', { class: 'quick-auto' }, '自动生成'),
            h('button', {
              class: 'quick-submit',
              type: 'button',
              disabled: rulesLoading.value,
              onClick: () => void createRule(),
            }, '确认'),
          ]),
          visibleRules.value.length
            ? visibleRules.value.map(renderRuleRow)
            : h('div', { class: 'rules-empty' }, [
              h('strong', guildId.value.trim() ? '暂无规则' : '先填写目标群号'),
              h('span', guildId.value.trim() ? '可以从上方快速添加关键词，或点击右上角导入 TXT 词库。' : '填写群号后点击“刷新列表”查看规则。'),
            ]),
        ]),
      ]),
      h('footer', { class: ['status-bar', `status-${statusTone.value}`], 'aria-live': 'polite' }, [
        h('div', { class: 'status-left' }, [
          h('span', { class: 'status-dot' }),
          h('span', status.value),
        ]),
        h('span', `Total: ${visibleRules.value.length}`),
      ]),
      showImport.value ? h('div', {
        class: 'import-modal-backdrop',
        role: 'presentation',
        onClick: () => { if (!busy.value) showImport.value = false },
      }, [
        h('section', {
          class: 'import-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'group-assistant-import-title',
          onClick: (event: MouseEvent) => { event.stopPropagation() },
        }, [
          h('div', { class: 'modal-header' }, [
            h('h2', { id: 'group-assistant-import-title' }, '批量导入词库'),
            h('button', {
              class: 'modal-close',
              type: 'button',
              disabled: busy.value,
              title: '关闭',
              onClick: () => { showImport.value = false },
            }, '×'),
          ]),
          h('div', { class: 'modal-body' }, [
            h('p', { class: 'modal-description' }, `将 TXT 文件导入群 ${guildId.value.trim() || '未填写'} 的${scopeLabel.value}。`),
            h('label', {
              class: ['dropzone', { dragging: dragging.value, 'has-file': !!selectedFile.value }],
              onDragover: (event: DragEvent) => { event.preventDefault(); if (!busy.value) dragging.value = true },
              onDragleave: () => { dragging.value = false },
              onDrop: dropFile,
            }, [
              h('input', { type: 'file', accept: '.txt,text/plain', disabled: busy.value, onChange: chooseFile }),
              h('div', { class: 'upload-symbol' }, selectedFile.value ? 'TXT' : '↑'),
              h('strong', selectedFile.value ? selectedFile.value.name : '点击上传或拖拽 TXT 文件'),
              h('span', { class: 'dropzone-meta' }, selectedFile.value ? `${fileSize.value} · UTF-8` : '单文件最大 2 MB'),
              selectedFile.value ? h('button', {
                type: 'button',
                class: 'clear-file',
                disabled: busy.value,
                onClick: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); setFile() },
              }, '移除文件') : null,
            ]),
            h('div', { class: 'modal-note' }, '每行一个关键词，空行和 # 开头的注释会自动忽略；导入过程会自动去重。'),
            statusTone.value === 'error' ? h('div', { class: 'modal-error' }, status.value) : null,
          ]),
          h('div', { class: 'modal-footer' }, [
            h('button', {
              class: 'modal-button',
              type: 'button',
              disabled: busy.value,
              onClick: () => { showImport.value = false },
            }, '取消'),
            h('button', {
              class: 'modal-button primary',
              type: 'button',
              disabled: busy.value,
              onClick: submit,
            }, busy.value ? '正在导入...' : '开始导入'),
          ]),
        ]),
      ]) : null,
      ]),
    ])
  },
})

export default function apply(ctx: Context) {
  ctx.page({
    path: '/group-assistant-wordlists',
    name: '群治理词库',
    desc: '上传并导入群治理词库',
    component: WordlistImportPage,
    authority: 4,
  })
}
