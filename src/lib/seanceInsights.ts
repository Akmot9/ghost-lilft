import { getDateKey, isWorkingSet, type ExerciseSet } from './trainingInsights'

/** Ce qu'il faut d'un exercice pour dresser le bilan de sa séance. */
export type SeanceExerciseInput = {
  slug: string
  name: string
  weightUnit: string
  sets: ExerciseSet[]
}

/** Une journée où la séance a été faite, tous exercices confondus. */
export type SeanceSession = {
  key: string
  date: Date
  /** Volume (reps × charge) des séries de travail, dans l'unité dominante. */
  volume: number
  reps: number
  /** Nombre d'exercices de la séance ayant au moins une série ce jour-là. */
  exercisesDone: number
}

/** Un exercice de la séance, sa dernière séance face à la précédente. */
export type ExerciseSessionVolume = {
  slug: string
  name: string
  weightUnit: string
  /** Volume le jour de la dernière séance ; 0 si l'exercice a été sauté. */
  latest: number
  /** Volume le jour de la séance précédente ; null sans séance précédente. */
  previous: number | null
  delta: number | null
  /** Hors du volume total : son unité n'est pas celle de la séance. */
  isOtherUnit: boolean
}

export type SeanceOverview = {
  weightUnit: string
  /** De la plus récente à la plus ancienne. */
  sessions: SeanceSession[]
  latest: SeanceSession | null
  previous: SeanceSession | null
  volumeDelta: number | null
  /** Dans l'ordre de la séance. */
  exercises: ExerciseSessionVolume[]
  /** Séries de travail dans l'unité dominante — pour la tendance hebdomadaire. */
  sets: ExerciseSet[]
}

/**
 * L'unité la plus fréquente parmi les exercices : celle dans laquelle les
 * volumes de la séance sont additionnés. Un exercice dans une autre unité
 * reste listé, mais hors des totaux — additionner des kg et des lb ne
 * dirait rien.
 */
export function dominantWeightUnit(exercises: Array<{ weightUnit: string }>): string {
  const counts = new Map<string, number>()

  for (const exercise of exercises) {
    counts.set(exercise.weightUnit, (counts.get(exercise.weightUnit) ?? 0) + 1)
  }

  let dominant = 'kg'
  let highest = 0

  for (const [unit, count] of counts) {
    if (count > highest) {
      dominant = unit
      highest = count
    }
  }

  return dominant
}

/**
 * Le bilan d'une séance se lit à l'échelle de la journée : une « séance »
 * est un jour où l'un de ses exercices a été travaillé, et chaque exercice
 * se mesure ce jour-là face au jour de la séance précédente. Un exercice
 * sauté vaut zéro — c'est une information, pas une absence.
 */
export function summarizeSeance(exercises: SeanceExerciseInput[]): SeanceOverview {
  const weightUnit = dominantWeightUnit(exercises)
  const sets: ExerciseSet[] = []
  const days = new Map<string, { volume: number; reps: number; exercises: Set<string> }>()
  const volumeByExerciseAndDay = new Map<string, number>()

  for (const exercise of exercises) {
    const isOtherUnit = exercise.weightUnit !== weightUnit

    for (const set of exercise.sets) {
      if (!isWorkingSet(set)) {
        continue
      }

      const key = getDateKey(set.completedAt)
      const volume = set.reps * set.weight
      const perExerciseKey = `${exercise.slug}|${key}`

      volumeByExerciseAndDay.set(
        perExerciseKey,
        (volumeByExerciseAndDay.get(perExerciseKey) ?? 0) + volume,
      )

      const day = days.get(key) ?? { volume: 0, reps: 0, exercises: new Set<string>() }
      day.exercises.add(exercise.slug)

      if (!isOtherUnit) {
        day.volume += volume
        day.reps += set.reps
        sets.push(set)
      }

      days.set(key, day)
    }
  }

  const sessions: SeanceSession[] = Array.from(days.entries())
    .map(([key, day]) => ({
      key,
      date: new Date(key),
      volume: day.volume,
      reps: day.reps,
      exercisesDone: day.exercises.size,
    }))
    .sort((first, second) => second.date.getTime() - first.date.getTime())

  const latest = sessions[0] ?? null
  const previous = sessions[1] ?? null

  const exerciseVolumes: ExerciseSessionVolume[] = exercises.map((exercise) => {
    const latestVolume = latest
      ? (volumeByExerciseAndDay.get(`${exercise.slug}|${latest.key}`) ?? 0)
      : 0
    const previousVolume = previous
      ? (volumeByExerciseAndDay.get(`${exercise.slug}|${previous.key}`) ?? 0)
      : null

    return {
      slug: exercise.slug,
      name: exercise.name,
      weightUnit: exercise.weightUnit,
      latest: latestVolume,
      previous: previousVolume,
      delta: previousVolume === null ? null : latestVolume - previousVolume,
      isOtherUnit: exercise.weightUnit !== weightUnit,
    }
  })

  return {
    weightUnit,
    sessions,
    latest,
    previous,
    volumeDelta: latest && previous ? latest.volume - previous.volume : null,
    exercises: exerciseVolumes,
    sets,
  }
}
