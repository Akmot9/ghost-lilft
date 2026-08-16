import { test, expect } from '@playwright/test'
import { useFixture } from './fixtures'

const TRACKER = '/seances/lower/exercises/high-bar-squat'

test.describe('Séries — exporter / importer', () => {
  test('exporte les séries de l’exercice sous son propre nom', async ({ page }) => {
    await useFixture(page, 'progression')
    await page.goto(TRACKER)

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exporter', exact: true }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(
      /^revenant-lower-high-bar-squat-\d{4}-\d{2}-\d{2}\.json$/,
    )
  })

  test('un exercice vide ne propose qu’Importer', async ({ page }) => {
    await page.goto('/seances')
    await page.getByRole('link', { name: '+ Nouvelle séance' }).click()
    await page.getByLabel('Nom de la séance').fill('Neuve')
    await page.getByLabel("Nom de l'exercice").fill('Squat')
    await page.getByLabel('Reps par défaut').fill('5')
    await page.getByLabel('Poids par défaut').fill('80')
    await page.getByLabel('Unité').fill('kg')
    await page.getByRole('button', { name: "Ajouter l'exercice" }).click()
    await page.getByRole('button', { name: 'Créer la séance' }).click()

    await page.getByRole('link', { name: /Squat/ }).click()

    await expect(page.locator('.sets-actions button')).toHaveText(['Importer'])
  })

  test('réimporter le même fichier n’ajoute aucun doublon', async ({ page }) => {
    await useFixture(page, 'progression')
    await page.goto(TRACKER)

    const avant = await page.locator('.set-list li').count()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exporter', exact: true }).click()
    const fichier = await (await downloadPromise).path()

    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Importer' }).click()
    await (await chooserPromise).setFiles(fichier)

    // Le compte rendu dit ce qui s'est passé plutôt que de rester muet : c'est
    // la seule preuve visible qu'un import sans effet a bien eu lieu.
    await expect(page.locator('.sets-report')).toContainText('déjà présente')
    expect(await page.locator('.set-list li').count()).toBe(avant)
  })

  test('refuse un fichier qui n’est pas une sauvegarde Revenant', async ({ page }) => {
    await useFixture(page, 'progression')
    await page.goto(TRACKER)

    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Importer' }).click()
    await (await chooserPromise).setFiles({
      name: 'pas-une-sauvegarde.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"format":"autre-app","version":1,"seances":[]}'),
    })

    await expect(page.locator('.sets-report')).toContainText('sauvegarde Revenant')
  })
})
