import type { Exercise, Seance } from '../stores/seances'
import type { ExerciseSet } from './trainingInsights'

export const BACKUP_FORMAT = 'ghost-lift-backup'
export const BACKUP_VERSION = 1

type BackupExercise = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds: number
}

type BackupHistory = {
  seanceSlug: string
  exerciseSlug: string
  sets: Array<{ reps: number; weight: number; completedAt: string }>
}

export function backupFileName(exportedAt: Date): string {
  return `revenant-${exportedAt.toISOString().slice(0, 10)}.json`
}

export function exerciseBackupFileName(
  seance: Seance,
  exercise: Exercise,
  exportedAt: Date,
): string {
  return `revenant-${seance.slug}-${exercise.slug}-${exportedAt.toISOString().slice(0, 10)}.json`
}

/**
 * L'export d'un exercice seul n'a pas de format propre : c'est une sauvegarde
 * ordinaire dont la séance ne porte qu'un exercice. Un fichier ainsi produit
 * reste donc restaurable en entier, et l'import par exercice accepte aussi
 * bien une sauvegarde complète.
 */
export function serializeExerciseBackup(
  seance: Seance,
  exercise: Exercise,
  exportedAt: Date,
): string {
  return serializeBackup([{ ...seance, exercises: [exercise] }], exportedAt)
}

/**
 * Les séries à verser dans un exercice, extraites de n'importe quelle
 * sauvegarde Revenant. Seuls les exercices porteurs d'historique comptent :
 * un fichier peut décrire un programme entier dont un seul exercice a des
 * séries, et c'est celui-là qu'on veut.
 */
export function readExerciseSets(text: string, exerciseSlug: string): ExerciseSet[] {
  const carriers = parseBackup(text)
    .flatMap((seance) => seance.exercises)
    .filter((exercise) => exercise.sets.length > 0)

  const named = carriers.find((exercise) => exercise.slug === exerciseSlug)

  if (named) {
    return named.sets
  }

  if (carriers.length === 0) {
    throw new Error("Ce fichier ne contient aucune série à importer.")
  }

  // Un seul historique dans le fichier : aucune ambiguïté à lever, on le prend
  // même si son identifiant diffère. C'est ce qui permet de verser dans un
  // exercice l'historique exporté sous un autre nom.
  if (carriers.length === 1) {
    return carriers[0]!.sets
  }

  const noms = carriers.map((exercise) => `« ${exercise.name} »`).join(', ')

  throw new Error(
    `Ce fichier contient plusieurs exercices avec un historique (${noms}). Exporte celui que tu veux importer depuis son propre écran.`,
  )
}

/**
 * Le modèle de séance et l'historique sont sérialisés séparément : un fichier
 * sans `history` est déjà un programme partageable, ce qui évitera un nouveau
 * format le jour où le partage de séance arrivera.
 *
 * `isDemo` n'est jamais écrit — une sauvegarde restaurée est la donnée de
 * l'utilisateur, elle ne doit pas ressusciter la bannière du mode découverte.
 * Les identifiants de séries non plus : ce sont des autoincrement locaux,
 * réattribués à l'import.
 */
export function serializeBackup(seances: Seance[], exportedAt: Date): string {
  const history: BackupHistory[] = []

  for (const seance of seances) {
    for (const exercise of seance.exercises) {
      if (exercise.sets.length === 0) {
        continue
      }

      history.push({
        seanceSlug: seance.slug,
        exerciseSlug: exercise.slug,
        sets: [...exercise.sets]
          .sort((first, second) => first.completedAt.getTime() - second.completedAt.getTime())
          .map((set) => ({
            reps: set.reps,
            weight: set.weight,
            completedAt: set.completedAt.toISOString(),
          })),
      })
    }
  }

  return `${JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: exportedAt.toISOString(),
      seances: seances.map((seance) => ({
        slug: seance.slug,
        name: seance.name,
        exercises: seance.exercises.map(
          (exercise): BackupExercise => ({
            slug: exercise.slug,
            name: exercise.name,
            defaultReps: exercise.defaultReps,
            defaultWeight: exercise.defaultWeight,
            weightUnit: exercise.weightUnit,
            restSeconds: exercise.restSeconds,
          }),
        ),
      })),
      history,
    },
    null,
    2,
  )}\n`
}

export function parseBackup(text: string): Seance[] {
  const payload = readJson(text)

  if (payload.format !== BACKUP_FORMAT) {
    throw new Error("Ce fichier n'est pas une sauvegarde Revenant.")
  }

  if (payload.version !== BACKUP_VERSION) {
    throw new Error(
      'Cette sauvegarde a été créée par une version plus récente de Revenant. Mets l\'app à jour pour la restaurer.',
    )
  }

  const seances = readSeances(payload.seances)
  applyHistory(seances, readHistory(payload.history))

  return seances
}

