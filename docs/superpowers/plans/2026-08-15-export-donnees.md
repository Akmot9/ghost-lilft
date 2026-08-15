# Export et restauration des données — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'utilisateur d'exporter toutes ses données dans un fichier JSON et de le restaurer sur un appareil neuf, tant qu'il n'a aucune donnée réelle.

**Architecture:** Trois unités séparées par leurs dépendances. `src/lib/backup.ts` est pur — sérialisation, parsing, validation — et ne connaît ni Tauri ni la base. `src/lib/fileTransfer.ts` est la seule à toucher aux plugins `dialog` et `fs`, avec un repli navigateur qui rend la feature testable en e2e. Le store porte les deux actions qui touchent SQLite, dans une transaction.

**Tech Stack:** Vue 3, Pinia, Tauri 2 (`plugin-dialog`, `plugin-fs`, `plugin-sql`), SQLite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-15-export-donnees-design.md`

## Global Constraints

- **Jamais `window.confirm`** : muet dans le WebView iOS. Toute confirmation se fait en deux clics sur le même bouton, comme `deleteDemoData` dans `SeanceSelectView.vue`.
- **Aucune couleur en dur** dans les composants : uniquement les tokens de `src/assets/main.css` (GL-30).
- **Tous les textes d'interface et messages d'erreur sont en français.**
- **Aucun échec silencieux** : toute erreur d'import produit un message visible et laisse la base inchangée.
- **Ne pas livrer avant résolution de #48** : les tâches 3 et 7 modifient le binaire iOS alors qu'une soumission App Store est en cours. Le code peut être écrit et mergé ; le build iOS attend.
- Vérification locale complète : `npm run type-check && npm run test:unit && npx playwright test && cargo test --manifest-path src-tauri/Cargo.toml`.

---

### Task 1: Sérialisation et parsing (unité pure)

**Files:**
- Create: `src/lib/backup.ts`
- Test: `src/lib/__tests__/backup.spec.ts`

**Interfaces:**
- Consomme : `Seance` depuis `src/stores/seances.ts` (import de type uniquement), `scenarios` depuis `src/datasets/scenarios.ts` (tests seulement).
- Produit :
  - `BACKUP_FORMAT: 'ghost-lift-backup'`
  - `BACKUP_VERSION: 1`
  - `serializeBackup(seances: Seance[], exportedAt: Date): string`
  - `parseBackup(text: string): Seance[]` — lève `Error` avec un message français
  - `backupFileName(exportedAt: Date): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/backup.spec.ts
import { describe, expect, it } from 'vitest'
import { backupFileName, parseBackup, serializeBackup } from '../backup'
import { scenarios } from '../../datasets/scenarios'

const NOW = new Date('2026-08-15T09:00:00.000Z')

