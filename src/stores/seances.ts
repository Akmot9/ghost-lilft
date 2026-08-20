import { defineStore } from 'pinia'
import { invoke, isTauri } from '@tauri-apps/api/core'
import Database from '@tauri-apps/plugin-sql'
import { createDemoSeances } from '../datasets/demoProgram'
import type { ExerciseSet } from '../lib/trainingInsights'
import { parseBackup, serializeBackup } from '../lib/backup'

export type Exercise = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  /** Repos prescrit entre les séries, en secondes. */
  restSeconds: number
  /** Saisie en poids d'un haltère ; l'historique reste toujours en charge totale. */
  isDumbbell?: boolean
  sets: ExerciseSet[]
}

export type Seance = {
  slug: string
  name: string
  /** Séance d'exemple du mode découverte, supprimable d'un geste. */
  isDemo: boolean
  exercises: Exercise[]
}

export type CreateExerciseInput = {
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds?: number
  isDumbbell?: boolean
}

export const useSeanceStore = defineStore('seances', {
  state: () => ({
    seances: [] as Seance[],
    ready: false,
  }),
  getters: {
    hasOnboarded: (state) => state.seances.length > 0,
    hasDemoData: (state) => state.seances.some((seance) => seance.isDemo),
    /** Une séance non-démo suffit : l'utilisateur a quelque chose à perdre. */
    hasRealData: (state) => state.seances.some((seance) => !seance.isDemo),
    findSeanceBySlug: (state) => (seanceSlug: string) =>
      state.seances.find((seance) => seance.slug === seanceSlug) ?? null,
    findExercise: (state) => (seanceSlug: string, exerciseSlug: string) => {
      const seance = state.seances.find((candidate) => candidate.slug === seanceSlug)

      if (!seance) {
        return null
      }

      return seance.exercises.find((exercise) => exercise.slug === exerciseSlug) ?? null
    },
    allSets: (state) =>
      state.seances.flatMap((seance) => seance.exercises.flatMap((exercise) => exercise.sets)),
  },
  actions: {
    async init() {
      if (this.ready) {
        return
      }

      if (runningInTauri()) {
        const database = await getDb()

        const countRows = await database.select<Array<{ n: number }>>(
          'SELECT COUNT(*) as n FROM seances',
        )
        const seanceCount = countRows[0]?.n ?? 0

        // Mode découverte : au tout premier lancement (base vide), la séance
        // d'exemple est semée pour explorer l'app avec de vraies données.
        // Elle est marquée is_demo et supprimable en un geste depuis la
        // bannière — la suppression renvoie vers l'onboarding réel.
        if (seanceCount === 0) {
          await seedDatabase(database)
        }

        this.seances = await loadSeancesFromDatabase(database)
      } else {
        this.seances = (await loadFixtureSeances()) ?? createDemoSeances()
      }

      this.ready = true
    },
    async createSeance(name: string, exercises: CreateExerciseInput[]) {
      if (exercises.length === 0) {
        throw new Error('A séance requires at least one exercise.')
      }

      const baseSlug = slugify(name)
      const slug = createUniqueSlug(
        baseSlug,
        this.seances.map((seance) => seance.slug),
      )

      const exerciseSlugs: string[] = []
      const seanceExercises: Exercise[] = exercises.map((input) => {
        const exerciseSlug = createUniqueSlug(slugify(input.name), exerciseSlugs)
        exerciseSlugs.push(exerciseSlug)

        return buildExercise(input, exerciseSlug)
      })

      const seanceName = name.trim()

      await persist('INSERT INTO seances (slug, name) VALUES ($1, $2)', [slug, seanceName])

      for (const exercise of seanceExercises) {
        await persist(
          'INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            slug,
            exercise.slug,
            exercise.name,
            exercise.defaultReps,
            exercise.defaultWeight,
            exercise.weightUnit,
            exercise.restSeconds,
            exercise.isDumbbell ? 1 : 0,
          ],
        )
      }

      this.seances.push({
        slug,
        name: seanceName,
        isDemo: false,
        exercises: seanceExercises,
      })

      return slug
    },
    /**
     * Adopte le programme de démonstration : vide l'historique d'exemple
     * (les séries) mais garde les séances, qui deviennent celles de
     * l'utilisateur (plus marquées démo, la bannière disparaît).
     */
    async adoptDemoSeances() {
      const demoSeances = this.seances.filter((seance) => seance.isDemo)

      for (const seance of demoSeances) {
        await persist('DELETE FROM sets WHERE seance_slug = $1', [seance.slug])
        await persist('UPDATE seances SET is_demo = 0 WHERE slug = $1', [seance.slug])

        for (const exercise of seance.exercises) {
          exercise.sets = []
        }
        seance.isDemo = false
      }
    },
    async deleteDemoData() {
      const demoSlugs = this.seances
        .filter((seance) => seance.isDemo)
        .map((seance) => seance.slug)

      for (const slug of demoSlugs) {
        await persist('DELETE FROM sets WHERE seance_slug = $1', [slug])
        await persist('DELETE FROM exercises WHERE seance_slug = $1', [slug])
        await persist('DELETE FROM seances WHERE slug = $1', [slug])
      }

      this.seances = this.seances.filter((seance) => !seance.isDemo)
    },
    async renameSeance(seanceSlug: string, name: string) {
      const seance = this.findSeanceBySlug(seanceSlug)

      if (!seance) {
        return
      }

      const trimmedName = name.trim()

      await persist('UPDATE seances SET name = $1 WHERE slug = $2', [trimmedName, seanceSlug])

      seance.name = trimmedName
    },
    async addExerciseToSeance(seanceSlug: string, input: CreateExerciseInput) {
      const seance = this.findSeanceBySlug(seanceSlug)

      if (!seance) {
        return null
      }

      const exerciseSlug = createUniqueSlug(
        slugify(input.name),
        seance.exercises.map((exercise) => exercise.slug),
      )
      const exercise = buildExercise(input, exerciseSlug)

      await persist(
        'INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          seanceSlug,
          exercise.slug,
          exercise.name,
          exercise.defaultReps,
          exercise.defaultWeight,
          exercise.weightUnit,
          exercise.restSeconds,
          exercise.isDumbbell ? 1 : 0,
        ],
      )

      seance.exercises.push(exercise)

      return exerciseSlug
    },
    async setExerciseDumbbell(seanceSlug: string, exerciseSlug: string, isDumbbell: boolean) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)

      if (!exercise) {
        return
      }

      await persist(
        'UPDATE exercises SET is_dumbbell = $1 WHERE seance_slug = $2 AND slug = $3',
        [isDumbbell ? 1 : 0, seanceSlug, exerciseSlug],
      )

      exercise.isDumbbell = isDumbbell
    },
    async addSet(seanceSlug: string, exerciseSlug: string, set: ExerciseSet) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)

      if (!exercise) {
        return
      }

      await persist(
        'INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          set.id,
          seanceSlug,
          exerciseSlug,
          set.reps,
          set.weight,
          set.completedAt.toISOString(),
          set.isWarmup ? 1 : 0,
        ],
      )

      exercise.sets.unshift(set)
    },
    async setSetWarmup(
      seanceSlug: string,
      exerciseSlug: string,
      setId: number,
      isWarmup: boolean,
    ) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)
      const set = exercise?.sets.find((candidate) => candidate.id === setId)

      if (!set) {
        return
      }

      await persist('UPDATE sets SET is_warmup = $1 WHERE id = $2', [isWarmup ? 1 : 0, setId])
      set.isWarmup = isWarmup
    },
    async removeSet(seanceSlug: string, exerciseSlug: string, setId: number) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)

      if (!exercise) {
        return
      }

      await persist('DELETE FROM sets WHERE id = $1', [setId])

      exercise.sets = exercise.sets.filter((set) => set.id !== setId)
    },
    async clearSets(seanceSlug: string, exerciseSlug: string) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)

      if (!exercise || exercise.sets.length === 0) {
        return
      }

      await persist('DELETE FROM sets WHERE seance_slug = $1 AND exercise_slug = $2', [
        seanceSlug,
        exerciseSlug,
      ])

      exercise.sets = []
    },
    /**
     * Verse des séries dans un exercice sans toucher au reste de la base.
     * Contrairement à `importBackup`, l'opération est purement additive : une
     * interruption laisse un sous-ensemble cohérent, ce qui dispense d'une
     * transaction côté Rust.
     *
     * Les séries déjà présentes à la même date, mêmes répétitions et même
     * charge sont ignorées — réimporter deux fois le même fichier ne duplique
     * rien.
     */
    async mergeSets(
      seanceSlug: string,
      exerciseSlug: string,
      incoming: Array<{
        reps: number
        weight: number
        completedAt: Date
        isWarmup?: boolean
      }>,
    ): Promise<{ ajoutees: number; ignorees: number }> {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)

      if (!exercise) {
        return { ajoutees: 0, ignorees: 0 }
      }

      const signature = (set: { reps: number; weight: number; completedAt: Date }) =>
        `${set.completedAt.toISOString()}|${set.reps}|${set.weight}`

      const seen = new Set(exercise.sets.map(signature))

      // Les identifiants sont uniques sur toute la base, pas par exercice :
      // `removeSet` supprime par identifiant seul.
      let nextId = this.allSets.reduce((highest, set) => Math.max(highest, set.id), 0) + 1

      let ignorees = 0
      const added: ExerciseSet[] = []

      for (const candidate of incoming) {
        const key = signature(candidate)

        if (seen.has(key)) {
          ignorees += 1
          continue
        }

        seen.add(key)
        added.push({ id: nextId++, ...candidate })
      }

      for (const set of added) {
        await persist(
          'INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            set.id,
            seanceSlug,
            exerciseSlug,
            set.reps,
            set.weight,
            set.completedAt.toISOString(),
            set.isWarmup ? 1 : 0,
          ],
        )
      }

      // `sets` est lu du plus récent au plus ancien partout ailleurs
      // (`addSet` empile en tête) : l'import doit rendre le même ordre.
      exercise.sets = [...exercise.sets, ...added].sort(
        (first, second) => second.completedAt.getTime() - first.completedAt.getTime(),
      )

      return { ajoutees: added.length, ignorees }
    },
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

      // L'écriture est déléguée à Rust : elle vide et repeuple les trois tables
      // dans une vraie transaction rusqlite. Le `BEGIN`/`COMMIT` du plugin SQL
      // ne transactionne rien — chaque `execute()` emprunte une connexion
      // différente du pool, donc un échec en cours de route laissait la base à
      // moitié vidée.
      if (runningInTauri()) {
        await invoke('import_seances', { seances: toImportPayload(seances) })
      }

      this.seances = seances
    },
  },
})

