export type ExerciseSet = {
  id: number
  reps: number
  weight: number
  completedAt: Date
  /** Montée en charge préparatoire, visible dans l'historique mais hors statistiques. */
  isWarmup?: boolean
  /** Effort perçu (RPE 1-10, demi-points) ; absent ou `null` : non noté. */
  rpe?: number | null
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
  const sortedSets = sortSets(sets.filter(isWorkingSet))
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
  const workingSets = sets.filter(isWorkingSet)

  if (workingSets.length === 0) {
    return null
  }

  return workingSets.reduce((latest, set) =>
    set.completedAt.getTime() > latest.completedAt.getTime() ? set : latest,
  )
}

/** Une série de travail alimente progression, fantôme, records et volume. */
export function isWorkingSet(set: ExerciseSet): boolean {
  return !set.isWarmup
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

  if (!targetSet || !isWorkingSet(targetSet)) {
    return false
  }

  return sets
    .filter(isWorkingSet)
    .every((set) => set.id === targetSet.id || set.weight < targetSet.weight)
}

/** Clé de journée (UTC) : c'est elle qui regroupe les séries en séances. */
export function getDateKey(date: Date) {
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

export type SetComparison = {
  weightDelta: number
  repsDelta: number
  outcome: 'progress' | 'equal' | 'regress'
}

/**
 * Compare une série à son homologue de la séance précédente — la N-ième
 * contre la N-ième, jamais contre la dernière. C'est la question que se pose
 * le lifteur en reposant la barre : est-ce que j'ai battu celle d'avant ?
 *
 * Quand la charge et les répétitions varient en sens contraire — le cas
 * courant en pyramidal, plus lourd pour moins de reps — le verdict suit la
 * charge, mais les deux écarts restent exposés pour que le lifteur juge
 * lui-même.
 */
export function compareSetToGhost(
  set: { reps: number; weight: number },
  ghost: { reps: number; weight: number },
): SetComparison {
  const weightDelta = set.weight - ghost.weight
  const repsDelta = set.reps - ghost.reps
  const decisive = weightDelta !== 0 ? weightDelta : repsDelta

  return {
    weightDelta,
    repsDelta,
    outcome: decisive > 0 ? 'progress' : decisive < 0 ? 'regress' : 'equal',
  }
}

export type RampStep = { weight: number; reps: number }

/**
 * Gamme montante proposée vers une charge de travail, telle que le programme
 * la décrit : on part de la barre à vide en répétitions explosives, on ajoute
 * du poids par paliers en baissant les répétitions, et la dernière série
 * peut ne compter qu'une seule répétition pour réveiller le système nerveux.
 *
 * Aux haltères il n'y a pas de barre à vide : la rampe démarre à mi-charge.
 * Les paliers sont arrondis aux disques (2,5 kg à la barre, 1 kg par haltère)
 * et ne dépassent jamais la charge de travail.
 */
export function suggestWarmupRamp(
  target: { weight: number },
  options: { isDumbbell?: boolean; weightUnit?: string } = {},
): RampStep[] {
  const isPounds = options.weightUnit?.toLowerCase() === 'lb'
  const bar = isPounds ? 45 : 20
  const increment = options.isDumbbell ? (isPounds ? 5 : 2) : isPounds ? 5 : 2.5
  const ladder: Array<{ fraction: number; reps: number }> = [
    { fraction: 0.5, reps: 6 },
    { fraction: 0.7, reps: 3 },
    { fraction: 0.9, reps: 1 },
  ]

  const steps: RampStep[] = []

  if (!options.isDumbbell && target.weight > bar) {
    steps.push({ weight: bar, reps: 10 })
  }

  for (const { fraction, reps } of ladder) {
    const weight = Math.round((target.weight * fraction) / increment) * increment
    const previous = steps[steps.length - 1]

    // À la barre, rien n'existe sous la barre à vide.
    const belowBar = !options.isDumbbell && weight < bar

    if (weight <= 0 || belowBar || weight >= target.weight || (previous && weight <= previous.weight)) {
      continue
    }

    steps.push({ weight, reps })
  }

  return steps
}
