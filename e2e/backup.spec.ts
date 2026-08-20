import { test, expect } from '@playwright/test'
import { useFixture } from './fixtures'

test.describe('Sauvegarde', () => {
  test('exporter télécharge un fichier JSON nommé par la date', async ({ page }) => {
    await useFixture(page, 'progression')

    await page.goto('/seances')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exporter mes données' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/^revenant-\d{4}-\d{2}-\d{2}\.json$/)
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

  test('un export restauré ramène l’historique', async ({ page }) => {
    await useFixture(page, 'progression')
    await page.goto('/seances')

    // 1. Exporter depuis un état qui contient de vraies données.
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exporter mes données' }).click()
    const backupPath = await (await downloadPromise).path()

    // 2. Repartir d'une app fraîchement installée : le mode découverte.
    const clean = await page.context().newPage()
    await clean.goto('/seances')
    await expect(clean.getByRole('link', { name: /Upper A/ })).toBeVisible()

    // 3. Restaurer. Le second clic ouvre le sélecteur de fichier ; il faut
    //    l'attendre par `filechooser`. Sans écouteur, Playwright referme le
    //    sélecteur, le navigateur émet `cancel` sur l'`input`, et
    //    `pickInBrowser` le retire du document — il n'y aurait plus rien à
    //    cibler avec `setInputFiles`.
    await clean.getByRole('button', { name: 'Restaurer une sauvegarde' }).click()
    const chooserPromise = clean.waitForEvent('filechooser')
    await clean.getByRole('button', { name: /Confirmer/ }).click()
    await (await chooserPromise).setFiles(backupPath)

    // 4. Les séances de la sauvegarde ont remplacé le programme d'exemple.
    await expect(clean.getByRole('link', { name: /Lower/ })).toBeVisible()
    await expect(clean.getByRole('link', { name: /Upper A/ })).toHaveCount(0)

    // 5. L'historique est revenu, fantôme compris. Navigation côté client
    //    obligatoire : hors Tauri le store vit en mémoire et repart du
    //    programme d'exemple à chaque rechargement, donc un `goto` effacerait
    //    ce qu'on vient de restaurer et le test passerait à vide.
    await clean.getByRole('link', { name: /Lower/ }).click()
    await clean.getByRole('link', { name: /High bar squat/ }).click()

    await expect(clean.getByText('Fantôme', { exact: true })).toBeVisible()
    await expect(clean.getByText('Cible → 70 kg × 8')).toBeVisible()
  })

  test('un fichier invalide est refusé sans toucher aux données', async ({ page }) => {
    await page.goto('/seances')

    await page.getByRole('button', { name: 'Restaurer une sauvegarde' }).click()
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: /Confirmer/ }).click()
    await (await chooserPromise).setFiles({
      name: 'pas-une-sauvegarde.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"format":"autre-app","version":1,"seances":[]}'),
    })

    // Message lisible, et le programme d'exemple est toujours là.
    await expect(page.getByRole('alert')).toContainText('sauvegarde Revenant')
    await expect(page.getByRole('link', { name: /Upper A/ })).toBeVisible()
  })
})
