/**
 * Les règles d'entraînement en TypeScript : **adaptateur navigateur, jamais
 * production** (#71).
 *
 * Sous Tauri, les instantanés viennent de `src-tauri/src/insights.rs`, seule
 * autorité. Cette copie existe pour que le mode navigateur (`npm run dev`),
 * les tests de présentation et les parcours e2e disposent des mêmes
 * instantanés sans monter un runtime Tauri — exactement le statut de
 * `backup.ts` pour le codec de sauvegarde (#70). Le store ne l'appelle que
 * sous `!runningInTauri()`, et `appApiMemory.ts` s'en sert pour répondre.
 *
 * Ce qui la garde honnête : `fixtures/insights-cases.json`. Le test
 * `__tests__/insightsFixture.spec.ts` écrit ce que ces règles rendent sur
 * des historiques choisis ; le test Rust relit le fichier et doit produire,
 * champ pour champ, le même JSON. Une règle qui diverge d'un côté fait tomber
 * un test de l'autre.
 *
 * La journée est le jour UTC de la série, la semaine commence le lundi UTC,
 * les repos se comptent en secondes entières : les mêmes conventions que
 * Rust, sans fuseau.
 */

import type {
  DashboardSnapshotDto,
  DayVolumeDto,
  ExerciseSetDto,
  ExerciseSnapshotDto,
  PositionalGhostDto,
  ProgressionDto,
  RampStepDto,
  SeanceExerciseDto,
  SeanceSessionDto,
  SeanceSnapshotDto,
  StagnantExerciseDto,
  StagnationDto,
  TargetDto,
  TrainingSessionDto,
  WarmupDayDto,
  WeeklyVolumeDto,
} from './appApi'
import { getDateKey, isWorkingSet, type ExerciseSet } from './trainingInsights'

/** Ce qu'il faut d'un exercice pour prendre son instantané. */
export type ExerciseInput = {
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds: number
  isDumbbell?: boolean
  sets: ExerciseSet[]
}

/** Ce qu'il faut d'un exercice pour dresser le bilan de sa séance. */
export type SeanceExerciseInput = ExerciseInput & {
  slug: string
  name: string
}

export type SeanceInput = {
  slug: string
  name: string
  exercises: SeanceExerciseInput[]
}

// ——— Journées et semaines ———

/** Le lundi UTC de la semaine d'une journée `AAAA-MM-JJ`. */
export function getWeekKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  const day = date.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day

  date.setUTCDate(date.getUTCDate() + mondayOffset)

  return getDateKey(date)
}

function daysBetween(earlierKey: string, laterKey: string): number {
  return Math.round((Date.parse(laterKey) - Date.parse(earlierKey)) / 86_400_000)
}

/** Secondes entières, comme Rust lit l'horodatage : les millisecondes ne comptent pas. */
function wholeSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function sortSets(sets: ExerciseSet[]) {
  return [...sets].sort(
    (first, second) => second.completedAt.getTime() - first.completedAt.getTime(),
  )
}

function toSetDto(set: ExerciseSet): ExerciseSetDto {
  return {
    id: set.id,
    reps: set.reps,
    weight: set.weight,
    completedAt: set.completedAt.toISOString(),
    isWarmup: Boolean(set.isWarmup),
    rpe: set.rpe ?? null,
    isDeload: Boolean(set.isDeload),
  }
}

// ——— Séances ———

/**
 * Regroupe les séries de travail en journées, de la plus récente à la plus
 * ancienne — et, dans chacune, de la plus récente à la plus ancienne.
 */
export function groupIntoSessions(sets: ExerciseSet[]): TrainingSessionDto[] {
  const sessions: TrainingSessionDto[] = []

  for (const set of sortSets(sets.filter(isWorkingSet))) {
    const key = getDateKey(set.completedAt)
    const last = sessions[sessions.length - 1]

    if (last && last.key === key) {
      last.sets.push(toSetDto(set))
    } else {
      sessions.push({
        key,
        week: getWeekKey(key),
        sets: [toSetDto(set)],
        reps: 0,
        volume: 0,
        heaviest: 0,
        isDeload: false,
      })
    }
  }

  for (const session of sessions) {
    session.reps = session.sets.reduce((total, set) => total + set.reps, 0)
    session.volume = session.sets.reduce((total, set) => total + set.reps * set.weight, 0)
    session.heaviest = Math.max(...session.sets.map((set) => set.weight))
    // Une séance est une décharge quand toutes ses séries de travail le sont :
    // une seule série allégée dans une séance normale est un ajustement.
    session.isDeload = session.sets.every((set) => set.isDeload)
  }

  return sessions
}

