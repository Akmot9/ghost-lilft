import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SeanceOverview from '../SeanceOverview.vue'
import { makeSet } from '../../lib/__tests__/testFactories'

const day = (date: string, minute = 0) => new Date(`${date}T18:${String(minute).padStart(2, '0')}:00Z`)

function mountOverview(exercises: Parameters<typeof SeanceOverview>[0]['exercises']) {
  return mount(SeanceOverview, { props: { exercises } })
}

describe('SeanceOverview', () => {
  it('invites to log sets when the séance has no history', () => {
    const wrapper = mountOverview([{ slug: 'squat', name: 'Squat', weightUnit: 'kg', sets: [] }])

    expect(wrapper.get('.overview-empty').text()).toContain('Enregistre des séries')
    expect(wrapper.find('.overview-stats').exists()).toBe(false)
  })

  it('compares the latest séance to the previous one, exercise by exercise', () => {
    const wrapper = mountOverview([
      {
        slug: 'squat',
        name: 'Squat',
        weightUnit: 'kg',
        sets: [
          makeSet({ id: 1, reps: 5, weight: 100, completedAt: day('2026-04-20') }),
          makeSet({ id: 2, reps: 5, weight: 110, completedAt: day('2026-04-27') }),
        ],
      },
      {
        slug: 'presse',
        name: 'Presse',
        weightUnit: 'kg',
        sets: [makeSet({ id: 3, reps: 10, weight: 150, completedAt: day('2026-04-20', 20) })],
      },
      { slug: 'curl', name: 'Curl', weightUnit: 'kg', sets: [] },
    ])

    const tiles = wrapper.findAll('.stat-tile')
    expect(tiles[0]!.get('strong').text()).toBe('550 kg')
    // Intl fr-FR sépare les milliers d'une espace fine insécable.
    expect(tiles[0]!.get('.stat-delta').text()).toBe('−1\u202f450 kg')
    expect(tiles[0]!.get('.stat-delta').classes()).toContain('negative')
    expect(tiles[1]!.get('strong').text()).toBe('1 / 2')
    // Le troisième exercice, jamais fait, n'entre pas dans la comparaison.
    expect(wrapper.findAll('.exercise-volume')[2]!.find('.exercise-volume-delta').exists()).toBe(false)
    expect(tiles[2]!.get('strong').text()).toBe('2')

    const rows = wrapper.findAll('.exercise-volume')
    expect(rows[0]!.get('.exercise-volume-values strong').text()).toBe('550 kg')
    expect(rows[0]!.get('.exercise-volume-delta').text()).toBe('+50 kg')
    expect(rows[0]!.get('.exercise-volume-delta').classes()).toContain('positive')
    expect(rows[1]!.get('.skipped').text()).toBe('non fait')
    expect(rows[1]!.classes()).toContain('exercise-volume--skipped')
    expect(rows[1]!.find('.volume-bar--latest').exists()).toBe(false)
    expect(rows[1]!.find('.volume-bar--ghost').exists()).toBe(true)

    // Même échelle pour toutes les barres : la presse (1500) fixe le maximum.
    expect(rows[1]!.get('.volume-bar--ghost').attributes('style')).toContain('width: 100%')
    expect(rows[0]!.get('.volume-bar--latest').attributes('style')).toMatch(/width: 36\.6/)
  })

  it('announces the ghost to come after a single séance', () => {
    const wrapper = mountOverview([
      {
        slug: 'squat',
        name: 'Squat',
        weightUnit: 'kg',
        sets: [makeSet({ id: 1, reps: 5, weight: 100, completedAt: day('2026-04-20') })],
      },
    ])

    expect(wrapper.findAll('.stat-tile')[0]!.get('.stat-delta').text()).toBe('première séance')
    expect(wrapper.get('.overview-note').text()).toContain('deuxième séance')
    expect(wrapper.findAll('.legend-swatch--ghost')).toHaveLength(0)
  })
})
