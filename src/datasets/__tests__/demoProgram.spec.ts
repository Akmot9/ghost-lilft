import { describe, expect, it } from 'vitest'
import { createDemoSeances } from '../demoProgram'
import { getWeekStart, isExerciseStagnant, type ExerciseSet } from '../../lib/trainingInsights'
import type { Seance } from '../../stores/seances'

const NOW = new Date('2026-08-16T09:00:00.000Z')

const program = createDemoSeances(NOW)

function seance(slug: string): Seance {
  const found = program.find((candidate) => candidate.slug === slug)

  if (!found) {
    throw new Error(`Séance ${slug} absente du programme de démonstration.`)
  }

  return found
}

/** Volume total par semaine, de la plus ancienne à la plus récente. */
function weeklyVolumes(sets: ExerciseSet[]): number[] {
  const totals = new Map<string, number>()

  for (const set of sets) {
    const key = getWeekStart(set.completedAt).toISOString().slice(0, 10)
    totals.set(key, (totals.get(key) ?? 0) + set.reps * set.weight)
  }

  return Array.from(totals.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([, volume]) => volume)
}

function allSetsOf(target: Seance): ExerciseSet[] {
  return target.exercises.flatMap((exercise) => exercise.sets)
}

describe('programme de démonstration', () => {
  it('livre les trois séances du programme de départ, marquées démo', () => {
    expect(program.map((item) => item.slug)).toEqual(['upper-a', 'lower', 'upper-b'])
    expect(program.every((item) => item.isDemo)).toBe(true)
  })

  it('date tout l’historique dans le passé', () => {
    for (const set of program.flatMap(allSetsOf)) {
      expect(set.completedAt.getTime()).toBeLessThanOrEqual(NOW.getTime())
    }
  })

  it('couvre au moins huit semaines', () => {
    const semaines = new Set(
      program
        .flatMap(allSetsOf)
        .map((set) => getWeekStart(set.completedAt).toISOString().slice(0, 10)),
    )

    expect(semaines.size).toBeGreaterThanOrEqual(8)
  })

  it('numérote les séries de façon unique sur tout le programme', () => {
    // `sets.id` est une clé primaire globale : plusieurs exercices porteurs
    // d'historique entreraient en collision si chacun repartait de 1, et le
    // semis avorterait au deuxième.
    const ids = program.flatMap(allSetsOf).map((set) => set.id)

    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('laisse des exercices sans historique, comme un vrai carnet', () => {
    const sansHistorique = program
      .flatMap((item) => item.exercises)
      .filter((exercise) => exercise.sets.length === 0)

    expect(sansHistorique.length).toBeGreaterThan(0)
  })

  it('Upper A raconte une progression franche', () => {
    const volumes = weeklyVolumes(allSetsOf(seance('upper-a')))

    expect(volumes.length).toBeGreaterThanOrEqual(8)
    for (let index = 1; index < volumes.length; index += 1) {
      expect(volumes[index]).toBeGreaterThan(volumes[index - 1] as number)
    }
  })

  it('Lower fait stagner un exercice, pour alimenter l’alerte du dashboard', () => {
    const stagnants = seance('lower').exercises.filter((exercise) =>
      isExerciseStagnant(exercise.sets),
    )

    expect(stagnants.length).toBeGreaterThanOrEqual(1)
  })

  it('Upper B traverse une semaine en baisse, puis repart', () => {
    const volumes = weeklyVolumes(allSetsOf(seance('upper-b')))
    const creux = volumes.findIndex(
      (volume, index) => index > 0 && volume < (volumes[index - 1] as number),
    )

    expect(creux).toBeGreaterThan(0)
    // La reprise : le volume final dépasse celui d'avant le creux.
    expect(volumes[volumes.length - 1]).toBeGreaterThan(volumes[creux - 1] as number)
  })

  it('aucun exercice ne stagne dans Upper A', () => {
    // La progression franche ne doit pas déclencher d'alerte : sinon le
    // dashboard signale tout, donc plus rien.
    const stagnants = seance('upper-a').exercises.filter((exercise) =>
      isExerciseStagnant(exercise.sets),
    )

    expect(stagnants).toEqual([])
  })
})
