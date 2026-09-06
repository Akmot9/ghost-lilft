import type {
  AppApi,
  AppError,
  BodyWeightDto,
  CreateExerciseInputDto,
  ExerciseDto,
  ExerciseSetDto,
  SeanceDto,
} from './appApi'
import { fromSeanceDtos, toSeanceDtos } from './appApi'
import { parseBackup, readExerciseSets, serializeBackup } from './backup'
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
  let bodyWeights: BodyWeightDto[] = []
  // Comme l'AUTOINCREMENT de SQLite : jamais réattribué, même après suppression.
  let nextSetId = 1
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

  function findSet(seanceSlug: string, exerciseSlug: string, setId: number): ExerciseSetDto {
    const set = findExercise(seanceSlug, exerciseSlug).sets.find(
      (candidate) => candidate.id === setId,
    )

    if (!set) {
      throw introuvable(`La série ${setId} n'existe pas dans l'exercice « ${exerciseSlug} ».`)
    }

    return set
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
    updateExercise: async (seanceSlug, exerciseSlug, input) => {
      const seance = findSeance(seanceSlug)
      const exercise = findExercise(seanceSlug, exerciseSlug)

      exercise.name = input.name.trim()
      exercise.defaultReps = input.defaultReps
      exercise.defaultWeight = input.defaultWeight
      exercise.weightUnit = input.weightUnit
      exercise.restSeconds = input.restSeconds ?? exercise.restSeconds
      exercise.isDumbbell = Boolean(input.isDumbbell)
      exercise.notes = input.notes?.trim() ?? ''

      return structuredClone(seance)
    },
    removeExercise: async (seanceSlug, exerciseSlug) => {
      const seance = findSeance(seanceSlug)

      seance.exercises = seance.exercises.filter((exercise) => exercise.slug !== exerciseSlug)

      return structuredClone(seance)
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
    // ——— Sauvegardes. C'est ici que vit encore le codec TypeScript
    // (`src/lib/backup.ts`) : **adaptateur navigateur, jamais production**.
    // Sous Tauri, le codec autoritaire est celui de Rust (#70). Cette copie
    // existe pour que l'export et l'import restent vérifiables en e2e, donc en
    // intégration continue, sans monter un runtime Tauri. ———

    exportBackup: async (exportedAt) =>
      serializeBackup(fromSeanceDtos(stored), new Date(exportedAt), structuredClone(bodyWeights)),
    exportExerciseBackup: async (seanceSlug, exerciseSlug, exportedAt) => {
      const seance = findSeance(seanceSlug)
      const exercise = findExercise(seanceSlug, exerciseSlug)

      return serializeBackup(
        fromSeanceDtos([{ ...seance, exercises: [exercise] }]),
        new Date(exportedAt),
        [],
      )
    },
    restoreBackup: async (text) => {
      const payload = parseBackup(text)

      stored.splice(0, stored.length, ...toSeanceDtos(payload.seances))
      bodyWeights.splice(0, bodyWeights.length, ...payload.bodyWeights)

      return { seances: structuredClone(stored), bodyWeights: structuredClone(bodyWeights) }
    },
    readBackupExerciseSets: async (text, exerciseSlug) =>
      readExerciseSets(text, exerciseSlug).map((set) => ({
        id: set.id,
        reps: set.reps,
        weight: set.weight,
        completedAt: set.completedAt.toISOString(),
        isWarmup: Boolean(set.isWarmup),
        rpe: set.rpe ?? null,
        isDeload: Boolean(set.isDeload),
      })),
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
    addSet: async (seanceSlug, exerciseSlug, input) => {
      const exercise = findExercise(seanceSlug, exerciseSlug)
      const set: ExerciseSetDto = {
        id: nextSetId++,
        reps: input.reps,
        weight: input.weight,
        completedAt: input.completedAt,
        isWarmup: Boolean(input.isWarmup),
        rpe: input.rpe ?? null,
        isDeload: false,
      }

      // Du plus récent au plus ancien, comme le rend Rust.
      exercise.sets = [set, ...exercise.sets].sort((first, second) =>
        second.completedAt.localeCompare(first.completedAt),
      )

      return structuredClone(set)
    },
    updateSet: async (seanceSlug, exerciseSlug, setId, changes) => {
      const set = findSet(seanceSlug, exerciseSlug, setId)

      set.reps = changes.reps
      set.weight = changes.weight
      set.rpe = changes.rpe

      return structuredClone(set)
    },
    setSetWarmup: async (seanceSlug, exerciseSlug, setId, isWarmup) => {
      const set = findSet(seanceSlug, exerciseSlug, setId)

      set.isWarmup = isWarmup
      // L'échauffement ne se note pas.
      if (isWarmup) {
        set.rpe = null
      }

      return structuredClone(set)
    },
    setSessionDeload: async (seanceSlug, exerciseSlug, day, isDeload) => {
      const exercise = findExercise(seanceSlug, exerciseSlug)

      for (const set of exercise.sets) {
        // L'échauffement n'est ni lourd ni léger : il prépare.
        if (!set.isWarmup && set.completedAt.slice(0, 10) === day) {
          set.isDeload = isDeload
        }
      }

      return structuredClone(exercise)
    },
    removeSet: async (seanceSlug, exerciseSlug, setId) => {
      const exercise = findExercise(seanceSlug, exerciseSlug)

      exercise.sets = exercise.sets.filter((set) => set.id !== setId)

      return structuredClone(exercise)
    },
    clearSets: async (seanceSlug, exerciseSlug) => {
      const exercise = findExercise(seanceSlug, exerciseSlug)

      exercise.sets = []

      return structuredClone(exercise)
    },
    mergeSets: async (seanceSlug, exerciseSlug, sets) => {
      const exercise = findExercise(seanceSlug, exerciseSlug)
      const signature = (set: { completedAt: string; reps: number; weight: number }) =>
        `${set.completedAt}|${set.reps}|${set.weight}`
      const seen = new Set(exercise.sets.map(signature))

      let ajoutees = 0
      let ignorees = 0

      for (const input of sets) {
        const key = signature(input)

        if (seen.has(key)) {
          ignorees += 1
          continue
        }

        seen.add(key)
        exercise.sets.push({
          id: nextSetId++,
          reps: input.reps,
          weight: input.weight,
          completedAt: input.completedAt,
          isWarmup: Boolean(input.isWarmup),
          rpe: input.rpe ?? null,
          isDeload: false,
        })
        ajoutees += 1
      }

      exercise.sets.sort((first, second) => second.completedAt.localeCompare(first.completedAt))

      return { ajoutees, ignorees, exercise: structuredClone(exercise) }
    },
    listBodyWeights: async () => structuredClone(bodyWeights),
    logBodyWeight: async (day, kilograms) => {
      bodyWeights = [
        { day, kilograms },
        ...bodyWeights.filter((weight) => weight.day !== day),
      ].sort((first, second) => second.day.localeCompare(first.day))

      return structuredClone(bodyWeights)
    },
    importBodyWeights: async (weights) => {
      bodyWeights = [...weights].sort((first, second) => second.day.localeCompare(first.day))

      return structuredClone(bodyWeights)
    },
    deleteBodyWeight: async (day) => {
      bodyWeights = bodyWeights.filter((weight) => weight.day !== day)

      return structuredClone(bodyWeights)
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
    // Une consigne est la note du lifteur : on la rogne, on ne la réécrit pas.
    notes: input.notes?.trim() ?? '',
    isDumbbell: input.isDumbbell ?? false,
    sets: [],
  }
}

function introuvable(message: string): AppError {
  return { code: 'introuvable', message }
}