/** Les journées d'échauffement, de la plus récente à la plus ancienne. */
export function groupWarmups(sets: ExerciseSet[]): WarmupDayDto[] {
  const days: WarmupDayDto[] = []

  for (const set of sortSets(sets.filter((set) => !isWorkingSet(set)))) {
    const key = getDateKey(set.completedAt)
    const last = days[days.length - 1]

    if (last && last.key === key) {
      last.sets.push(toSetDto(set))
    } else {
      days.push({ key, week: getWeekKey(key), sets: [toSetDto(set)], volume: 0, heaviest: 0 })
    }
  }

  for (const day of days) {
    day.volume = day.sets.reduce((total, set) => total + set.reps * set.weight, 0)
    day.heaviest = Math.max(...day.sets.map((set) => set.weight))
  }

  return days
}

// ——— Fantôme, cible, plateau ———

/**
 * Le fantôme est positionnel : la N-ième série d'aujourd'hui se mesure à la
 * N-ième série de la séance précédente. Un schéma pyramidal se reproduit donc
 * série par série au lieu d'être écrasé par « dernière série + 1 rep ».
 * Au-delà du nombre de séries de la référence, on reste sur sa dernière.
 */
export function getPositionalGhost(
  sessions: TrainingSessionDto[],
  today: string,
): PositionalGhostDto | null {
  const latest = sessions[0]

  if (!latest) {
    return null
  }

  const currentSession = latest.key === today ? latest : null
  const candidates = currentSession ? sessions.slice(1) : sessions
  // Une décharge ne sert pas de mètre étalon : on remonte à la dernière séance
  // qui n'en était pas une. Faute de mieux, elle reste préférable à pas de
  // fantôme du tout.
  const reference = candidates.find((session) => !session.isDeload) ?? candidates[0]

  if (!reference) {
    return null
  }

  const setsDoneToday = currentSession ? currentSession.sets.length : 0
  const chronological = [...reference.sets].reverse()
  const index = Math.min(setsDoneToday, chronological.length - 1)
  const set = chronological[index]

  if (!set) {
    return null
  }

  return { set, position: index + 1, sessionKey: reference.key }
}

/** La cible à viser : celle du fantôme, à l'identique — jamais « +1 » (GL-22). */
export function getSuggestedTarget(
  ghost: PositionalGhostDto | null,
  fallback: TargetDto,
): TargetDto {
  return ghost ? { weight: ghost.set.weight, reps: ghost.set.reps } : fallback
}

/** L'effort perçu d'une séance : la moyenne des RPE notés, `null` si rien n'est noté. */
export function sessionEffort(session: TrainingSessionDto): number | null {
  const rated = session.sets.flatMap((set) => (set.rpe === null ? [] : [set.rpe]))

  return rated.length === 0 ? null : rated.reduce((total, rpe) => total + rpe, 0) / rated.length
}

const FATIGUE_EFFORT_RISE = 1
const PLATEAU_SESSIONS = 3

function samePerformance(first: TrainingSessionDto, second: TrainingSessionDto): boolean {
  return first.heaviest === second.heaviest && first.reps === second.reps
}

/**
 * Le plateau, lu comme un coach le lirait (#95) : la même charge tenue plus
 * facilement n'est pas un plateau ; la même performance avec un effort
 * nettement plus haut est de la fatigue ; sinon, trois séances identiques
 * d'affilée. Les décharges ne comptent pas.
 */
export function stagnation(sessions: TrainingSessionDto[]): StagnationDto | null {
  const worked = sessions.filter((session) => !session.isDeload)
  const latest = worked[0]

  if (!latest) {
    return null
  }

  let identical = 0

  for (const session of worked) {
    if (!samePerformance(latest, session)) {
      break
    }

    identical += 1
  }

  if (identical < 2) {
    return null
  }

  const now = sessionEffort(latest)
  const before = sessionEffort(worked[1]!)

  if (now !== null && before !== null) {
    if (now < before) {
      return null
    }

    if (now - before >= FATIGUE_EFFORT_RISE) {
      return { kind: 'fatigue', sessions: identical }
    }
  }

  return identical >= PLATEAU_SESSIONS ? { kind: 'plateau', sessions: identical } : null
}

