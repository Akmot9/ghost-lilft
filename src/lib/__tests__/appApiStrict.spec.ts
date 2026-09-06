import { describe, expect, it } from 'vitest'
import { createStrictAppApi } from '../appApiStrict'

describe('createStrictAppApi', () => {
  it('answers what the test taught it', async () => {
    const api = createStrictAppApi({ renameSeance: async () => ({ slug: 'a', name: 'A', isDemo: false, exercises: [] }) })

    await expect(api.renameSeance('a', 'A')).resolves.toMatchObject({ slug: 'a' })
  })

  it('refuses a call the test did not expect, naming it', () => {
    const api = createStrictAppApi()

    expect(() => api.deleteDemoData()).toThrow('Appel inattendu à AppApi.deleteDemoData')
  })

  it('does not pass itself off as a promise', async () => {
    await expect(Promise.resolve(createStrictAppApi())).resolves.toBeDefined()
  })
})
