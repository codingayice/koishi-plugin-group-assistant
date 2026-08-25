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
    const ruleFilter = ref<'all' | RuleScope>('all')
    const rulePattern = ref('')
    const rulesLoading = ref(false)
    const rulesStatus = ref('填写群号后刷新规则列表。')
    const editingRuleId = ref<number>()
    const editingPattern = ref('')
    const editingScope = ref<RuleScope>('sensitive')

    const fileSize = computed(() => selectedFile.value ? formatFileSize(selectedFile.value.size) : '')
    const scopeLabel = computed(() => scope.value === 'redline' ? '红线词库' : '敏感词库')
    const visibleRules = computed(() => ruleFilter.value === 'all'
      ? rules.value
      : rules.value.filter((rule) => rule.scope === ruleFilter.value))

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
        await loadRules()
      } catch (error) {
        status.value = `导入失败：${error instanceof Error ? error.message : String(error)}`
        statusTone.value = 'error'
      } finally {
        busy.value = false
      }
    }

    return () => h('main', { class: 'group-assistant-wordlist-page' }, [
      h('header', { class: 'page-header' }, [
        h('div', { class: 'header-kicker' }, [
          h('span', { class: 'kicker-line' }),
          h('span', '群聊治理 / 规则资产'),
        ]),
        h('h1', '词库与规则'),
        h('p', '在一个工作台里导入词库，并维护指定群正在使用的治理规则。'),
      ]),
      h('section', { class: 'process-strip', 'aria-label': '导入流程' }, [
        h('div', { class: 'process-step active' }, [
          h('span', { class: 'step-number' }, '01'),
          h('span', '配置目标'),
        ]),
        h('span', { class: 'process-arrow' }, '/'),
        h('div', { class: 'process-step' }, [
          h('span', { class: 'step-number' }, '02'),
          h('span', '上传文件'),
        ]),
        h('span', { class: 'process-arrow' }, '/'),
        h('div', { class: 'process-step' }, [
          h('span', { class: 'step-number' }, '03'),
          h('span', '批量写入'),
        ]),
      ]),
      h('section', { class: 'import-layout' }, [
        h('div', { class: 'config-panel panel' }, [
          h('div', { class: 'panel-heading' }, [
            h('div', { class: 'panel-index' }, 'A'),
            h('div', [
              h('h2', '导入配置'),
              h('p', '选择词库归属，规则只会作用于这个群。'),
            ]),
          ]),
          h('label', { class: 'field-label', for: 'group-assistant-guild-id' }, '目标群号'),
          h('input', {
            id: 'group-assistant-guild-id',
            class: 'text-input',
            value: guildId.value,
            placeholder: '例如 1047767828',
            disabled: busy.value,
            onInput: (event: Event) => { guildId.value = (event.target as HTMLInputElement).value },
          }),
          h('p', { class: 'field-help' }, '填写机器人已加入的群号。'),
          h('div', { class: 'field-label scope-label' }, '词库类型'),
          h('div', { class: 'scope-options' }, [
            h('label', { class: ['scope-option', { selected: scope.value === 'sensitive' }] }, [
              h('input', {
                type: 'radio',
                name: 'wordlist-scope',
                value: 'sensitive',
                checked: scope.value === 'sensitive',
                disabled: busy.value,
                onChange: () => { scope.value = 'sensitive' },
              }),
              h('span', { class: 'scope-mark sensitive-mark' }, 'S'),
              h('span', { class: 'scope-copy' }, [
                h('strong', '敏感词库'),
                h('small', '进入 AI 异步复核'),
              ]),
            ]),
            h('label', { class: ['scope-option', { selected: scope.value === 'redline' }] }, [
              h('input', {
                type: 'radio',
                name: 'wordlist-scope',
                value: 'redline',
                checked: scope.value === 'redline',
                disabled: busy.value,
                onChange: () => { scope.value = 'redline' },
              }),
              h('span', { class: 'scope-mark redline-mark' }, '!'),
              h('span', { class: 'scope-copy' }, [
                h('strong', '红线词库'),
                h('small', '命中后立即处置'),
              ]),
            ]),
          ]),
          h('div', { class: 'config-note' }, [
            h('span', { class: 'note-mark' }, 'i'),
            h('span', '每行一个关键词，空行和 # 开头的注释会自动忽略。'),
          ]),
        ]),
        h('div', { class: 'file-panel panel' }, [
          h('div', { class: 'panel-heading' }, [
            h('div', { class: 'panel-index' }, 'B'),
            h('div', [
              h('h2', '上传词库文件'),
              h('p', '支持 UTF-8 编码 TXT，单次最多 2 MB。'),
            ]),
          ]),
          h('label', {
            class: ['dropzone', { dragging: dragging.value, 'has-file': !!selectedFile.value }],
            onDragover: (event: DragEvent) => { event.preventDefault(); if (!busy.value) dragging.value = true },
            onDragleave: () => { dragging.value = false },
            onDrop: dropFile,
          }, [
            h('input', { type: 'file', accept: '.txt,text/plain', disabled: busy.value, onChange: chooseFile }),
            h('div', { class: 'upload-symbol' }, selectedFile.value ? 'TXT' : '+'),
            h('strong', selectedFile.value ? selectedFile.value.name : '拖入 TXT 文件，或点击选择'),
            h('span', { class: 'dropzone-meta' }, selectedFile.value ? `${fileSize.value} · ${scopeLabel.value}` : '单文件最大 2 MB'),
            selectedFile.value ? h('button', {
              type: 'button',
              class: 'clear-file',
              disabled: busy.value,
              onClick: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); setFile() },
            }, '移除文件') : null,
          ]),
          h('div', { class: 'upload-footer' }, [
            h('span', { class: 'format-badge' }, 'UTF-8 / TXT'),
            h('span', '导入后自动去重，不覆盖已有规则'),
          ]),
          h('button', {
            class: 'submit-button',
            type: 'button',
            disabled: busy.value,
            onClick: submit,
          }, [
            h('span', { class: 'button-icon' }, busy.value ? '...' : '↑'),
            h('span', busy.value ? '正在导入' : '上传并导入'),
          ]),
        ]),
      ]),
      h('section', { class: 'rules-panel panel' }, [
        h('div', { class: 'rules-heading' }, [
          h('div', { class: 'panel-heading' }, [
            h('div', { class: 'panel-index' }, 'C'),
            h('div', [
              h('h2', '规则管理'),
              h('p', '在这里完成新增、查询、编辑、启用和删除。'),
            ]),
          ]),
          h('button', {
            class: 'refresh-button',
            type: 'button',
            disabled: rulesLoading.value,
            onClick: () => void loadRules(),
          }, rulesLoading.value ? '读取中...' : '刷新列表'),
        ]),
        h('div', { class: 'rule-create-bar' }, [
          h('input', {
            class: 'rule-create-input',
            value: rulePattern.value,
            placeholder: `添加${scopeLabel.value}关键词`,
            disabled: rulesLoading.value,
            onInput: (event: Event) => { rulePattern.value = (event.target as HTMLInputElement).value },
            onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') void createRule() },
          }),
          h('span', { class: ['current-scope', scope.value] }, scopeLabel.value),
          h('button', {
            class: 'create-button',
            type: 'button',
            disabled: rulesLoading.value,
            onClick: () => void createRule(),
          }, '+ 添加规则'),
        ]),
        h('div', { class: 'rules-toolbar' }, [
          h('span', { class: 'rules-count' }, `共 ${visibleRules.value.length} 条`),
          h('span', { class: 'rules-status' }, rulesStatus.value),
          h('select', {
            class: 'filter-select',
            value: ruleFilter.value,
            disabled: rulesLoading.value,
            onChange: (event: Event) => { ruleFilter.value = (event.target as HTMLSelectElement).value as typeof ruleFilter.value; void loadRules() },
          }, [
            h('option', { value: 'all' }, '全部分类'),
            h('option', { value: 'sensitive' }, '仅敏感'),
            h('option', { value: 'redline' }, '仅红线'),
          ]),
        ]),
        h('div', { class: 'rules-table' }, [
          h('div', { class: 'rules-table-head' }, [
            h('span', '编号'),
            h('span', '关键词'),
            h('span', '分类'),
            h('span', '状态'),
            h('span', '创建时间'),
            h('span', '操作'),
          ]),
          visibleRules.value.length
            ? visibleRules.value.map(renderRuleRow)
            : h('div', { class: 'rules-empty' }, [
              h('strong', guildId.value.trim() ? '暂无规则' : '先填写目标群号'),
              h('span', guildId.value.trim() ? '可以从上方添加关键词，或上传词库文件。' : '填写群号后点击“刷新列表”查看规则。'),
            ]),
        ]),
      ]),
      h('section', { class: ['status-panel', `status-${statusTone.value}`], 'aria-live': 'polite' }, [
        h('div', { class: 'status-indicator' }, statusTone.value === 'success' ? 'OK' : statusTone.value === 'error' ? '!' : statusTone.value === 'working' ? '...' : '·'),
        h('div', { class: 'status-copy' }, [
          h('span', { class: 'status-label' }, statusTone.value === 'working' ? '正在处理' : statusTone.value === 'success' ? '导入完成' : statusTone.value === 'error' ? '需要处理' : '导入状态'),
          h('strong', status.value),
        ]),
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
