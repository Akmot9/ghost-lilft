import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fromSeanceDtos,
  isAppError,
  toAppError,
  toSeanceDtos,
  UNEXPECTED_ERROR_CODE,
  type AppApi,
  type AppError,
  type SeanceDto,
  type SeanceModel,
} from '../appApi'
import { createMemoryAppApi } from '../appApiMemory'
import { createTauriAppApi, type InvokeFn } from '../appApiTauri'
import { scenarios } from '../../datasets/scenarios'

/**
 * NE SUPPRIME PAS `fixtures/contract-seances.json` NI `contract-errors.json`.
 *
 * Même mécanisme que `importPayload.spec.ts`, étendu au contrat AppApi
 * complet (#66) : ces deux fichiers sont le point de contact vérifiable entre
 * `src/lib/appApi.ts` et `src-tauri/src/contract.rs`.
 *
 *   1. ce test-ci produit les fixtures avec les vraies fonctions du contrat
 *      (`toSeanceDtos`, la liste des erreurs) et les compare octet pour octet
 *      aux fichiers ;
 *   2. les tests Rust de `contract.rs` lisent **les mêmes fichiers**, les
 *      désérialisent dans les DTO canoniques, les passent à
 *      `validate_seances`, puis les resérialisent — et exigent de retomber
 *      octet pour octet sur les mêmes fichiers.
 *
 * Un champ renommé, réordonné ou retypé d'un seul côté fait donc tomber au
 * moins un des deux. Quand le contrat change volontairement (des deux côtés) :
 *
 *     GHOST_LIFT_UPDATE_FIXTURES=1 npm run test:unit
 *
 * puis relis le diff : c'est exactement ce qui circulera entre Vue et Rust.
 */
const SEANCES_FIXTURE_PATH = resolve(process.cwd(), 'fixtures/contract-seances.json')
const ERRORS_FIXTURE_PATH = resolve(process.cwd(), 'fixtures/contract-errors.json')

const NOW = new Date('2026-08-15T09:00:00.000Z')

/**
 * Les scénarios réels de l'app, plus une séance qui porte les formes apparues
 * depuis 1.7 et absentes d'eux : mode découverte (`isDemo`), haltères, charge
 * au demi-kilo, série d'échauffement.
 */
function referenceSeances(): SeanceModel[] {
  const halteres: SeanceModel = {
    slug: 'upper-halteres',
    name: 'Upper haltères',
    isDemo: true,
    exercises: [
      {
        slug: 'curl-halteres',
        name: 'Curl haltères',
        defaultReps: 10,
        defaultWeight: 12.5,
        weightUnit: 'kg',
        restSeconds: 90,
        isDumbbell: true,
        sets: [
          {
            id: 9001,
            reps: 10,
            weight: 25,
            completedAt: new Date('2026-08-14T18:10:00.000Z'),
            isWarmup: false,
          },
          {
            id: 9002,
            reps: 6,
            weight: 32.5,
            completedAt: new Date('2026-08-14T18:00:00.000Z'),
            isWarmup: true,
          },
        ],
      },
    ],
  }

  return withGloballyUniqueSetIds([
    ...scenarios.stagnation(NOW),
    ...scenarios.progression(NOW),
    ...scenarios.debutant(NOW),
  ]).concat(halteres)
}

/**
 * Un exemple de chaque code d'erreur du contrat, tel que Rust le produit :
 * la fixture fige à la fois la forme (`code`/`message` en camelCase) et la
 * liste des codes dont Vue a le droit de parler.
 */
function referenceErrors(): AppError[] {
  return [
    { code: 'slug-invalide', message: 'Séance « Upper A » : un slug est en minuscules ascii, chiffres et tirets simples.' },
    { code: 'slug-duplique', message: 'Deux séances portent le slug « upper-a ».' },
    { code: 'nom-invalide', message: 'Séance « upper-a » : le nom est vide ou porte des espaces de bord.' },
    { code: 'repetitions-invalides', message: 'Série 7 : au moins une répétition pour être enregistrée.' },
    { code: 'charge-invalide', message: "Série 7 : la charge est un multiple de 0,5 kg, d'au moins 1 kg." },
    { code: 'unite-invalide', message: "Exercice « curl » : l'unité de poids est vide." },
    { code: 'repos-invalide', message: 'Exercice « curl » : le repos ne peut pas être négatif.' },
    { code: 'identifiant-invalide', message: "Exercice « curl » : l'identifiant de série 0 est invalide (au moins 1)." },
    { code: 'identifiant-duplique', message: "Deux séries portent l'identifiant 7 : il est unique sur toute la base." },
    { code: 'date-invalide', message: "Série 7 : « 2026-08-15 » n'est pas un horodatage UTC canonique (AAAA-MM-JJTHH:MM:SS.mmmZ)." },
    { code: 'graine-invalide', message: 'La graine de démonstration doit être entièrement en mode découverte.' },
    { code: 'stockage-indisponible', message: 'Base de données inaccessible : database is locked' },
    { code: UNEXPECTED_ERROR_CODE, message: 'Une erreur inattendue est survenue.' },
  ]
}

