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
  /** Série d'une séance allégée volontairement (décharge). */
  isDeload: boolean
}

/**
 * L'état rendu par une restauration : les deux moitiés d'une sauvegarde, dans
 * la forme canonique relue en base. Elles ont été écrites par la même
 * transaction — les rendre ensemble évite qu'un écran affiche un programme
 * restauré à côté d'un poids d'avant.
 */
export type RestoredBackupDto = {
  seances: SeanceDto[]
  bodyWeights: BodyWeightDto[]
}

/**
 * Une pesée sur le fil : une par jour calendaire (`AAAA-MM-JJ`, le jour local
 * du pèse-personne), poids en kilogrammes au dixième près.
 */
export type BodyWeightDto = {
  day: string
  kilograms: number
}

/**
 * Ce que le frontend envoie pour enregistrer une série : tout sauf
 * l'identifiant, que SQLite attribue. `isWarmup` et `rpe` optionnels :
 * absents, série de travail non notée.
 */
export type SetInputDto = {
  reps: number
  weight: number
  completedAt: string
  isWarmup?: boolean
  rpe?: number | null
}

/** Ce qui se corrige sur une série passée — jamais sa date. */
export type SetChangesDto = {
  reps: number
  weight: number
  rpe: number | null
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
  /**
   * Consignes libres du programme, écrites par l'utilisateur : « top set puis
   * −10 % », un tempo, une dégressive. Chaîne vide quand il n'y en a pas (#44).
   */
  notes: string
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
  isDeload?: boolean
}

export type ExerciseModel = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds: number
  isDumbbell?: boolean
  /** Consignes libres du programme ; chaîne vide quand il n'y en a pas (#44). */
  notes?: string
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
  notes?: string
}

// ——— Instantanés (#71). Les règles d'entraînement vivent en Rust
// (`src-tauri/src/insights.rs`) ; un écran lit tout ce dont il a besoin d'un
// seul appel, et ne recalcule aucune règle. Les dates restent des chaînes
// (jour UTC `AAAA-MM-JJ`, horodatage canonique) : le formatage local est
// l'affaire de Vue. ———

/** Une journée où l'exercice a été travaillé : ses séries de travail. */
export type TrainingSessionDto = {
  /** Jour UTC `AAAA-MM-JJ` : c'est lui qui regroupe les séries en séances. */
  key: string
  /** Lundi UTC de la semaine, `AAAA-MM-JJ`. */
  week: string
  /** De la plus récente à la plus ancienne, comme partout dans l'app. */
  sets: ExerciseSetDto[]
  reps: number
  volume: number
  heaviest: number
  /** Séance allégée volontairement : hors fantôme, records et plateau. */
  isDeload: boolean
}

/** Une journée où l'exercice a été échauffé : sa gamme montante, telle que faite. */
export type WarmupDayDto = {
  key: string
  week: string
  /** De la plus récente à la plus ancienne. */
  sets: ExerciseSetDto[]
  volume: number
  heaviest: number
}

/** L'homologue positionnel de la série à venir. */
export type PositionalGhostDto = {
  set: ExerciseSetDto
  /** Numéro (1-based) de la série homologue dans la séance de référence. */
  position: number
  sessionKey: string
}

export type TargetDto = { weight: number; reps: number }

export type RampStepDto = { weight: number; reps: number }

/** Le volume d'une journée, pour la mèche des semaines à plusieurs séances. */
export type DayVolumeDto = { key: string; volume: number }

/** Le volume d'une semaine, lundi en tête ; `days` du plus ancien au plus récent. */
export type WeeklyVolumeDto = {
  /** Lundi UTC de la semaine, `AAAA-MM-JJ`. */
  week: string
  volume: number
  days: DayVolumeDto[]
}

