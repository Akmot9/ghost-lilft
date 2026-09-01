/**
 * Le contrat AppApi (#66) : la frontière unique entre Vue et Rust.
 *
 * La spécification lisible vit dans `docs/app-api.md` ; ce module en est la
 * moitié TypeScript, la moitié Rust étant `src-tauri/src/contract.rs`. Les
 * deux sont cousues par `fixtures/contract-seances.json` et
 * `fixtures/contract-errors.json` : le test `__tests__/appApi.spec.ts`
 * vérifie que ces fichiers sont octet pour octet ce que produit la
 * sérialisation d'ici, les tests Rust qu'ils se désérialisent, se valident et
 * se resérialisent à l'identique.
 *
 * Rust est autoritaire : les invariants (noms, slugs, répétitions, charges,
 * dates, identifiants) sont tenus par `validate_seances` côté Rust. La
 * validation des formulaires Vue reste une aide de saisie immédiate, jamais
 * une garantie.
 *
 * Ce module n'importe rien de Tauri : Pinia pourra en dépendre sans savoir
 * s'il parle au vrai backend (`appApiTauri.ts`) ou à un double de test
 * (`appApiMemory.ts`).
 */

/** Une série sur le fil : la date est une chaîne, tout champ est explicite. */
export type ExerciseSetDto = {
  /** Unique sur toute la base, pas par exercice : la suppression se fait par identifiant seul. */
  id: number
  reps: number
  /** Charge totale en kilogrammes, au demi-kilo près (haltères, rampes). */
  weight: number
  /** Horodatage UTC canonique : exactement ce que produit `Date.prototype.toISOString()`. */
  completedAt: string
  isWarmup: boolean
  /** Effort perçu (RPE), de 1 à 10 au demi-point près ; `null` : non noté. */
  rpe: number | null
}

/**
 * Une pesée sur le fil : une par jour calendaire (`AAAA-MM-JJ`, le jour local
 * du pèse-personne), poids en kilogrammes au dixième près.
 */
export type BodyWeightDto = {
  day: string
  kilograms: number
}

export type ExerciseDto = {
  slug: string
  name: string
  defaultReps: number
  /** Kilogrammes au demi-kilo près. Zéro admis : poids du corps. */
  defaultWeight: number
  weightUnit: string
  restSeconds: number
  /** Saisie en poids d'un haltère ; l'historique reste en charge totale. */
  isDumbbell: boolean
  /** Du plus récent au plus ancien, comme partout dans l'app. */
  sets: ExerciseSetDto[]
}

export type SeanceDto = {
  slug: string
  name: string
  /** Séance d'exemple du mode découverte, supprimable d'un geste. */
  isDemo: boolean
  /** L'ordre du tableau est l'ordre du programme. */
  exercises: ExerciseDto[]
}

/**
 * Le modèle en mémoire, tel que le store et les composants le manipulent :
 * dates réelles, drapeaux optionnels hérités des anciennes données.
 * Structurellement identique aux types du store — c'est voulu, le store
 * deviendra une projection de cette API (#72).
 */
export type ExerciseSetModel = {
  id: number
  reps: number
  weight: number
  completedAt: Date
  isWarmup?: boolean
  rpe?: number | null
}

export type ExerciseModel = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds: number
  isDumbbell?: boolean
  sets: ExerciseSetModel[]
}

export type SeanceModel = {
  slug: string
  name: string
  isDemo: boolean
  exercises: ExerciseModel[]
}

/**
 * Ce que les formulaires envoient pour créer un exercice — la seule forme du
 * contrat où des champs sont optionnels : Rust applique les défauts (`180`,
 * `false`) et rend toujours la forme canonique complète.
 */
export type CreateExerciseInputDto = {
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds?: number
  isDumbbell?: boolean
}

/**
 * L'erreur métier que toute commande peut rendre : un code stable pour que le
 * code s'y accroche, un message en français affichable tel quel.
 */
export type AppError = {
  code: string
  message: string
}

/** Ce qu'on colle sur une défaillance qui n'est pas déjà une AppError. */
export const UNEXPECTED_ERROR_CODE = 'erreur-inattendue'

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppError).code === 'string' &&
    typeof (value as AppError).message === 'string'
  )
}

/**
 * Normalise n'importe quelle défaillance en AppError. Les commandes déjà
 * migrées rejettent une AppError sérialisée ; les autres rejettent encore une
 * chaîne (`import_seances`), et le runtime peut lever n'importe quoi.
 */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) {
    return value
  }

  if (typeof value === 'string' && value.length > 0) {
    return { code: UNEXPECTED_ERROR_CODE, message: value }
  }

  if (value instanceof Error && value.message.length > 0) {
    return { code: UNEXPECTED_ERROR_CODE, message: value.message }
  }

  return { code: UNEXPECTED_ERROR_CODE, message: 'Une erreur inattendue est survenue.' }
}

/**
 * La surface exposée par le cœur Rust — aujourd'hui les deux commandes
 * existantes. Les cas d'usage migrés par #68 à #71 s'ajouteront ici, et la
 * table des commandes de `docs/app-api.md` fixe déjà leur forme.
 */
