import { test, expect } from '@playwright/test'
import { useFixture } from './fixtures'

/**
 * L'app ne doit jamais défiler latéralement (#48).
 *
 * Un écran plus large que le téléphone est le genre de défaut qu'on ne voit
 * pas au développement — le navigateur de bureau est large — et que le
 * relecteur App Store voit tout de suite, capture d'écran à l'appui. C'est
 * arrivé : quatre boutons dans une rangée `nowrap` ont imposé leur largeur à
 * toute la page.
 *
 * 430 px est la largeur CSS des iPhone 6,9" (15/16/17 Pro Max), le plus large
 * des formats courants — et donc le moins susceptible de déborder. S'il
 * déborde, tous les autres débordent.
 */
// Les réglages sont écrits à la main plutôt que repris de `devices[...]` : le
// descripteur d'iPhone impose WebKit, que la CI n'installe pas (seul Chromium
// est configuré). Ce qui compte ici est la largeur, pas le moteur.
test.use({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})

const SCREENS = [
  { name: 'liste des séances', path: '/seances' },
  { name: 'séance', path: '/seances/upper-a' },
  { name: 'suivi des séries', path: '/seances/upper-a/exercises/developpe-couche' },
  { name: 'dashboard', path: '/dashboard' },
]

for (const screen of SCREENS) {
  test(`${screen.name} tient dans la largeur d’un iPhone`, async ({ page }) => {
    await useFixture(page, 'pyramide')

    await page.goto(screen.path)
    // Les graphes et le bilan arrivent après le premier rendu : c'est chargé
    // qu'un écran déborde, pas vide.
    await page.waitForTimeout(500)

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

    expect(scrollWidth).toBe(clientWidth)
  })
}
