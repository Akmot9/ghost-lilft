import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { serializeBackup } from '../../lib/backup'
import type { Seance } from '../seances'

/**
 * Les 103 tests de `seances.spec.ts` prennent tous la branche « hors Tauri » du
 * store : `runningInTauri()` y est faux, donc `persist()` ne fait rien et
 * `invoke('import_seances', …)` n'est jamais exécuté. Le nom de la commande, le
 * nom de son argument et le moment de l'appel ne sont donc vérifiés nulle part
 * côté TypeScript — un `invoke('import_seance')` au singulier compilerait,
 * passerait les tests, et casserait la restauration chez l'utilisateur.
 *
 * Ce fichier-ci fait tourner la **vraie** branche Tauri du store en interceptant
 * le pont IPC avec `mockIPC` (`@tauri-apps/api/mocks`).
 *
 * Deux détails de montage méritent d'être écrits noir sur blanc :
 *
 *  1. `mockIPC()` installe `window.__TAURI_INTERNALS__.invoke`, mais **ne** pose
 *     **pas** `globalThis.isTauri`. Or `isTauri()` (`@tauri-apps/api/core`) se
 *     résume à `!!(globalThis || window).isTauri`, et `runningInTauri()` appelle
 *     `isTauri()` dès qu'elle existe — son repli sur `__TAURI_INTERNALS__` n'est
 *     donc jamais atteint. Sans le drapeau posé à la main, le store resterait
 *     sur sa branche mémoire et ces tests seraient verts sans rien exécuter.
 *
 *  2. Le store garde sa connexion (`dbInstance` / `dbLoadPromise`) dans une
 *     variable de module. Un test qui a ouvert la base la laisserait ouverte
 *     pour les suivants, et `db_file_name` ne serait plus jamais demandé.
 *     D'où le `vi.resetModules()` et l'import dynamique à chaque test — pinia
 *     compris, sinon `setActivePinia` et `defineStore` viendraient de deux
 *     copies différentes du module.
 */

/** Le fichier de référence partagé avec Rust, produit par `importPayload.spec.ts`. */
const FIXTURE_PATH = resolve(process.cwd(), 'fixtures/import-payload.json')

type PayloadSet = {
  id: number
  reps: number
  weight: number
  completedAt: string
  isWarmup: boolean
}
type PayloadExercise = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds: number
  isDumbbell: boolean
  sets: PayloadSet[]
}
type PayloadSeance = { slug: string; name: string; exercises: PayloadExercise[] }

function referencePayload(): PayloadSeance[] {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as PayloadSeance[]
}

/**
 * Reconstruit les séances du fichier de référence, puis les sérialise au format
 * sauvegarde. Le texte obtenu est ce qu'un utilisateur choisirait dans le
 * sélecteur de fichiers ; la charge utile qui en ressort à l'autre bout doit
 * être, octet pour octet, le fichier de référence que Rust désérialise.
 *
 * Partir du fichier plutôt que des scénarios évite de dupliquer la construction
 * de `importPayload.spec.ts` : ce test-ci ne connaît que l'artefact partagé.
 */
function backupTextFromReference(): string {
  const seances: Seance[] = referencePayload().map((seance) => ({
    slug: seance.slug,
    name: seance.name,
    isDemo: false,
    exercises: seance.exercises.map((exercise) => ({
      slug: exercise.slug,
      name: exercise.name,
      defaultReps: exercise.defaultReps,
      defaultWeight: exercise.defaultWeight,
      weightUnit: exercise.weightUnit,
      restSeconds: exercise.restSeconds,
      isDumbbell: exercise.isDumbbell,
      sets: exercise.sets.map((set) => ({
        id: set.id,
        reps: set.reps,
        weight: set.weight,
        completedAt: new Date(set.completedAt),
        isWarmup: set.isWarmup,
      })),
    })),
  }))

  return serializeBackup(seances, new Date('2026-08-15T09:00:00.000Z'))
}

type IpcCall = { cmd: string; args: Record<string, unknown> }

/** Nom de fichier renvoyé par la fausse commande `db_file_name`. */
const DB_FILE = 'ghost-lift-test.db'

