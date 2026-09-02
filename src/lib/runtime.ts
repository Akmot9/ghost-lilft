import { isTauri } from '@tauri-apps/api/core'

/**
 * Un seul endroit décide si l'app tourne dans le runtime Tauri ou dans un
 * navigateur nu (dev, e2e) : la fonction était dupliquée mot pour mot dans
 * trois fichiers (#57).
 *
 * Le repli sur `__TAURI_INTERNALS__` couvre les tests où `mockIPC` installe
 * le pont sans poser `isTauri`.
 */
export function runningInTauri(): boolean {
  if (typeof isTauri === 'function') {
    return isTauri()
  }

  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