/** Ce qu'une lecture du tracker rend, d'un seul appel. */
export type ExerciseSnapshotDto = {
  /** La journée UTC pour laquelle l'instantané a été pris. */
  today: string
  /** De la plus récente à la plus ancienne. */
  sessions: TrainingSessionDto[]
  /** De la plus récente à la plus ancienne. */
  warmups: WarmupDayDto[]
  ghost: PositionalGhostDto | null
  target: TargetDto
  /**
   * Le repos à lancer une fois la série visée validée : celui de l'exercice,
   * allongé si la série suivante est le sommet de la pyramide (#94).
   */
  restSeconds: number
  isStagnant: boolean
  /** Du plus ancien au plus récent : l'histoire se lit dans le sens du temps. */
  records: ExerciseSetDto[]
  /** La série de travail la plus récente bat toute charge antérieure. */
  isLatestSetRecord: boolean
  /** … ou tient sa charge pour plus de répétitions que jamais (#95). */
  isLatestSetRepsRecord: boolean
  /** Meilleur 1RM estimé (Epley) ; `null` sans série de travail. */
  oneRepMax: number | null
  /** Jours écoulés depuis la dernière séance ; `null` sur un exercice jamais fait. */
  daysAway: number | null
  /** Charge de reprise suggérée après deux semaines d'arrêt ; `null` sinon. */
  returnLoad: number | null
  /** Repos médian réellement pris entre deux séries de travail, en secondes. */
  medianRestTaken: number | null
  warmupRamp: RampStepDto[]
  /** De la plus ancienne à la plus récente, comme un graphe se lit. */
  weekly: WeeklyVolumeDto[]
}

export type StagnantExerciseDto = {
  seanceSlug: string
  seanceName: string
  exerciseSlug: string
  exerciseName: string
}

/** Ce qu'une lecture du dashboard rend, d'un seul appel. */
export type DashboardSnapshotDto = {
  stagnant: StagnantExerciseDto[]
  /** Chiffres clés des trente derniers jours, séries de travail seules. */
  trainingDays: number
  workingSets: number
  liftedVolume: number
  heaviestWeight: number
  /** Horodatage de la dernière série de travail, ou `null`. */
  lastSetAt: string | null
  weekly: WeeklyVolumeDto[]
}

/** Une journée où la séance a été faite, tous exercices confondus. */
export type SeanceSessionDto = {
  key: string
  /** Volume des séries de travail, dans l'unité dominante de la séance. */
  volume: number
  reps: number
  /** Exercices de la séance ayant au moins une série ce jour-là. */
  exercisesDone: number
}

/** Un exercice de la séance : sa dernière séance face à la précédente. */
export type SeanceExerciseDto = {
  slug: string
  name: string
  weightUnit: string
  /** Volume le jour de la dernière séance ; 0 si l'exercice a été sauté. */
  latest: number
  /** Volume le jour de la séance précédente ; `null` sans séance précédente. */
  previous: number | null
  delta: number | null
  /** Hors du volume total : son unité n'est pas celle de la séance. */
  isOtherUnit: boolean
  /** Repos réglé sur le chrono, en secondes. */
  restSeconds: number
  medianRestTaken: number | null
  /** La série de travail la plus récente, ou `null`. */
  lastSet: ExerciseSetDto | null
}

