import { test, expect } from '@playwright/test'

test.describe('Create séance flow', () => {
  test('creates a new séance with an exercise via the "+ Nouvelle séance" flow', async ({
    page,
  }) => {
    await page.goto('/seances')

    // 1. Navigate to the creation form.
    await page.getByRole('link', { name: '+ Nouvelle séance' }).click()
    await expect(page).toHaveURL(/\/seances\/new$/)

    const submitButton = page.getByRole('button', { name: 'Créer la séance' })

    // Submit is disabled before anything is filled in at all.
    await expect(submitButton).toBeDisabled()

    // 2. Fill the séance name.
    await page.getByLabel('Nom de la séance').fill('Séance e2e test')

    // 3. Even with a name set, submission must stay blocked while there are
    // zero drafted exercises — a séance needs at least one exercise.
    await expect(submitButton).toBeDisabled()

    // 4. Fill the exercise sub-form and add it to the draft list.
    await page.getByLabel("Nom de l'exercice").fill('Squat')
    await page.getByLabel('Reps par défaut').fill('5')
    await page.getByLabel('Poids par défaut').fill('60')
    await page.getByLabel('Unité').fill('kg')
    await page.getByRole('button', { name: "Ajouter l'exercice" }).click()

    const draftList = page.getByRole('list').filter({ hasText: 'Squat' })
    await expect(draftList.getByText('Squat')).toBeVisible()
    await expect(draftList.getByText(/5 reps.*60\s*kg/)).toBeVisible()

    // Now that an exercise has been drafted, submission is allowed.
    await expect(submitButton).toBeEnabled()

    // 5. Submit the séance for real and confirm we land on its own page.
    await submitButton.click()

    await expect(page).toHaveURL(/\/seances\/(?!new$)[^/]+$/)
    await expect(page.getByRole('heading', { name: 'Séance e2e test' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Squat/ })).toBeVisible()
  })
})