/**
 * Branche l'IPC, journalise chaque appel, et délègue la réponse au `respond`
 * fourni. Le `respond` par défaut **lève** sur toute commande non prévue : un
 * renommage côté TypeScript ne produit pas un appel silencieusement ignoré mais
 * une promesse rejetée, en plus de l'assertion explicite sur le nom.
 */
function interceptIpc(respond: (cmd: string, args: Record<string, unknown>) => unknown): IpcCall[] {
  const calls: IpcCall[] = []

  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Record<string, unknown>
    calls.push({ cmd, args: payload })

    return respond(cmd, payload)
  })

  return calls
}

/** Réponses minimales du back : la commande d'import et rien d'autre. */
function importOnly(cmd: string): unknown {
  if (cmd === 'import_seances') {
    return null
  }

  throw new Error(`commande IPC inattendue : ${cmd}`)
}

/** Réponses minimales du back pour le chemin base de données. */
function sqlBackend(selectRows: (query: string) => unknown[] = () => []) {
  return (cmd: string, args: Record<string, unknown>): unknown => {
    switch (cmd) {
      case 'db_file_name':
        return DB_FILE
      case 'plugin:sql|load':
        return args.db
      case 'plugin:sql|execute':
        return [1, 0]
      case 'plugin:sql|select':
        return selectRows(String(args.query))
      default:
        throw new Error(`commande IPC inattendue : ${cmd}`)
    }
  }
}

type StoreModule = typeof import('../seances')

/**
 * Recharge pinia et le store, drapeau Tauri posé. Retourne le store frais,
 * connexion à la base non encore ouverte.
 */
async function freshTauriStore() {
  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())

  const { useSeanceStore }: StoreModule = await import('../seances')

  return useSeanceStore()
}

function setTauriFlag(value: boolean) {
  const scope = globalThis as unknown as { isTauri?: boolean }

  if (value) {
    scope.isTauri = true
  } else {
    delete scope.isTauri
  }
}

