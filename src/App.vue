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
  background:
    radial-gradient(circle at 18% 12%, rgb(125 211 252 / 13%), transparent 28%),
    radial-gradient(circle at 88% 82%, rgb(167 139 250 / 12%), transparent 32%),
    linear-gradient(135deg, #0b1120 0%, #111827 48%, #172033 100%);
}

main {
  display: grid;
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
