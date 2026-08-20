import { test, expect } from '@playwright/test'

// Le programme de départ compte trois séances ; « Développé couché » (Upper B)
// est le seul exercice livré avec un historique, donc le seul à afficher un
// fantôme, une cible et un résumé « Dernière fois ».
const SEANCE_NAME = 'Upper B'
const SEANCE_URL = '/seances/upper-b'
const EXERCISE_NAME = 'Développé couché'
const TRACKER_URL = `${SEANCE_URL}/exercises/developpe-couche`

test.describe('Séance navigation', () => {
  test('redirects "/" to "/seances" and lists the seeded séances', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL('/seances')
    await expect(page.getByRole('link', { name: /Upper A/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Lower/ })).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(SEANCE_NAME) })).toBeVisible()
  })

  test('opening the séance shows its exercise list with a "Dernière fois" summary', async ({
    page,
  }) => {
    await page.goto('/seances')

    await page.getByRole('link', { name: new RegExp(SEANCE_NAME) }).click()

    await expect(page).toHaveURL(SEANCE_URL)
    await expect(page.getByText(EXERCISE_NAME)).toBeVisible()
    // Ciblé sur l'exercice plutôt que sur la page : plusieurs exercices du
    // programme portent un historique, et un sélecteur global deviendrait
    // ambigu — ou pire, passerait grâce à un autre exercice que celui visé.
    await expect(page.getByRole('link', { name: new RegExp(EXERCISE_NAME) })).toContainText(
      'Dernière fois',
    )
  })

  test('opening an exercise reaches the tracker with its ghost and six comparison columns', async ({
    page,
  }) => {
    await page.goto(SEANCE_URL)

    await page.getByRole('link', { name: new RegExp(EXERCISE_NAME) }).click()

    await expect(page).toHaveURL(TRACKER_URL)
    await expect(page.getByText('Fantôme', { exact: true })).toBeVisible()
    await expect(page.getByText(/Cible/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Séries face au fantôme' })).toBeVisible()
    await expect(page.locator('.set-bar')).toHaveCount(6)
  })

  test('the persistent top bar navigates back to the séance list from the tracker', async ({
    page,
  }) => {
    await page.goto(TRACKER_URL)

    // Le retour ne vaut que depuis un tracker réellement rendu : une URL morte
    // afficherait quand même la barre du haut, et le test passerait à vide.
    await expect(page.getByRole('heading', { name: 'Suivi des séries' })).toBeVisible()

    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Séances' }).click()

    await expect(page).toHaveURL('/seances')
    await expect(page.getByRole('heading', { name: 'Tes séances' })).toBeVisible()
  })
})
