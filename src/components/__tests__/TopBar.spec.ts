import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import TopBar from '../TopBar.vue'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/seances', component: { template: '<div />' } },
      { path: '/seances/:seanceSlug', component: { template: '<div />' } },
      { path: '/seances/:seanceSlug/exercises/:exerciseSlug', component: { template: '<div />' } },
      { path: '/dashboard', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(path: string) {
  const router = createTestRouter()
  router.push(path)
  await router.isReady()

  return mount(TopBar, { global: { plugins: [router] } })
}

describe('TopBar', () => {
  it('marks "Séances" active on the séance list route', async () => {
    const wrapper = await mountAt('/seances')

    const links = wrapper.findAll('.nav-link')
    expect(links[0]?.classes()).toContain('nav-link--active')
    expect(links[1]?.classes()).not.toContain('nav-link--active')
  })

  it('marks "Séances" active while deep inside a séance/exercise route, not just at the list', async () => {
    const wrapper = await mountAt('/seances/seance-principale/exercises/bench-press')

    const links = wrapper.findAll('.nav-link')
    expect(links[0]?.classes()).toContain('nav-link--active')
    expect(links[1]?.classes()).not.toContain('nav-link--active')
  })

  it('marks "Dashboard" active on the dashboard route', async () => {
    const wrapper = await mountAt('/dashboard')

    const links = wrapper.findAll('.nav-link')
    expect(links[0]?.classes()).not.toContain('nav-link--active')
    expect(links[1]?.classes()).toContain('nav-link--active')
  })

  it('links the brand wordmark back to the séance list', async () => {
    const wrapper = await mountAt('/dashboard')

    expect(wrapper.get('.brand').attributes('href')).toBe('/seances')
  })
})
