import { describe, expect, it } from 'vitest'
import { scenarios, type ScenarioName } from '../scenarios'
import {
  getPositionalGhost,
  groupIntoSessions,
  isExerciseStagnant,
  isNewRecord,
} from '../../lib/trainingInsights'

// Date fixe : les scénarios sont paramétrés par « maintenant », les tests
// unitaires doivent rester déterministes.
const NOW = new Date('2026-08-15T09:00:00.000Z')

// Chaque scénario place l'exercice qu'il illustre en premier de sa première
// séance : c'est le contrat sur lequel s'appuient les tests e2e.
function subjectOf(name: ScenarioName) {
  const seances = scenarios[name](NOW)
  const seance = seances[0]

  if (!seance) {
    throw new Error(`Le scénario ${name} ne produit aucune séance.`)
  }

  const exercise = seance.exercises[0]

  if (!exercise) {
    throw new Error(`La séance ${seance.slug} ne contient aucun exercice.`)
  }

  return { seance, exercise }
}

const ALL_SCENARIOS = Object.keys(scenarios) as ScenarioName[]

describe('scénarios de test', () => {
  it.each(ALL_SCENARIOS)('%s produit un état exploitable par l\'app', (name) => {
    const seances = scenarios[name](NOW)

    expect(seances.length).toBeGreaterThan(0)

    const slugs = seances.map((seance) => seance.slug)
    expect(new Set(slugs).size).toBe(slugs.length)

    for (const seance of seances) {
      expect(seance.exercises.length).toBeGreaterThan(0)

      // Un scénario n'est pas le programme de démonstration : la bannière
      // « adopter / supprimer » ne doit pas s'afficher par-dessus les tests.
      expect(seance.isDemo).toBe(false)

      const exerciseSlugs = seance.exercises.map((exercise) => exercise.slug)
      expect(new Set(exerciseSlugs).size).toBe(exerciseSlugs.length)
    }
  })

  it.each(ALL_SCENARIOS)('%s date ses séries avant maintenant', (name) => {
    for (const seance of scenarios[name](NOW)) {
      for (const exercise of seance.exercises) {
        for (const set of exercise.sets) {
          expect(set.completedAt.getTime()).toBeLessThanOrEqual(NOW.getTime())
        }
      }
    }
  })

  it('stagnation : l\'exercice est détecté comme stagnant', () => {
    const { exercise } = subjectOf('stagnation')

    expect(isExerciseStagnant(exercise.sets)).toBe(true)
  })

  it('progression : l\'exercice ne stagne pas et son volume monte', () => {
    const { exercise } = subjectOf('progression')

    expect(isExerciseStagnant(exercise.sets)).toBe(false)

    // groupIntoSessions trie de la plus récente à la plus ancienne.
    const volumes = groupIntoSessions(exercise.sets).map((session) => session.volume)

    expect(volumes.length).toBeGreaterThanOrEqual(3)
    for (let index = 0; index < volumes.length - 1; index += 1) {
      expect(volumes[index]).toBeGreaterThan(volumes[index + 1] as number)
    }
  })

  it('record : une série plus lourde que tout l\'historique est un record', () => {
    const { exercise } = subjectOf('record')

    const heaviest = Math.max(...exercise.sets.map((set) => set.weight))
    const nextId = Math.max(...exercise.sets.map((set) => set.id)) + 1
    const attempt = {
      id: nextId,
      reps: 5,
      weight: heaviest + 5,
      completedAt: NOW,
    }

    expect(isNewRecord([...exercise.sets, attempt], nextId)).toBe(true)
  })

  it('debutant : aucune série, donc aucun fantôme', () => {
    const { exercise } = subjectOf('debutant')

    expect(exercise.sets).toEqual([])
    expect(getPositionalGhost(exercise.sets, NOW)).toBeNull()
  })

  it('pyramide : la séance de référence a des charges distinctes par série', () => {
    const { exercise } = subjectOf('pyramide')

    const reference = groupIntoSessions(exercise.sets)[0]

    if (!reference) {
      throw new Error('Le scénario pyramide ne produit aucune séance de référence.')
    }

    const weights = reference.sets.map((set) => set.weight)
    expect(weights.length).toBeGreaterThanOrEqual(3)
    expect(new Set(weights).size).toBe(weights.length)

    // Aucune série n'a encore été loggée aujourd'hui : le fantôme pointe la
    // première série de la séance de référence.
    const ghost = getPositionalGhost(exercise.sets, NOW)

    expect(ghost?.position).toBe(1)
  })
})
