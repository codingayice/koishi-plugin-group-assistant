import { Context, receive, send } from '@koishijs/client'
import { defineComponent, h, ref } from 'vue'

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

const WordlistImportPage = defineComponent({
  setup() {
    const guildId = ref('')
    const scope = ref<'redline' | 'sensitive'>('sensitive')
    const selectedFile = ref<File>()
    const busy = ref(false)
    const status = ref('选择 TXT 文件并填写目标群号。')
    const jobId = ref('')

    receive('group-assistant/import-progress', (data: { jobId?: string; message?: string }) => {
      if (data?.jobId !== jobId.value || !data.message) return
      status.value = data.message
    })

    const chooseFile = (event: Event) => {
      const input = event.target as HTMLInputElement
      const file = input.files?.[0]
      selectedFile.value = file
      status.value = file ? `已选择 ${file.name}，等待上传。` : '请选择 TXT 文件。'
    }

    const submit = async () => {
      const file = selectedFile.value
      const targetGuildId = guildId.value.trim()
      if (!targetGuildId) {
        status.value = '请填写目标群号。'
        return
      }
      if (!file) {
        status.value = '请选择 TXT 文件。'
        return
      }
      if (!file.name.toLowerCase().endsWith('.txt')) {
        status.value = '只支持 TXT 文件。'
        return
      }
      if (file.size > MAX_WORDLIST_BYTES) {
        status.value = '文件不能超过 2 MB。'
        return
      }

      busy.value = true
      jobId.value = Math.random().toString(36).slice(2)
      status.value = '正在上传文件，请稍候。'
      try {
        const content = encodeBase64(await file.arrayBuffer())
        const result = await send('group-assistant/import-wordlist', {
          guildId: targetGuildId,
          scope: scope.value,
          filename: file.name,
          content,
          jobId: jobId.value,
        })
        status.value = String(result || '词库导入完成。')
      } catch (error) {
        status.value = `导入失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        busy.value = false
      }
    }

    return () => h('main', { class: 'group-assistant-wordlist-page' }, [
      h('h1', '群治理词库导入'),
      h('p', '通过管理控制台上传 TXT 词库，导入到指定群。'),
      h('label', [
        h('span', '目标群号'),
        h('input', {
          value: guildId.value,
          placeholder: '例如：1047767828',
          disabled: busy.value,
          onInput: (event: Event) => { guildId.value = (event.target as HTMLInputElement).value },
        }),
      ]),
      h('label', [
        h('span', '词库分类'),
        h('select', {
          value: scope.value,
          disabled: busy.value,
          onChange: (event: Event) => { scope.value = (event.target as HTMLSelectElement).value as typeof scope.value },
        }, [
          h('option', { value: 'sensitive' }, '敏感词库'),
          h('option', { value: 'redline' }, '红线词库'),
        ]),
      ]),
      h('label', [
        h('span', 'TXT 文件'),
        h('input', { type: 'file', accept: '.txt,text/plain', disabled: busy.value, onChange: chooseFile }),
      ]),
      h('button', { type: 'button', disabled: busy.value, onClick: submit }, busy.value ? '导入中...' : '上传并导入'),
      h('output', { role: 'status' }, status.value),
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
