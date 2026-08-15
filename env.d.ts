/// <reference types="vite/client" />

import type { ScenarioName } from './src/datasets/scenarios'

declare global {
  interface Window {
    /**
     * Scénario de test demandé par la suite e2e (voir `e2e/fixtures.ts`).
     * Lu uniquement en dev : absent du bundle de production.
     */
    __GHOST_LIFT_FIXTURE__?: ScenarioName
  }
}

export {}
