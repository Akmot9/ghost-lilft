import { defineStore } from 'pinia'
import { isTauri } from '@tauri-apps/api/core'
import Database from '@tauri-apps/plugin-sql'
import benchPressDataset from '../datasets/bench-press.json'
import type { ExerciseSet } from '../lib/trainingInsights'

export type Exercise = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
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
}

const DB_CONNECTION = import.meta.env.DEV ? 'sqlite:ghostlift-dev.db' : 'sqlite:ghostlift.db'

export const useSeanceStore = defineStore('seances', {
  state: () => ({
    seances: [] as Seance[],
    ready: false,
  }),
  getters: {
    hasOnboarded: (state) => state.seances.length > 0,
    hasDemoData: (state) => state.seances.some((seance) => seance.isDemo),
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

        // Demo/dev seed data must never reach a real user's first launch —
        // production builds start from a genuinely empty database, which
        // sends them through real onboarding (see hasOnboarded/router redirect).
        if (seanceCount === 0 && import.meta.env.DEV) {
          await seedDatabase(database)
        }

        this.seances = await loadSeancesFromDatabase(database)
      } else {
        this.seances = createSeedSeances()
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
          'INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            slug,
            exercise.slug,
            exercise.name,
            exercise.defaultReps,
            exercise.defaultWeight,
            exercise.weightUnit,
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
        'INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          seanceSlug,
          exercise.slug,
          exercise.name,
          exercise.defaultReps,
          exercise.defaultWeight,
          exercise.weightUnit,
        ],
      )

      seance.exercises.push(exercise)

      return exerciseSlug
    },
    async addSet(seanceSlug: string, exerciseSlug: string, set: ExerciseSet) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)

      if (!exercise) {
        return
      }

      await persist(
        'INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [set.id, seanceSlug, exerciseSlug, set.reps, set.weight, set.completedAt.toISOString()],
      )

      exercise.sets.unshift(set)
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
  },
})

let dbInstance: Database | null = null
let dbLoadPromise: Promise<Database> | null = null

async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance
  }

  if (!dbLoadPromise) {
    dbLoadPromise = Database.load(DB_CONNECTION)
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
}

type SetRow = {
  id: number
  seance_slug: string
  exercise_slug: string
  reps: number
  weight: number
  completed_at: string
}

async function seedDatabase(database: Database) {
  const seedSeances = createSeedSeances()

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

async function insertSeedSeances(database: Database, seedSeances: Seance[]) {
  for (const seance of seedSeances) {
    await database.execute('INSERT INTO seances (slug, name, is_demo) VALUES ($1, $2, 1)', [
      seance.slug,
      seance.name,
    ])

    for (const exercise of seance.exercises) {
      await database.execute(
        'INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          seance.slug,
          exercise.slug,
          exercise.name,
          exercise.defaultReps,
          exercise.defaultWeight,
          exercise.weightUnit,
        ],
      )

      for (const set of exercise.sets) {
        await database.execute(
          'INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [set.id, seance.slug, exercise.slug, set.reps, set.weight, set.completedAt.toISOString()],
        )
      }
    }
  }
}

async function loadSeancesFromDatabase(database: Database): Promise<Seance[]> {
  const [seanceRows, exerciseRows, setRows] = await Promise.all([
    database.select<SeanceRow[]>('SELECT slug, name, is_demo FROM seances'),
    database.select<ExerciseRow[]>(
      'SELECT seance_slug, slug, name, default_reps, default_weight, weight_unit FROM exercises',
    ),
    database.select<SetRow[]>(
      'SELECT id, seance_slug, exercise_slug, reps, weight, completed_at FROM sets ORDER BY completed_at DESC',
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
      sets: (setsByExercise.get(`${seanceRow.slug}|${exerciseRow.slug}`) ?? []).map((setRow) => ({
        id: setRow.id,
        reps: setRow.reps,
        weight: setRow.weight,
        completedAt: new Date(setRow.completed_at),
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

function createSeedSeances(): Seance[] {
  return [
    {
      slug: 'seance-principale',
      name: 'Séance principale',
      isDemo: true,
      exercises: [
        {
          slug: benchPressDataset.slug,
          name: benchPressDataset.name,
          defaultReps: benchPressDataset.defaultReps,
          defaultWeight: benchPressDataset.defaultWeight,
          weightUnit: benchPressDataset.weightUnit,
          sets: createSetsFromDataset(benchPressDataset.sets),
        },
      ],
    },
  ]
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
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

function createSetsFromDataset(
  sets: Array<{ date: string; reps: number; weight: number }>,
): ExerciseSet[] {
  return sets.map((set, index) => ({
    id: index + 1,
    reps: set.reps,
    weight: set.weight,
    completedAt: new Date(set.date),
  }))
}
