import { test, expect } from '@playwright/test'

test.describe('Séance navigation', () => {
  test('redirects "/" to "/seances" and lists the seeded séance', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL('/seances')
    await expect(page.getByRole('link', { name: /Séance principale/ })).toBeVisible()
  })

  test('opening the séance shows its exercise list with a "Dernière fois" summary', async ({
    page,
  }) => {
    await page.goto('/seances')

    await page.getByRole('link', { name: /Séance principale/ }).click()

    await expect(page).toHaveURL('/seances/seance-principale')
    await expect(page.getByText('Bench press')).toBeVisible()
    await expect(page.getByText(/Dernière fois/)).toBeVisible()
  })

  test('opening an exercise reaches the tracker with a ghost row and a target chip', async ({
    page,
  }) => {
    await page.goto('/seances/seance-principale')

    await page.getByRole('link', { name: /Bench press/ }).click()

    await expect(page).toHaveURL('/seances/seance-principale/exercises/bench-press')
    await expect(page.getByText('Fantôme')).toBeVisible()
    await expect(page.getByText(/Cible/)).toBeVisible()
  })

  test('the persistent top bar navigates back to the séance list from the tracker', async ({
    page,
  }) => {
    await page.goto('/seances/seance-principale/exercises/bench-press')

    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Séances' }).click()

    await expect(page).toHaveURL('/seances')
    await expect(page.getByRole('heading', { name: 'Tes séances' })).toBeVisible()
  })
})
