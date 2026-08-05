import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { useSeanceStore } from './stores/seances'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import './assets/main.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// The router's initial navigation resolves synchronously (including the "/"
// redirect, which reads seanceStore.hasOnboarded) as soon as the router is
// installed — well before App.vue's onMounted hook would get a chance to run
// seanceStore.init(). Awaiting init() here first prevents a returning user
// (whose séances live in SQLite) from racing the redirect and being sent to
// /onboarding before their data has loaded.
useSeanceStore(pinia)
  .init()
  .catch((error) => {
    console.error('Échec du chargement initial des données', error)
  })
  .finally(() => {
    app.use(router)
    app.mount('#app')
  })
