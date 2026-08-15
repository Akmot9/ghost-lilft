import type { Page } from '@playwright/test'
import type { ScenarioName } from '../src/datasets/scenarios'

/**
 * Remplace les données du mode découverte par un scénario de test, pour la
 * durée de la page. À appeler AVANT le premier `page.goto` : le store lit le
 * global à son initialisation, donc au tout premier rendu.
 */
export async function useFixture(page: Page, name: ScenarioName) {
  await page.addInitScript((fixture) => {
    window.__GHOST_LIFT_FIXTURE__ = fixture as ScenarioName
  }, name)
}