function readJson(text: string): Record<string, unknown> {
  let payload: unknown

  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Fichier illisible : ce n\'est pas un fichier JSON valide.')
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Fichier illisible : contenu inattendu.')
  }

  return payload as Record<string, unknown>
}

function readSeances(raw: unknown): Seance[] {
  if (!Array.isArray(raw)) {
    throw new Error('Fichier incomplet : aucune séance trouvée.')
  }

  const seances: Seance[] = []
  const seenSeanceSlugs = new Set<string>()

  for (const entry of raw) {
    const seance = entry as Record<string, unknown>

    if (!isNonEmptyString(seance?.slug) || !isNonEmptyString(seance?.name)) {
      throw new Error('Fichier incomplet : une séance n\'a ni identifiant ni nom.')
    }

    if (seenSeanceSlugs.has(seance.slug)) {
      throw new Error(`Fichier invalide : la séance « ${seance.slug} » apparaît en double.`)
    }
    seenSeanceSlugs.add(seance.slug)

    seances.push({
      slug: seance.slug,
      name: seance.name,
      isDemo: false,
      exercises: readExercises(seance.exercises, seance.slug),
    })
  }

  return seances
}

function readExercises(raw: unknown, seanceSlug: string): Exercise[] {
  if (!Array.isArray(raw)) {
    throw new Error(`Fichier incomplet : la séance « ${seanceSlug} » n'a pas d'exercices.`)
  }

  const exercises: Exercise[] = []
  const seenExerciseSlugs = new Set<string>()

  for (const entry of raw) {
    const exercise = entry as Record<string, unknown>

    if (!isNonEmptyString(exercise?.slug) || !isNonEmptyString(exercise?.name)) {
      throw new Error(`Fichier incomplet : un exercice de « ${seanceSlug} » est mal formé.`)
    }

    if (seenExerciseSlugs.has(exercise.slug)) {
      throw new Error(`Fichier invalide : l'exercice « ${exercise.slug} » apparaît en double.`)
    }
    seenExerciseSlugs.add(exercise.slug)

    if (
      !isFiniteNumber(exercise.defaultReps) ||
      !isFiniteNumber(exercise.defaultWeight) ||
      !isFiniteNumber(exercise.restSeconds) ||
      !isNonEmptyString(exercise.weightUnit)
    ) {
      throw new Error(`Fichier incomplet : l'exercice « ${exercise.slug} » a des valeurs manquantes.`)
    }

    exercises.push({
      slug: exercise.slug,
      name: exercise.name,
      defaultReps: exercise.defaultReps,
      defaultWeight: exercise.defaultWeight,
      weightUnit: exercise.weightUnit,
      restSeconds: exercise.restSeconds,
      sets: [],
    })
  }

  return exercises
}

function readHistory(raw: unknown): BackupHistory[] {
  if (raw === undefined || raw === null) {
    return []
  }

  if (!Array.isArray(raw)) {
    throw new Error('Fichier invalide : l\'historique est mal formé.')
  }

  return raw as BackupHistory[]
}

function applyHistory(seances: Seance[], history: BackupHistory[]) {
  // `sets.id` est une clé primaire globale (AUTOINCREMENT) et `removeSet`
  // supprime par identifiant seul (`stores/seances.ts`) : une numérotation
  // repartant de 1 à chaque exercice entrerait en collision dès le deuxième
  // exercice porteur de séries, et ferait diverger la mémoire de la base.
  // On numérote donc sur toute la sauvegarde.
  let nextId = 1

  for (const entry of history) {
    const seance = seances.find((candidate) => candidate.slug === entry?.seanceSlug)
    const exercise = seance?.exercises.find((candidate) => candidate.slug === entry?.exerciseSlug)

    if (!exercise) {
      throw new Error(
        `Fichier incohérent : l'historique référence « ${entry?.exerciseSlug} », absent des séances.`,
      )
    }

    if (!Array.isArray(entry.sets)) {
      throw new Error(`Fichier invalide : les séries de « ${entry.exerciseSlug} » sont mal formées.`)
    }

    exercise.sets = entry.sets.map((set) => {
      if (!isFiniteNumber(set?.reps) || !isFiniteNumber(set?.weight)) {
        throw new Error(`Fichier incomplet : une série de « ${entry.exerciseSlug} » est mal formée.`)
      }

      const completedAt = new Date(set.completedAt)

      if (Number.isNaN(completedAt.getTime())) {
        throw new Error(
          `Fichier invalide : une série de « ${entry.exerciseSlug} » porte une date illisible.`,
        )
      }

      // Les identifiants sont locaux : on renumérote plutôt que de faire
      // confiance au fichier, qui peut venir d'un autre appareil.
      return { id: nextId++, reps: set.reps, weight: set.weight, completedAt }
    })
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
