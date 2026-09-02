<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSeanceStore } from '../stores/seances'
import { pickTextFile } from '../lib/fileTransfer'
import { toAppError } from '../lib/appApi'

const props = withDefaults(
  defineProps<{
    /**
     * Incrémenté par le parent quand un bouton voisin s'arme : deux
     * confirmations aux effets opposés ne doivent jamais être armées en
     * même temps (#57).
     */
    disarmSignal?: number
  }>(),
  { disarmSignal: 0 },
)
const emit = defineEmits<{
  /** Ce bouton vient de s'armer : au parent de désarmer les voisins. */
  armed: []
}>()

const seanceStore = useSeanceStore()
const router = useRouter()

// Deux clics plutôt que window.confirm (absent du WebView iOS/macOS).
const confirmRestore = ref(false)
const restoring = ref(false)
const restoreError = ref('')

watch(
  () => props.disarmSignal,
  () => {
    confirmRestore.value = false
  },
)

async function onRestore() {
  restoreError.value = ''

  if (!confirmRestore.value) {
    confirmRestore.value = true
    emit('armed')
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
    // `toAppError` reconnaît l'AppError du contrat, l'Error du parseur et la
    // chaîne brute d'une commande pas encore migrée : le message soigné écrit
    // côté Rust arrive enfin à l'écran (#57).
    restoreError.value = toAppError(error).message
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <div v-if="!seanceStore.hasRealData" class="restore">
    <button type="button" class="data-action-button" :disabled="restoring" @click="onRestore">
      {{
        restoring
          ? 'Restauration…'
          : confirmRestore
            ? 'Confirmer : remplacer les données d’exemple ?'
            : 'Restaurer une sauvegarde'
      }}
    </button>

    <p v-if="restoreError" class="data-action-error" role="alert">{{ restoreError }}</p>
  </div>
</template>

<style scoped>
.restore {
  display: grid;
  gap: 8px;
}
</style>
