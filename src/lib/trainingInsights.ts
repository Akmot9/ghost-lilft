/**
 * Ce qui reste des règles d'entraînement côté Vue, une fois qu'elles vivent
 * en Rust (#71) : les types que les écrans manipulent, la clé de journée que
 * le contrat définit, et la comparaison d'une série à son fantôme.
 *
 * Les règles elles-mêmes — fantôme positionnel, cible, stagnation, records,
 * repos pris, gamme montante, agrégats hebdomadaires — sont rendues par les
 * instantanés de `src-tauri/src/insights.rs`. Leur copie TypeScript vit dans
 * `insightsBrowser.ts` : adaptateur navigateur, jamais production.
 */

export type ExerciseSet = {
  id: number
  reps: number
  weight: number
  completedAt: Date
  /** Montée en charge préparatoire, visible dans l'historique mais hors statistiques. */
  isWarmup?: boolean
  /** Effort perçu (RPE 1-10, demi-points) ; absent ou `null` : non noté. */
  rpe?: number | null
  /** Série d'une séance allégée volontairement (décharge). */
  isDeload?: boolean
}

/** Une journée où l'exercice a été travaillé, telle que les écrans la lisent. */
export type TrainingSession = {
  /** Jour UTC `AAAA-MM-JJ`. */
  key: string
  /** Lundi UTC de la semaine, `AAAA-MM-JJ`. */
  week: string
  date: Date
  /** De la plus récente à la plus ancienne. */
  sets: ExerciseSet[]
  reps: number
  volume: number
  heaviest: number
  /**
   * Séance allégée volontairement. Son volume reste compté — c'est du travail
   * réel — mais elle ne sert ni de fantôme, ni de record, ni de plateau.
   */
  isDeload: boolean
}

/** Une série de travail alimente progression, fantôme, records et volume. */
export function isWorkingSet(set: ExerciseSet): boolean {
  return !set.isWarmup
}

/**
 * Clé de journée (UTC) : c'est elle qui regroupe les séries en séances, et
 * c'est la journée que les instantanés reçoivent (`today`). Définie par le
 * contrat (`docs/app-api.md`), pas une règle qui pourrait diverger.
 */
export function getDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
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
 * C'est la seule lecture qui reste calculée dans Vue (#71) : une soustraction
 * entre deux valeurs déjà connues, faite à l'instant où la série est validée
 * — avant que l'instantané relu ne déplace le fantôme vers la suivante.
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
