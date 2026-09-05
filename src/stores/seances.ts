import { defineStore } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { runningInTauri } from '../lib/runtime'
import Database from '@tauri-apps/plugin-sql'
import { createDemoSeances } from '../datasets/demoProgram'
import type { ExerciseSet } from '../lib/trainingInsights'
import { parseBackup, serializeBackup } from '../lib/backup'
import { useBodyWeightStore } from './bodyWeight'
import {
  fromExerciseDtos,
  fromSeanceDtos,
  toSeanceDtos,
  type ExerciseSetDto,
} from '../lib/appApi'
import { createTauriAppApi } from '../lib/appApiTauri'
import { createUniqueSlug, slugify } from '../lib/slug'

export type Exercise = {
  slug: string
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  /** Repos prescrit entre les séries, en secondes. */
  restSeconds: number
  /** Saisie en poids d'un haltère ; l'historique reste toujours en charge totale. */
  isDumbbell?: boolean
  sets: ExerciseSet[]
}

export type Seance = {
  slug: string
  name: string
  /** Séance d'exemple du mode découverte, supprimable d'un geste. */
  isDemo: boolean
  exercises: Exercise[]
}

export type CreateExerciseInput = {
  name: string
  defaultReps: number
  defaultWeight: number
  weightUnit: string
  restSeconds?: number
  isDumbbell?: boolean
}

