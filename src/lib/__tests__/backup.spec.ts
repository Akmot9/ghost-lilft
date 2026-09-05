import { describe, expect, it } from 'vitest'
import {
  backupFileName,
  exerciseBackupFileName,
  parseBackup,
  readExerciseSets,
  serializeBackup,
  serializeExerciseBackup,
} from '../backup'
import { scenarios } from '../../datasets/scenarios'

const NOW = new Date('2026-08-15T09:00:00.000Z')

describe('serializeBackup / parseBackup', () => {
  it('fait un aller-retour sans perte', () => {
    const seances = scenarios.stagnation(NOW)
    seances[0]!.exercises[0]!.isDumbbell = true
    seances[0]!.exercises[0]!.sets[0]!.isWarmup = true
    const restored = parseBackup(serializeBackup(seances, NOW)).seances

    expect(restored).toHaveLength(seances.length)
    expect(restored[0]?.slug).toBe(seances[0]?.slug)
    expect(restored[0]?.name).toBe(seances[0]?.name)

    const source = seances[0]!.exercises[0]!
    const target = restored[0]!.exercises[0]!

    expect(target.slug).toBe(source.slug)
    expect(target.restSeconds).toBe(source.restSeconds)
    expect(target.isDumbbell).toBe(true)
    expect(target.sets[0]?.isWarmup).toBe(true)
    expect(target.sets.map((set) => [set.reps, set.weight])).toEqual(
      source.sets.map((set) => [set.reps, set.weight]),
    )
    expect(target.sets[0]?.completedAt.toISOString()).toBe(
      source.sets[0]?.completedAt.toISOString(),
    )
  })

  it('n\'exporte jamais le marqueur de démonstration', () => {
    const seances = scenarios.progression(NOW).map((seance) => ({ ...seance, isDemo: true }))
    const restored = parseBackup(serializeBackup(seances, NOW)).seances

    expect(restored.every((seance) => seance.isDemo === false)).toBe(true)
    expect(serializeBackup(seances, NOW)).not.toContain('isDemo')
  })

  it('accepte un fichier sans history et rend des séances à historique vide', () => {
    const text = JSON.stringify({
      format: 'ghost-lift-backup',
      version: 1,
      exportedAt: NOW.toISOString(),
      seances: [
        {
          slug: 'upper-a',
          name: 'Upper A',
          exercises: [
            {
              slug: 'developpe-couche',
              name: 'Développé couché',
              defaultReps: 8,
              defaultWeight: 70,
              weightUnit: 'kg',
              restSeconds: 120,
            },
          ],
        },
      ],
    })

    const restored = parseBackup(text).seances

    expect(restored[0]?.exercises[0]?.sets).toEqual([])
    expect(restored[0]?.exercises[0]?.isDumbbell).toBe(false)
  })

  it('keeps old version-1 exports compatible by treating missing flags as work sets', () => {
    const text = JSON.stringify({
      format: 'ghost-lift-backup',
      version: 1,
      seances: [
        {
          slug: 'upper-a',
          name: 'Upper A',
          exercises: [
            {
              slug: 'developpe-incline',
              name: 'Développé incliné',
              defaultReps: 6,
              defaultWeight: 84,
              weightUnit: 'kg',
              restSeconds: 150,
            },
          ],
        },
      ],
      history: [
        {
          seanceSlug: 'upper-a',
          exerciseSlug: 'developpe-incline',
          sets: [{ reps: 6, weight: 84, completedAt: '2026-08-17T18:00:00Z' }],
        },
      ],
    })

    expect(parseBackup(text).seances[0]?.exercises[0]?.sets[0]?.isWarmup).toBe(false)
  })

  it('numérote les séries de façon unique sur toute la sauvegarde', () => {
    const restored = parseBackup(serializeBackup(scenarios.stagnation(NOW), NOW)).seances
    const ids = restored.flatMap((seance) =>
      seance.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id)),
    )

    // stagnation : 9 séries sur le développé couché + 4 sur le rowing.
    expect(ids).toHaveLength(13)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('nomme le fichier avec la date du jour', () => {
    expect(backupFileName(NOW)).toBe('revenant-2026-08-15.json')
  })
})