let dbInstance: Database | null = null
let dbLoadPromise: Promise<Database> | null = null

// Rust est la seule source de vérité pour le nom du fichier de base (voir
// `db_file_name` dans src-tauri/src/lib.rs) : recalculer localement le même
// choix via `import.meta.env.DEV` divergeait silencieusement de
// `cfg!(debug_assertions)` sous `tauri build --debug` (donc
// `tauri ios build --debug`), qui compile toujours le front en mode
// production. `getDb` n'est appelée que sous Tauri (voir `runningInTauri`
// dans les appelants) : hors Tauri cette commande n'est jamais invoquée.
async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance
  }

  if (!dbLoadPromise) {
    dbLoadPromise = invoke<string>('db_file_name').then((fileName) =>
      Database.load(`sqlite:${fileName}`),
    )
  }

  dbInstance = await dbLoadPromise
  return dbInstance
}

function runningInTauri(): boolean {
  if (typeof isTauri === 'function') {
    return isTauri()
  }

  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// Every mutating action needs the same "write through to SQLite when running
// under Tauri, no-op in the plain-browser in-memory fallback" wrapper — this
// is the one place that decides whether/how a write actually persists.
async function persist(sql: string, params: unknown[]) {
  if (!runningInTauri()) {
    return
  }

  const database = await getDb()
  await database.execute(sql, params)
}

function buildExercise(input: CreateExerciseInput, slug: string): Exercise {
  return {
    slug,
    name: input.name.trim(),
    defaultReps: input.defaultReps,
    defaultWeight: input.defaultWeight,
    weightUnit: input.weightUnit.trim() || 'kg',
    restSeconds: input.restSeconds ?? 180,
    isDumbbell: input.isDumbbell ?? false,
    sets: [],
  }
}

type SeanceRow = {
  slug: string
  name: string
  is_demo: number
}

type ExerciseRow = {
  seance_slug: string
  slug: string
  name: string
  default_reps: number
  default_weight: number
  weight_unit: string
  rest_seconds: number
  is_dumbbell: number
}

type SetRow = {
  id: number
  seance_slug: string
  exercise_slug: string
  reps: number
  weight: number
  completed_at: string
  is_warmup: number
}

async function seedDatabase(database: Database) {
  const seedSeances = createDemoSeances()

  // Tout ou rien : un semis interrompu (rechargement, arrêt de l'app) ne doit
  // pas laisser une démo partielle que le prochain lancement croirait complète.
  await database.execute('BEGIN')
  try {
    await insertSeedSeances(database, seedSeances)
    await database.execute('COMMIT')
  } catch (error) {
    await database.execute('ROLLBACK')
    throw error
  }
}

/**
 * Charge utile de la commande Rust `import_seances`. Les clés sont en camelCase
 * (côté Rust, `#[serde(rename_all = "camelCase")]`) et les dates sont converties
 * en chaînes ISO, exactement le format que porte déjà la colonne `completed_at`.
 *
 * L'identifiant de chaque série est transmis explicitement : la mémoire et la
 * base doivent porter les mêmes, sinon `removeSet` — qui supprime par
 * identifiant seul — effacerait la mauvaise ligne jusqu'au prochain rechargement.
 *
 * `isDemo` n'est pas transmis : ce que l'utilisateur restaure lui appartient,
 * la commande écrit `is_demo = 0`.
 *
 * Exportée uniquement pour les tests : `src/stores/__tests__/importPayload.spec.ts`
 * s'en sert pour régénérer `fixtures/import-payload.json`, le fichier de
 * référence que le test Rust `the_reference_payload_from_typescript_deserializes`
 * désérialise. C'est ce qui rend un renommage de champ d'un seul côté visible
 * en intégration continue.
 */
export function toImportPayload(seances: Seance[]) {
  return seances.map((seance) => ({
    slug: seance.slug,
    name: seance.name,
    exercises: seance.exercises.map((exercise) => ({
      slug: exercise.slug,
      name: exercise.name,
      defaultReps: exercise.defaultReps,
      defaultWeight: exercise.defaultWeight,
      weightUnit: exercise.weightUnit,
      restSeconds: exercise.restSeconds,
      isDumbbell: Boolean(exercise.isDumbbell),
      sets: exercise.sets.map((set) => ({
        id: set.id,
        reps: set.reps,
        weight: set.weight,
        completedAt: set.completedAt.toISOString(),
        isWarmup: Boolean(set.isWarmup),
      })),
    })),
  }))
}

async function insertSeedSeances(database: Database, seedSeances: Seance[]) {
  for (const seance of seedSeances) {
    await database.execute('INSERT INTO seances (slug, name, is_demo) VALUES ($1, $2, 1)', [
      seance.slug,
      seance.name,
    ])

    for (const exercise of seance.exercises) {
      await database.execute(
        'INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          seance.slug,
          exercise.slug,
          exercise.name,
          exercise.defaultReps,
          exercise.defaultWeight,
          exercise.weightUnit,
          exercise.restSeconds,
          exercise.isDumbbell ? 1 : 0,
        ],
      )

      for (const set of exercise.sets) {
        await database.execute(
          'INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            set.id,
            seance.slug,
            exercise.slug,
            set.reps,
            set.weight,
            set.completedAt.toISOString(),
            set.isWarmup ? 1 : 0,
          ],
        )
      }
    }
  }
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'item'
}