const PROGRESSION_MAX_RPE = 8
const PROGRESSION_MIN_SETS = 3

/** La marche des disques : 2,5 kg à la barre, un kilo par haltère, cinq livres. */
export function loadIncrement(isDumbbell: boolean, weightUnit: string): number {
  if (weightUnit.toLowerCase() === 'lb') {
    return 5
  }

  return isDumbbell ? 2 : 2.5
}

/**
 * La double progression, suggérée et jamais préremplie (#95) : deux séances
 * d'affilée à la même performance, chacune d'au moins trois séries toutes
 * notées à RPE 8 ou moins. La séance du jour ne compte pas ; un plateau ou
 * une fatigue la tait.
 */
export function progression(
  sessions: TrainingSessionDto[],
  today: string,
  target: TargetDto,
  isDumbbell: boolean,
  weightUnit: string,
): ProgressionDto | null {
  const [latest, previous] = sessions.filter(
    (session) => !session.isDeload && session.key !== today,
  )
  const heldWithReserve = (session: TrainingSessionDto) =>
    session.sets.length >= PROGRESSION_MIN_SETS &&
    session.sets.every((set) => set.rpe !== null && set.rpe <= PROGRESSION_MAX_RPE)

  if (
    !latest ||
    !previous ||
    !samePerformance(latest, previous) ||
    !heldWithReserve(latest) ||
    !heldWithReserve(previous) ||
    stagnation(sessions) !== null
  ) {
    return null
  }

  const increment = loadIncrement(isDumbbell, weightUnit)

  return { increment, weight: target.weight + increment, reps: target.reps }
}

// ——— Repos ———

/** Ce que le repos gagne quand la série à venir est le sommet de la pyramide (#94). */
export const HEAVIEST_SET_EXTRA_REST_SECONDS = 30

/**
 * Le repos sert la série **à venir**. `position` est celle (1-based) de la
 * série visée dans la séance de référence ; la suivante est à l'index
 * `position`. Quand elle est la plus lourde de la référence, il gagne trente
 * secondes.
 */
export function restAfterSet(
  restSeconds: number,
  position: number | null,
  reference: TrainingSessionDto | null,
): number {
  if (position === null || !reference) {
    return restSeconds
  }

  const next = [...reference.sets].reverse()[position]

  if (!next || next.weight < reference.heaviest) {
    return restSeconds
  }

  return restSeconds + HEAVIEST_SET_EXTRA_REST_SECONDS
}

/** Au-delà, l'écart entre deux séries n'est plus un repos : la séance a été interrompue. */
export const MAX_REST_SECONDS = 15 * 60

/**
 * Le repos réellement pris entre deux séries de travail, médiane sur les
 * horodatages. `null` quand aucune séance ne porte deux séries de travail.
 * La médiane de deux valeurs est arrondie à la seconde inférieure, comme Rust.
 */
export function getMedianRestTaken(sessions: TrainingSessionDto[]): number | null {
  return medianOf(restsTaken(sessions))
}

const REST_SUGGESTION_MIN_INTERVALS = 4
// L'intervalle entre deux séries loggées contient la série elle-même : en
// deçà d'une minute d'écart, c'est la série, pas le repos.
const REST_SUGGESTION_MIN_GAP = 60
const REST_STEP = 15

/**
 * Le repos réellement pris, proposé comme réglage quand il s'écarte franchement
 * du chrono ; `null` sans assez d'intervalles, ou quand les deux s'accordent.
 */
export function suggestedRestSeconds(
  restSeconds: number,
  sessions: TrainingSessionDto[],
): number | null {
  const rests = restsTaken(sessions)

  if (rests.length < REST_SUGGESTION_MIN_INTERVALS) {
    return null
  }

  const median = medianOf(rests)

  if (median === null) {
    return null
  }

  const rounded = Math.round(median / REST_STEP) * REST_STEP

  return Math.abs(rounded - restSeconds) >= REST_SUGGESTION_MIN_GAP ? rounded : null
}

