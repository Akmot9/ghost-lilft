<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <main>
    <RouterView />
  </main>
</template>

<style scoped>
main {
  display: grid;
  min-height: 100vh;
  padding: 32px 16px;
  place-items: center;
  background:
    radial-gradient(circle at 18% 12%, rgb(125 211 252 / 13%), transparent 28%),
    radial-gradient(circle at 88% 82%, rgb(167 139 250 / 12%), transparent 32%),
    linear-gradient(135deg, #0b1120 0%, #111827 48%, #172033 100%);
}
</style>
