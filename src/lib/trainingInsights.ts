export type ExerciseSet = {
  id: number
  reps: number
  weight: number
  completedAt: Date
}

export type TrainingSession = {
  key: string
  date: Date
  sets: ExerciseSet[]
  reps: number
  volume: number
  heaviest: number
}

export function groupIntoSessions(sets: ExerciseSet[]): TrainingSession[] {
  const sortedSets = sortSets(sets)
  const groupedSessions = new Map<string, ExerciseSet[]>()

  for (const set of sortedSets) {
    const key = getDateKey(set.completedAt)
    const sessionSets = groupedSessions.get(key)

    if (sessionSets) {
      sessionSets.push(set)
    } else {
      groupedSessions.set(key, [set])
    }
  }

  return Array.from(groupedSessions.entries())
    .map(([key, sessionSets]) => createTrainingSession(key, sessionSets))
    .sort((first, second) => second.date.getTime() - first.date.getTime())
}

export function getMostRecentSet(sets: ExerciseSet[]): ExerciseSet | null {
  if (sets.length === 0) {
    return null
  }

  return sets.reduce((latest, set) =>
    set.completedAt.getTime() > latest.completedAt.getTime() ? set : latest,
  )
}

export type PositionalGhost = {
  set: ExerciseSet
  /** Numéro (1-based) de la série homologue dans la séance de référence. */
  position: number
  sessionDate: Date
}

/**
 * Le fantôme est positionnel : la N-ième série d'aujourd'hui se mesure à la
 * N-ième série de la séance précédente. Un schéma pyramidal (6/8/12 à des
 * charges différentes) se reproduit donc série par série au lieu d'être
 * écrasé par « dernière série + 1 rep ». Au-delà du nombre de séries de la
 * séance de référence, on reste sur sa dernière série. Première séance de
 * l'exercice : pas de fantôme.
 */
export function getPositionalGhost(
  sets: ExerciseSet[],
  now: Date = new Date(),
  sessions: TrainingSession[] = groupIntoSessions(sets),
): PositionalGhost | null {
  const latest = sessions[0]

  if (!latest) {
    return null
  }

  const currentSession = latest.key === getDateKey(now) ? latest : null
  const reference = currentSession ? sessions[1] : latest

  if (!reference) {
    return null
  }

  const setsDoneToday = currentSession ? currentSession.sets.length : 0
  // session.sets est trié de la plus récente à la plus ancienne : on remet
  // la séance de référence dans l'ordre où elle a été exécutée.
  const chronological = [...reference.sets].reverse()
  const index = Math.min(setsDoneToday, chronological.length - 1)
  const set = chronological[index]

  if (!set) {
    return null
  }

  return { set, position: index + 1, sessionDate: reference.date }
}

export function getSuggestedTarget(
  sets: ExerciseSet[],
  fallback: { weight: number; reps: number },
  ghost: PositionalGhost | null = getPositionalGhost(sets),
): { weight: number; reps: number } {
  if (!ghost) {
    return fallback
  }

  return {
    weight: ghost.set.weight,
    reps: ghost.set.reps,
  }
}

export function isExerciseStagnant(
  sets: ExerciseSet[],
  sessions: TrainingSession[] = groupIntoSessions(sets),
): boolean {
  if (sessions.length < 2) {
    return false
  }

  const [latestSession, previousSession] = sessions as [TrainingSession, TrainingSession]

  return (
    latestSession.heaviest === previousSession.heaviest && latestSession.reps === previousSession.reps
  )
}

export function getWeekStart(date: Date): Date {
  const weekStart = new Date(date)
  weekStart.setHours(0, 0, 0, 0)

  const day = weekStart.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  weekStart.setDate(weekStart.getDate() + mondayOffset)

  return weekStart
}

export function isNewRecord(sets: ExerciseSet[], setId: number): boolean {
  const targetSet = sets.find((set) => set.id === setId)

  if (!targetSet) {
    return false
  }

  return sets.every((set) => set.id === targetSet.id || set.weight < targetSet.weight)
}

function getDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function createTrainingSession(key: string, sessionSets: ExerciseSet[]): TrainingSession {
  return {
    key,
    date: new Date(key),
    sets: sessionSets,
    reps: sessionSets.reduce((total, set) => total + set.reps, 0),
    volume: sessionSets.reduce((total, set) => total + set.reps * set.weight, 0),
    heaviest: Math.max(...sessionSets.map((set) => set.weight)),
  }
}

function sortSets(exerciseSets: ExerciseSet[]) {
  return [...exerciseSets].sort(
    (first, second) => second.completedAt.getTime() - first.completedAt.getTime(),
  )
}
