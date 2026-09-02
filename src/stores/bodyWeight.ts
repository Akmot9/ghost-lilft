import { defineStore } from 'pinia'
import type { BodyWeightDto } from '../lib/appApi'
import { createTauriAppApi } from '../lib/appApiTauri'
import { runningInTauri } from '../lib/runtime'

/**
 * Le poids de corps : une pesée par jour calendaire, en kilogrammes. Le store
 * est une pure projection des commandes Rust (`body_weight.rs`) — il applique
 * l'état rendu, il ne calcule rien.
 *
 * Hors Tauri (navigateur nu, e2e), les pesées vivent en mémoire : le même
 * comportement, sans persistance — comme les autres stores.
 */

const appApi = createTauriAppApi()


/** Le jour du pèse-personne : le jour local de l'appareil, `AAAA-MM-JJ`. */
export function localDay(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export const useBodyWeightStore = defineStore('bodyWeight', {
  state: () => ({
    /** Du plus récent au plus ancien, comme le rend Rust. */
    weights: [] as BodyWeightDto[],
  }),
  getters: {
    latest: (state): BodyWeightDto | null => state.weights[0] ?? null,
    previous: (state): BodyWeightDto | null => state.weights[1] ?? null,
  },
  actions: {
    async init() {
      if (runningInTauri()) {
        this.weights = await appApi.listBodyWeights()
      }
    },
    async logWeight(day: string, kilograms: number) {
      if (runningInTauri()) {
        this.weights = await appApi.logBodyWeight(day, kilograms)
        return
      }

      this.weights = [{ day, kilograms }, ...this.weights.filter((weight) => weight.day !== day)]
        .sort((first, second) => second.day.localeCompare(first.day))
    },
    async deleteWeight(day: string) {
      if (runningInTauri()) {
        this.weights = await appApi.deleteBodyWeight(day)
        return
      }

      this.weights = this.weights.filter((weight) => weight.day !== day)
    },
  },
})
