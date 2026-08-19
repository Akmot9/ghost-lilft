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
    await page.getByLabel('Exercice aux haltères').check()
    await expect(page.getByLabel('Poids par haltère')).toHaveValue('30')
    await expect(page.getByText('= 60 kg au total')).toBeVisible()
    await page.getByRole('button', { name: "Ajouter l'exercice" }).click()

    const draftList = page.getByRole('list').filter({ hasText: 'Squat' })
    await expect(draftList.getByText('Squat')).toBeVisible()
    await expect(draftList.getByText(/5 reps.*30\s*kg par haltère.*60\s*kg au total/)).toBeVisible()

    // Now that an exercise has been drafted, submission is allowed.
    await expect(submitButton).toBeEnabled()

    // 5. Submit the séance for real and confirm we land on its own page.
    await submitButton.click()

    await expect(page).toHaveURL(/\/seances\/(?!new$)[^/]+$/)
    await expect(page.getByRole('heading', { name: 'Séance e2e test' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Squat/ })).toBeVisible()
  })

  test('adds a dumbbell exercise to an existing séance with a total default weight', async ({
    page,
  }) => {
    await page.goto('/seances/upper-a/exercises/new')

    await page.getByLabel('Nom').fill('Curl marteau')
    await page.getByLabel('Reps par défaut').fill('10')
    await page.getByLabel('Poids par défaut').fill('24')
    await page.getByLabel('Exercice aux haltères').check()

    await expect(page.getByLabel('Poids par haltère')).toHaveValue('12')
    await expect(page.getByText('= 24 kg au total')).toBeVisible()

    await page.getByRole('button', { name: "Ajouter l'exercice" }).click()
    await expect(page).toHaveURL('/seances/upper-a')

    await page.getByRole('link', { name: /Curl marteau/ }).click()
    await expect(page).toHaveURL('/seances/upper-a/exercises/curl-marteau')
    await expect(page.getByRole('button', { name: 'Haltères ×2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByLabel('Poids par haltère')).toHaveValue('12')
  })
})
