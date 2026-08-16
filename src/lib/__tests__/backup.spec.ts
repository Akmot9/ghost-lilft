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
    const restored = parseBackup(serializeBackup(seances, NOW))

    expect(restored).toHaveLength(seances.length)
    expect(restored[0]?.slug).toBe(seances[0]?.slug)
    expect(restored[0]?.name).toBe(seances[0]?.name)

    const source = seances[0]!.exercises[0]!
    const target = restored[0]!.exercises[0]!

    expect(target.slug).toBe(source.slug)
    expect(target.restSeconds).toBe(source.restSeconds)
    expect(target.sets.map((set) => [set.reps, set.weight])).toEqual(
      source.sets.map((set) => [set.reps, set.weight]),
    )
    expect(target.sets[0]?.completedAt.toISOString()).toBe(
      source.sets[0]?.completedAt.toISOString(),
    )
  })

  it('n\'exporte jamais le marqueur de démonstration', () => {
    const seances = scenarios.progression(NOW).map((seance) => ({ ...seance, isDemo: true }))
    const restored = parseBackup(serializeBackup(seances, NOW))

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

    const restored = parseBackup(text)

    expect(restored[0]?.exercises[0]?.sets).toEqual([])
  })

  it('numérote les séries de façon unique sur toute la sauvegarde', () => {
    const restored = parseBackup(serializeBackup(scenarios.stagnation(NOW), NOW))
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
      JSON.stringify({ format: 'ghost-lift-backup', version: 2, seances: [] }),
      'version plus récente',
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
    const restored = parseBackup(text)

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