export const useSeanceStore = defineStore('seances', {
  state: () => ({
    seances: [] as Seance[],
    ready: false,
  }),
  getters: {
    hasOnboarded: (state) => state.seances.length > 0,
    hasDemoData: (state) => state.seances.some((seance) => seance.isDemo),
    /** Une séance non-démo suffit : l'utilisateur a quelque chose à perdre. */
    hasRealData: (state) => state.seances.some((seance) => !seance.isDemo),
    findSeanceBySlug: (state) => (seanceSlug: string) =>
      state.seances.find((seance) => seance.slug === seanceSlug) ?? null,
    findExercise: (state) => (seanceSlug: string, exerciseSlug: string) => {
      const seance = state.seances.find((candidate) => candidate.slug === seanceSlug)

      if (!seance) {
        return null
      }

      return seance.exercises.find((exercise) => exercise.slug === exerciseSlug) ?? null
    },
    allSets: (state) =>
      state.seances.flatMap((seance) => seance.exercises.flatMap((exercise) => exercise.sets)),
  },
  actions: {
    async init() {
      if (this.ready) {
        return
      }

      if (runningInTauri()) {
        // Les migrations passent quand `tauri-plugin-sql` ouvre la base :
        // la connexion doit exister avant la première commande rusqlite.
        await getDb()

        // Mode découverte : le semis appartient à Rust (`bootstrap_seances`),
        // qui écrit la graine dans une vraie transaction — le BEGIN/COMMIT du
        // plugin SQL n'en formait pas une, un premier lancement interrompu
        // laissait une démo amputée à vie. Rust décide aussi de rafraîchir
        // une démo restée intacte quand le programme d'exemple change, et
        // rend l'état complet : c'est lui la source de vérité.
        this.seances = fromSeanceDtos(
          await appApi.bootstrapSeances(toSeanceDtos(createDemoSeances())),
        )
      } else {
        this.seances = (await loadFixtureSeances()) ?? createDemoSeances()
      }

      this.ready = true
    },
    async createSeance(name: string, exercises: CreateExerciseInput[]) {
      if (exercises.length === 0) {
        throw new Error('A séance requires at least one exercise.')
      }

      // Rust normalise le nom, décide slugs et positions, écrit la séance et
      // tous ses exercices dans une seule transaction, et rend l'agrégat
      // réellement persisté : on l'applique, on ne reconstruit rien. Un rejet
      // laisse l'état mémoire intact — comme la base.
      if (runningInTauri()) {
        const seance = fromSeanceDtos([await appApi.createSeance(name, exercises)])[0]!

        this.seances.push(seance)

        return seance.slug
      }

      // Repli mémoire (navigateur de dev, tests) : les mêmes décisions, en
      // local — l'unification passera par l'adaptateur mémoire (#72).
      const slug = createUniqueSlug(
        slugify(name),
        this.seances.map((seance) => seance.slug),
      )

      const exerciseSlugs: string[] = []
      const seanceExercises: Exercise[] = exercises.map((input) => {
        const exerciseSlug = createUniqueSlug(slugify(input.name), exerciseSlugs)
        exerciseSlugs.push(exerciseSlug)

        return buildExercise(input, exerciseSlug)
      })

      this.seances.push({
        slug,
        name: name.trim(),
        isDemo: false,
        exercises: seanceExercises,
      })

      return slug
    },
    /**
     * Adopte le programme de démonstration : vide l'historique d'exemple
     * (les séries) mais garde les séances, qui deviennent celles de
     * l'utilisateur (plus marquées démo, la bannière disparaît).
     */
    async adoptDemoSeances() {
      // Atomique côté Rust : une adoption interrompue ne laisse pas une
      // séance adoptée et l'autre encore démo.
      if (runningInTauri()) {
        this.seances = fromSeanceDtos(await appApi.adoptDemoSeances())

        return
      }

      for (const seance of this.seances.filter((candidate) => candidate.isDemo)) {
        for (const exercise of seance.exercises) {
          exercise.sets = []
        }
        seance.isDemo = false
      }
    },
    async deleteDemoData() {
      if (runningInTauri()) {
        this.seances = fromSeanceDtos(await appApi.deleteDemoData())

        return
      }

      this.seances = this.seances.filter((seance) => !seance.isDemo)
    },
    async renameSeance(seanceSlug: string, name: string) {
      const seance = this.findSeanceBySlug(seanceSlug)

      if (!seance) {
        return
      }

      if (runningInTauri()) {
        const updated = await appApi.renameSeance(seanceSlug, name)

        // Seul le champ que la commande possède est appliqué. Les séries
        // vivent encore côté plugin SQL (#69) : poser l'instantané complet de
        // Rust écraserait une série enregistrée entre l'envoi et la réponse.
        seance.name = updated.name

        return
      }

      seance.name = name.trim()
    },
    async addExerciseToSeance(seanceSlug: string, input: CreateExerciseInput) {
      const seance = this.findSeanceBySlug(seanceSlug)

      if (!seance) {
        return null
      }

      // Un exercice ajouté arrive en fin de séance, là où l'écran le montre —
      // le slug et la position sont décidés par Rust, sur l'état de la base.
      if (runningInTauri()) {
        const exercise = fromExerciseDtos([await appApi.addExercise(seanceSlug, input)])[0]!

        seance.exercises.push(exercise)

        return exercise.slug
      }

      const exerciseSlug = createUniqueSlug(
        slugify(input.name),
        seance.exercises.map((exercise) => exercise.slug),
      )
      const exercise = buildExercise(input, exerciseSlug)

      seance.exercises.push(exercise)

      return exerciseSlug
    },
    async setExerciseDumbbell(seanceSlug: string, exerciseSlug: string, isDumbbell: boolean) {
      const seance = this.findSeanceBySlug(seanceSlug)
      const index = seance?.exercises.findIndex((exercise) => exercise.slug === exerciseSlug) ?? -1

      if (!seance || index === -1) {
        return
      }

      if (runningInTauri()) {
        const updated = await appApi.setExerciseDumbbell(seanceSlug, exerciseSlug, isDumbbell)

        // Seul le drapeau que la commande possède : remplacer l'exercice
        // entier poserait un instantané des séries antérieur à ce que la
        // mémoire porte déjà (elles restent sur le chemin plugin SQL, #69).
        seance.exercises[index]!.isDumbbell = updated.isDumbbell

        return
      }

      seance.exercises[index]!.isDumbbell = isDumbbell
    },
    /**
     * Déplace un exercice d'un cran dans sa séance. L'ordre affiché est celui
     * du programme — l'ordre dans lequel les exercices s'enchaînent à la salle
     * — et non l'ordre de création : il doit pouvoir être corrigé après coup.
     *
     * Un cran à la fois plutôt qu'un glisser-déposer : à la salle, sur mobile,
     * une poignée de glissement dans une liste qui défile se déclenche à
     * contretemps. Deux boutons se visent au pouce et s'annoncent aux
     * lecteurs d'écran.
     *
     * Aux extrémités, l'appel ne fait rien et le dit (`false`) : c'est ce que
     * l'appelant désactive à l'écran.
     */
    async moveExercise(seanceSlug: string, exerciseSlug: string, direction: 'up' | 'down') {
      const seance = this.findSeanceBySlug(seanceSlug)

      if (!seance) {
        return false
      }

      const from = seance.exercises.findIndex((exercise) => exercise.slug === exerciseSlug)
      const to = direction === 'up' ? from - 1 : from + 1

      if (from === -1 || to < 0 || to >= seance.exercises.length) {
        return false
      }

      // Rust renumérote toute la séance en transaction (ce qui rattrape des
      // positions divergentes) et rend l'ordre réellement persisté.
      if (runningInTauri()) {
        const updated = await appApi.moveExercise(seanceSlug, exerciseSlug, direction)

        if (updated === null) {
          return false
        }

        // On applique l'ordre décidé par Rust aux exercices déjà en mémoire :
        // leurs séries, encore sur le chemin plugin SQL (#69), peuvent être
        // plus fraîches que l'instantané relu dans la transaction.
        const bySlug = new Map(seance.exercises.map((exercise) => [exercise.slug, exercise]))
        seance.exercises = updated.exercises.map(
          (dto) => bySlug.get(dto.slug) ?? fromExerciseDtos([dto])[0]!,
        )

        return true
      }

      const reordered = [...seance.exercises]
      const [moved] = reordered.splice(from, 1)
      reordered.splice(to, 0, moved!)

      seance.exercises = reordered

      return true
    },
    /**
     * Sous Tauri, l'identifiant fourni par l'appelant est ignoré : SQLite
     * attribue le sien et c'est la forme canonique rendue par Rust qui entre
     * en mémoire. Hors Tauri, l'identifiant local fait l'affaire.
     */
    async addSet(seanceSlug: string, exerciseSlug: string, set: ExerciseSet) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)

      if (!exercise) {
        return
      }

      if (runningInTauri()) {
        const dto = await appApi.addSet(seanceSlug, exerciseSlug, {
          reps: set.reps,
          weight: set.weight,
          completedAt: set.completedAt.toISOString(),
          isWarmup: Boolean(set.isWarmup),
          rpe: set.rpe ?? null,
        })
        exercise.sets.unshift(fromSetDto(dto))
        return
      }

      exercise.sets.unshift(set)
    },
    async setSetWarmup(
      seanceSlug: string,
      exerciseSlug: string,
      setId: number,
      isWarmup: boolean,
    ) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)
      const set = exercise?.sets.find((candidate) => candidate.id === setId)

      if (!set) {
        return
      }

      if (runningInTauri()) {
        const dto = await appApi.setSetWarmup(seanceSlug, exerciseSlug, setId, isWarmup)
        set.isWarmup = dto.isWarmup
        // L'échauffement ne se note pas : Rust a effacé le RPE.
        set.rpe = dto.rpe
        return
      }

      set.isWarmup = isWarmup
      if (isWarmup) {
        set.rpe = null
      }
    },
    /**
     * Corrige une série passée — la faute de frappe du carnet papier. La date
     * ne bouge pas : c'est l'identité de la série (fantômes, déduplication).
     */
    async updateSet(
      seanceSlug: string,
      exerciseSlug: string,
      setId: number,
      changes: { reps: number; weight: number; rpe: number | null },
    ) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)
      const set = exercise?.sets.find((candidate) => candidate.id === setId)

      if (!set) {
        return
      }

      if (runningInTauri()) {
        const dto = await appApi.updateSet(seanceSlug, exerciseSlug, setId, changes)
        set.reps = dto.reps
        set.weight = dto.weight
        set.rpe = dto.rpe
        return
      }

      set.reps = changes.reps
      set.weight = changes.weight
      set.rpe = changes.rpe
    },
    async removeSet(seanceSlug: string, exerciseSlug: string, setId: number) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)

      if (!exercise) {
        return
      }

      if (runningInTauri()) {
        const dto = await appApi.removeSet(seanceSlug, exerciseSlug, setId)
        exercise.sets = dto.sets.map(fromSetDto)
        return
      }

      exercise.sets = exercise.sets.filter((set) => set.id !== setId)
    },
    async clearSets(seanceSlug: string, exerciseSlug: string) {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)

      if (!exercise || exercise.sets.length === 0) {
        return
      }

      if (runningInTauri()) {
        await appApi.clearSets(seanceSlug, exerciseSlug)
      }

      exercise.sets = []
    },
    /**
     * Verse des séries dans un exercice sans toucher au reste de la base.
     * Contrairement à `importBackup`, l'opération est purement additive : une
     * interruption laisse un sous-ensemble cohérent, ce qui dispense d'une
     * transaction côté Rust.
     *
     * Les séries déjà présentes à la même date, mêmes répétitions et même
     * charge sont ignorées — réimporter deux fois le même fichier ne duplique
     * rien.
     */
    async mergeSets(
      seanceSlug: string,
      exerciseSlug: string,
      incoming: Array<{
        reps: number
        weight: number
        completedAt: Date
        isWarmup?: boolean
        rpe?: number | null
      }>,
    ): Promise<{ ajoutees: number; ignorees: number }> {
      const exercise = this.findExercise(seanceSlug, exerciseSlug)

      if (!exercise) {
        return { ajoutees: 0, ignorees: 0 }
      }

      if (runningInTauri()) {
        // Rust déduplique par signature et attribue les identifiants, le tout
        // en une transaction ; on applique l'exercice canonique rendu.
        const report = await appApi.mergeSets(
          seanceSlug,
          exerciseSlug,
          incoming.map((set) => ({
            reps: set.reps,
            weight: set.weight,
            completedAt: set.completedAt.toISOString(),
            isWarmup: Boolean(set.isWarmup),
            rpe: set.rpe ?? null,
          })),
        )
        exercise.sets = report.exercise.sets.map(fromSetDto)

        return { ajoutees: report.ajoutees, ignorees: report.ignorees }
      }

      const signature = (set: { reps: number; weight: number; completedAt: Date }) =>
        `${set.completedAt.toISOString()}|${set.reps}|${set.weight}`

      const seen = new Set(exercise.sets.map(signature))

      // Les identifiants sont uniques sur toute la base, pas par exercice :
      // `removeSet` supprime par identifiant seul.
      let nextId = this.allSets.reduce((highest, set) => Math.max(highest, set.id), 0) + 1

      let ignorees = 0
      const added: ExerciseSet[] = []

      for (const candidate of incoming) {
        const key = signature(candidate)

        if (seen.has(key)) {
          ignorees += 1
          continue
        }

        seen.add(key)
        added.push({ id: nextId++, ...candidate })
      }

      // `sets` est lu du plus récent au plus ancien partout ailleurs
      // (`addSet` empile en tête) : l'import doit rendre le même ordre.
      exercise.sets = [...exercise.sets, ...added].sort(
        (first, second) => second.completedAt.getTime() - first.completedAt.getTime(),
      )

      return { ajoutees: added.length, ignorees }
    },
    /**
     * La date est injectée par l'appelant : le nom du fichier et le champ
     * `exportedAt` doivent porter le même instant (#57).
     */
    async exportBackup(exportedAt: Date): Promise<string> {
      // Les pesées sont demandées ici, pas passées par l'appelant : une vue qui
      // oublierait de les charger exporterait une sauvegarde sans poids, et le
      // fichier n'aurait l'air de rien manquer.
      return serializeBackup(this.seances, exportedAt, await useBodyWeightStore().current())
    },
    /**
     * Restauration possible seulement tant qu'il n'y a rien à perdre : aucune
     * séance, ou uniquement le programme d'exemple. Cette contrainte supprime
     * par construction toute question de fusion — il n'y a jamais rien à
     * arbitrer entre deux historiques.
     */
    async importBackup(text: string) {
      if (this.hasRealData) {
        throw new Error(
          'Tu as déjà tes propres séances : la restauration n’est possible que sur une app fraîchement installée.',
        )
      }

      // Le parsing lève avant toute écriture : un fichier invalide ne doit
      // jamais entamer la base.
      const { seances, bodyWeights } = parseBackup(text)

      // L'écriture est déléguée à Rust : elle vide et repeuple les trois tables
      // dans une vraie transaction rusqlite. Le `BEGIN`/`COMMIT` du plugin SQL
      // ne transactionne rien — chaque `execute()` emprunte une connexion
      // différente du pool, donc un échec en cours de route laissait la base à
      // moitié vidée.
      if (runningInTauri()) {
        await invoke('import_seances', { seances: toImportPayload(seances) })
      }

      this.seances = seances

      // Les pesées vivent à part des séances : leur table a sa propre commande
      // de remplacement. Elles arrivent après le programme — un fichier
      // restauré sans elles reste un programme complet, l'inverse serait un
      // historique de poids sans séances.
      await useBodyWeightStore().restore(bodyWeights)
    },
  },
})

