import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WeeklyVolumeGraph from '../WeeklyVolumeGraph.vue'
import type { ExerciseSet } from '../../lib/trainingInsights'

function set(id: number, date: string, reps: number, weight: number): ExerciseSet {
  return { id, reps, weight, completedAt: new Date(date) }
}

function mountGraph(sets: ExerciseSet[]) {
  return mount(WeeklyVolumeGraph, { props: { sets, weightUnit: 'kg' } })
}

describe('WeeklyVolumeGraph', () => {
  it('ne montre aucun graphe tant qu’aucune série n’est enregistrée', () => {
    const wrapper = mountGraph([])

    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.text()).toContain('Ajoute des séries')
  })

  it('annonce l’attente plutôt que de tracer une tendance sur une seule semaine', () => {
    // L'échelle est ancrée à zéro : une valeur unique vaut 100 % de la hauteur
    // et se dessine tout en haut du cadre, le reste restant vide. Le résultat
    // ressemble à une panne — c'est l'état de tout nouvel utilisateur, et donc
    // celui que voit un reviewer App Store.
    const wrapper = mountGraph([
      set(1, '2026-08-10T18:00:00.000Z', 8, 60),
      set(2, '2026-08-11T18:00:00.000Z', 8, 60),
    ])

    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.text()).toContain('deuxième semaine')
  })

  it('trace la tendance dès la deuxième semaine', () => {
    const wrapper = mountGraph([
      set(1, '2026-08-03T18:00:00.000Z', 10, 50),
      set(2, '2026-08-10T18:00:00.000Z', 10, 60),
    ])

    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.findAll('.close-tick')).toHaveLength(2)
  })

  it('garde une échelle ancrée à zéro quand les volumes diffèrent', () => {
    const wrapper = mountGraph([
      set(1, '2026-07-27T18:00:00.000Z', 10, 40),
      set(2, '2026-08-03T18:00:00.000Z', 10, 60),
      set(3, '2026-08-10T18:00:00.000Z', 10, 80),
    ])

    const ys = wrapper.findAll('.close-tick').map((tick) => Number(tick.attributes('y1')))

    // Hauteur 260, marges 18 en haut et 42 en bas : le plus gros volume touche
    // le haut, et l'ancrage à zéro laisse volontairement de l'air en dessous du
    // plus petit — c'est une échelle honnête, pas un bug.
    expect(Math.min(...ys)).toBe(18)
    expect(ys).toHaveLength(3)
  })

  it('reste lisible quand le volume ne bouge pas d’une semaine à l’autre', () => {
    // La stagnation est la raison d'être de l'app : le graphe doit la montrer,
    // pas la faire disparaître.
    const wrapper = mountGraph([
      set(1, '2026-07-27T18:00:00.000Z', 10, 50),
      set(2, '2026-08-03T18:00:00.000Z', 10, 50),
      set(3, '2026-08-10T18:00:00.000Z', 10, 50),
    ])

    const ys = wrapper.findAll('.close-tick').map((tick) => Number(tick.attributes('y1')))

    expect(ys).toHaveLength(3)
    expect(new Set(ys).size).toBe(1)
  })
})
