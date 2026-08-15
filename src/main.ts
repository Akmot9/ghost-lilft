import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { useSeanceStore } from './stores/seances'
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
  .then(() => {
    app.use(router)
    app.mount('#app')
  })
  .catch((error) => {
    // Monter quand même laisserait l'app démarrer avec une liste de séances
    // vide et sans le dire : `hasRealData` serait faux, le bouton « Restaurer
    // une sauvegarde » s'afficherait, et un import écraserait un fichier que
    // l'app n'a en réalité jamais réussi à lire. Une base illisible doit
    // produire quelque chose de visible, pas une app qui fait semblant de
    // fonctionner. En navigateur (tests e2e compris), `init()` retombe
    // toujours sur la mémoire et réussit : cette branche n'y est jamais prise.
    console.error('Échec du chargement initial des données', error)

    const root = document.querySelector('#app')
    if (root) {
      root.textContent =
        "Impossible de charger vos données. Redémarrez l'application ; si le problème persiste, contactez le support."
    }
  })