/** Les repos mesurés, dans l'ordre croissant, interruptions écartées. */
function restsTaken(sessions: TrainingSessionDto[]): number[] {
  const rests: number[] = []

  for (const session of sessions) {
    const chronological = [...session.sets].reverse()

    for (let index = 1; index < chronological.length; index += 1) {
      const rest =
        wholeSeconds(new Date(chronological[index]!.completedAt)) -
        wholeSeconds(new Date(chronological[index - 1]!.completedAt))

      if (rest <= MAX_REST_SECONDS) {
        rests.push(rest)
      }
    }
  }

  rests.sort((first, second) => first - second)

  return rests
}

function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) {
    return null
  }

  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.floor((sorted[middle - 1]! + sorted[middle]!) / 2)
}

// ——— Records ———

/**
 * Le chemin parcouru : les séries qui, le jour où elles ont été faites,
 * battaient tout ce qui précédait. Du plus ancien au plus récent (#31).
 * L'échauffement et la décharge n'en sont pas, une charge égale non plus.
 */
export function getRecordHistory(sets: ExerciseSet[]): ExerciseSetDto[] {
  const records: ExerciseSetDto[] = []
  let heaviest = -Infinity

  for (const set of sortSets(sets.filter(isWorkingSet)).reverse()) {
    if (set.isDeload || set.weight <= heaviest) {
      continue
    }

    heaviest = set.weight
    records.push(toSetDto(set))
  }

  return records
}

/** La série bat toute autre charge de travail de l'historique. */
export function isNewRecord(sets: ExerciseSet[], setId: number): boolean {
  const targetSet = sets.find((set) => set.id === setId)

  if (!targetSet || !isWorkingSet(targetSet) || targetSet.isDeload) {
    return false
  }

  return sets
    .filter(isWorkingSet)
    .every((set) => set.id === targetSet.id || set.weight < targetSet.weight)
}

/**
 * Un record à cible de répétitions : cette charge n'avait jamais été tenue
 * pour autant de répétitions (#95).
 */
export function isNewRecordForReps(sets: ExerciseSet[], setId: number): boolean {
  const targetSet = sets.find((set) => set.id === setId)

  if (!targetSet || !isWorkingSet(targetSet) || targetSet.isDeload) {
    return false
  }

  return sets
    .filter(isWorkingSet)
    .every(
      (set) =>
        set.id === targetSet.id ||
        set.isDeload ||
        set.weight < targetSet.weight ||
        set.reps < targetSet.reps,
    )
}

/**
 * Le 1RM estimé par la formule d'Epley : charge × (1 + reps ÷ 30). Une seule
 * répétition rend la charge elle-même — estimer à partir de la chose mesurée
 * doit rendre la chose mesurée (#95).
 */
export function estimateOneRepMax(set: { reps: number; weight: number }): number {
  return set.reps <= 1 ? set.weight : set.weight * (1 + set.reps / 30)
}

export function getBestEstimatedOneRepMax(sets: ExerciseSet[]): number | null {
  const working = sets.filter(isWorkingSet)

  if (working.length === 0) {
    return null
  }

  return Math.max(...working.map(estimateOneRepMax))
}

// ——— Reprise ———

export const RETURN_BREAK_DAYS = 14
const RETURN_LOAD_RATIO = 0.9

/** Jours écoulés depuis la dernière séance de travail ; `null` sans séance. */
export function daysSinceLastSession(
  sessions: TrainingSessionDto[],
  today: string,
): number | null {
  const [latest] = sessions

  if (!latest) {
    return null
  }

  return Math.max(daysBetween(latest.key, today), 0)
}

/** Après deux semaines sans l'exercice : −10 %, au demi-kilo (#95). */
export function suggestReturnLoad(weight: number, daysAway: number | null): number | null {
  if (daysAway === null || daysAway < RETURN_BREAK_DAYS) {
    return null
  }

  return Math.round(weight * RETURN_LOAD_RATIO * 2) / 2
}

// ——— Gamme montante ———

/**
 * Gamme montante proposée vers une charge de travail : la barre à vide en
 * répétitions explosives, puis des paliers en baissant les répétitions. Aux
 * haltères il n'y a pas de barre à vide : la rampe démarre à mi-charge.
 */
