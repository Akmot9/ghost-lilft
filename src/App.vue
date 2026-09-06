<script setup lang="ts">
import { RouterView } from 'vue-router'
import TopBar from './components/TopBar.vue'

// seanceStore.init() is awaited in main.ts before the router is installed and
// the app is mounted, so by the time this component ever renders the store is
// already settled (ready, or permanently not — see main.ts's comment). Do not
// re-call init() here: it previously duplicated that gate, which was a no-op
// on success and an undocumented silent retry on failure.
</script>

<template>
  <div class="app-shell">
    <TopBar />
    <main>
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg);
}

main {
  display: grid;
  /* `minmax(0, 1fr)` et pas `auto` : sans lui, la colonne se dimensionne sur
     le contenu le plus large, et un écran un peu chargé fait défiler toute
     l'app latéralement. La coque décide de la largeur, jamais l'écran. */
  grid-template-columns: minmax(0, 1fr);
  flex: 1;
  min-height: calc(100vh - 60px);
  padding: 32px 16px;
  place-items: center;
}

@media (max-width: 680px) {
  main {
    min-height: calc(100vh - 52px);
  }
}

</style>
