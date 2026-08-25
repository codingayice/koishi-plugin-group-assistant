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

const WordlistPage = defineComponent({
  setup() {
    const guildId = ref('')
    const scope = ref<RuleScope>('sensitive')
    const groups = ref<GroupRecord[]>([])
    const groupsLoading = ref(false)
    const rules = ref<RuleRecord[]>([])
    const ruleSearch = ref('')
    const rulePattern = ref('')
    const rulesLoading = ref(false)
    const rulesStatus = ref('填写群号后加载词库。')
    const editingRuleId = ref<number>()
    const editingPattern = ref('')

    const showImport = ref(false)
    const selectedFile = ref<File>()
    const busy = ref(false)
    const dragging = ref(false)
    const status = ref('等待选择词库文件。')
    const statusTone = ref<'idle' | 'working' | 'success' | 'error'>('idle')
    const jobId = ref('')

    const scopeLabel = computed(() => scope.value === 'redline' ? '红线词库' : '敏感词库')
    const fileSize = computed(() => selectedFile.value ? formatFileSize(selectedFile.value.size) : '')
    const visibleRules = computed(() => {
      const search = ruleSearch.value.trim().toLowerCase()
      return rules.value.filter((rule) => rule.scope === scope.value && (!search || rule.pattern.toLowerCase().includes(search)))
    })

    receive('group-assistant/import-progress', (data: { jobId?: string; message?: string }) => {
      if (data?.jobId !== jobId.value || !data.message) return
      status.value = data.message
      statusTone.value = 'working'
    })

    const loadRules = async () => {
      const targetGuildId = guildId.value.trim()
      if (!targetGuildId) {
        rules.value = []
        rulesStatus.value = '请先填写群号。'
        return
      }
      rulesLoading.value = true
      rulesStatus.value = `正在加载${scopeLabel.value}。`
      try {
        const result = await send('group-assistant/list-rules', {
          guildId: targetGuildId,
          scope: scope.value,
        })
        rules.value = Array.isArray(result) ? result as RuleRecord[] : []
        rulesStatus.value = `已加载 ${rules.value.length} 条关键词。`
      } catch (error) {
        rulesStatus.value = `加载失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        rulesLoading.value = false
      }
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
      editingRuleId.value = undefined
      editingPattern.value = ''
      void loadRules()
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

    return () => h('main', { class: 'wordlist-page' }, [
      h('aside', { class: 'group-sidebar' }, [
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
      ]),
      h('div', { class: 'page-main' }, [
      h('header', { class: 'page-heading' }, [
        h('div', [
          h('h1', '群治理词库'),
          h('p', guildId.value.trim() ? `当前群：${guildId.value.trim()}` : '填写群号后管理对应群聊的词库。'),
        ]),
        h('button', {
          class: 'console-button',
          type: 'button',
          disabled: busy.value,
          onClick: () => { showImport.value = true },
        }, '导入词库'),
      ]),
      h('section', { class: 'control-bar' }, [
        h('button', {
          class: 'console-button primary',
          type: 'button',
          disabled: rulesLoading.value,
          onClick: () => void loadRules(),
        }, rulesLoading.value ? '刷新中...' : '刷新'),
        h('input', {
          class: 'console-input search-input',
          value: ruleSearch.value,
          placeholder: '搜索关键词',
          onInput: (event: Event) => { ruleSearch.value = (event.target as HTMLInputElement).value },
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
      h('footer', { class: 'table-footer', 'aria-live': 'polite' }, [
        h('span', `共 ${visibleRules.value.length} 条`),
        h('span', rulesStatus.value),
      ]),
      showImport.value ? h('div', {
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
        ])]) : null,
      ]),
    ])
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
