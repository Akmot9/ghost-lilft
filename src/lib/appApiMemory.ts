import type { AppApi, SeanceDto } from './appApi'

/**
 * Le double de test d'AppApi : mêmes promesses, même sémantique, aucune IPC.
 * C'est lui qui permet d'exercer un consommateur de l'API (bientôt Pinia,
 * #72) dans Vitest ou dans un navigateur nu, sans runtime Tauri.
 *
 * `seances()` rend l'état que le vrai backend aurait persisté — c'est
 * l'observabilité du test, pas une méthode du contrat.
 */
export function createMemoryAppApi(): AppApi & { seances: () => SeanceDto[] } {
  let stored: SeanceDto[] = []
  // L'empreinte du dernier semis, comme la table `meta` côté Rust : c'est
  // elle qui distingue une démo intacte (remplaçable) d'une démo touchée.
  let seededFingerprint: string | null = null

  return {
    dbFileName: () => Promise.resolve('ghostlift-memoire.db'),
    bootstrapSeances: (seed) => {
      const untouchedDemo =
        stored.every((seance) => seance.isDemo) &&
        seededFingerprint !== null &&
        JSON.stringify(stored) === seededFingerprint

      if (stored.length === 0 || untouchedDemo) {
        stored = structuredClone(seed)
        seededFingerprint = JSON.stringify(stored)
      }

      return Promise.resolve(structuredClone(stored))
    },
    importSeances: (seances) => {
      // Même sémantique que la commande Rust : remplacement intégral, et ce
      // que l'utilisateur restaure lui appartient (isDemo repart à false).
      stored = structuredClone(seances).map((seance) => ({ ...seance, isDemo: false }))
      return Promise.resolve()
    },
    seances: () => structuredClone(stored),
  }
}
