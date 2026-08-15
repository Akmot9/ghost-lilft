import { test, expect } from '@playwright/test'
import { useFixture } from './fixtures'

// Chaque scénario est vérifié côté données par `src/datasets/__tests__/scenarios.spec.ts` ;
// ici on vérifie ce que l'app en affiche.

test.describe('Scénario : stagnation', () => {
  test('le tracker signale la charge identique et le dashboard remonte l\'alerte', async ({
    page,
  }) => {
    await useFixture(page, 'stagnation')

    await page.goto('/seances/upper-a/exercises/developpe-couche')

    await expect(page.getByText('Même charge que la dernière fois')).toBeVisible()

    await page.getByRole('link', { name: 'Dashboard' }).click()

    await expect(page.getByRole('heading', { name: 'Exercices qui stagnent' })).toBeVisible()

    // Seul le développé couché stagne : le rowing progresse dans ce scénario.
    const alerts = page.getByRole('link', { name: /Stagne/ })
    await expect(alerts).toHaveCount(1)
    await expect(alerts.first()).toContainText('Développé couché')
  })
})

test.describe('Scénario : progression', () => {
  test('aucune alerte de stagnation sur le dashboard', async ({ page }) => {
    await useFixture(page, 'progression')

    await page.goto('/dashboard')

    await expect(page.getByRole('heading', { name: 'Rien à signaler' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Stagne/ })).toHaveCount(0)
  })
})

test.describe('Scénario : débutant', () => {
  test('sans historique, pas de fantôme et la cible retombe sur les valeurs par défaut', async ({
    page,
  }) => {
    await useFixture(page, 'debutant')

    await page.goto('/seances/ma-seance/exercises/developpe-couche')

    await expect(page.getByRole('heading', { name: 'Suivi des séries' })).toBeVisible()
    await expect(page.getByText('Fantôme')).toHaveCount(0)
    await expect(page.getByText('Cible → 40 kg × 8')).toBeVisible()
    await expect(page.getByText("Aucune série ajoutée pour l'instant.")).toBeVisible()
  })
})

test.describe('Scénario : record', () => {
  test('une série plus lourde que tout l\'historique affiche le badge record', async ({ page }) => {
    await useFixture(page, 'record')

    await page.goto('/seances/upper-b/exercises/overhead-press')

    // L'historique plafonne à 60 kg.
    await page.getByLabel('Répétitions', { exact: true }).fill('5')
    await page.getByLabel(/^Poids/).fill('65')
    await page.getByRole('button', { name: 'Ajouter la série' }).click()

    await expect(page.getByText('Nouveau record')).toBeVisible()
  })

  test('une série dans les charges habituelles n\'est pas un record', async ({ page }) => {
    await useFixture(page, 'record')

    await page.goto('/seances/upper-b/exercises/overhead-press')

    await page.getByLabel('Répétitions', { exact: true }).fill('5')
    await page.getByLabel(/^Poids/).fill('50')
    await page.getByRole('button', { name: 'Ajouter la série' }).click()

    await expect(page.getByText('Repos')).toBeVisible()
    await expect(page.getByText('Nouveau record')).toHaveCount(0)
  })
})

test.describe('Scénario : pyramide', () => {
  test('le fantôme pointe la première série de la séance de référence', async ({ page }) => {
    await useFixture(page, 'pyramide')

    await page.goto('/seances/upper-a/exercises/developpe-couche')

    // Séance de référence : 12×50, 8×60, 6×70. Aucune série loggée aujourd'hui,
    // donc le fantôme et la cible portent sur la série 1, pas sur la dernière.
    await expect(page.getByText(/Série 1, dernière séance : 12 × 50 kg/)).toBeVisible()
    await expect(page.getByText('Cible → 50 kg × 12')).toBeVisible()
  })

  test('après une série, le fantôme avance sur la deuxième', async ({ page }) => {
    await useFixture(page, 'pyramide')

    await page.goto('/seances/upper-a/exercises/developpe-couche')

    await page.getByLabel('Répétitions', { exact: true }).fill('12')
    await page.getByLabel(/^Poids/).fill('52')
    await page.getByRole('button', { name: 'Ajouter la série' }).click()
    await page.getByRole('button', { name: 'Passer' }).click()

    await expect(page.getByText(/Série 2, dernière séance : 8 × 60 kg/)).toBeVisible()
    await expect(page.getByText('Cible → 60 kg × 8')).toBeVisible()
  })
})