export interface AppApi {
  /** Nom du fichier SQLite, décidé par Rust seul (profils debug/release). */
  dbFileName(): Promise<string>
  /**
   * Le premier contact avec la base : sème la graine de démonstration si la
   * base est vide, remplace une démo restée intacte par la graine du jour
   * (le programme d'exemple a pu changer, ses dates ne vieillissent plus),
   * ne touche à rien dès que l'utilisateur possède quelque chose. Rend
   * toujours l'état complet, dans les ordres canoniques du contrat.
   */
  bootstrapSeances(seed: SeanceDto[]): Promise<SeanceDto[]>
  /**
   * Remplace tout le contenu de la base, dans une vraie transaction. Ce que
   * l'utilisateur restaure lui appartient : `isDemo` repart à `false`.
   */
  importSeances(seances: SeanceDto[]): Promise<void>

  // ——— Mutations de séances et d'exercices (#68). Rust normalise les noms,
  // décide slugs et positions, écrit en transaction, et rend l'agrégat
  // réellement persisté — l'appelant applique, il ne reconstruit pas. ———

  /** Crée la séance et tous ses exercices, en une seule transaction. */
  createSeance(name: string, exercises: CreateExerciseInputDto[]): Promise<SeanceDto>
  renameSeance(seanceSlug: string, name: string): Promise<SeanceDto>
  /** L'exercice arrive en fin de séance, là où l'écran le montre. */
  addExercise(seanceSlug: string, input: CreateExerciseInputDto): Promise<ExerciseDto>
  /** Un cran vers le haut ou le bas ; `null` aux extrémités (rien ne bouge). */
  moveExercise(
    seanceSlug: string,
    exerciseSlug: string,
    direction: 'up' | 'down',
  ): Promise<SeanceDto | null>
  setExerciseDumbbell(
    seanceSlug: string,
    exerciseSlug: string,
    isDumbbell: boolean,
  ): Promise<ExerciseDto>
  /** Vide l'historique d'exemple, garde les séances — plus marquées démo. */
  adoptDemoSeances(): Promise<SeanceDto[]>
  /** Supprime le programme de démonstration entier. */
  deleteDemoData(): Promise<SeanceDto[]>

  // ——— Poids de corps : une pesée par jour, la dernière lecture fait foi.
  // Chaque commande rend l'état complet, du plus récent au plus ancien. ———

  listBodyWeights(): Promise<BodyWeightDto[]>
  /** Enregistre ou remplace la pesée du jour donné (`AAAA-MM-JJ`). */
  logBodyWeight(day: string, kilograms: number): Promise<BodyWeightDto[]>
  /** Supprimer un jour sans pesée n'est pas une erreur. */
  deleteBodyWeight(day: string): Promise<BodyWeightDto[]>
}

/**
 * Vers la forme de fil. L'ordre des clés est celui du contrat — les fixtures
 * se comparent octet pour octet, il fait partie de la forme canonique.
 */
export function toSeanceDtos(seances: SeanceModel[]): SeanceDto[] {
  return seances.map((seance) => ({
    slug: seance.slug,
    name: seance.name,
    isDemo: seance.isDemo,
    exercises: seance.exercises.map((exercise) => ({
      slug: exercise.slug,
      name: exercise.name,
      defaultReps: exercise.defaultReps,
      defaultWeight: exercise.defaultWeight,
      weightUnit: exercise.weightUnit,
      restSeconds: exercise.restSeconds,
      isDumbbell: Boolean(exercise.isDumbbell),
      sets: exercise.sets.map((set) => ({
        id: set.id,
        reps: set.reps,
        weight: set.weight,
        completedAt: set.completedAt.toISOString(),
        isWarmup: Boolean(set.isWarmup),
        rpe: set.rpe ?? null,
      })),
    })),
  }))
}

/** Depuis la forme de fil : les dates redeviennent des `Date`. */
export function fromSeanceDtos(dtos: SeanceDto[]): SeanceModel[] {
  return dtos.map((dto) => ({
    slug: dto.slug,
    name: dto.name,
    isDemo: dto.isDemo,
    exercises: fromExerciseDtos(dto.exercises),
  }))
}

/** Le même retour de fil, au niveau d'un exercice seul (`add_exercise`…). */
export function fromExerciseDtos(dtos: ExerciseDto[]): ExerciseModel[] {
  return dtos.map((exercise) => ({
    slug: exercise.slug,
    name: exercise.name,
    defaultReps: exercise.defaultReps,
    defaultWeight: exercise.defaultWeight,
    weightUnit: exercise.weightUnit,
    restSeconds: exercise.restSeconds,
    isDumbbell: exercise.isDumbbell,
    sets: exercise.sets.map((set) => ({
      id: set.id,
      reps: set.reps,
      weight: set.weight,
      completedAt: new Date(set.completedAt),
      isWarmup: set.isWarmup,
      rpe: set.rpe,
    })),
  }))
}
