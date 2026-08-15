import { test, expect } from '@playwright/test'
import { useFixture } from './fixtures'

test.describe('Sauvegarde', () => {
  test('exporter télécharge un fichier JSON nommé par la date', async ({ page }) => {
    await useFixture(page, 'progression')

    await page.goto('/seances')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exporter mes données' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/^ghost-lift-\d{4}-\d{2}-\d{2}\.json$/)
  })

  test('la restauration est absente dès qu’il existe une séance réelle', async ({ page }) => {
    await useFixture(page, 'progression')

    await page.goto('/seances')

    await expect(page.getByRole('button', { name: 'Restaurer une sauvegarde' })).toHaveCount(0)
  })

  test('la restauration est proposée en mode découverte', async ({ page }) => {
    await page.goto('/seances')

    await expect(page.getByRole('button', { name: 'Restaurer une sauvegarde' })).toBeVisible()
  })

  test('la restauration disparaît dès qu’une séance réelle existe, même avec la démo', async ({
    page,
  }) => {
    await page.goto('/seances')
    await expect(page.getByRole('button', { name: 'Restaurer une sauvegarde' })).toBeVisible()

    await page.getByRole('link', { name: '+ Nouvelle séance' }).click()
    await page.getByLabel('Nom de la séance').fill('Séance réelle')
    await page.getByLabel("Nom de l'exercice").fill('Squat')
    await page.getByLabel('Reps par défaut').fill('5')
    await page.getByLabel('Poids par défaut').fill('60')
    await page.getByLabel('Unité').fill('kg')
    await page.getByRole('button', { name: "Ajouter l'exercice" }).click()
    await page.getByRole('button', { name: 'Créer la séance' }).click()

    // Navigation côté client, surtout pas page.goto : hors Tauri le store est
    // en mémoire et repart du programme d'exemple à chaque rechargement, ce
    // qui effacerait la séance qu'on vient de créer.
    await page
      .getByRole('navigation', { name: 'Navigation principale' })
      .getByRole('link', { name: 'Séances' })
      .click()

    // La bannière découverte est toujours là…
    await expect(page.getByText('Mode découverte')).toBeVisible()
    // …mais le bouton a disparu : c'est bien sa propre garde qui agit.
    await expect(page.getByRole('button', { name: 'Restaurer une sauvegarde' })).toHaveCount(0)
  })
})
