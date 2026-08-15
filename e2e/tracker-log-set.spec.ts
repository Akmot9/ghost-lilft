import { test, expect } from '@playwright/test'

// « Développé couché » (Upper B) est le seul exercice seedé avec un historique,
// donc le seul dont le tracker affiche fantôme, cible et stat hebdomadaire.
const trackerUrl = '/seances/upper-b/exercises/developpe-couche'

test.describe('Exercise tracker – logging a set', () => {
  let consoleErrors: string[]
  let pageErrors: string[]

  test.beforeEach(({ page }) => {
    consoleErrors = []
    pageErrors = []

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })

    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })
  })

  test.afterEach(() => {
    expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join('\n')}`).toEqual([])
    expect(pageErrors, `Unexpected page errors:\n${pageErrors.join('\n')}`).toEqual([])
  })

  test('submitting a set starts the rest timer, and skipping returns to the entry form', async ({
    page,
  }) => {
    await page.goto(trackerUrl)

    const repsInput = page.getByLabel('Répétitions', { exact: true })
    const weightInput = page.getByLabel(/^Poids/)

    await expect(repsInput).toBeVisible()
    await expect(weightInput).toBeVisible()

    // Capture whatever the suggested target prefilled — it's derived from real
    // historical data, so we only assert it's a sane positive number, never a
    // specific hardcoded value.
    const prefilledReps = Number(await repsInput.inputValue())
    const prefilledWeight = Number(await weightInput.inputValue())
    expect(prefilledReps).toBeGreaterThan(0)
    expect(prefilledWeight).toBeGreaterThan(0)

    const submitButton = page.getByRole('button', { name: 'Ajouter la série' })
    await expect(submitButton).toBeVisible()
    await submitButton.click()

    // The entry form is replaced by the rest-timer panel.
    await expect(submitButton).toBeHidden()

    const countdown = page.getByText(/^\d+:\d{2}$/)
    await expect(countdown).toBeVisible()
    await expect(page.getByRole('button', { name: '-15 s' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+15 s' })).toBeVisible()

    const skipButton = page.getByRole('button', { name: 'Passer' })
    await expect(skipButton).toBeVisible()

    await skipButton.click()

    // Skipping the rest ends it and brings the entry form back.
    await expect(skipButton).toBeHidden()
    await expect(page.getByLabel('Répétitions', { exact: true })).toBeVisible()
    await expect(page.getByLabel(/^Poids/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ajouter la série' })).toBeVisible()
  })

  test('clicking informational elements (target chip, weekly stat) stays inert', async ({
    page,
  }) => {
    await page.goto(trackerUrl)

    await expect(page.getByRole('heading', { name: 'Suivi des séries' })).toBeVisible()
    const startUrl = page.url()

    const targetChip = page.getByText(/Cible →/)
    await expect(targetChip).toBeVisible()
    await targetChip.click()
    await expect(page).toHaveURL(startUrl)
    await expect(page.getByRole('heading', { name: 'Suivi des séries' })).toBeVisible()

    const weeklyStatLabel = page.getByText('Volume cette semaine', { exact: true })
    await expect(weeklyStatLabel).toBeVisible()
    await weeklyStatLabel.click()
    await expect(page).toHaveURL(startUrl)
    await expect(page.getByRole('heading', { name: 'Suivi des séries' })).toBeVisible()
  })
})