function createUniqueSlug(baseSlug: string, existingSlugs: string[]) {
  let slug = baseSlug
  let suffix = 2

  while (existingSlugs.includes(slug)) {
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }

  return slug
}

async function loadSeancesFromDatabase(database: Database): Promise<Seance[]> {
  const [seanceRows, exerciseRows, setRows] = await Promise.all([
    database.select<SeanceRow[]>('SELECT slug, name, is_demo FROM seances'),
    database.select<ExerciseRow[]>(
      'SELECT seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell FROM exercises',
    ),
    database.select<SetRow[]>(
      'SELECT id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup FROM sets ORDER BY completed_at DESC',
    ),
  ])

  const exercisesBySeance = groupBy(exerciseRows, (row) => row.seance_slug)
  const setsByExercise = groupBy(setRows, (row) => `${row.seance_slug}|${row.exercise_slug}`)

  return seanceRows.map((seanceRow) => ({
    slug: seanceRow.slug,
    name: seanceRow.name,
    isDemo: seanceRow.is_demo === 1,
    exercises: (exercisesBySeance.get(seanceRow.slug) ?? []).map((exerciseRow) => ({
      slug: exerciseRow.slug,
      name: exerciseRow.name,
      defaultReps: exerciseRow.default_reps,
      defaultWeight: exerciseRow.default_weight,
      weightUnit: exerciseRow.weight_unit,
      restSeconds: exerciseRow.rest_seconds,
      isDumbbell: exerciseRow.is_dumbbell === 1,
      sets: (setsByExercise.get(`${seanceRow.slug}|${exerciseRow.slug}`) ?? []).map((setRow) => ({
        id: setRow.id,
        reps: setRow.reps,
        weight: setRow.weight,
        completedAt: new Date(setRow.completed_at),
        isWarmup: setRow.is_warmup === 1,
      })),
    })),
  }))
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()

  for (const row of rows) {
    const key = keyOf(row)
    const group = groups.get(key)

    if (group) {
      group.push(row)
    } else {
      groups.set(key, [row])
    }
  }

  return groups
}

/**
 * Jeux de données de test (voir `datasets/scenarios.ts`), demandés par les
 * tests e2e via `window.__GHOST_LIFT_FIXTURE__`.
 *
 * L'import est dynamique et sous garde `import.meta.env.DEV` : en production
 * la branche entière est éliminée à la compilation, donc ni le hook ni les
 * scénarios ne partent dans le bundle livré.
 *
 * Un nom inconnu lève au lieu de retomber sur le programme de démonstration :
 * un test qui croit charger un scénario et navigue en fait dans les données
 * d'exemple passerait en testant autre chose que ce qu'il annonce.
 */
async function loadFixtureSeances(): Promise<Seance[] | null> {
  if (!import.meta.env.DEV) {
    return null
  }

  const name = globalThis.window?.__GHOST_LIFT_FIXTURE__

  if (!name) {
    return null
  }

  const { scenarios } = await import('../datasets/scenarios')
  const scenario = scenarios[name]

  if (!scenario) {
    throw new Error(`Scénario de test inconnu : ${name}`)
  }

  return scenario(new Date())
}