let dbInstance: Database | null = null
let dbLoadPromise: Promise<Database> | null = null

// Rust est la seule source de vérité pour le nom du fichier de base (voir
// `db_file_name` dans src-tauri/src/lib.rs) : recalculer localement le même
// choix via `import.meta.env.DEV` divergeait silencieusement de
// `cfg!(debug_assertions)` sous `tauri build --debug` (donc
// `tauri ios build --debug`), qui compile toujours le front en mode
// production. `getDb` n'est appelée que sous Tauri (voir `runningInTauri`
// dans les appelants) : hors Tauri cette commande n'est jamais invoquée.
async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance
  }

  if (!dbLoadPromise) {
    dbLoadPromise = invoke<string>('db_file_name').then((fileName) =>
      Database.load(`sqlite:${fileName}`),
    )
  }

  dbInstance = await dbLoadPromise
  return dbInstance
}

// L'adaptateur réel du contrat AppApi (docs/app-api.md). Instancié au niveau
// du module comme la connexion ci-dessus : il est sans état, seul le runtime
// Tauri décide de ce qu'il touche — et il n'est appelé que sous Tauri.
const appApi = createTauriAppApi()

/** La forme mémoire d'une série rendue par le contrat : la date redevient une `Date`. */
function fromSetDto(dto: ExerciseSetDto): ExerciseSet {
  return {
    id: dto.id,
    reps: dto.reps,
    weight: dto.weight,
    completedAt: new Date(dto.completedAt),
    isWarmup: dto.isWarmup,
    rpe: dto.rpe,
  }
}

