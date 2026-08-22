import { test, expect } from '@playwright/test'

// Upper A, du programme de départ : le premier exercice est « Développé
// incliné », le deuxième « Tractions lestées ».
const SEANCE_URL = '/seances/upper-a'
const FIRST = 'Développé incliné'
const SECOND = 'Tractions lestées'

/** Les exercices dans l'ordre où l'écran les liste. */
async function exerciseOrder(page: import('@playwright/test').Page) {
  return page.locator('.exercise-list .exercise-name').allInnerTexts()
}

test.describe('Réordonner les exercices d’une séance', () => {
  test('the arrows only show up once reordering is asked for', async ({ page }) => {
    await page.goto(SEANCE_URL)

    // L'écran sert d'abord à ouvrir un exercice : rien n'encombre les lignes
    // tant que le mode n'est pas demandé.
    await expect(page.getByRole('button', { name: `Monter ${SECOND}` })).toHaveCount(0)

    await page.getByRole('button', { name: 'Réordonner' }).click()

    await expect(page.getByRole('button', { name: `Monter ${SECOND}` })).toBeVisible()

    await page.getByRole('button', { name: 'Terminer' }).click()

    await expect(page.getByRole('button', { name: `Monter ${SECOND}` })).toHaveCount(0)
  })

  test('moving an exercise up swaps it with the one above', async ({ page }) => {
    await page.goto(SEANCE_URL)
    await page.getByRole('button', { name: 'Réordonner' }).click()

    const before = await exerciseOrder(page)
    expect(before.slice(0, 2)).toEqual([FIRST, SECOND])

    await page.getByRole('button', { name: `Monter ${SECOND}` }).click()

    await expect
      .poll(async () => (await exerciseOrder(page)).slice(0, 2))
      .toEqual([SECOND, FIRST])
    // Seuls les deux voisins ont bougé : le reste de la séance est intact.
    expect((await exerciseOrder(page)).slice(2)).toEqual(before.slice(2))
  })

  test('moving down puts the exercise back where it was', async ({ page }) => {
    await page.goto(SEANCE_URL)
    await page.getByRole('button', { name: 'Réordonner' }).click()

    const before = await exerciseOrder(page)

    await page.getByRole('button', { name: `Monter ${SECOND}` }).click()
    await expect
      .poll(async () => (await exerciseOrder(page)).slice(0, 2))
      .toEqual([SECOND, FIRST])

    await page.getByRole('button', { name: `Descendre ${SECOND}` }).click()

    await expect.poll(exerciseOrder.bind(null, page)).toEqual(before)
  })

  test('the arrows are disabled at either end of the list', async ({ page }) => {
    await page.goto(SEANCE_URL)
    await page.getByRole('button', { name: 'Réordonner' }).click()

    const names = await exerciseOrder(page)
    const last = names[names.length - 1]!

    await expect(page.getByRole('button', { name: `Monter ${FIRST}` })).toBeDisabled()
    await expect(page.getByRole('button', { name: `Descendre ${last}` })).toBeDisabled()
  })

  // Le bouton qui vient de servir devient désactivé quand l'exercice atteint
  // le haut de la liste : sans reprise, le focus retomberait au début du
  // document et la navigation au clavier repartirait de zéro.
  test('focus follows the exercise when its arrow becomes disabled', async ({ page }) => {
    await page.goto(SEANCE_URL)
    await page.getByRole('button', { name: 'Réordonner' }).click()

    await page.getByRole('button', { name: `Monter ${SECOND}` }).click()

    await expect(page.getByRole('button', { name: `Descendre ${SECOND}` })).toBeFocused()
  })
})
