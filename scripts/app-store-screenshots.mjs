/**
 * Captures d'écran pour la fiche App Store (#48, guideline 2.3.3).
 *
 * Apple refuse une fiche qui montre le logo ou un écran de démarrage : elle
 * veut l'app **en usage**. Ces captures viennent donc de l'app réelle, avec de
 * vraies données, aux dimensions exigées — pas d'un montage.
 *
 *   npm run dev            # dans un terminal
 *   node scripts/app-store-screenshots.mjs
 *
 * Les fichiers atterrissent dans `app-store/` (ignoré par git : ce sont des
 * artefacts, régénérables en une commande).
 *
 * La taille 1290 × 2796 est celle des iPhone 6,9" (15/16/17 Pro Max), la seule
 * obligatoire depuis 2024 : App Store Connect décline les autres tailles
 * lui-même. Le facteur d'échelle 3 rend un viewport CSS de 430 × 932, ce que
 * le WebView de l'app affiche réellement sur ces appareils.
 */

import { chromium, devices } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE_URL = process.env.REVENANT_URL ?? 'http://localhost:5173'
const OUTPUT_DIR = 'app-store'

/**
 * Chaque capture montre une chose que la fiche doit prouver : qu'on saisit une
 * série, qu'on lit sa progression, qu'on suit son programme.
 */
const SHOTS = [
  {
    name: '1-saisie',
    fixture: 'pyramide',
    path: '/seances/upper-a/exercises/developpe-couche',
    waitFor: '.target-chip',
  },
  {
    name: '2-progression',
    fixture: 'pyramide',
    path: '/seances/upper-a/exercises/developpe-couche',
    waitFor: '.set-ghost-card',
    // Le graphe vit sous le formulaire : la capture doit le montrer, pas la
    // saisie qu'on a déjà en première image.
    scrollTo: '.set-ghost-card',
  },
  {
    name: '3-dashboard',
    fixture: 'progression',
    path: '/dashboard',
    waitFor: '.kpi-row',
  },
  {
    name: '4-seance',
    fixture: 'stagnation',
    path: '/seances/upper-a',
    waitFor: '.exercise-list',
  },
]

const iPhone = {
  ...devices['iPhone 15 Pro Max'],
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
}

await mkdir(OUTPUT_DIR, { recursive: true })

const browser = await chromium.launch()

for (const shot of SHOTS) {
  const context = await browser.newContext(iPhone)

  // Le store lit ce global à son initialisation : il doit être posé avant le
  // premier rendu, pas après.
  await context.addInitScript((fixture) => {
    window.__GHOST_LIFT_FIXTURE__ = fixture
  }, shot.fixture)

  const page = await context.newPage()

  await page.goto(`${BASE_URL}${shot.path}`)
  await page.waitForSelector(shot.waitFor, { timeout: 10_000 })

  if (shot.scrollTo) {
    await page.locator(shot.scrollTo).scrollIntoViewIfNeeded()
  }
  // Les graphes s'animent à l'entrée : on les laisse se poser.
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUTPUT_DIR}/${shot.name}.png` })

  console.log(`${OUTPUT_DIR}/${shot.name}.png`)
  await context.close()
}

await browser.close()
