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

export function getSuggestedTarget(
  sets: ExerciseSet[],
  fallback: { weight: number; reps: number },
  mostRecentSet: ExerciseSet | null = getMostRecentSet(sets),
): { weight: number; reps: number } {
  if (!mostRecentSet) {
    return fallback
  }

  return {
    weight: mostRecentSet.weight,
    reps: mostRecentSet.reps + 1,
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
