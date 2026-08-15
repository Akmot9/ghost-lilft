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
})
