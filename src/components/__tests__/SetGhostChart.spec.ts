import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SetGhostChart from '../SetGhostChart.vue'
import { groupIntoSessions, type ExerciseSet } from '../../lib/trainingInsights'
import { makeSet } from '../../lib/__tests__/testFactories'

function mountChart(sets: ExerciseSet[]) {
  const [latestSession = null, previousSession = null] = groupIntoSessions(sets)

  return mount(SetGhostChart, {
    props: { latestSession, previousSession, weightUnit: 'kg' },
  })
}

const sixSets = [
  makeSet({ id: 1, reps: 10, weight: 55, completedAt: new Date('2026-08-10T18:00:00Z') }),
  makeSet({ id: 2, reps: 9, weight: 60, completedAt: new Date('2026-08-10T18:05:00Z') }),
  makeSet({ id: 3, reps: 8, weight: 65, completedAt: new Date('2026-08-10T18:10:00Z') }),
  makeSet({ id: 4, reps: 10, weight: 60, completedAt: new Date('2026-08-17T18:00:00Z') }),
  makeSet({ id: 5, reps: 9, weight: 66, completedAt: new Date('2026-08-17T18:05:00Z') }),
  makeSet({ id: 6, reps: 8, weight: 72, completedAt: new Date('2026-08-17T18:10:00Z') }),
]

describe('SetGhostChart', () => {
  it('shows three positional pairs, for six columns in total', () => {
    const wrapper = mountChart(sixSets)

    expect(wrapper.findAll('.set-pair')).toHaveLength(3)
    expect(wrapper.findAll('.set-bar')).toHaveLength(6)
    expect(wrapper.findAll('.set-bar--latest')).toHaveLength(3)
    expect(wrapper.findAll('.set-bar--ghost')).toHaveLength(3)
    expect(wrapper.findAll('.set-position').map((position) => position.text())).toEqual([
      'S1',
      'S2',
      'S3',
    ])
  })

  it('keeps only the three working sets when an exported workout also has warm-ups', () => {
    const withWarmups = [
      ...sixSets.slice(0, 3),
      makeSet({ id: 20, reps: 6, weight: 48, completedAt: new Date('2026-08-17T17:45:00Z'), isWarmup: true }),
      makeSet({ id: 21, reps: 7, weight: 56, completedAt: new Date('2026-08-17T17:50:00Z'), isWarmup: true }),
      makeSet({ id: 22, reps: 6, weight: 64, completedAt: new Date('2026-08-17T17:55:00Z'), isWarmup: true }),
      makeSet({ id: 23, reps: 6, weight: 84, completedAt: new Date('2026-08-17T18:00:00Z') }),
      makeSet({ id: 24, reps: 8, weight: 76, completedAt: new Date('2026-08-17T18:05:00Z') }),
      makeSet({ id: 25, reps: 12, weight: 68, completedAt: new Date('2026-08-17T18:10:00Z') }),
    ]

    const wrapper = mountChart(withWarmups)

    expect(wrapper.findAll('.set-bar')).toHaveLength(6)
    expect(
      wrapper.findAll('.set-pair').map((pair) => pair.findAll('.set-bar-value')[0]!.text()),
    ).toEqual(['6 × 84', '8 × 76', '12 × 68'])
    expect(wrapper.text()).not.toContain('6 × 48')
  })

  it('compares sets in workout order instead of storage order', () => {
    const wrapper = mountChart(sixSets)
    const pairs = wrapper.findAll('.set-pair')

    expect(pairs[0]!.findAll('.set-bar-value').map((value) => value.text())).toEqual([
      '10 × 60',
      '10 × 55',
    ])
    expect(pairs[1]!.findAll('.set-bar-value').map((value) => value.text())).toEqual([
      '9 × 66',
      '9 × 60',
    ])
    expect(pairs[2]!.findAll('.set-bar-value').map((value) => value.text())).toEqual([
      '8 × 72',
      '8 × 65',
    ])
  })

  it('uses total weight for the scale and labels its heaviest column at 100%', () => {
    const wrapper = mountChart(sixSets)
    const heaviestBar = wrapper.findAll('.set-bar--latest')[2]!

    expect(heaviestBar.attributes('style')).toContain('height: 100%')
    expect(heaviestBar.attributes('aria-label')).toBe(
      'Série 3, dernière séance : 8 répétitions à 72 kg',
    )
    expect(wrapper.text()).toContain('Charge totale par position')
  })

  it('keeps ghost positions visible while the latest workout is incomplete', () => {
    const wrapper = mountChart([
      ...sixSets.slice(0, 3),
      makeSet({ id: 7, reps: 10, weight: 62, completedAt: new Date('2026-08-17T18:00:00Z') }),
    ])

    expect(wrapper.findAll('.set-pair')).toHaveLength(3)
    expect(wrapper.findAll('.set-bar--latest')).toHaveLength(1)
    expect(wrapper.findAll('.set-bar--ghost')).toHaveLength(3)
    expect(wrapper.findAll('.set-bar-value--empty')).toHaveLength(2)
  })

  it('explains when the first workout does not have a ghost yet', () => {
    const wrapper = mountChart(sixSets.slice(3))

    expect(wrapper.findAll('.set-bar--latest')).toHaveLength(3)
    expect(wrapper.findAll('.set-bar--ghost')).toHaveLength(0)
    expect(wrapper.get('.set-ghost-note').text()).toContain('après une deuxième séance')
  })

  it('shows an empty state before the first set', () => {
    const wrapper = mountChart([])

    expect(wrapper.find('.set-ghost-chart').exists()).toBe(false)
    expect(wrapper.get('.set-ghost-empty').text()).toContain('Enregistre une première série')
  })
})