/** Comme dans `importPayload.spec.ts` : une fixture doit être importable. */
function withGloballyUniqueSetIds(seances: SeanceModel[]): SeanceModel[] {
  let nextId = 1

  return seances.map((seance) => ({
    ...seance,
    exercises: seance.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, id: nextId++ })),
    })),
  }))
}

/** Forme canonique des fixtures : 2 espaces d'indentation, saut de ligne final. */
function serializeFixture(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`
}

function expectFixtureMatches(path: string, expected: string) {
  if (process.env.GHOST_LIFT_UPDATE_FIXTURES === '1') {
    writeFileSync(path, expected, 'utf8')
  }

  const onDisk = readFileSync(path, 'utf8')

  expect(
    onDisk,
    `${path} ne correspond plus au contrat TypeScript. Si le changement est voulu, ` +
      'adapte aussi src-tauri/src/contract.rs, puis régénère : ' +
      'GHOST_LIFT_UPDATE_FIXTURES=1 npm run test:unit',
  ).toBe(expected)
}

describe('fixtures contractuelles partagées avec Rust', () => {
  it('les séances de référence correspondent au fichier partagé', () => {
    expectFixtureMatches(SEANCES_FIXTURE_PATH, serializeFixture(toSeanceDtos(referenceSeances())))
  })

  it('les erreurs de référence correspondent au fichier partagé', () => {
    expectFixtureMatches(ERRORS_FIXTURE_PATH, serializeFixture(referenceErrors()))
  })

  it('la fixture de séances reste digne d’être comparée', () => {
    // Garde-fou : une fixture dégénérée passerait la comparaison sans rien
    // prouver. Les formes qui ont déjà divergé entre les deux langages
    // doivent y être — le demi-kilo fut un i64 côté Rust.
    const dtos = toSeanceDtos(referenceSeances())
    const exercises = dtos.flatMap((seance) => seance.exercises)
    const sets = exercises.flatMap((exercise) => exercise.sets)

    expect(dtos.length).toBeGreaterThan(1)
    expect(dtos.some((seance) => seance.isDemo)).toBe(true)
    expect(dtos.some((seance) => !seance.isDemo)).toBe(true)
    expect(exercises.some((exercise) => exercise.isDumbbell)).toBe(true)
    expect(exercises.some((exercise) => exercise.sets.length === 0)).toBe(true)
    expect(exercises.some((exercise) => !Number.isInteger(exercise.defaultWeight))).toBe(true)
    expect(sets.some((set) => set.isWarmup)).toBe(true)
    expect(sets.some((set) => !Number.isInteger(set.weight))).toBe(true)
  })

  it('ne parle que des champs du contrat, dans son ordre', () => {
    // L'ordre des clés fait partie de la forme canonique : les fixtures se
    // comparent octet pour octet, dans les deux langages.
    const [seance] = toSeanceDtos(referenceSeances())
    expect(Object.keys(seance!)).toEqual(['slug', 'name', 'isDemo', 'exercises'])

    const [exercise] = seance!.exercises
    expect(Object.keys(exercise!)).toEqual([
      'slug',
      'name',
      'defaultReps',
      'defaultWeight',
      'weightUnit',
      'restSeconds',
      'isDumbbell',
      'sets',
    ])

    const [set] = exercise!.sets
    expect(Object.keys(set!)).toEqual(['id', 'reps', 'weight', 'completedAt', 'isWarmup'])
  })
})

describe('sérialisation des dates', () => {
  it('rend l’horodatage UTC canonique quelle que soit l’écriture d’origine', () => {
    // Une date saisie dans un fuseau (ici Paris, +02:00) sort en UTC : le
    // contrat n'a qu'une seule écriture par instant, la déduplication par
    // signature en dépend.
    const paris = new Date('2026-08-15T11:00:00.000+02:00')
    const seances: SeanceModel[] = [
      {
        slug: 'upper-a',
        name: 'Upper A',
        isDemo: false,
        exercises: [
          {
            slug: 'curl',
            name: 'Curl',
            defaultReps: 8,
            defaultWeight: 20,
            weightUnit: 'kg',
            restSeconds: 90,
            sets: [{ id: 1, reps: 8, weight: 20, completedAt: paris }],
          },
        ],
      },
    ]

    const [dto] = toSeanceDtos(seances)

    expect(dto!.exercises[0]!.sets[0]!.completedAt).toBe('2026-08-15T09:00:00.000Z')
    // Les drapeaux optionnels du modèle deviennent explicites sur le fil.
    expect(dto!.exercises[0]!.isDumbbell).toBe(false)
    expect(dto!.exercises[0]!.sets[0]!.isWarmup).toBe(false)
  })

  it('fait l’aller-retour sans perte', () => {
    const dtos = toSeanceDtos(referenceSeances())

    const back = toSeanceDtos(fromSeanceDtos(dtos))

    expect(back).toEqual(dtos)
  })
})

describe('AppError', () => {
  it('reconnaît une erreur du contrat et la laisse intacte', () => {
    const error: AppError = { code: 'date-invalide', message: 'Message affichable.' }

    expect(isAppError(error)).toBe(true)
    expect(toAppError(error)).toBe(error)
  })

  it('normalise les rejets bruts en AppError affichable', () => {
    // `import_seances` rejette encore une chaîne ; le runtime peut lever
    // n'importe quoi. Tout ressort affichable.
    expect(toAppError('Restauration impossible : disque plein')).toEqual({
      code: UNEXPECTED_ERROR_CODE,
      message: 'Restauration impossible : disque plein',
    })
    expect(toAppError(new Error('boom'))).toEqual({ code: UNEXPECTED_ERROR_CODE, message: 'boom' })
    expect(toAppError(undefined).message.length).toBeGreaterThan(0)
    expect(isAppError(toAppError(42))).toBe(true)
  })
})

describe('substitution des adaptateurs', () => {
  it('l’adaptateur mémoire tient le contrat sans runtime Tauri', async () => {
    // L'affectation est le test de type : les deux usines rendent un AppApi.
    const api: AppApi = createMemoryAppApi()
    const memory = createMemoryAppApi()

    await memory.importSeances(toSeanceDtos(referenceSeances()))

    const stored = memory.seances()
    expect(stored.map((seance) => seance.slug)).toEqual(
      toSeanceDtos(referenceSeances()).map((seance) => seance.slug),
    )
    // Même sémantique que la commande Rust : ce qu'on restaure nous appartient.
    expect(stored.every((seance) => !seance.isDemo)).toBe(true)
    await expect(api.dbFileName()).resolves.toContain('.db')
  })

  it('l’adaptateur Tauri invoque les commandes du contrat, sans champ inconnu', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const invokeFn: InvokeFn = <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args })
      return Promise.resolve(undefined as T)
    }

    const api: AppApi = createTauriAppApi(invokeFn)

    await api.dbFileName()
    await api.importSeances(toSeanceDtos(referenceSeances()))

    expect(calls[0]).toEqual({ command: 'db_file_name', args: undefined })
    expect(calls[1]!.command).toBe('import_seances')
    // `import_seances` ne lit pas `isDemo` : on n'envoie que ce que Rust sait lire.
    const sent = (calls[1]!.args as { seances: Array<Record<string, unknown>> }).seances
    expect(Object.keys(sent[0]!)).toEqual(['slug', 'name', 'exercises'])
  })

  it('l’adaptateur Tauri envoie la graine du bootstrap entière, drapeau démo compris', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const invokeFn: InvokeFn = <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args })
      return Promise.resolve([] as T)
    }

    const seed = toSeanceDtos(referenceSeances())
    await createTauriAppApi(invokeFn).bootstrapSeances(seed)

    // Contrairement à l'import, la graine voyage dans sa forme canonique
    // complète : c'est Rust qui lit `isDemo` pour marquer le mode découverte.
    expect(calls[0]!.command).toBe('bootstrap_seances')
    expect(Object.keys(calls[0]!.args!)).toEqual(['seed'])
    const sent = (calls[0]!.args as { seed: Array<Record<string, unknown>> }).seed
    expect(Object.keys(sent[0]!)).toEqual(['slug', 'name', 'isDemo', 'exercises'])
  })

  it('l’adaptateur mémoire suit la sémantique du bootstrap : semer, rafraîchir, préserver', async () => {
    const memory = createMemoryAppApi()
    const demo = (marker: string): SeanceDto[] => [
      {
        slug: 'upper-a',
        name: `Upper A ${marker}`,
        isDemo: true,
        exercises: [],
      },
    ]

    // Base vide : la graine est semée.
    expect(await memory.bootstrapSeances(demo('v1'))).toEqual(demo('v1'))
    // Démo intacte : la graine du jour la remplace.
    expect(await memory.bootstrapSeances(demo('v2'))).toEqual(demo('v2'))

    // Données réelles : plus rien n'est remplaçable.
    await memory.importSeances(demo('mienne'))
    const kept = await memory.bootstrapSeances(demo('v3'))
    expect(kept.map((seance) => seance.name)).toEqual(['Upper A mienne'])
    expect(kept.every((seance) => !seance.isDemo)).toBe(true)
  })

  it('l’adaptateur Tauri normalise les rejets en AppError', async () => {
    const invokeFn: InvokeFn = () => Promise.reject('Restauration impossible : contrainte violée')

    const api = createTauriAppApi(invokeFn)

    await expect(api.importSeances([])).rejects.toEqual({
      code: UNEXPECTED_ERROR_CODE,
      message: 'Restauration impossible : contrainte violée',
    })
  })
})