describe('branche Tauri du store (pont IPC simulé)', () => {
  beforeEach(() => {
    vi.resetModules()
    setTauriFlag(true)
  })

  afterEach(() => {
    // Un mock qui survit d'un test à l'autre rend le suivant vert pour la
    // mauvaise raison : on rend le `window` à son état pré-Tauri.
    clearMocks()
    setTauriFlag(false)
  })

  it('le montage fait bien basculer le store sur sa branche Tauri', async () => {
    // Test du test : si ce garde-fou tombe, tous les autres de ce fichier
    // passeraient en n'exécutant que le repli mémoire.
    const { isTauri } = await import('@tauri-apps/api/core')

    interceptIpc(sqlBackend())

    expect(isTauri()).toBe(true)
  })

  describe('importBackup', () => {
    it('invoque la commande import_seances avec son argument seances', async () => {
      const calls = interceptIpc(importOnly)
      const store = await freshTauriStore()

      await store.importBackup(backupTextFromReference())

      // Un seul appel, et c'est celui-là : ni le nom de la commande ni celui de
      // l'argument ne peuvent être renommés d'un seul côté sans faire tomber ce
      // test — c'est exactement ce que le test Rust
      // `invoking_import_seances_by_name_writes_the_reference_payload` invoque.
      expect(calls.map((call) => call.cmd)).toEqual(['import_seances'])
      expect(Object.keys(calls[0]!.args)).toEqual(['seances'])
    })

    it('envoie exactement la charge utile du fichier de référence', async () => {
      const calls = interceptIpc(importOnly)
      const store = await freshTauriStore()

      await store.importBackup(backupTextFromReference())

      // Ce que Rust désérialise dans ses tests est ce que le front met sur le
      // fil : le fichier fait le pont entre les deux langages, ce test-ci
      // vérifie que c'est bien lui qui part.
      expect(calls[0]!.args.seances).toEqual(referencePayload())
    })

    it('ne touche pas à l’IPC quand des données réelles existent', async () => {
      const calls = interceptIpc(importOnly)
      const store = await freshTauriStore()

      store.seances = [
        { slug: 'ma-seance', name: 'Ma séance', isDemo: false, exercises: [] },
      ]

      await expect(store.importBackup(backupTextFromReference())).rejects.toThrow(
        /restauration/,
      )

      // Le refus doit être total : rien ne part vers Rust, donc rien n'est
      // écrasé — même pas partiellement.
      expect(calls).toEqual([])
      expect(store.seances.map((seance) => seance.slug)).toEqual(['ma-seance'])
    })

    it('ne touche pas à l’IPC quand le fichier est invalide', async () => {
      const calls = interceptIpc(importOnly)
      const store = await freshTauriStore()

      await expect(store.importBackup('{ pas du json')).rejects.toThrow(/illisible/)
      await expect(store.importBackup('{"format":"autre-chose"}')).rejects.toThrow(
        /sauvegarde Revenant/,
      )

      // La garantie « le parsing lève avant toute écriture », vérifiée cette
      // fois sur le fil et pas seulement en mémoire.
      expect(calls).toEqual([])
    })

    it('propage l’erreur renvoyée par Rust sans toucher à l’état', async () => {
      // `import_seances` renvoie `Result<(), String>` : côté JS, l'échec arrive
      // sous la forme d'une promesse rejetée portant la chaîne d'erreur.
      const calls = interceptIpc((cmd) => {
        if (cmd === 'import_seances') {
          return Promise.reject('Restauration impossible : database is locked')
        }

        throw new Error(`commande IPC inattendue : ${cmd}`)
      })

      const store = await freshTauriStore()
      const before: Seance[] = [
        { slug: 'demo', name: 'Démo', isDemo: true, exercises: [] },
      ]
      store.seances = before

      await expect(store.importBackup(backupTextFromReference())).rejects.toBe(
        'Restauration impossible : database is locked',
      )

      // L'écriture a bien été tentée, et l'état en mémoire n'a pas bougé : la
      // mémoire ne prend l'avance sur la base dans aucun sens.
      expect(calls.map((call) => call.cmd)).toEqual(['import_seances'])
      expect(store.seances).toEqual(before)
    })
  })

  describe('getDb', () => {
    it('demande le nom du fichier à Rust avant d’ouvrir la connexion', async () => {
      const calls = interceptIpc(
        sqlBackend((query) => (query.includes('COUNT(*)') ? [{ n: 1 }] : [])),
      )
      const store = await freshTauriStore()

      await store.init()

      // Rust est la seule source de vérité pour le nom du fichier : le front ne
      // doit pas le recalculer. L'ordre importe — le nom d'abord, la connexion
      // ensuite, sur ce nom-là.
      expect(calls[0]!.cmd).toBe('db_file_name')
      expect(calls[1]).toEqual({
        cmd: 'plugin:sql|load',
        args: { db: `sqlite:${DB_FILE}` },
      })
    })

    it('ne redemande pas le nom du fichier à chaque écriture', async () => {
      const calls = interceptIpc(sqlBackend())
      const store = await freshTauriStore()

      store.seances = [
        {
          slug: 'lower',
          name: 'Lower',
          isDemo: false,
          exercises: [
            {
              slug: 'squat',
              name: 'Squat',
              defaultReps: 5,
              defaultWeight: 80,
              weightUnit: 'kg',
              restSeconds: 120,
              sets: [],
            },
          ],
        },
      ]

      await store.renameSeance('lower', 'Lower A')
      await store.renameSeance('lower', 'Lower B')

      expect(calls.filter((call) => call.cmd === 'db_file_name')).toHaveLength(1)
      expect(calls.filter((call) => call.cmd === 'plugin:sql|load')).toHaveLength(1)
    })
  })

  describe('persist', () => {
    /**
     * Le chemin d'écriture du quotidien. `@tauri-apps/plugin-sql` passe lui
     * aussi par l'IPC (`plugin:sql|load`, `plugin:sql|execute`,
     * `plugin:sql|select`) : `mockIPC` l'intercepte sans montage
     * supplémentaire, et l'on voit donc partir la vraie requête SQL avec ses
     * vrais paramètres. Un test représentatif suffit — c'est le même `persist()`
     * pour toutes les actions.
     */
    it('ajouter une série émet l’insertion attendue', async () => {
      const calls = interceptIpc(sqlBackend())
      const store = await freshTauriStore()

      store.seances = [
        {
          slug: 'upper-b',
          name: 'Upper B',
          isDemo: false,
          exercises: [
            {
              slug: 'developpe-couche',
              name: 'Développé couché',
              defaultReps: 8,
              defaultWeight: 70,
              weightUnit: 'kg',
              restSeconds: 120,
              sets: [],
            },
          ],
        },
      ]

      await store.addSet('upper-b', 'developpe-couche', {
        id: 42,
        reps: 8,
        weight: 72.5,
        completedAt: new Date('2026-08-15T18:00:00.000Z'),
      })

      const executes = calls.filter((call) => call.cmd === 'plugin:sql|execute')

      expect(executes).toHaveLength(1)
      expect(executes[0]!.args).toEqual({
        db: `sqlite:${DB_FILE}`,
        query:
          'INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        values: [42, 'upper-b', 'developpe-couche', 8, 72.5, '2026-08-15T18:00:00.000Z', 0],
      })

      // Et la mémoire suit : l'écriture n'a pas remplacé la mise à jour locale.
      expect(store.findExercise('upper-b', 'developpe-couche')?.sets.map((set) => set.id)).toEqual([
        42,
      ])
    })

    it('mémorise le mode haltères sur l’exercice visé', async () => {
      const calls = interceptIpc(sqlBackend())
      const store = await freshTauriStore()

      store.seances = [
        {
          slug: 'upper-a',
          name: 'Upper A',
          isDemo: false,
          exercises: [
            {
              slug: 'curl-incline',
              name: 'Curl incliné',
              defaultReps: 10,
              defaultWeight: 24,
              weightUnit: 'kg',
              restSeconds: 90,
              isDumbbell: false,
              sets: [],
            },
          ],
        },
      ]

      await store.setExerciseDumbbell('upper-a', 'curl-incline', true)

      const execute = calls.find((call) => call.cmd === 'plugin:sql|execute')
      expect(execute?.args).toEqual({
        db: `sqlite:${DB_FILE}`,
        query: 'UPDATE exercises SET is_dumbbell = $1 WHERE seance_slug = $2 AND slug = $3',
        values: [1, 'upper-a', 'curl-incline'],
      })
      expect(store.findExercise('upper-a', 'curl-incline')?.isDumbbell).toBe(true)
    })

    it('mémorise la reclassification d’une série en échauffement', async () => {
      const calls = interceptIpc(sqlBackend())
      const store = await freshTauriStore()

      store.seances = [
        {
          slug: 'upper-a',
          name: 'Upper A',
          isDemo: false,
          exercises: [
            {
              slug: 'developpe-incline',
              name: 'Développé incliné',
              defaultReps: 6,
              defaultWeight: 84,
              weightUnit: 'kg',
              restSeconds: 150,
              sets: [
                {
                  id: 42,
                  reps: 6,
                  weight: 48,
                  completedAt: new Date('2026-08-17T18:00:00.000Z'),
                },
              ],
            },
          ],
        },
      ]

      await store.setSetWarmup('upper-a', 'developpe-incline', 42, true)

      const execute = calls.find((call) => call.cmd === 'plugin:sql|execute')
      expect(execute?.args).toEqual({
        db: `sqlite:${DB_FILE}`,
        query: 'UPDATE sets SET is_warmup = $1 WHERE id = $2',
        values: [1, 42],
      })
      expect(store.findExercise('upper-a', 'developpe-incline')?.sets[0]?.isWarmup).toBe(true)
    })

    it('n’écrit rien quand l’exercice visé n’existe pas', async () => {
      const calls = interceptIpc(sqlBackend())
      const store = await freshTauriStore()

      await store.addSet('inconnue', 'inconnu', {
        id: 1,
        reps: 5,
        weight: 60,
        completedAt: new Date('2026-08-15T18:00:00.000Z'),
      })

      expect(calls).toEqual([])
    })
  })
})
