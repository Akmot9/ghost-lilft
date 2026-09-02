import { isTauri } from '@tauri-apps/api/core'

/**
 * La notification locale de fin de repos : programmée à l'échéance du
 * minuteur, elle sonne même téléphone verrouillé ou app en arrière-plan —
 * le repos se mesure sur l'horloge murale, la notification aussi.
 *
 * Toute défaillance est avalée : une notification qui rate ne doit jamais
 * casser le minuteur affiché, qui reste la source de vérité à l'écran.
 * Hors Tauri (navigateur nu, e2e), tout est un no-op et le plugin n'est
 * jamais chargé (import dynamique, comme `fileTransfer.ts`).
 */

// Un seul repos à la fois dans l'app : un identifiant fixe suffit, et
// reprogrammer écrase la notification précédente au lieu de l'empiler.
const REST_NOTIFICATION_ID = 4217

function runningInTauri(): boolean {
  if (typeof isTauri === 'function') {
    return isTauri()
  }

  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Les plateformes où la programmation a un sens : sur desktop, le plugin
 * ignore `schedule` et afficherait la notification immédiatement, au début
 * du repos — pire que rien. Le minuteur à l'écran suffit là-bas.
 */
function isMobile(): boolean {
  return /iPhone|iPad|iPod|Android/.test(navigator.userAgent)
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

/**
 * Contournement d'un bug de tauri-plugin-notification 2.4.0 sur iOS : son
 * `DateFormatter` lit `…SSS'Z'` avec un Z **littéral** et sans fuseau — la
 * date UTC envoyée par `toISOString()` est donc comprise comme de l'heure
 * locale. Depuis un fuseau à l'est d'UTC (Paris : +2 h), toute échéance
 * paraît dans le passé et la notification est rejetée en silence
 * (`pastScheduledTime`). On donne donc à iOS l'heure murale locale déguisée
 * en ISO : relue en local, elle redésigne le bon instant. Android, lui,
 * parse en UTC (Jackson) : pas de décalage à compenser.
 */
function toIosWallClock(date: Date): Date {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
}

async function ensurePermission(): Promise<boolean> {
  const { isPermissionGranted, requestPermission } = await import(
    '@tauri-apps/plugin-notification'
  )

  if (await isPermissionGranted()) {
    return true
  }

  // iOS ne pose la question qu'une fois : le refus est respecté sans insister.
  return (await requestPermission()) === 'granted'
}

/** Programme (ou reprogramme) la notification pour l'échéance donnée. */
export async function scheduleRestEndNotification(endsAt: Date, exerciseName: string) {
  if (!runningInTauri() || !isMobile()) {
    return
  }

  try {
    if (!(await ensurePermission())) {
      return
    }

    const { cancel, sendNotification, Schedule } = await import('@tauri-apps/plugin-notification')

    // Une échéance déjà passée (reprise d'un repos expiré) n'a rien à dire.
    if (endsAt.getTime() <= Date.now()) {
      await cancel([REST_NOTIFICATION_ID]).catch(() => {})
      return
    }

    await cancel([REST_NOTIFICATION_ID]).catch(() => {})
    sendNotification({
      id: REST_NOTIFICATION_ID,
      title: 'Repos terminé',
      body: `${exerciseName} — retourne sous la barre.`,
      schedule: Schedule.at(isIos() ? toIosWallClock(endsAt) : endsAt),
    })
  } catch {
    // Permission révoquée, plugin absent (desktop sans support) : le
    // minuteur à l'écran reste la source de vérité.
  }
}

/** Annule la notification en attente (repos fini ou passé en avance). */
export async function cancelRestEndNotification() {
  if (!runningInTauri() || !isMobile()) {
    return
  }

  try {
    const { cancel } = await import('@tauri-apps/plugin-notification')
    await cancel([REST_NOTIFICATION_ID])
  } catch {
    // Rien à annuler, ou plugin indisponible : même silence qu'au programme.
  }
}
