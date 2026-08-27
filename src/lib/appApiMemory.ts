import type { AppApi, AppError, CreateExerciseInputDto, ExerciseDto, SeanceDto } from './appApi'
import { createUniqueSlug, slugify } from './slug'

/**
 * Le double de test d'AppApi : mêmes promesses, même sémantique, aucune IPC.
 * C'est lui qui permet d'exercer un consommateur de l'API (bientôt Pinia,
 * #72) dans Vitest ou dans un navigateur nu, sans runtime Tauri.
 *
 * Il reproduit les décisions de Rust — slugs, défauts, normalisation des
 * noms, `introuvable` — mais pas sa validation complète : Rust reste le seul
 * juge de ce qu'une donnée a le droit d'être.
 *
 * `seances()` rend l'état que le vrai backend aurait persisté — c'est
 * l'observabilité du test, pas une méthode du contrat.
 */
export function createMemoryAppApi(): AppApi & { seances: () => SeanceDto[] } {
  let stored: SeanceDto[] = []
  // L'empreinte du dernier semis, comme la table `meta` côté Rust : c'est
  // elle qui distingue une démo intacte (remplaçable) d'une démo touchée.
  let seededFingerprint: string | null = null

  function findSeance(seanceSlug: string): SeanceDto {
    const seance = stored.find((candidate) => candidate.slug === seanceSlug)

    if (!seance) {
      throw introuvable(`La séance « ${seanceSlug} » n'existe pas.`)
    }

    return seance
  }

  function findExercise(seanceSlug: string, exerciseSlug: string): ExerciseDto {
    const exercise = findSeance(seanceSlug).exercises.find(
      (candidate) => candidate.slug === exerciseSlug,
    )

    if (!exercise) {
      throw introuvable(
        `L'exercice « ${exerciseSlug} » n'existe pas dans la séance « ${seanceSlug} ».`,
      )
    }

    return exercise
  }

  return {
    dbFileName: () => Promise.resolve('ghostlift-memoire.db'),
    bootstrapSeances: (seed) => {
      const untouchedDemo =
        stored.every((seance) => seance.isDemo) &&
        seededFingerprint !== null &&
        JSON.stringify(stored) === seededFingerprint

      if (stored.length === 0 || untouchedDemo) {
        stored = structuredClone(seed)
        seededFingerprint = JSON.stringify(stored)
      }

      return Promise.resolve(structuredClone(stored))
    },
    importSeances: (seances) => {
      // Même sémantique que la commande Rust : remplacement intégral, et ce
      // que l'utilisateur restaure lui appartient (isDemo repart à false).
      stored = structuredClone(seances).map((seance) => ({ ...seance, isDemo: false }))
      return Promise.resolve()
    },
    createSeance: async (name, exercises) => {
      const seanceName = name.trim()
      const slug = createUniqueSlug(
        slugify(seanceName),
        stored.map((seance) => seance.slug),
      )

      const exerciseSlugs: string[] = []
      const seance: SeanceDto = {
        slug,
        name: seanceName,
        isDemo: false,
        exercises: exercises.map((input) => {
          const exerciseSlug = createUniqueSlug(slugify(input.name), exerciseSlugs)
          exerciseSlugs.push(exerciseSlug)

          return buildExerciseDto(input, exerciseSlug)
        }),
      }

      stored.push(seance)

      return structuredClone(seance)
    },
    renameSeance: async (seanceSlug, name) => {
      const seance = findSeance(seanceSlug)
      seance.name = name.trim()

      return structuredClone(seance)
    },
    addExercise: async (seanceSlug, input) => {
      const seance = findSeance(seanceSlug)
      const exerciseSlug = createUniqueSlug(
        slugify(input.name),
        seance.exercises.map((exercise) => exercise.slug),
      )
      const exercise = buildExerciseDto(input, exerciseSlug)

      seance.exercises.push(exercise)

      return structuredClone(exercise)
    },
    moveExercise: async (seanceSlug, exerciseSlug, direction) => {
      const seance = findSeance(seanceSlug)
      findExercise(seanceSlug, exerciseSlug)

      const from = seance.exercises.findIndex((exercise) => exercise.slug === exerciseSlug)
      const to = direction === 'up' ? from - 1 : from + 1

      if (to < 0 || to >= seance.exercises.length) {
        return null
      }

      const [moved] = seance.exercises.splice(from, 1)
      seance.exercises.splice(to, 0, moved!)

      return structuredClone(seance)
    },
    setExerciseDumbbell: async (seanceSlug, exerciseSlug, isDumbbell) => {
      const exercise = findExercise(seanceSlug, exerciseSlug)
      exercise.isDumbbell = isDumbbell

      return structuredClone(exercise)
    },
    adoptDemoSeances: async () => {
      for (const seance of stored) {
        if (seance.isDemo) {
          seance.isDemo = false

          for (const exercise of seance.exercises) {
            exercise.sets = []
          }
        }
      }

      return structuredClone(stored)
    },
    deleteDemoData: async () => {
      stored = stored.filter((seance) => !seance.isDemo)

      return structuredClone(stored)
    },
    seances: () => structuredClone(stored),
  }
}

/** Les mêmes défauts et la même normalisation que `mutations.rs`. */
function buildExerciseDto(input: CreateExerciseInputDto, slug: string): ExerciseDto {
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

function introuvable(message: string): AppError {
  return { code: 'introuvable', message }
}