export function suggestWarmupRamp(
  target: { weight: number },
  options: { isDumbbell?: boolean; weightUnit?: string } = {},
): RampStepDto[] {
  const isPounds = options.weightUnit?.toLowerCase() === 'lb'
  const bar = isPounds ? 45 : 20
  const increment = options.isDumbbell ? (isPounds ? 5 : 2) : isPounds ? 5 : 2.5
  const ladder = [
    { fraction: 0.5, reps: 6 },
    { fraction: 0.7, reps: 3 },
    { fraction: 0.9, reps: 1 },
  ]

  const steps: RampStepDto[] = []

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

// ——— Agrégats hebdomadaires ———

/**
 * Le volume des séries de travail par semaine, de la plus ancienne à la plus
 * récente, avec le détail par journée pour les semaines à plusieurs séances.
 */
export function weeklyVolumes(sets: ExerciseSet[]): WeeklyVolumeDto[] {
  const weeks = new Map<string, Map<string, number>>()

  for (const set of sets.filter(isWorkingSet)) {
    const key = getDateKey(set.completedAt)
    const week = getWeekKey(key)
    const days = weeks.get(week) ?? new Map<string, number>()

    days.set(key, (days.get(key) ?? 0) + set.reps * set.weight)
    weeks.set(week, days)
  }

  return Array.from(weeks.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([week, days]) => {
      const dayVolumes: DayVolumeDto[] = Array.from(days.entries())
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, volume]) => ({ key, volume }))

      return {
        week,
        volume: dayVolumes.reduce((total, day) => total + day.volume, 0),
        days: dayVolumes,
      }
    })
}

// ——— Les trois instantanés ———

/** L'instantané d'un exercice : tout ce que le tracker lit, d'un seul appel. */
export function buildExerciseSnapshot(exercise: ExerciseInput, today: string): ExerciseSnapshotDto {
  const sessions = groupIntoSessions(exercise.sets)
  const ghost = getPositionalGhost(sessions, today)
  const target = getSuggestedTarget(ghost, {
    weight: exercise.defaultWeight,
    reps: exercise.defaultReps,
  })
  const reference = ghost
    ? (sessions.find((session) => session.key === ghost.sessionKey) ?? null)
    : null
  const latestSet = sessions[0]?.sets[0] ?? null
  const daysAway = daysSinceLastSession(sessions, today)

  return {
    today,
    sessions,
    warmups: groupWarmups(exercise.sets),
    ghost,
    target,
    restSeconds: restAfterSet(exercise.restSeconds, ghost?.position ?? null, reference),
    suggestedRestSeconds: suggestedRestSeconds(exercise.restSeconds, sessions),
    stagnation: stagnation(sessions),
    progression: progression(sessions, today, target, Boolean(exercise.isDumbbell), exercise.weightUnit),
    records: getRecordHistory(exercise.sets),
    isLatestSetRecord: latestSet !== null && isNewRecord(exercise.sets, latestSet.id),
    isLatestSetRepsRecord: latestSet !== null && isNewRecordForReps(exercise.sets, latestSet.id),
    oneRepMax: getBestEstimatedOneRepMax(exercise.sets),
    daysAway,
    returnLoad: suggestReturnLoad(target.weight, daysAway),
    medianRestTaken: getMedianRestTaken(sessions),
    warmupRamp: suggestWarmupRamp(target, {
      isDumbbell: exercise.isDumbbell,
      weightUnit: exercise.weightUnit,
    }),
    weekly: weeklyVolumes(exercise.sets),
  }
}

/**
 * L'unité la plus fréquente parmi les exercices : celle dans laquelle les
 * volumes de la séance sont additionnés. Un exercice dans une autre unité
 * reste listé, mais hors des totaux.
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

/** La série de travail la plus récente ; à égalité d'instant, la première. */
export function getMostRecentSet(sets: ExerciseSet[]): ExerciseSet | null {
  let latest: ExerciseSet | null = null

  for (const set of sets.filter(isWorkingSet)) {
    if (!latest || set.completedAt.getTime() > latest.completedAt.getTime()) {
      latest = set
    }
  }

  return latest
}

