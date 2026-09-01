import { invoke } from '@tauri-apps/api/core'
import {
  toAppError,
  type AppApi,
  type BodyWeightDto,
  type CreateExerciseInputDto,
  type ExerciseDto,
  type SeanceDto,
} from './appApi'

/** La signature d'`invoke` dont l'adaptateur a besoin — injectable en test. */
export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

/**
 * L'adaptateur réel : chaque méthode d'AppApi devient un `invoke` vers la
 * commande Rust du même contrat, et toute défaillance ressort en AppError —
 * les vues n'ont jamais à connaître la forme brute d'un rejet IPC.
 *
 * `invokeFn` est injectable pour les tests ; l'app l'utilise sans argument.
 */
export function createTauriAppApi(invokeFn: InvokeFn = invoke): AppApi {
  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invokeFn<T>(command, args)
    } catch (failure) {
      throw toAppError(failure)
    }
  }

  return {
    dbFileName: () => call<string>('db_file_name'),
    bootstrapSeances: (seed: SeanceDto[]) => call<SeanceDto[]>('bootstrap_seances', { seed }),
    importSeances: (seances: SeanceDto[]) =>
      call<void>('import_seances', { seances: seances.map(toImportSeance) }),
    createSeance: (name, exercises) =>
      call<SeanceDto>('create_seance', { name, exercises: exercises.map(toInputPayload) }),
    renameSeance: (seanceSlug, name) => call<SeanceDto>('rename_seance', { seanceSlug, name }),
    addExercise: (seanceSlug, input) =>
      call<ExerciseDto>('add_exercise', { seanceSlug, input: toInputPayload(input) }),
    moveExercise: (seanceSlug, exerciseSlug, direction) =>
      call<SeanceDto | null>('move_exercise', { seanceSlug, exerciseSlug, direction }),
    setExerciseDumbbell: (seanceSlug, exerciseSlug, isDumbbell) =>
      call<ExerciseDto>('set_exercise_dumbbell', { seanceSlug, exerciseSlug, isDumbbell }),
    adoptDemoSeances: () => call<SeanceDto[]>('adopt_demo_seances'),
    deleteDemoData: () => call<SeanceDto[]>('delete_demo_data'),
    listBodyWeights: () => call<BodyWeightDto[]>('list_body_weights'),
    logBodyWeight: (day, kilograms) => call<BodyWeightDto[]>('log_body_weight', { day, kilograms }),
    deleteBodyWeight: (day) => call<BodyWeightDto[]>('delete_body_weight', { day }),
  }
}

/**
 * On n'envoie que les champs du contrat, et jamais une clé à valeur
 * `undefined` : la commande Rust est `deny_unknown_fields`, ses défauts
 * (`180`, `false`) s'appliquent aux champs absents.
 */
function toInputPayload(input: CreateExerciseInputDto) {
  const payload: Record<string, unknown> = {
    name: input.name,
    defaultReps: input.defaultReps,
    defaultWeight: input.defaultWeight,
    weightUnit: input.weightUnit,
  }

  if (input.restSeconds !== undefined) {
    payload.restSeconds = input.restSeconds
  }

  if (input.isDumbbell !== undefined) {
    payload.isDumbbell = input.isDumbbell
  }

  return payload
}

/**
 * La commande `import_seances` ne lit pas `isDemo` — ce que l'utilisateur
 * restaure lui appartient, Rust écrit `is_demo = 0` d'office. On n'envoie que
 * les champs que Rust sait lire : un champ ignoré en silence aujourd'hui
 * deviendrait un refus le jour où la commande passe en `deny_unknown_fields`.
 */
function toImportSeance({ isDemo: _isDemo, ...seance }: SeanceDto) {
  return seance
}
