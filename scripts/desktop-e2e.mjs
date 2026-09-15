// Parcours sur l'app Tauri de bureau, vrai backend Rust, via tauri-driver
// (WebDriver). Aucun client npm : le protocole WebDriver est du HTTP.
//
//   npm run test:e2e:desktop   (voir scripts/desktop-e2e.sh)

//
// Prérequis : `npm run dev` (le binaire debug charge devUrl).

import { join } from 'node:path'

import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BINARY = join(ROOT, 'src-tauri/target/debug/app')
const DRIVER = 'http://127.0.0.1:4444'
const DEV_URL = 'http://localhost:5173'

// La base : celle du profil debug, dans le XDG_CONFIG_HOME donné à
// tauri-driver — un dossier de travail vierge, jamais ~/.config. Rust y sème
// le programme de démonstration au premier lancement.

async function wd(method, path, body) {
  const res = await fetch(DRIVER + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`)
  return json.value
}

const session = await wd('POST', '/session', {
  capabilities: { alwaysMatch: { 'tauri:options': { application: BINARY } } },
})
const sid = session.sessionId
const S = `/session/${sid}`
const run = (script, ...args) => wd('POST', `${S}/execute/sync`, { script, args })
const runAsync = (script, ...args) => wd('POST', `${S}/execute/async`, { script, args })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const text = (selector) => run(`return document.querySelector(arguments[0])?.textContent?.trim() ?? null`, selector)

async function waitFor(selector, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const found = await run(`return !!document.querySelector(arguments[0])`, selector)
    if (found) return
    await sleep(150)
  }
  throw new Error(`introuvable : ${selector}`)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

try {
  // 1. L'app démarre, Rust a semé la démo.
  await waitFor('#app a, #app button', 30000)
  const url0 = await wd('GET', `${S}/url`)
  check('l’app démarre sur le vrai backend', url0.startsWith(DEV_URL), url0)

  // 2. Le tracker du développé couché (historique de démo).
  await wd('POST', `${S}/url`, { url: `${DEV_URL}/seances/upper-b/exercises/developpe-couche` })
  await waitFor('.target-chip', 30000)
  const ghost = await text('.ghost-row')
  const target0 = await text('.target-chip')
  check('fantôme et cible viennent de l’instantané Rust', Boolean(ghost) && /Cible/.test(target0 ?? ''), `${ghost} | ${target0}`)
  check('1RM estimé affiché', Boolean(await text('.one-rep-max')), await text('.one-rep-max'))

  // 3. Valider une série et mesurer le délai jusqu'au déplacement de la cible.
  const timing = await runAsync(`
    const done = arguments[arguments.length - 1]
    const chip = document.querySelector('.target-chip')
    const before = chip.textContent
    const form = document.querySelector('form')
    const inputs = form.querySelectorAll('input[type=number]')
    // La cible de S1 telle quelle : on la valide.
    const t0 = performance.now()
    let moved = null
    const observer = new MutationObserver(() => {
      const now = document.querySelector('.target-chip')
      if (now && now.textContent !== before) { moved = performance.now() - t0; observer.disconnect() }
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    form.requestSubmit()
    const started = setInterval(() => {
      if (moved !== null || performance.now() - t0 > 5000) {
        clearInterval(started)
        done({ before, after: document.querySelector('.target-chip')?.textContent ?? null, moved,
               verdict: document.querySelector('.verdict')?.textContent?.trim() ?? null,
               rest: document.querySelector('.rest-countdown')?.textContent?.trim() ?? null,
               badge: document.querySelector('.badge-positive')?.textContent?.trim() ?? null })
      }
    }, 10)
  `)
  check('la cible passe à la série suivante après add_set + exercise_snapshot', timing.moved !== null && timing.after !== timing.before, `${timing.before} → ${timing.after}`)
  check('délai de déplacement de la cible', timing.moved !== null && timing.moved < 500, `${timing.moved?.toFixed(0)} ms`)
  check('verdict local affiché pendant le repos', Boolean(timing.verdict), timing.verdict ?? '')
  check('repos lancé', Boolean(timing.rest), timing.rest ?? '')
  console.log('   badge :', timing.badge ?? 'aucun')

  // 4. Le carnet : la série est là, S1 numérotée, retirer la remet d'aplomb.
  await sleep(300)
  const rows = await run(`return [...document.querySelectorAll('.set-list li')].slice(0, 2).map((li) => li.textContent.replace(/\\s+/g, ' ').trim())`)
  check('la série validée est dans le carnet', rows.length > 0, rows[0])
  await run(`document.querySelector('.skip-button')?.click()`)
  await sleep(200)
  await run(`document.querySelector('.set-list li .remove-set, .set-list li button[class*=remove]')?.click()`)
  await sleep(600)
  const target2 = await text('.target-chip')
  check('retirer la série ramène la cible sur S1', target2 === target0, `${target2}`)

  // 5. Écran de séance : bilan et dernière fois depuis seance_snapshot.
  await wd('POST', `${S}/url`, { url: `${DEV_URL}/seances/upper-b` })
  await waitFor('.exercise-summary', 30000)
  const summary = await text('.exercise-summary')
  check('écran de séance : « Dernière fois » depuis l’instantané', /Dernière fois/.test(summary ?? ''), summary ?? '')
  check('bilan de séance rendu', await run(`return !!document.querySelector('.seance-overview')`))
  check('tendance hebdomadaire de la séance rendue', await run(`return !!document.querySelector('.volume-graph')`))

  // 6. Dashboard : chiffres clés depuis dashboard_snapshot.
  await wd('POST', `${S}/url`, { url: `${DEV_URL}/dashboard` })
  await waitFor('.kpi-value', 30000)
  await sleep(500)
  const kpis = await run(`return [...document.querySelectorAll('.kpi-value')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim())`)
  check('dashboard : chiffres clés remplis', kpis.length >= 5 && kpis[0] !== '0', kpis.join(' | '))
  const alerts = await text('#alerts-title')
  check('dashboard : alerte de stagnation lue', Boolean(alerts), alerts ?? '')
} catch (error) {
  check('exécution', false, String(error))
} finally {
  await wd('DELETE', S).catch(() => {})
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} vérifications passent`)
process.exit(failed ? 1 : 0)