describe('serializeBackup / parseBackup', () => {
  it('fait un aller-retour sans perte', () => {
    const seances = scenarios.stagnation(NOW)
    const restored = parseBackup(serializeBackup(seances, NOW))

    expect(restored).toHaveLength(seances.length)
    expect(restored[0]?.slug).toBe(seances[0]?.slug)
    expect(restored[0]?.name).toBe(seances[0]?.name)

    const source = seances[0]!.exercises[0]!
    const target = restored[0]!.exercises[0]!

    expect(target.slug).toBe(source.slug)
    expect(target.restSeconds).toBe(source.restSeconds)
    expect(target.sets.map((set) => [set.reps, set.weight])).toEqual(
      source.sets.map((set) => [set.reps, set.weight]),
    )
    expect(target.sets[0]?.completedAt.toISOString()).toBe(
      source.sets[0]?.completedAt.toISOString(),
    )
  })

  it("n'exporte jamais le marqueur de démonstration", () => {
    const seances = scenarios.progression(NOW).map((seance) => ({ ...seance, isDemo: true }))
    const restored = parseBackup(serializeBackup(seances, NOW))

    expect(restored.every((seance) => seance.isDemo === false)).toBe(true)
    expect(serializeBackup(seances, NOW)).not.toContain('isDemo')
  })

  it('accepte un fichier sans history et rend des séances à historique vide', () => {
    const text = JSON.stringify({
      format: 'ghost-lift-backup',
      version: 1,
      exportedAt: NOW.toISOString(),
      seances: [
        {
          slug: 'upper-a',
          name: 'Upper A',
          exercises: [
            {
              slug: 'developpe-couche',
              name: 'Développé couché',
              defaultReps: 8,
              defaultWeight: 70,
              weightUnit: 'kg',
              restSeconds: 120,
            },
          ],
        },
      ],
    })

    const restored = parseBackup(text)

    expect(restored[0]?.exercises[0]?.sets).toEqual([])
  })

  it('numérote les séries de chaque exercice à partir de 1', () => {
    const restored = parseBackup(serializeBackup(scenarios.pyramide(NOW), NOW))

    expect(restored[0]?.exercises[0]?.sets.map((set) => set.id)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('nomme le fichier avec la date du jour', () => {
    expect(backupFileName(NOW)).toBe('ghost-lift-2026-08-15.json')
  })
})

describe('parseBackup — refus', () => {
  const cases: Array<[string, string, string]> = [
    ['fichier illisible', 'ceci n’est pas du JSON', 'Fichier illisible'],
    [
      'format étranger',
      JSON.stringify({ format: 'autre-app', version: 1, seances: [] }),
      'sauvegarde Ghost Lift',
    ],
    [
      'version future',
      JSON.stringify({ format: 'ghost-lift-backup', version: 2, seances: [] }),
      'version plus récente',
    ],
    [
      'séance sans nom',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [{ slug: 'upper-a', exercises: [] }],
      }),
      'incomplet',
    ],
    [
      'historique orphelin',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [{ slug: 'upper-a', name: 'Upper A', exercises: [] }],
        history: [{ seanceSlug: 'upper-a', exerciseSlug: 'inconnu', sets: [] }],
      }),
      'incohérent',
    ],
    [
      'slugs dupliqués',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [
          { slug: 'upper-a', name: 'Upper A', exercises: [] },
          { slug: 'upper-a', name: 'Doublon', exercises: [] },
        ],
      }),
      'en double',
    ],
    [
      'date non parsable',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [
          {
            slug: 'upper-a',
            name: 'Upper A',
            exercises: [
              {
                slug: 'dc',
                name: 'DC',
                defaultReps: 8,
                defaultWeight: 70,
                weightUnit: 'kg',
                restSeconds: 120,
              },
            ],
          },
        ],
        history: [
          {
            seanceSlug: 'upper-a',
            exerciseSlug: 'dc',
            sets: [{ reps: 8, weight: 70, completedAt: 'hier' }],
          },
        ],
      }),
      'date',
    ],
  ]

  it.each(cases)('refuse : %s', (_label, text, expectedMessage) => {
    expect(() => parseBackup(text)).toThrowError(new RegExp(expectedMessage, 'i'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/backup.spec.ts`
Expected: FAIL — `Failed to resolve import "../backup"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/backup.ts
import type { Exercise, Seance } from '../stores/seances'

export const BACKUP_FORMAT = 'ghost-lift-backup'
export const BACKUP_VERSION = 1

type BackupExercise = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds: number
}

type BackupHistory = {
  seanceSlug: string
  exerciseSlug: string
  sets: Array<{ reps: number; weight: number; completedAt: string }>
}

export function backupFileName(exportedAt: Date): string {
  return `ghost-lift-${exportedAt.toISOString().slice(0, 10)}.json`
}

/**
 * Le modèle de séance et l'historique sont sérialisés séparément : un fichier
 * sans `history` est déjà un programme partageable, ce qui évitera un nouveau
 * format le jour où le partage de séance arrivera.
 *
 * `isDemo` n'est jamais écrit — une sauvegarde restaurée est la donnée de
 * l'utilisateur, elle ne doit pas ressusciter la bannière du mode découverte.
 * Les identifiants de séries non plus : ce sont des autoincrement locaux,
 * réattribués à l'import.
 */
export function serializeBackup(seances: Seance[], exportedAt: Date): string {
  const history: BackupHistory[] = []

  for (const seance of seances) {
    for (const exercise of seance.exercises) {
      if (exercise.sets.length === 0) {
        continue
      }

      history.push({
        seanceSlug: seance.slug,
        exerciseSlug: exercise.slug,
        sets: [...exercise.sets]
          .sort((first, second) => first.completedAt.getTime() - second.completedAt.getTime())
          .map((set) => ({
            reps: set.reps,
            weight: set.weight,
            completedAt: set.completedAt.toISOString(),
          })),
      })
    }
  }

  return `${JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: exportedAt.toISOString(),
      seances: seances.map((seance) => ({
        slug: seance.slug,
        name: seance.name,
        exercises: seance.exercises.map(
          (exercise): BackupExercise => ({
            slug: exercise.slug,
            name: exercise.name,
            defaultReps: exercise.defaultReps,
            defaultWeight: exercise.defaultWeight,
            weightUnit: exercise.weightUnit,
            restSeconds: exercise.restSeconds,
          }),
        ),
      })),
      history,
    },
    null,
    2,
  )}\n`
}

export function parseBackup(text: string): Seance[] {
  const payload = readJson(text)

  if (payload.format !== BACKUP_FORMAT) {
    throw new Error("Ce fichier n'est pas une sauvegarde Ghost Lift.")
  }

  if (payload.version !== BACKUP_VERSION) {
    throw new Error(
      'Cette sauvegarde a été créée par une version plus récente de Ghost Lift. Mets l’app à jour pour la restaurer.',
    )
  }

  const seances = readSeances(payload.seances)
  applyHistory(seances, readHistory(payload.history))

  return seances
}

function readJson(text: string): Record<string, unknown> {
  let payload: unknown

  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Fichier illisible : ce n’est pas un fichier JSON valide.')
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Fichier illisible : contenu inattendu.')
  }

  return payload as Record<string, unknown>
}

function readSeances(raw: unknown): Seance[] {
  if (!Array.isArray(raw)) {
    throw new Error('Fichier incomplet : aucune séance trouvée.')
  }

  const seances: Seance[] = []
  const seenSeanceSlugs = new Set<string>()

  for (const entry of raw) {
    const seance = entry as Record<string, unknown>

    if (!isNonEmptyString(seance?.slug) || !isNonEmptyString(seance?.name)) {
      throw new Error('Fichier incomplet : une séance n’a ni identifiant ni nom.')
    }

    if (seenSeanceSlugs.has(seance.slug)) {
      throw new Error(`Fichier invalide : la séance « ${seance.slug} » apparaît en double.`)
    }
    seenSeanceSlugs.add(seance.slug)

    seances.push({
      slug: seance.slug,
      name: seance.name,
      isDemo: false,
      exercises: readExercises(seance.exercises, seance.slug),
    })
  }

  return seances
}

function readExercises(raw: unknown, seanceSlug: string): Exercise[] {
  if (!Array.isArray(raw)) {
    throw new Error(`Fichier incomplet : la séance « ${seanceSlug} » n’a pas d’exercices.`)
  }

  const exercises: Exercise[] = []
  const seenExerciseSlugs = new Set<string>()

  for (const entry of raw) {
    const exercise = entry as Record<string, unknown>

    if (!isNonEmptyString(exercise?.slug) || !isNonEmptyString(exercise?.name)) {
      throw new Error(`Fichier incomplet : un exercice de « ${seanceSlug} » est mal formé.`)
    }

    if (seenExerciseSlugs.has(exercise.slug)) {
      throw new Error(`Fichier invalide : l’exercice « ${exercise.slug} » apparaît en double.`)
    }
    seenExerciseSlugs.add(exercise.slug)

    if (
      !isFiniteNumber(exercise.defaultReps) ||
      !isFiniteNumber(exercise.defaultWeight) ||
      !isFiniteNumber(exercise.restSeconds) ||
      !isNonEmptyString(exercise.weightUnit)
    ) {
      throw new Error(`Fichier incomplet : l’exercice « ${exercise.slug} » a des valeurs manquantes.`)
    }

    exercises.push({
      slug: exercise.slug,
      name: exercise.name,
      defaultReps: exercise.defaultReps,
      defaultWeight: exercise.defaultWeight,
      weightUnit: exercise.weightUnit,
      restSeconds: exercise.restSeconds,
      sets: [],
    })
  }

  return exercises
}

function readHistory(raw: unknown): BackupHistory[] {
  if (raw === undefined || raw === null) {
    return []
  }

  if (!Array.isArray(raw)) {
    throw new Error('Fichier invalide : l’historique est mal formé.')
  }

  return raw as BackupHistory[]
}

function applyHistory(seances: Seance[], history: BackupHistory[]) {
  for (const entry of history) {
    const seance = seances.find((candidate) => candidate.slug === entry?.seanceSlug)
    const exercise = seance?.exercises.find((candidate) => candidate.slug === entry?.exerciseSlug)

    if (!exercise) {
      throw new Error(
        `Fichier incohérent : l’historique référence « ${entry?.exerciseSlug} », absent des séances.`,
      )
    }

    if (!Array.isArray(entry.sets)) {
      throw new Error(`Fichier invalide : les séries de « ${entry.exerciseSlug} » sont mal formées.`)
    }

    exercise.sets = entry.sets.map((set, index) => {
      if (!isFiniteNumber(set?.reps) || !isFiniteNumber(set?.weight)) {
        throw new Error(`Fichier incomplet : une série de « ${entry.exerciseSlug} » est mal formée.`)
      }

      const completedAt = new Date(set.completedAt)

      if (Number.isNaN(completedAt.getTime())) {
        throw new Error(
          `Fichier invalide : une série de « ${entry.exerciseSlug} » porte une date illisible.`,
        )
      }

      // Les identifiants sont locaux : on renumérote plutôt que de faire
      // confiance au fichier, qui peut venir d'un autre appareil.
      return { id: index + 1, reps: set.reps, weight: set.weight, completedAt }
    })
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/backup.spec.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/backup.ts src/lib/__tests__/backup.spec.ts
git commit -m "Sérialisation et parsing des sauvegardes"
```

---

### Task 2: Actions du store — export et import

**Files:**
- Modify: `src/stores/seances.ts` (getters, actions, helper d'écriture)
- Test: `src/stores/__tests__/seances.spec.ts`

**Interfaces:**
- Consomme : `serializeBackup`, `parseBackup` de la tâche 1.
- Produit :
  - getter `hasRealData: boolean`
  - action `exportBackup(): string`
  - action `importBackup(text: string): Promise<void>` — lève si `hasRealData`

- [ ] **Step 1: Write the failing test**

Ajouter à `src/stores/__tests__/seances.spec.ts` :

```ts
import { parseBackup } from '../../lib/backup'
import { scenarios } from '../../datasets/scenarios'

const NOW = new Date('2026-08-15T09:00:00.000Z')

describe('sauvegarde', () => {
  it('hasRealData est faux tant que tout est de la démonstration', () => {
    const store = useSeanceStore()
    store.seances = scenarios.progression(NOW).map((seance) => ({ ...seance, isDemo: true }))

    expect(store.hasRealData).toBe(false)
  })

  it('hasRealData devient vrai dès une séance réelle', () => {
    const store = useSeanceStore()
    store.seances = scenarios.progression(NOW)

    expect(store.hasRealData).toBe(true)
  })

  it('exporte l’état courant dans un fichier relisible', () => {
    const store = useSeanceStore()
    store.seances = scenarios.progression(NOW)

    const restored = parseBackup(store.exportBackup())

    expect(restored[0]?.slug).toBe(store.seances[0]?.slug)
    expect(restored[0]?.exercises[0]?.sets).toHaveLength(
      store.seances[0]?.exercises[0]?.sets.length ?? 0,
    )
  })

  it('remplace les données de démonstration par la sauvegarde', async () => {
    const store = useSeanceStore()
    store.seances = scenarios.stagnation(NOW).map((seance) => ({ ...seance, isDemo: true }))

    const backup = serializeBackup(scenarios.progression(NOW), NOW)
    await store.importBackup(backup)

    expect(store.seances.map((seance) => seance.slug)).toEqual(['lower'])
    expect(store.hasDemoData).toBe(false)
  })

  it('refuse d’importer par-dessus des données réelles', async () => {
    const store = useSeanceStore()
    store.seances = scenarios.progression(NOW)

    await expect(
      store.importBackup(serializeBackup(scenarios.stagnation(NOW), NOW)),
    ).rejects.toThrow(/déjà tes propres séances/i)

    expect(store.seances.map((seance) => seance.slug)).toEqual(['lower'])
  })

  it('laisse l’état intact quand le fichier est invalide', async () => {
    const store = useSeanceStore()
    store.seances = scenarios.stagnation(NOW).map((seance) => ({ ...seance, isDemo: true }))

    await expect(store.importBackup('pas du json')).rejects.toThrow(/illisible/i)

    expect(store.seances.map((seance) => seance.slug)).toEqual(['upper-a'])
  })
})
```

Ajouter `serializeBackup` à l'import existant depuis `../../lib/backup`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/__tests__/seances.spec.ts`
Expected: FAIL — `store.exportBackup is not a function`.

- [ ] **Step 3: Write the implementation**

Dans `src/stores/seances.ts`, ajouter l'import en tête :

```ts
import { parseBackup, serializeBackup } from '../lib/backup'
```

Ajouter le getter à côté de `hasDemoData` :

```ts
    /** Une séance non-démo suffit : l'utilisateur a quelque chose à perdre. */
    hasRealData: (state) => state.seances.some((seance) => !seance.isDemo),
```

Ajouter les deux actions à la suite de `deleteDemoData` :

```ts
    exportBackup(): string {
      return serializeBackup(this.seances, new Date())
    },
    /**
     * Restauration possible seulement tant qu'il n'y a rien à perdre : aucune
     * séance, ou uniquement le programme d'exemple. Cette contrainte supprime
     * par construction toute question de fusion — il n'y a jamais rien à
     * arbitrer entre deux historiques.
     */
    async importBackup(text: string) {
      if (this.hasRealData) {
        throw new Error(
          'Tu as déjà tes propres séances : la restauration n’est possible que sur une app fraîchement installée.',
        )
      }

      // Le parsing lève avant toute écriture : un fichier invalide ne doit
      // jamais entamer la base.
      const seances = parseBackup(text)

      await replaceAllSeances(seances)

      this.seances = seances
    },
```

Ajouter le helper près de `seedDatabase` :

```ts
/**
 * Tout ou rien : un import interrompu ne doit pas laisser une base à moitié
 * peuplée, état qu'aucun écran de l'app ne saurait interpréter.
 */
async function replaceAllSeances(seances: Seance[]) {
  if (!runningInTauri()) {
    return
  }

  const database = await getDb()

  await database.execute('BEGIN')
  try {
    await database.execute('DELETE FROM sets')
    await database.execute('DELETE FROM exercises')
    await database.execute('DELETE FROM seances')

    for (const seance of seances) {
      await database.execute('INSERT INTO seances (slug, name, is_demo) VALUES ($1, $2, 0)', [
        seance.slug,
        seance.name,
      ])

      for (const exercise of seance.exercises) {
        await database.execute(
          'INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            seance.slug,
            exercise.slug,
            exercise.name,
            exercise.defaultReps,
            exercise.defaultWeight,
            exercise.weightUnit,
            exercise.restSeconds,
          ],
        )

        for (const set of exercise.sets) {
          await database.execute(
            'INSERT INTO sets (seance_slug, exercise_slug, reps, weight, completed_at) VALUES ($1, $2, $3, $4, $5)',
            [seance.slug, exercise.slug, set.reps, set.weight, set.completedAt.toISOString()],
          )
        }
      }
    }

    await database.execute('COMMIT')
  } catch (error) {
    await database.execute('ROLLBACK')
    throw error
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/__tests__/seances.spec.ts && npm run type-check`
Expected: PASS, aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add src/stores/seances.ts src/stores/__tests__/seances.spec.ts
git commit -m "Store : exportBackup et importBackup"
```

---

### Task 3: Transfert de fichier — plugins Tauri et repli navigateur

**Files:**
- Create: `src/lib/fileTransfer.ts`
- Modify: `package.json` (deux dépendances)
- Modify: `src-tauri/Cargo.toml` (deux dépendances)
- Modify: `src-tauri/src/lib.rs` (enregistrement des plugins)
- Modify: `src-tauri/capabilities/default.json` (permissions)

**Interfaces:**
- Produit :
  - `saveTextFile(suggestedName: string, contents: string): Promise<boolean>` — `false` si l'utilisateur annule
  - `pickTextFile(): Promise<string | null>` — `null` si annulation

- [ ] **Step 1: Installer les dépendances**

```bash
npm install @tauri-apps/plugin-dialog @tauri-apps/plugin-fs
cargo add tauri-plugin-dialog tauri-plugin-fs --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Enregistrer les plugins côté Rust**

Dans `src-tauri/src/lib.rs`, ajouter à la chaîne de `Builder` existante, à côté de `tauri_plugin_sql` :

```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
```

- [ ] **Step 3: Ouvrir les permissions**

Dans `src-tauri/capabilities/default.json`, remplacer le tableau `permissions` par :

```json
  "permissions": [
    "core:default",
    "sql:default",
    "sql:allow-execute",
    "dialog:allow-save",
    "dialog:allow-open",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file"
  ]
```

- [ ] **Step 4: Vérifier que le projet Rust compile encore**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — 8 tests, aucune erreur de compilation.

- [ ] **Step 5: Écrire le module de transfert**

```ts
// src/lib/fileTransfer.ts
import { isTauri } from '@tauri-apps/api/core'

/**
 * Seule unité qui connaît les plugins de fichiers. Le repli navigateur n'est
 * pas une commodité de développement : c'est ce qui rend l'export et l'import
 * vérifiables en e2e, donc en intégration continue.
 *
 * Les imports des plugins sont dynamiques pour que le mode navigateur n'ait
 * jamais à les charger.
 */
function runningInTauri(): boolean {
  if (typeof isTauri === 'function') {
    return isTauri()
  }

  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function saveTextFile(suggestedName: string, contents: string): Promise<boolean> {
  if (!runningInTauri()) {
    downloadInBrowser(suggestedName, contents)
    return true
  }

  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: 'Sauvegarde Ghost Lift', extensions: ['json'] }],
  })

  if (!path) {
    return false
  }

  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(path, contents)

  return true
}

export async function pickTextFile(): Promise<string | null> {
  if (!runningInTauri()) {
    return pickInBrowser()
  }

  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Sauvegarde Ghost Lift', extensions: ['json'] }],
  })

  if (typeof path !== 'string') {
    return null
  }

  const { readTextFile } = await import('@tauri-apps/plugin-fs')

  return readTextFile(path)
}

function downloadInBrowser(fileName: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function pickInBrowser(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')

    input.type = 'file'
    input.accept = 'application/json,.json'
    input.dataset.testid = 'backup-file-input'

    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      resolve(file ? await file.text() : null)
      input.remove()
    })

    // Annulation : aucun événement `change` n'est émis, la promesse reste en
    // attente et l'utilisateur peut simplement recliquer sur le bouton.
    document.body.append(input)
    input.click()
  })
}
```

- [ ] **Step 6: Vérifier les types**

Run: `npm run type-check`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock \
  src-tauri/src/lib.rs src-tauri/capabilities/default.json src/lib/fileTransfer.ts
git commit -m "Transfert de fichier via dialog/fs, avec repli navigateur"
```

---

### Task 4: Bouton d'export dans la liste des séances

**Files:**
- Modify: `src/views/SeanceSelectView.vue`
- Test: `e2e/backup.spec.ts` (créé ici, complété en tâche 6)

**Interfaces:**
- Consomme : `exportBackup()` (tâche 2), `saveTextFile` et `backupFileName` (tâches 3 et 1).

- [ ] **Step 1: Write the failing test**

```ts
// e2e/backup.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/backup.spec.ts`
Expected: FAIL — le bouton « Exporter mes données » n'existe pas.

- [ ] **Step 3: Write the implementation**

Dans `src/views/SeanceSelectView.vue`, ajouter aux imports du `<script setup>` :

```ts
import { backupFileName } from '../lib/backup'
import { saveTextFile } from '../lib/fileTransfer'
```

Ajouter l'état et l'action :

```ts
const exporting = ref(false)
const backupError = ref('')

async function onExport() {
  backupError.value = ''
  exporting.value = true
  try {
    const exportedAt = new Date()
    await saveTextFile(backupFileName(exportedAt), seanceStore.exportBackup())
  } catch (error) {
    backupError.value = error instanceof Error ? error.message : 'Export impossible.'
  } finally {
    exporting.value = false
  }
}
```

Ajouter la section juste avant la fermeture de `</section>` dans le template :

```html
    <div class="data-actions">
      <h2 class="data-title">Tes données</h2>
      <p class="data-hint">
        Tout est stocké sur cet appareil. Exporte régulièrement : une
        réinstallation efface l'historique.
      </p>

      <button type="button" class="data-export" :disabled="exporting" @click="onExport">
        {{ exporting ? 'Export en cours…' : 'Exporter mes données' }}
      </button>

      <p v-if="backupError" class="data-error" role="alert">{{ backupError }}</p>
    </div>
```

Ajouter le style, en n'utilisant que des tokens existants :

```css
.data-actions {
  display: grid;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--panel-border);
}

.data-title {
  margin: 0;
  font-size: 1rem;
}

.data-hint {
  margin: 0;
  color: var(--muted);
}

.data-export {
  justify-self: start;
  min-height: 44px;
}

.data-error {
  margin: 0;
  color: var(--blood-text);
}
```

`--muted` et `--blood-text` sont les tokens réellement définis dans `src/assets/main.css`, en clair comme en sombre (lignes 33-51 et 95-109). Aucune couleur en dur, conformément à GL-30.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test e2e/backup.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/SeanceSelectView.vue e2e/backup.spec.ts
git commit -m "Bouton d'export dans la liste des séances"
```

---

### Task 5: Restauration — onboarding et bannière du mode découverte

**Files:**
- Create: `src/components/RestoreBackupButton.vue`
- Modify: `src/views/CreateSeanceView.vue`
- Modify: `src/views/SeanceSelectView.vue`

**Interfaces:**
- Consomme : `importBackup()` et `hasRealData` (tâche 2), `pickTextFile` (tâche 3).
- Produit : composant `RestoreBackupButton`, sans props, qui s'auto-masque quand `hasRealData` est vrai.

Le composant est partagé parce que les deux points d'entrée portent exactement le même comportement ; le dupliquer garantirait qu'ils divergent.

- [ ] **Step 1: Write the failing test**

Ajouter à `e2e/backup.spec.ts` :

```ts
  test('la restauration est absente dès qu’il existe une séance réelle', async ({ page }) => {
    await useFixture(page, 'progression')

    await page.goto('/seances')

    await expect(page.getByRole('button', { name: 'Restaurer une sauvegarde' })).toHaveCount(0)
  })

  test('la restauration est proposée en mode découverte', async ({ page }) => {
    await page.goto('/seances')

    await expect(page.getByRole('button', { name: 'Restaurer une sauvegarde' })).toBeVisible()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/backup.spec.ts`
Expected: FAIL sur le second test — le bouton n'existe pas.

- [ ] **Step 3: Write the component**

```vue
<!-- src/components/RestoreBackupButton.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSeanceStore } from '../stores/seances'
import { pickTextFile } from '../lib/fileTransfer'

const seanceStore = useSeanceStore()
const router = useRouter()

// Deux clics plutôt que window.confirm (absent du WebView iOS/macOS).
const confirmRestore = ref(false)
const restoring = ref(false)
const restoreError = ref('')

async function onRestore() {
  restoreError.value = ''

  if (!confirmRestore.value) {
    confirmRestore.value = true
    return
  }

  confirmRestore.value = false

  const text = await pickTextFile()

  if (text === null) {
    return
  }

  restoring.value = true
  try {
    await seanceStore.importBackup(text)
    router.push('/seances')
  } catch (error) {
    restoreError.value =
      error instanceof Error ? error.message : 'Restauration impossible : fichier illisible.'
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <div v-if="!seanceStore.hasRealData" class="restore">
    <button type="button" class="restore-button" :disabled="restoring" @click="onRestore">
      {{
        restoring
          ? 'Restauration…'
          : confirmRestore
            ? 'Confirmer : remplacer les données d’exemple ?'
            : 'Restaurer une sauvegarde'
      }}
    </button>

    <p v-if="restoreError" class="restore-error" role="alert">{{ restoreError }}</p>
  </div>
</template>

<style scoped>
.restore {
  display: grid;
  gap: 8px;
}

.restore-button {
  min-height: 44px;
}

.restore-error {
  margin: 0;
  color: var(--blood-text);
}
</style>
```

- [ ] **Step 4: Brancher les deux points d'entrée**

Dans `src/views/CreateSeanceView.vue`, importer et poser le composant sous le formulaire :

```ts
import RestoreBackupButton from '../components/RestoreBackupButton.vue'
```

```html
      <RestoreBackupButton />
```

Dans `src/views/SeanceSelectView.vue`, ajouter le même import et poser le composant dans `.demo-actions`, après le bouton de suppression :

```html
        <RestoreBackupButton />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test e2e/backup.spec.ts && npm run type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/RestoreBackupButton.vue src/views/CreateSeanceView.vue \
  src/views/SeanceSelectView.vue e2e/backup.spec.ts
git commit -m "Restauration depuis l'onboarding et la bannière découverte"
```

---

### Task 6: Le parcours complet en e2e

**Files:**
- Modify: `e2e/backup.spec.ts`

C'est le seul test qui prouve que la sauvegarde protège réellement. Les précédents ne vérifient que du JSON et des boutons.

- [ ] **Step 1: Write the failing test**

Ajouter à `e2e/backup.spec.ts` :

```ts
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

    // 3. Restaurer.
    await clean.getByRole('button', { name: 'Restaurer une sauvegarde' }).click()
    await clean.getByRole('button', { name: /Confirmer/ }).click()
    await clean.locator('input[type="file"]').setInputFiles(backupPath)

    // 4. Les séances de la sauvegarde ont remplacé le programme d'exemple.
    await expect(clean.getByRole('link', { name: /Lower/ })).toBeVisible()
    await expect(clean.getByRole('link', { name: /Upper A/ })).toHaveCount(0)

    // 5. L'historique est revenu, fantôme compris.
    await clean.goto('/seances/lower/exercises/high-bar-squat')
    await expect(clean.getByText('Fantôme')).toBeVisible()
    await expect(clean.getByText('Cible → 70 kg × 8')).toBeVisible()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/backup.spec.ts`
Expected: FAIL — à ce stade seulement si un maillon manque ; sinon le test passe directement et confirme la chaîne.

- [ ] **Step 3: Corriger ce que le test révèle**

Deux points à surveiller, tous deux vus pendant la conception :

1. `pickInBrowser` crée l'`input` au clic ; le test doit donc cliquer **avant** `setInputFiles`, ce que fait l'ordre ci-dessus.
2. Le nouvel onglet hérite du scénario `progression` posé par `addInitScript` sur le contexte. Si c'est le cas, ouvrir le second onglet depuis un contexte neuf : `await page.context().browser()!.newContext()` puis `newPage()`.

- [ ] **Step 4: Run the full suite**

Run: `npm run type-check && npm run test:unit && npx playwright test`
Expected: tout passe, aucun test ignoré.

- [ ] **Step 5: Commit**

```bash
git add e2e/backup.spec.ts
git commit -m "e2e : export puis restauration ramène l'historique"
```

---

### Task 7: Conformité iOS

**Files:**
- Create: `src-tauri/PrivacyInfo.xcprivacy`
- Modify: `.github/workflows/ios-testflight.yml` (copie du fichier dans le projet généré)

Apple exige une déclaration de raison d'usage dès qu'une app touche aux API de fichiers. Son absence vaut un rejet à la soumission — la documentation du plugin `fs` le mentionne explicitement.

- [ ] **Step 1: Écrire le fichier de déclaration**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key>
  <false/>
  <key>NSPrivacyTrackingDomains</key>
  <array/>
  <key>NSPrivacyCollectedDataTypes</key>
  <array/>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>C617.1</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
```

`C617.1` déclare un accès aux horodatages de fichiers que l'utilisateur a lui-même désignés dans un sélecteur de documents — exactement notre cas. `NSPrivacyCollectedDataTypes` reste vide : l'app ne collecte rien, ce qui doit rester cohérent avec la déclaration « Aucune donnée collectée » d'App Store Connect.

- [ ] **Step 2: Copier le fichier dans le projet iOS généré**

Dans `.github/workflows/ios-testflight.yml`, après l'étape qui exécute `tauri ios init` et avant la construction :

```yaml
      - name: Installer la déclaration de confidentialité
        run: cp src-tauri/PrivacyInfo.xcprivacy "src-tauri/gen/apple/PrivacyInfo.xcprivacy"
```

Vérifier ensuite dans Xcode que le fichier est bien membre de la cible de l'app : un `PrivacyInfo.xcprivacy` présent sur disque mais absent de la cible n'est pas embarqué, et Apple le traitera comme manquant.

- [ ] **Step 3: Vérifier la cohérence des déclarations**

Relire l'issue #48 : la fiche App Store déclare « Aucune donnée collectée ». La déclaration ci-dessus doit dire la même chose. Une divergence entre les deux est exactement ce qu'un reviewer relève.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/PrivacyInfo.xcprivacy .github/workflows/ios-testflight.yml
git commit -m "Déclaration de confidentialité pour les API fichiers"
```

- [ ] **Step 5: Ne pas livrer tout de suite**

Ne déclencher aucun build iOS tant que #48 n'est pas tranchée. Le code peut être mergé sur `main` sans risque : le workflow TestFlight n'écoute que `workflow_dispatch` et les tags `ios-v*`.

---

## Vérification finale

- [ ] `npm run type-check`
- [ ] `npm run test:unit` — les tests de `backup.spec.ts` et du store passent
- [ ] `npx playwright test` — aucun test ignoré
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `npm run build-only` puis vérifier que `dist/` ne contient aucune trace des scénarios de test
- [ ] Fermer #45 en référençant la PR
