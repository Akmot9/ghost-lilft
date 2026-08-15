import { isTauri } from '@tauri-apps/api/core'

/**
 * Seule unité qui connaît les plugins de fichiers. Le repli navigateur n'est
 * pas une commodité de développement : c'est ce qui rend l'export et l'import
 * vérifiables en e2e, donc en intégration continue.
 *
 * Les imports des plugins sont dynamiques pour que le mode navigateur n'ait
 * jamais à les charger.
 */
function runningInTauri(): boolean {
  if (typeof isTauri === 'function') {
    return isTauri()
  }

  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function saveTextFile(suggestedName: string, contents: string): Promise<boolean> {
  if (!runningInTauri()) {
    downloadInBrowser(suggestedName, contents)
    return true
  }

  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: 'Sauvegarde Revenant', extensions: ['json'] }],
  })

  if (!path) {
    return false
  }

  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(path, contents)

  return true
}

export async function pickTextFile(): Promise<string | null> {
  if (!runningInTauri()) {
    return pickInBrowser()
  }

  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Sauvegarde Revenant', extensions: ['json'] }],
  })

  if (typeof path !== 'string') {
    return null
  }

  const { readTextFile } = await import('@tauri-apps/plugin-fs')

  return readTextFile(path)
}

function downloadInBrowser(fileName: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function pickInBrowser(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')

    input.type = 'file'
    input.accept = 'application/json,.json'
    input.dataset.testid = 'backup-file-input'
    input.style.display = 'none'

    const finish = (text: string | null) => {
      input.remove()
      resolve(text)
    }

    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      finish(file ? await file.text() : null)
    })

    // Annulation : les navigateurs émettent `cancel` sans émettre `change`.
    // Sans ce gestionnaire, la promesse resterait pendante et l'input
    // s'accumulerait dans le document à chaque abandon.
    input.addEventListener('cancel', () => finish(null))

    document.body.append(input)
    input.click()
  })
}