/** Ce qu'une lecture de l'écran de séance rend, d'un seul appel. */
export type SeanceSnapshotDto = {
  weightUnit: string
  /** De la plus récente à la plus ancienne. */
  sessions: SeanceSessionDto[]
  latest: SeanceSessionDto | null
  previous: SeanceSessionDto | null
  volumeDelta: number | null
  /** Dans l'ordre de la séance. */
  exercises: SeanceExerciseDto[]
  weekly: WeeklyVolumeDto[]
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
  /**
   * Corrige un exercice déjà créé — son nom et ses valeurs par défaut. Le slug
   * ne bouge pas : c'est l'identité dont dépendent le routage, les fantômes et
   * tout l'historique (#3).
   */
  updateExercise(
    seanceSlug: string,
    exerciseSlug: string,
    input: CreateExerciseInputDto,
  ): Promise<SeanceDto>
  /** Supprime l'exercice et son historique ; le supprimer deux fois va bien. */
  removeExercise(seanceSlug: string, exerciseSlug: string): Promise<SeanceDto>
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
  // ——— Sauvegardes : le codec appartient à Rust (#70). Le frontend ne fait
  // que choisir le fichier, le proposer à l'enregistrement, et afficher les
  // messages d'erreur — qui sont écrits pour être lus tels quels. ———

  /** Le texte d'une sauvegarde complète, écrit par Rust depuis la base. */
  exportBackup(exportedAt: string): Promise<string>
  /**
   * Le texte d'une sauvegarde limitée à un exercice : une sauvegarde ordinaire
   * dont la séance ne porte qu'un exercice, donc restaurable en entier.
   */
  exportExerciseBackup(
    seanceSlug: string,
    exerciseSlug: string,
    exportedAt: string,
  ): Promise<string>
  /**
   * Restaure depuis le **texte brut** du fichier : Rust lit, valide et remplace
   * la base en une transaction. Rend l'état canonique restauré.
   */
  restoreBackup(text: string): Promise<RestoredBackupDto>
  /** Les séries à verser dans un exercice, lues dans n'importe quelle sauvegarde. */
  readBackupExerciseSets(text: string, exerciseSlug: string): Promise<ExerciseSetDto[]>
  /** Vide l'historique d'exemple, garde les séances — plus marquées démo. */
  adoptDemoSeances(): Promise<SeanceDto[]>
  /** Supprime le programme de démonstration entier. */
  deleteDemoData(): Promise<SeanceDto[]>

  // ——— Journalisation des séries (#69). SQLite attribue les identifiants ;
  // chaque commande rend la forme canonique persistée. ———

  addSet(seanceSlug: string, exerciseSlug: string, input: SetInputDto): Promise<ExerciseSetDto>
  /** Corrige répétitions, charge, RPE — jamais la date (identité de la série). */
  updateSet(
    seanceSlug: string,
    exerciseSlug: string,
    setId: number,
    changes: SetChangesDto,
  ): Promise<ExerciseSetDto>
  /** Classer en échauffement efface le RPE : l'échauffement ne se note pas. */
  setSetWarmup(
    seanceSlug: string,
    exerciseSlug: string,
    setId: number,
    isWarmup: boolean,
  ): Promise<ExerciseSetDto>
  /**
   * Marque — ou démarque — une journée d'entraînement comme décharge (#97).
   * `day` est la journée UTC (`AAAA-MM-JJ`), celle qui regroupe les séries en
   * séances. L'échauffement n'est jamais marqué.
   */
  setSessionDeload(
    seanceSlug: string,
    exerciseSlug: string,
    day: string,
    isDeload: boolean,
  ): Promise<ExerciseDto>
  /** Supprimer une série déjà absente n'est pas une erreur. */
  removeSet(seanceSlug: string, exerciseSlug: string, setId: number): Promise<ExerciseDto>
  clearSets(seanceSlug: string, exerciseSlug: string): Promise<ExerciseDto>
  /** Déduplication par signature `date|reps|charge`, en une transaction. */
  mergeSets(
    seanceSlug: string,
    exerciseSlug: string,
    sets: SetInputDto[],
  ): Promise<{ ajoutees: number; ignorees: number; exercise: ExerciseDto }>

  // ——— Instantanés (#71) : les règles d'entraînement, rendues par Rust d'un
  // seul appel par écran. `today` est la journée UTC courante (`AAAA-MM-JJ`) ;
  // le bilan d'une séance n'en dépend pas. Un écran relit son instantané
  // après chaque écriture qui le concerne. ———

  /** Une lecture du tracker : séances, fantôme, cible, verdicts, records, repos. */
  exerciseSnapshot(
    seanceSlug: string,
    exerciseSlug: string,
    today: string,
  ): Promise<ExerciseSnapshotDto>
  /** Une lecture de l'écran de séance : bilan par journée et par exercice. */
  seanceSnapshot(seanceSlug: string): Promise<SeanceSnapshotDto>
  /** Une lecture du dashboard : alertes, chiffres clés, volume hebdomadaire. */
  dashboardSnapshot(today: string): Promise<DashboardSnapshotDto>

  // ——— Poids de corps : une pesée par jour, la dernière lecture fait foi.
  // Chaque commande rend l'état complet, du plus récent au plus ancien. ———

  listBodyWeights(): Promise<BodyWeightDto[]>
  /** Enregistre ou remplace la pesée du jour donné (`AAAA-MM-JJ`). */
  logBodyWeight(day: string, kilograms: number): Promise<BodyWeightDto[]>
  /**
   * Restauration d'une sauvegarde (#70) : remplace toutes les pesées par
   * celles du fichier, dans une transaction côté Rust. Jamais une fusion.
   */
  importBodyWeights(weights: BodyWeightDto[]): Promise<BodyWeightDto[]>
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
      notes: exercise.notes ?? '',
      sets: exercise.sets.map((set) => ({
        id: set.id,
        reps: set.reps,
        weight: set.weight,
        completedAt: set.completedAt.toISOString(),
        isWarmup: Boolean(set.isWarmup),
        rpe: set.rpe ?? null,
        isDeload: Boolean(set.isDeload),
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
    notes: exercise.notes,
    sets: exercise.sets.map((set) => ({
      id: set.id,
      reps: set.reps,
      weight: set.weight,
      completedAt: new Date(set.completedAt),
      isWarmup: set.isWarmup,
      rpe: set.rpe,
      isDeload: set.isDeload,
    })),
  }))
}
