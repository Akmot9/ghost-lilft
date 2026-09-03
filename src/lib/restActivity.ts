import { invoke, isTauri } from '@tauri-apps/api/core'

/**
 * La Live Activity du repos : pendant qu'un repos court, iOS affiche un
 * chrono vivant sur l'écran verrouillé et dans le Dynamic Island — rendu
 * par le système, l'app n'a rien à rafraîchir.
 *
 * iOS 16.2+ seulement, et comme la notification de fin de repos : toute
 * défaillance est avalée, le minuteur affiché reste la source de vérité.
 * Les échéances voyagent en millisecondes epoch — jamais en chaînes de
 * date (le bug de fuseau de plugins-workspace#3256 ne se reproduira pas).
 */

function runningInTauri(): boolean {
  if (typeof isTauri === 'function') {
    return isTauri()
  }

  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

/** Démarre (ou remplace) l'activité du repos en cours. */
export async function startRestActivity(endsAt: Date, exerciseName: string, target: string) {
  if (!runningInTauri() || !isIos()) {
    return
  }

  try {
    await invoke('plugin:rest-activity|start_activity', {
      exerciseName,
      target,
      endsAtEpochMs: endsAt.getTime(),
    })
  } catch {
    // iOS < 16.2, activités désactivées par l'utilisateur : silence — la
    // notification de fin de repos couvre déjà l'écran verrouillé.
  }
}

/** −15 s / +15 s : l'échéance bouge, l'activité suit. */
export async function updateRestActivity(endsAt: Date) {
  if (!runningInTauri() || !isIos()) {
    return
  }

  try {
    await invoke('plugin:rest-activity|update_activity', { endsAtEpochMs: endsAt.getTime() })
  } catch {
    // Même silence qu'au démarrage.
  }
}

/** Le repos est fini (ou passé en avance) : l'activité disparaît. */
export async function endRestActivity() {
  if (!runningInTauri() || !isIos()) {
    return
  }

  try {
    await invoke('plugin:rest-activity|end_activity')
  } catch {
    // Rien à ranger.
  }
}
