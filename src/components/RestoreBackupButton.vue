<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSeanceStore } from '../stores/seances'
import { pickTextFile } from '../lib/fileTransfer'

const seanceStore = useSeanceStore()
const router = useRouter()

// Deux clics plutôt que window.confirm (absent du WebView iOS/macOS).
const confirmRestore = ref(false)
const restoring = ref(false)
const restoreError = ref('')

async function onRestore() {
  restoreError.value = ''

  if (!confirmRestore.value) {
    confirmRestore.value = true
    return
  }

  confirmRestore.value = false
  restoring.value = true

  try {
    const text = await pickTextFile()

    if (text === null) {
      return
    }

    await seanceStore.importBackup(text)
    router.push('/seances')
  } catch (error) {
    restoreError.value =
      error instanceof Error ? error.message : 'Restauration impossible : fichier illisible.'
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <div v-if="!seanceStore.hasRealData" class="restore">
    <button type="button" class="restore-button" :disabled="restoring" @click="onRestore">
      {{
        restoring
          ? 'Restauration…'
          : confirmRestore
            ? 'Confirmer : remplacer les données d’exemple ?'
            : 'Restaurer une sauvegarde'
      }}
    </button>

    <p v-if="restoreError" class="restore-error" role="alert">{{ restoreError }}</p>
  </div>
</template>

<style scoped>
.restore {
  display: grid;
  gap: 8px;
}

.restore-button {
  min-height: 44px;
  padding: 0 16px;
  color: var(--text-strong);
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--pill-radius);
  transition: transform 0.2s var(--ease), border-color 0.2s var(--ease);
}

.restore-button:hover:not(:disabled) {
  transform: scale(1.02);
  border-color: var(--accent);
}

.restore-button:disabled {
  opacity: 0.6;
  cursor: default;
}

.restore-error {
  margin: 0;
  color: var(--blood-text);
}
</style>
