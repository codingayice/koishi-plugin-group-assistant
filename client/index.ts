import { Context, receive, send } from '@koishijs/client'
import { computed, defineComponent, h, ref } from 'vue'
import './style.css'

const MAX_WORDLIST_BYTES = 2 * 1024 * 1024

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

    const fileSize = computed(() => selectedFile.value ? formatFileSize(selectedFile.value.size) : '')
    const scopeLabel = computed(() => scope.value === 'redline' ? '红线词库' : '敏感词库')

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
        h('h1', '词库导入'),
        h('p', '把可复用的治理词库安全地加入指定群，导入后立即参与消息检测。'),
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