function buildExercise(input: CreateExerciseInput, slug: string): Exercise {
  return {
    slug,
    name: input.name.trim(),
    defaultReps: input.defaultReps,
    defaultWeight: input.defaultWeight,
    weightUnit: input.weightUnit.trim() || 'kg',
    restSeconds: input.restSeconds ?? 180,
    isDumbbell: input.isDumbbell ?? false,
    sets: [],
  }
}

/**
 * Charge utile de la commande Rust `import_seances`. Les clés sont en camelCase
 * (côté Rust, `#[serde(rename_all = "camelCase")]`) et les dates sont converties
 * en chaînes ISO, exactement le format que porte déjà la colonne `completed_at`.
 *
 * L'identifiant de chaque série est transmis explicitement : la mémoire et la
 * base doivent porter les mêmes, sinon `removeSet` — qui supprime par
 * identifiant seul — effacerait la mauvaise ligne jusqu'au prochain rechargement.
 *
 * `isDemo` n'est pas transmis : ce que l'utilisateur restaure lui appartient,
 * la commande écrit `is_demo = 0`.
 *
 * Exportée uniquement pour les tests : `src/stores/__tests__/importPayload.spec.ts`
 * s'en sert pour régénérer `fixtures/import-payload.json`, le fichier de
 * référence que le test Rust `the_reference_payload_from_typescript_deserializes`
 * désérialise. C'est ce qui rend un renommage de champ d'un seul côté visible
 * en intégration continue.
 */
export function toImportPayload(seances: Seance[]) {
  return seances.map((seance) => ({
    slug: seance.slug,
    name: seance.name,
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
      })),
    })),
  }))
}

/**
 * Jeux de données de test (voir `datasets/scenarios.ts`), demandés par les
 * tests e2e via `window.__GHOST_LIFT_FIXTURE__`.
 *
 * L'import est dynamique et sous garde `import.meta.env.DEV` : en production
 * la branche entière est éliminée à la compilation, donc ni le hook ni les
 * scénarios ne partent dans le bundle livré.
 *
 * Un nom inconnu lève au lieu de retomber sur le programme de démonstration :
 * un test qui croit charger un scénario et navigue en fait dans les données
 * d'exemple passerait en testant autre chose que ce qu'il annonce.
 */
async function loadFixtureSeances(): Promise<Seance[] | null> {
  if (!import.meta.env.DEV) {
    return null
  }

  const name = globalThis.window?.__GHOST_LIFT_FIXTURE__

  if (!name) {
    return null
  }

  const { scenarios } = await import('../datasets/scenarios')
  const scenario = scenarios[name]

  if (!scenario) {
    throw new Error(`Scénario de test inconnu : ${name}`)
  }

  return scenario(new Date())
}
