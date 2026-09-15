import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createStrictAppApi } from '../../lib/appApiStrict'
import { useAppApiForTests, useSeanceStore } from '../seances'

/**
 * Pinia est une **projection** des réponses de Rust, pas un second état qui
 * anticipe (#72). La preuve tient en une phrase : quand une commande échoue,
 * l'écran doit montrer exactement ce qu'il montrait avant.
 *
 * Le faux est strict (#67) : il ne répond qu'à ce que le test lui apprend, et
 * jette sur tout appel parasite. Un store qui écrirait dans son cache sans
 * passer par le backend, ou qui appellerait une autre commande en chemin,
 * échouerait ici.
 */
const scope = globalThis as unknown as { isTauri?: boolean }
let restoreAppApi = () => {}

beforeEach(() => {
  setActivePinia(createPinia())
  scope.isTauri = true
})

afterEach(() => {
  restoreAppApi()
  delete scope.isTauri
})

describe('a rejected command leaves the Pinia cache untouched', () => {
  it('keeps the previous name when renaming fails', async () => {
    restoreAppApi = useAppApiForTests(
      createStrictAppApi({
        renameSeance: async () => {
          throw new Error('stockage-indisponible')
        },
      }),
    )
    const store = useSeanceStore()
    store.seances = [
      { slug: 'upper-a', name: 'Upper A', isDemo: false, exercises: [] },
    ]

    await expect(store.renameSeance('upper-a', 'Haut du corps')).rejects.toThrow()

    expect(store.findSeanceBySlug('upper-a')?.name).toBe('Upper A')
  })

  it('keeps the exercise when its removal fails', async () => {
    restoreAppApi = useAppApiForTests(
      createStrictAppApi({
        removeExercise: async () => {
          throw new Error('stockage-indisponible')
        },
      }),
    )
    const store = useSeanceStore()
    store.seances = [
      {
        slug: 'upper-a',
        name: 'Upper A',
        isDemo: false,
        exercises: [
          {
            slug: 'squat',
            name: 'Squat',
            defaultReps: 5,
            defaultWeight: 100,
            weightUnit: 'kg',
            restSeconds: 180,
            sets: [],
          },
        ],
      },
    ]

    await expect(store.removeExercise('upper-a', 'squat')).rejects.toThrow()

    expect(store.findExercise('upper-a', 'squat')).not.toBeNull()
  })
})
