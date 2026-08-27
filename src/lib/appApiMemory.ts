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

  return {
    dbFileName: () => Promise.resolve('ghostlift-memoire.db'),
    importSeances: (seances) => {
      // Même sémantique que la commande Rust : remplacement intégral, et ce
      // que l'utilisateur restaure lui appartient (isDemo repart à false).
      stored = structuredClone(seances).map((seance) => ({ ...seance, isDemo: false }))
      return Promise.resolve()
    },
    seances: () => structuredClone(stored),
  }
}