describe('parseBackup — refus', () => {
  const cases: Array<[string, string, string]> = [
    ['fichier illisible', 'ceci n\'est pas du JSON', 'Fichier illisible'],
    [
      'format étranger',
      JSON.stringify({ format: 'autre-app', version: 1, seances: [] }),
      'sauvegarde Revenant',
    ],
    [
      'version future',
      JSON.stringify({ format: 'ghost-lift-backup', version: 5, seances: [] }),
      'version plus récente',
    ],
    [
      'version absurde',
      JSON.stringify({ format: 'ghost-lift-backup', version: '1', seances: [] }),
      'version de sauvegarde inconnue',
    ],
    [
      'version zéro',
      JSON.stringify({ format: 'ghost-lift-backup', version: 0, seances: [] }),
      'version de sauvegarde inconnue',
    ],
    [
      'aucune séance',
      JSON.stringify({ format: 'ghost-lift-backup', version: 1, seances: [] }),
      'aucune séance',
    ],
    [
      'slug de séance hors grammaire',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [{ slug: 'Upper A/1', name: 'Upper A', exercises: [] }],
      }),
      "n'est pas au format attendu",
    ],
    [
      "slug d'exercice hors grammaire",
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [
          {
            slug: 'upper-a',
            name: 'Upper A',
            exercises: [
              {
                slug: 'Curl !',
                name: 'Curl',
                defaultReps: 8,
                defaultWeight: 30,
                weightUnit: 'kg',
                restSeconds: 90,
              },
            ],
          },
        ],
      }),
      "n'est pas au format attendu",
    ],
    [
      'historique en double pour un même exercice',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [
          {
            slug: 'upper-a',
            name: 'Upper A',
            exercises: [
              {
                slug: 'curl',
                name: 'Curl',
                defaultReps: 8,
                defaultWeight: 30,
                weightUnit: 'kg',
                restSeconds: 90,
              },
            ],
          },
        ],
        history: [
          {
            seanceSlug: 'upper-a',
            exerciseSlug: 'curl',
            sets: [{ reps: 8, weight: 30, completedAt: '2026-08-15T18:00:00.000Z' }],
          },
          {
            seanceSlug: 'upper-a',
            exerciseSlug: 'curl',
            sets: [{ reps: 6, weight: 32, completedAt: '2026-08-16T18:00:00.000Z' }],
          },
        ],
      }),
      "référence deux fois « curl »",
    ],
    [
      'séance sans nom',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [{ slug: 'upper-a', exercises: [] }],
      }),
      'incomplet',
    ],
    [
      'historique orphelin',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [{ slug: 'upper-a', name: 'Upper A', exercises: [] }],
        history: [{ seanceSlug: 'upper-a', exerciseSlug: 'inconnu', sets: [] }],
      }),
      'incohérent',
    ],
    [
      'slugs dupliqués',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [
          { slug: 'upper-a', name: 'Upper A', exercises: [] },
          { slug: 'upper-a', name: 'Doublon', exercises: [] },
        ],
      }),
      'en double',
    ],
    [
      'date non parsable',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [
          {
            slug: 'upper-a',
            name: 'Upper A',
            exercises: [
              {
                slug: 'dc',
                name: 'DC',
                defaultReps: 8,
                defaultWeight: 70,
                weightUnit: 'kg',
                restSeconds: 120,
              },
            ],
          },
        ],
        history: [
          {
            seanceSlug: 'upper-a',
            exerciseSlug: 'dc',
            sets: [{ reps: 8, weight: 70, completedAt: 'hier' }],
          },
        ],
      }),
      'date',
    ],
    [
      'type d’échauffement invalide',
      JSON.stringify({
        format: 'ghost-lift-backup',
        version: 1,
        seances: [
          {
            slug: 'upper-a',
            name: 'Upper A',
            exercises: [
              {
                slug: 'dc',
                name: 'DC',
                defaultReps: 8,
                defaultWeight: 70,
                weightUnit: 'kg',
                restSeconds: 120,
              },
            ],
          },
        ],
        history: [
          {
            seanceSlug: 'upper-a',
            exerciseSlug: 'dc',
            sets: [
              { reps: 8, weight: 70, completedAt: '2026-08-17T18:00:00Z', isWarmup: 'oui' },
            ],
          },
        ],
      }),
      'type de série',
    ],
  ]

  it.each(cases)('refuse : %s', (_label, text, expectedMessage) => {
    expect(() => parseBackup(text)).toThrowError(new RegExp(expectedMessage, 'i'))
  })
})

