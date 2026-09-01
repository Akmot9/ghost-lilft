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

  test('logging a warm-up keeps the working stats, target and six chart columns unchanged', async ({
    page,
  }) => {
    await page.goto(trackerUrl)

    const target = page.locator('.target-chip')
    const stats = page.locator('.stats-grid')
    // Le libellé de la cible change en mode échauffement (« Objectif de
    // travail ») ; seules les valeurs doivent rester identiques.
    const targetBefore = (await target.textContent())?.split('→')[1]?.trim() ?? ''
    const statsBefore = await stats.textContent()
    const barsBefore = await page.locator('.set-bar').count()

    const warmupToggle = page.getByRole('button', { name: 'Échauffement', exact: true })
    await warmupToggle.click()
    await expect(warmupToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.exercise-tracker')).toHaveClass(/exercise-tracker--warmup/)
    await expect(page.locator('.warmup-panel')).toBeVisible()

    await page.getByLabel('Répétitions', { exact: true }).fill('6')
    await page.getByLabel(/^Poids/).fill('48')
    await page.getByRole('button', { name: 'Ajouter l’échauffement' }).click()

    await expect(stats).toHaveText(statsBefore ?? '')
    await expect(target).toContainText(targetBefore)
    await expect(page.locator('.set-bar')).toHaveCount(barsBefore)
    await expect(page.locator('.badge-positive')).toHaveCount(0)
    await expect(page.locator('.verdict')).toHaveCount(0)

    await expect(page.locator('.rest-panel')).toHaveClass(/rest-panel--warmup/)
    await expect(page.locator('.ramp--today .ramp-step')).toHaveText(['48 kg × 6'])
    await expect(page.locator('.warmup-stats-grid strong').first()).toHaveText('1')

    await page.getByRole('button', { name: 'Passer' }).click()
    const latestHistoryRow = page.locator('.set-list li').first()
    await expect(latestHistoryRow).toHaveClass(/set-row--warmup/)
    const latestHistoryToggle = latestHistoryRow.locator('.set-warmup-toggle')
    await expect(latestHistoryToggle).toHaveText('Échauffement')
    await expect(latestHistoryToggle).toHaveAttribute('aria-pressed', 'true')
  })

  test('a past set can be edited in place, keeping its date', async ({ page }) => {
    await page.goto(trackerUrl)

    const firstRow = page.locator('.set-list li').first()
    const dateBefore = (await firstRow.locator('.set-summary span').innerText()).match(/le .+$/)?.[0]

    await firstRow.getByRole('button', { name: /^Corriger la série/ }).click()

    const editForm = firstRow.locator('.set-edit')
    await editForm.getByLabel('Répétitions').fill('11')
    await editForm.locator('.weight-input input').fill('77.5')
    await editForm.getByRole('button', { name: 'Limite RPE 9' }).click()
    await editForm.getByRole('button', { name: 'Enregistrer' }).click()

    await expect(firstRow.locator('.set-summary strong')).toHaveText('11 répétitions')
    await expect(firstRow.locator('.set-summary')).toContainText('77.5 kg')
    await expect(firstRow.locator('.set-rpe')).toHaveText('RPE 9')
    // La date de la série n'a pas bougé.
    if (dateBefore) {
      await expect(firstRow.locator('.set-summary')).toContainText(dateBefore)
    }

    // Annuler ne change rien.
    await firstRow.getByRole('button', { name: /^Corriger la série/ }).click()
    await firstRow.locator('.set-edit').getByLabel('Répétitions').fill('99')
    await firstRow.getByRole('button', { name: 'Annuler' }).click()
    await expect(firstRow.locator('.set-summary strong')).toHaveText('11 répétitions')
  })

  test('an existing work set can be reclassified as warm-up and restored', async ({ page }) => {
    await page.goto(trackerUrl)

    const latestHistoryToggle = page.locator('.set-list li').first().locator('.set-warmup-toggle')
    const barsBefore = await page.locator('.set-bar').count()

    await expect(latestHistoryToggle).toHaveText(/^S\d+$/)
    await latestHistoryToggle.click()
    await expect(latestHistoryToggle).toHaveText('Échauffement')
    await expect(latestHistoryToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.set-bar')).toHaveCount(barsBefore - 1)

    await latestHistoryToggle.click()
    await expect(latestHistoryToggle).toHaveText(/^S\d+$/)
    await expect(page.locator('.set-bar')).toHaveCount(barsBefore)
  })
})