/**
 * Le bilan d'une séance se lit à l'échelle de la journée : une « séance »
 * est un jour où l'un de ses exercices a été travaillé, et chaque exercice
 * se mesure ce jour-là face au jour de la séance précédente. Un exercice
 * sauté vaut zéro — c'est une information, pas une absence.
 */
export function buildSeanceSnapshot(seance: SeanceInput): SeanceSnapshotDto {
  const weightUnit = dominantWeightUnit(seance.exercises)
  const dominantSets: ExerciseSet[] = []
  const days = new Map<string, { volume: number; reps: number; exercises: Set<string> }>()
  const volumeByExerciseAndDay = new Map<string, number>()

  for (const exercise of seance.exercises) {
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
        dominantSets.push(set)
      }

      days.set(key, day)
    }
  }

  const sessions: SeanceSessionDto[] = Array.from(days.entries())
    .map(([key, day]) => ({
      key,
      volume: day.volume,
      reps: day.reps,
      exercisesDone: day.exercises.size,
    }))
    .sort((first, second) => second.key.localeCompare(first.key))

  const latest = sessions[0] ?? null
  const previous = sessions[1] ?? null

  const exercises: SeanceExerciseDto[] = seance.exercises.map((exercise) => {
    const latestVolume = latest
      ? (volumeByExerciseAndDay.get(`${exercise.slug}|${latest.key}`) ?? 0)
      : 0
    const previousVolume = previous
      ? (volumeByExerciseAndDay.get(`${exercise.slug}|${previous.key}`) ?? 0)
      : null
    const lastSet = getMostRecentSet(exercise.sets)

    return {
      slug: exercise.slug,
      name: exercise.name,
      weightUnit: exercise.weightUnit,
      latest: latestVolume,
      previous: previousVolume,
      delta: previousVolume === null ? null : latestVolume - previousVolume,
      isOtherUnit: exercise.weightUnit !== weightUnit,
      restSeconds: exercise.restSeconds,
      medianRestTaken: getMedianRestTaken(groupIntoSessions(exercise.sets)),
      lastSet: lastSet ? toSetDto(lastSet) : null,
    }
  })

  return {
    weightUnit,
    sessions,
    latest,
    previous,
    volumeDelta: latest && previous ? latest.volume - previous.volume : null,
    exercises,
    weekly: weeklyVolumes(dominantSets),
  }
}

/** Fenêtre des chiffres clés, en jours — la même que celle de Rust. */
export const KPI_WINDOW_DAYS = 30

/**
 * L'instantané du dashboard. La fenêtre des chiffres clés se compte en
 * journées UTC, pas en millisecondes : une séance faite ce matin ne sort pas
 * du compte selon l'heure qu'il est.
 */
export function buildDashboardSnapshot(seances: SeanceInput[], today: string): DashboardSnapshotDto {
  const stagnant: StagnantExerciseDto[] = []
  const working: ExerciseSet[] = []
  const since = new Date(`${today}T00:00:00.000Z`)
  since.setUTCDate(since.getUTCDate() - KPI_WINDOW_DAYS)
  const sinceKey = getDateKey(since)

  for (const seance of seances) {
    for (const exercise of seance.exercises) {
      const plateau = stagnation(groupIntoSessions(exercise.sets))

      if (plateau) {
        stagnant.push({
          seanceSlug: seance.slug,
          seanceName: seance.name,
          exerciseSlug: exercise.slug,
          exerciseName: exercise.name,
          kind: plateau.kind,
          sessions: plateau.sessions,
        })
      }

      working.push(...exercise.sets.filter(isWorkingSet))
    }
  }

  const recent = working.filter((set) => getDateKey(set.completedAt) >= sinceKey)
  const lastSet = getMostRecentSet(recent)

  return {
    stagnant,
    trainingDays: new Set(recent.map((set) => getDateKey(set.completedAt))).size,
    workingSets: recent.length,
    liftedVolume: Math.round(recent.reduce((total, set) => total + set.reps * set.weight, 0)),
    heaviestWeight: recent.reduce((heaviest, set) => Math.max(heaviest, set.weight), 0),
    lastSetAt: lastSet ? lastSet.completedAt.toISOString() : null,
    weekly: weeklyVolumes(working),
  }
}