describe('serializeExerciseBackup / readExerciseSets', () => {
  const seances = scenarios.progression(NOW)
  const seance = seances[0]!
  const exercise = seance.exercises[0]!

  it('exporte un seul exercice dans un fichier de sauvegarde ordinaire', () => {
    const text = serializeExerciseBackup(seance, exercise, NOW)
    const restored = parseBackup(text).seances

    expect(restored).toHaveLength(1)
    expect(restored[0]?.slug).toBe(seance.slug)
    expect(restored[0]?.exercises).toHaveLength(1)
    expect(restored[0]?.exercises[0]?.slug).toBe(exercise.slug)
  })

  it('relit les séries de l\'exercice demandé', () => {
    const sets = readExerciseSets(serializeExerciseBackup(seance, exercise, NOW), exercise.slug)

    expect(sets.map((set) => [set.reps, set.weight])).toEqual(
      exercise.sets.map((set) => [set.reps, set.weight]),
    )
  })

  it('accepte une sauvegarde complète et n\'en tire que l\'exercice ouvert', () => {
    const sets = readExerciseSets(serializeBackup(seances, NOW), exercise.slug)

    expect(sets).toHaveLength(exercise.sets.length)
  })

  it('accepte un fichier au nom différent s\'il ne porte qu\'un seul historique', () => {
    // Ce qui permet d'importer l'historique d'un exercice nommé autrement
    // ailleurs — le cas d'un export venu d'une autre app.
    const text = serializeExerciseBackup(seance, exercise, NOW)

    expect(readExerciseSets(text, 'un-slug-qui-n-existe-pas')).toHaveLength(exercise.sets.length)
  })

  it('refuse d\'arbitrer entre plusieurs exercices inconnus', () => {
    const deuxHistoriques = [
      {
        ...seance,
        exercises: [
          exercise,
          { ...exercise, slug: 'un-autre-exercice', name: 'Un autre exercice' },
        ],
      },
    ]

    expect(() => readExerciseSets(serializeBackup(deuxHistoriques, NOW), 'inconnu')).toThrow(
      /plusieurs exercices/,
    )
  })

  it('refuse un fichier sans aucune série', () => {
    const vide = { ...exercise, sets: [] }

    expect(() => readExerciseSets(serializeExerciseBackup(seance, vide, NOW), vide.slug)).toThrow(
      /aucune série/,
    )
  })
})

describe('poids de corps dans la sauvegarde (v4)', () => {
  const weights = [
    { day: '2026-09-01', kilograms: 74.2 },
    { day: '2026-08-30', kilograms: 75.1 },
  ]

  function fileWith(bodyWeights: unknown): string {
    return JSON.stringify({
      format: 'ghost-lift-backup',
      version: 4,
      exportedAt: NOW.toISOString(),
      seances: [{ slug: 'lower', name: 'Lower', exercises: [] }],
      bodyWeights,
    })
  }

  it('lit une sauvegarde d\'avant la v4 sans pesée', () => {
    const text = JSON.stringify({
      format: 'ghost-lift-backup',
      version: 3,
      exportedAt: NOW.toISOString(),
      seances: [{ slug: 'lower', name: 'Lower', exercises: [] }],
    })

    expect(parseBackup(text).bodyWeights).toEqual([])
  })

  it.each([
    ['jour hors calendrier', [{ day: '2026-02-30', kilograms: 74.2 }], 'jour calendaire'],
    ['jour mal formé', [{ day: '01/09/2026', kilograms: 74.2 }], 'jour calendaire'],
    ['horodatage complet', [{ day: '2026-09-01T00:00:00.000Z', kilograms: 74.2 }], 'jour calendaire'],
    ['poids sous la borne', [{ day: '2026-09-01', kilograms: 19.9 }], 'entre 20 et 400'],
    ['poids au-dessus', [{ day: '2026-09-01', kilograms: 400.1 }], 'entre 20 et 400'],
    ['poids au centième', [{ day: '2026-09-01', kilograms: 74.25 }], 'au dixième'],
    ['poids non numérique', [{ day: '2026-09-01', kilograms: '74.2' }], 'au dixième'],
    ['pesée sans jour', [{ kilograms: 74.2 }], 'jour calendaire'],
    ['deux pesées le même jour', [
      { day: '2026-09-01', kilograms: 74.2 },
      { day: '2026-09-01', kilograms: 75.0 },
    ], 'deux pesées'],
    ['pesées mal formées', { day: '2026-09-01' }, 'pesées sont mal formées'],
  ])('refuse %s', (_titre, bodyWeights, attendu) => {
    expect(() => parseBackup(fileWith(bodyWeights))).toThrowError(new RegExp(attendu, 'i'))
  })

  it('fait un aller-retour des pesées, de la plus ancienne à la plus récente', () => {
    const seances = scenarios.stagnation(NOW)
    const restored = parseBackup(serializeBackup(seances, NOW, weights))

    expect(restored.bodyWeights).toEqual([
      { day: '2026-08-30', kilograms: 75.1 },
      { day: '2026-09-01', kilograms: 74.2 },
    ])
  })
})
