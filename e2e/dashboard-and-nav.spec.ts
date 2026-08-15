import { test, expect } from '@playwright/test'
import { useFixture } from './fixtures'

test.describe('Dashboard and top bar navigation', () => {
  test('Dashboard link in top bar navigates to the dashboard with its stagnation and volume sections', async ({
    page,
  }) => {
    await page.goto('/seances')

    await page.getByRole('link', { name: 'Dashboard' }).click()

    await expect(page).toHaveURL('/dashboard')
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /Exercices qui stagnent|Rien à signaler/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Tendance du volume hebdomadaire' }),
    ).toBeVisible()
  })

  test('clicking a stagnant exercise navigates to its tracker route', async ({ page }) => {
    // Le programme de démonstration ne contient aucun exercice qui stagne : ce
    // test s'ignorait lui-même. Le scénario en garantit un.
    await useFixture(page, 'stagnation')

    await page.goto('/dashboard')

    // Stagnation alert links are the only links whose accessible name includes
    // the "Stagne" badge text, so this selects exactly the stagnant-exercise rows.
    const stagnantLinks = page.getByRole('link', { name: /Stagne/ })

    await expect(stagnantLinks.first()).toBeVisible()
    await stagnantLinks.first().click()

    await expect(page).toHaveURL(/\/seances\/[^/]+\/exercises\/[^/]+$/)
    await expect(page.getByRole('heading', { name: 'Suivi des séries' })).toBeVisible()
  })

  test('Revenant wordmark in top bar navigates back to séances from the dashboard', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    await page.getByRole('link', { name: 'Revenant' }).click()

    await expect(page).toHaveURL('/seances')
    await expect(page.getByRole('heading', { name: 'Tes séances' })).toBeVisible()
  })
})
