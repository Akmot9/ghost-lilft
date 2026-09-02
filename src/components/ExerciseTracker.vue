<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import SessionDiff from './SessionDiff.vue'
import SetGhostChart from './SetGhostChart.vue'
import WeeklyVolumeGraph from './WeeklyVolumeGraph.vue'
import {
  cancelRestEndNotification,
  scheduleRestEndNotification,
} from '../lib/restNotification'
import {
  getDateKey,
  getPositionalGhost,
  getSuggestedTarget,
  getWeekStart,
  groupIntoSessions,
  isExerciseStagnant,
  isNewRecord,
  compareSetToGhost,
  suggestWarmupRamp,
  type RampStep,
  type SetComparison,
  type ExerciseSet,
} from '../lib/trainingInsights'

const props = withDefaults(
  defineProps<{
    exerciseName: string
    // Identifiant stable de l'exercice, utilisé pour ranger le repos en cours.
    // Deux séances peuvent contenir un exercice du même nom (les slugs ne sont
    // uniques qu'au sein d'une séance) : sans clé propre, elles partageraient
    // le même chrono. À défaut, le nom sert de repli.
    restKey?: string
    sets?: ExerciseSet[]
    defaultReps?: number
    defaultWeight?: number
    weightUnit?: string
    restSeconds?: number
    isDumbbell?: boolean
    /**
     * Premier exercice de la séance : le seul où le programme prescrit une
     * gamme montante calculée. Sur les autres, la première série légère est
     * une série de travail, pas un échauffement.
     */
    isFirstInSeance?: boolean
    /** Compte rendu du dernier import, ou message d'erreur. */
    importReport?: string
  }>(),
  {
    sets: () => [],
    defaultReps: 5,
    defaultWeight: 60,
    weightUnit: 'kg',
    restSeconds: 180,
    isDumbbell: false,
    isFirstInSeance: false,
  },
)
const emit = defineEmits<{
  addSet: [set: ExerciseSet]
  removeSet: [setId: number]
  clearSets: []
  exportSets: []
  importSets: []
  'update:isDumbbell': [isDumbbell: boolean]
  setWarmup: [setId: number, isWarmup: boolean]
  updateSet: [setId: number, changes: { reps: number; weight: number; rpe: number | null }]
}>()

const sessions = computed(() => groupIntoSessions(props.sets))
const sortedSets = computed(() => sessions.value.flatMap((session) => session.sets))
const sortedAllSets = computed(() =>
  [...props.sets].sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime()),
)
// L'export réel peut contenir plusieurs gammes montantes avant S1/S2/S3. On
// garde donc assez de lignes visibles pour pouvoir corriger ces anciennes
// séries directement, sans que les échauffements disparaissent du carnet.
const visibleSetCount = ref(12)
const visibleSets = computed(() => sortedAllSets.value.slice(0, visibleSetCount.value))
const hasMoreSets = computed(() => visibleSetCount.value < sortedAllSets.value.length)
const latestSession = computed(() => sessions.value[0] ?? null)
const previousSession = computed(() => sessions.value[1] ?? null)

// Numéro (S1, S2, S3…) de chaque série de travail dans sa séance : c'est le
// repère du fantôme positionnel, et le carnet l'affiche pour que le lifteur
// retrouve « sa » série sans compter.
const setPositions = computed(() => {
  const positions = new Map<number, number>()

  for (const session of sessions.value) {
    // session.sets va de la plus récente à la plus ancienne.
    session.sets.forEach((set, index) => positions.set(set.id, session.sets.length - index))
  }

  return positions
})

function setKindLabel(set: ExerciseSet) {
  if (set.isWarmup) {
    return 'Échauffement'
  }

  const position = setPositions.value.get(set.id)

  return position ? `S${position}` : 'Travail'
}

const warmupSets = computed(() => sortedAllSets.value.filter((set) => set.isWarmup))

// La montée en charge du jour, dans l'ordre réalisé, et celle de la dernière
// journée où l'exercice a été échauffé : le lifteur voit d'un coup d'œil s'il
// suit sa rampe habituelle.
function warmupRampOn(dateKey: string | undefined) {
  return dateKey
    ? warmupSets.value.filter((set) => getDateKey(set.completedAt) === dateKey).reverse()
    : []
}

const todayWarmups = computed(() => warmupRampOn(getDateKey(new Date())))
const previousWarmups = computed(() => {
  const today = getDateKey(new Date())
  const previousDay = warmupSets.value
    .map((set) => getDateKey(set.completedAt))
    .find((key) => key !== today)

  return warmupRampOn(previousDay)
})

// « Cette semaine » : la semaine de la série la plus récente de la liste. Les
// totaux de travail et d'échauffement ont chacun la leur — un échauffement
// saisi une semaine sans série de travail ne doit pas remettre à zéro le
// volume de travail affiché.
function latestWeekOf(sortedList: ExerciseSet[]) {
  const latestSet = sortedList[0]

  if (!latestSet) {
    return []
  }

  const latestWeekStart = getWeekStart(latestSet.completedAt).getTime()

  return sortedList.filter((set) => getWeekStart(set.completedAt).getTime() === latestWeekStart)
}

const latestWeekSets = computed(() => latestWeekOf(sortedSets.value))
const latestWeekWarmups = computed(() => latestWeekOf(warmupSets.value))
const warmupWeeklyVolume = computed(() =>
  latestWeekWarmups.value.reduce((total, set) => total + set.reps * set.weight, 0),
)
const warmupHeaviest = computed(() =>
  latestWeekWarmups.value.reduce<ExerciseSet | null>(
    (heaviest, set) => (!heaviest || set.weight > heaviest.weight ? set : heaviest),
    null,
  ),
)
const weeklyReps = computed(() => latestWeekSets.value.reduce((total, set) => total + set.reps, 0))
const weeklyVolume = computed(() =>
  latestWeekSets.value.reduce((total, set) => total + set.reps * set.weight, 0),
)
const heaviestSet = computed(() =>
  latestWeekSets.value.reduce<ExerciseSet | null>(
    (heaviest, set) => (!heaviest || set.weight > heaviest.weight ? set : heaviest),
    null,
  ),
)

// Fantôme positionnel : la N-ième série du jour se mesure à la N-ième série
// de la séance précédente (les schémas pyramidaux se reproduisent série par
// série). Recalculé après chaque ajout : au retour du repos, le formulaire
// propose la série suivante.
const ghost = computed(() => getPositionalGhost(props.sets, new Date(), sessions.value))
const suggestedTarget = computed(() =>
  getSuggestedTarget(props.sets, { weight: props.defaultWeight, reps: props.defaultReps }, ghost.value),
)
// Passing the already-computed sessions avoids isExerciseStagnant() re-running
// groupIntoSessions() on props.sets a second time on every set logged.
const isStagnant = computed(() => isExerciseStagnant(props.sets, sessions.value))

// La gamme montante proposée : celle de la dernière fois si le lifteur en a
// une (c'est son habitude, comme le fantôme), sinon celle du programme —
// barre à vide, puis paliers croissants à répétitions décroissantes jusqu'à
// une dernière série possible à une seule répétition, avant la charge de
// travail visée. Le programme la réserve au premier exercice de la séance :
// ailleurs, sans historique, rien n'est proposé.
const suggestedRamp = computed<RampStep[]>(() => {
  if (previousWarmups.value.length > 0) {
    return previousWarmups.value.map(({ weight, reps }) => ({ weight, reps }))
  }

  if (!props.isFirstInSeance) {
    return []
  }

  return suggestWarmupRamp(suggestedTarget.value, {
    isDumbbell: props.isDumbbell,
    weightUnit: props.weightUnit,
  })
})
const rampSource = computed(() =>
  previousWarmups.value.length > 0 ? 'd’après la dernière fois' : 'd’après l’objectif de travail',
)
// La prochaine marche à faire, une fois retirées celles déjà faites aujourd'hui.
const nextRampIndex = computed(() => todayWarmups.value.length)

// L'historique, le fantôme et la cible restent en charge totale. Seul le champ
// de saisie parle en poids d'un haltère.
function toInputWeight(totalWeight: number) {
  return props.isDumbbell ? totalWeight / 2 : totalWeight
}

function isHalfKiloStep(value: number) {
  return Number.isFinite(value) && Number.isInteger(value * 2)
}

const reps = ref(suggestedTarget.value.reps)
const weight = ref(toInputWeight(suggestedTarget.value.weight))
const isWarmup = ref(false)

/**
 * Effort perçu de la série qu'on s'apprête à saisir. Trois crans suffisent
 * pour piloter la surcharge : facile (RPE 7, au moins 3 reps en réserve),
 * dur (RPE 8, 2 en réserve), limite (RPE 9-10, 1 ou zéro). Optionnel —
 * une série non notée reste non notée, et l'échauffement ne se note pas.
 */
const RPE_CHOICES = [
  { label: 'Facile', value: 7 },
  { label: 'Dur', value: 8 },
  { label: 'Limite', value: 9 },
] as const
const rpe = ref<number | null>(null)

function toggleRpe(value: number) {
  rpe.value = rpe.value === value ? null : value
}

watch(suggestedTarget, (target) => {
  // Une gamme montante se saisit librement. Elle ne doit pas être remplacée
  // par S1 chaque fois qu'une nouvelle série d'échauffement est enregistrée.
  if (isWarmup.value) {
    return
  }

  reps.value = target.reps
  weight.value = toInputWeight(target.weight)
})

const totalWeight = computed(() => {
  if (!Number.isFinite(weight.value)) {
    return 0
  }

  return props.isDumbbell ? weight.value * 2 : weight.value
})

function toggleDumbbell() {
  const next = !props.isDumbbell

  // La charge effective ne bouge pas : seul le référentiel de saisie change.
  // Un total impair donne un demi-kilo par haltère, jamais arrondi.
  if (Number.isFinite(weight.value)) {
    weight.value = next ? weight.value / 2 : weight.value * 2
  }

  emit('update:isDumbbell', next)
}

function fillRampStep(step: RampStep | undefined) {
  if (!step) {
    return
  }

  reps.value = step.reps
  weight.value = toInputWeight(step.weight)
}

function setWarmupMode(warmup: boolean) {
  if (isWarmup.value === warmup) {
    return
  }

  isWarmup.value = warmup

  if (warmup) {
    // Deux interactions maximum pour logger : la marche suivante de la rampe
    // est déjà dans le formulaire, il n'y a qu'à ajuster.
    fillRampStep(suggestedRamp.value[nextRampIndex.value])
    return
  }

  // En revenant au travail, on remet précisément la série pyramidale encore
  // attendue. Les échauffements n'ont pas avancé le fantôme positionnel.
  reps.value = suggestedTarget.value.reps
  weight.value = toInputWeight(suggestedTarget.value.weight)
}

// Le panneau de repos garde la couleur de la série qui vient d'être faite,
// même si le mode est changé pendant le repos.
const lastSetWasWarmup = ref(false)

// La dernière série de travail ajoutée, repérée par sa date : sous Tauri,
// l'identifiant définitif est attribué par SQLite et ne correspond pas à
// celui fabriqué ici — la date, elle, est la même des deux côtés.
const lastAddedSetAt = ref<number | null>(null)
/**
 * Verdict de la série qu'on vient de valider, face à son homologue de la
 * séance précédente. Capturé au moment de la validation : le fantôme se
 * déplace ensuite vers la série suivante.
 */
const lastVerdict = ref<(SetComparison & { position: number }) | null>(null)

const verdictLabel = computed(() => {
  const verdict = lastVerdict.value

  if (!verdict) {
    return ''
  }

  if (verdict.outcome === 'equal') {
    return `Série ${verdict.position} identique à la dernière séance`
  }

  const morceaux: string[] = []

  if (verdict.weightDelta !== 0) {
    morceaux.push(`${verdict.weightDelta > 0 ? '+' : '−'}${Math.abs(verdict.weightDelta)} ${props.weightUnit}`)
  }

  if (verdict.repsDelta !== 0) {
    const pluriel = Math.abs(verdict.repsDelta) > 1 ? 'reps' : 'rep'
    morceaux.push(`${verdict.repsDelta > 0 ? '+' : '−'}${Math.abs(verdict.repsDelta)} ${pluriel}`)
  }

  return `${morceaux.join(', ')} sur la série ${verdict.position}`
})
const isLatestSetNewRecord = computed(
  () => {
    if (lastAddedSetAt.value === null) {
      return false
    }

    const added = props.sets.find((set) => set.completedAt.getTime() === lastAddedSetAt.value)

    return added !== undefined && isNewRecord(props.sets, added.id)
  },
)

// Le repos se mesure sur l'horloge murale (une échéance absolue), jamais sur un
// compteur décrémenté à chaque tick : en arrière-plan, le WebView iOS/Android
// gèle setInterval, et le chrono repartait alors d'où il s'était arrêté — il
// « bloquait » tant que l'app n'était pas ré-ouverte. Ici le tick ne fait que
// relire l'horloge, donc le temps passé hors de l'app est décompté.
const isResting = ref(false)
const restSecondsRemaining = ref(0)
const restEndsAt = ref<number | null>(null)
let restIntervalId: ReturnType<typeof setInterval> | null = null

// Un tick sous la seconde évite qu'un réveil décalé fasse « sauter » l'affichage.
const REST_TICK_MS = 250
// Entre deux marches d'une gamme montante, on ne récupère pas d'un effort :
// on enchaîne. Le repos de l'exercice (2' à 2'30 dans le programme) est fait
// pour les séries de travail.
const WARMUP_REST_SECONDS = 60
// L'échéance est persistée pour survivre à une fermeture complète de l'app :
// au retour sur l'exercice, le repos reprend là où l'horloge en est vraiment.
const REST_STORAGE_PREFIX = 'ghost-lift:rest:'
const restStorageKey = computed(() => `${REST_STORAGE_PREFIX}${props.restKey ?? props.exerciseName}`)

type StoredRest = { endsAt: number; warmup: boolean }

// La nature du repos (travail ou échauffement) voyage avec l'échéance : à la
// reprise, le panneau retrouve sa couleur et sa durée d'origine. Les anciennes
// valeurs — l'échéance seule, en chiffres — se lisent encore comme du travail.
function readStoredRest(): StoredRest | null {
  try {
    const raw = localStorage.getItem(restStorageKey.value)

    if (raw === null) {
      return null
    }

    const asNumber = Number(raw)

    if (Number.isFinite(asNumber)) {
      return { endsAt: asNumber, warmup: false }
    }

    const parsed: unknown = JSON.parse(raw)

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Number.isFinite((parsed as StoredRest).endsAt)
    ) {
      return { endsAt: (parsed as StoredRest).endsAt, warmup: Boolean((parsed as StoredRest).warmup) }
    }

    return null
  } catch {
    // Stockage indisponible (WebView restreint) ou contenu illisible : le
    // repos reste en mémoire.
    return null
  }
}

function persistRestEndsAt(endsAt: number | null) {
  try {
    if (endsAt === null) {
      localStorage.removeItem(restStorageKey.value)
    } else {
      const stored: StoredRest = { endsAt, warmup: lastSetWasWarmup.value }
      localStorage.setItem(restStorageKey.value, JSON.stringify(stored))
    }
  } catch {
    // Idem : l'absence de persistance ne doit pas casser le chrono en cours.
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat('fr', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatCompletedAt(date: Date) {
  return dateTimeFormatter.format(date)
}

function formatRestTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function clearRestInterval() {
  if (restIntervalId !== null) {
    clearInterval(restIntervalId)
    restIntervalId = null
  }
}

// Relit l'horloge : seul point qui écrit le compte à rebours affiché.
function syncRest() {
  if (restEndsAt.value === null) {
    return
  }

  const remaining = Math.ceil((restEndsAt.value - Date.now()) / 1000)

  if (remaining <= 0) {
    finishRest()
    return
  }

  restSecondsRemaining.value = remaining
}

function startRest(endsAt: number = Date.now() + props.restSeconds * 1000) {
  clearRestInterval()
  restEndsAt.value = endsAt
  persistRestEndsAt(endsAt)
  isResting.value = true
  syncRest()

  // syncRest() a pu terminer le repos immédiatement (échéance déjà passée).
  if (isResting.value) {
    restIntervalId = setInterval(syncRest, REST_TICK_MS)
    // La notification sonne à l'échéance, même téléphone verrouillé — le
    // repos se mesure sur l'horloge murale, elle aussi.
    void scheduleRestEndNotification(new Date(endsAt), props.exerciseName)
  }
}

// Arrête le repos côté composant sans toucher à l'échéance persistée.
function stopRest() {
  clearRestInterval()
  isResting.value = false
  restEndsAt.value = null
  restSecondsRemaining.value = 0
  lastAddedSetAt.value = null
  lastVerdict.value = null
}

function finishRest() {
  persistRestEndsAt(null)
  stopRest()
  // Repos fini à l'écran (échéance atteinte ou passée en avance) : la
  // notification n'a plus rien à annoncer.
  void cancelRestEndNotification()
}

function skipRest() {
  finishRest()
}

function adjustRest(deltaSeconds: number) {
  if (restEndsAt.value === null) {
    return
  }

  const endsAt = restEndsAt.value + deltaSeconds * 1000

  if (endsAt <= Date.now()) {
    finishRest()
    return
  }

  restEndsAt.value = endsAt
  persistRestEndsAt(endsAt)
  syncRest()
  // −15 s / +15 s déplacent l'échéance : la notification suit.
  void scheduleRestEndNotification(new Date(endsAt), props.exerciseName)
}

// Reprend un repos entamé avant une fermeture de l'app (ou avant un changement
// d'exercice) tant que son échéance n'est pas dépassée.
function restoreRest() {
  const stored = readStoredRest()

  if (stored === null) {
    return
  }

  if (stored.endsAt <= Date.now()) {
    persistRestEndsAt(null)
    return
  }

  lastSetWasWarmup.value = stored.warmup
  startRest(stored.endsAt)
}

// Au retour au premier plan, le tick a pu être gelé (voire perdu) : on relit
// l'horloge et on s'assure que le ticker tourne encore.
function resumeRest() {
  if (restEndsAt.value === null) {
    return
  }

  syncRest()

  if (isResting.value && restIntervalId === null) {
    restIntervalId = setInterval(syncRest, REST_TICK_MS)
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    resumeRest()
  }
}

// Le composant est réutilisé d'un exercice à l'autre (mêmes route et composant) :
// chaque exercice a son propre repos.
watch(
  restStorageKey,
  () => {
    stopRest()
    restoreRest()
  },
)

onMounted(() => {
  restoreRest()
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('focus', resumeRest)
  window.addEventListener('pageshow', resumeRest)
})

onUnmounted(() => {
  clearRestInterval()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('focus', resumeRest)
  window.removeEventListener('pageshow', resumeRest)
})

function addSet() {
  // Le demi-kilo est la plus petite marche réelle (1,25 kg par côté, ou un
  // total impair réparti sur deux haltères) ; en deçà, c'est une faute de frappe.
  if (reps.value < 1 || totalWeight.value < 1 || !isHalfKiloStep(weight.value)) {
    return
  }

  const completedAt = new Date()
  const newSet: ExerciseSet = {
    id: completedAt.getTime(),
    reps: reps.value,
    weight: totalWeight.value,
    completedAt,
    isWarmup: isWarmup.value,
    rpe: isWarmup.value ? null : rpe.value,
  }
  // Chaque série se note pour elle-même : pas de report du cran précédent.
  rpe.value = null

  // Le fantôme visé par cette série, avant qu'il ne se déplace vers la
  // suivante : c'est l'homologue auquel elle doit se mesurer.
  const homologue = newSet.isWarmup ? null : ghost.value
  lastVerdict.value = homologue
    ? { ...compareSetToGhost(newSet, homologue.set), position: homologue.position }
    : null

  lastAddedSetAt.value = newSet.isWarmup ? null : completedAt.getTime()
  lastSetWasWarmup.value = isWarmup.value
  emit('addSet', newSet)

  if (newSet.isWarmup) {
    // La série qu'on vient de faire n'est pas encore dans les props : la
    // marche suivante est celle d'après.
    fillRampStep(suggestedRamp.value[nextRampIndex.value + 1])
  }

  const restSeconds = newSet.isWarmup ? WARMUP_REST_SECONDS : props.restSeconds
  startRest(Date.now() + restSeconds * 1000)
}

function removeSet(id: number) {
  emit('removeSet', id)
}

// Deux clics plutôt que window.confirm (absent du WebView iOS/macOS).
const confirmClearSets = ref(false)

// ——— Corriger une série passée : la faute de frappe du carnet papier. Une
// seule série en édition à la fois ; la date ne se modifie pas — c'est
// l'identité de la série (fantômes, déduplication par signature). ———

const editingSetId = ref<number | null>(null)
const editReps = ref(0)
const editWeight = ref(0)
const editRpe = ref<number | null>(null)

function startEditSet(set: ExerciseSet) {
  editingSetId.value = set.id
  editReps.value = set.reps
  // Aux haltères, le champ parle en poids d'un haltère, comme la saisie.
  editWeight.value = toInputWeight(set.weight)
  editRpe.value = set.rpe ?? null
}

function cancelEditSet() {
  editingSetId.value = null
}

function toggleEditRpe(value: number) {
  editRpe.value = editRpe.value === value ? null : value
}

function saveEditSet(set: ExerciseSet) {
  const total = props.isDumbbell ? editWeight.value * 2 : editWeight.value

  // Les mêmes garde-fous que la saisie : au moins une répétition, une vraie
  // charge, sur la grille du demi-kilo.
  if (editReps.value < 1 || total < 1 || !isHalfKiloStep(editWeight.value)) {
    return
  }

  emit('updateSet', set.id, {
    reps: Math.round(editReps.value),
    weight: total,
    rpe: set.isWarmup ? null : editRpe.value,
  })
  editingSetId.value = null
}

function clearSets() {
  if (!confirmClearSets.value) {
    confirmClearSets.value = true
    return
  }
  confirmClearSets.value = false
  emit('clearSets')
}
</script>

<template>
  <section
    class="exercise-tracker"
    :class="{ 'exercise-tracker--warmup': isWarmup }"
    aria-labelledby="exercise-title"
  >
    <div class="tracker-header">
      <p class="eyebrow">{{ exerciseName }}</p>
      <h1 id="exercise-title">Suivi des séries</h1>
      <p v-if="isStagnant" class="badge badge-negative">Même charge que la dernière fois</p>
    </div>

    <div class="mode-switch" role="group" aria-label="Type de série">
      <button
        type="button"
        class="mode-option mode-option--work"
        :class="{ 'mode-option--active': !isWarmup }"
        :aria-pressed="!isWarmup"
        @click="setWarmupMode(false)"
      >
        Travail
      </button>
      <button
        type="button"
        class="mode-option mode-option--warmup warmup-toggle"
        :class="{ 'mode-option--active': isWarmup }"
        :aria-pressed="isWarmup"
        @click="setWarmupMode(true)"
      >
        Échauffement
      </button>
    </div>

    <div class="ghost-target">
      <div v-if="ghost" class="ghost-row">
        <span class="ghost-label">Fantôme</span>
        <span>
          Série {{ ghost.position }}, dernière séance :
          {{ ghost.set.reps }} × {{ ghost.set.weight }} {{ weightUnit }}
        </span>
      </div>

      <div class="target-chip">
        {{ isWarmup ? 'Objectif de travail' : 'Cible' }} → {{ suggestedTarget.weight }}
        {{ weightUnit }} × {{ suggestedTarget.reps }}
      </div>

      <button
        type="button"
        class="dumbbell-toggle"
        :class="{ 'dumbbell-toggle--active': isDumbbell }"
        :aria-pressed="isDumbbell"
        @click="toggleDumbbell"
      >
        Haltères ×2
      </button>
    </div>

    <div v-if="isWarmup" class="warmup-panel" aria-label="Montée en charge">
      <p class="warmup-title">Montée en charge</p>

      <div class="ramp ramp--today">
        <span class="ramp-label">Aujourd’hui</span>
        <ol v-if="todayWarmups.length > 0" class="ramp-steps">
          <li v-for="set in todayWarmups" :key="set.id" class="ramp-step">
            <span class="ramp-chip">{{ set.weight }} {{ weightUnit }} × {{ set.reps }}</span>
          </li>
        </ol>
        <span v-else class="ramp-empty">Aucune série d’échauffement pour l’instant</span>
      </div>

      <div v-if="suggestedRamp.length > 0" class="ramp ramp--suggested">
        <span class="ramp-label">
          Proposée
          <small>{{ rampSource }}</small>
        </span>
        <ol class="ramp-steps">
          <li
            v-for="(step, index) in suggestedRamp"
            :key="index"
            class="ramp-step"
            :class="{
              'ramp-step--done': index < nextRampIndex,
              'ramp-step--next': index === nextRampIndex,
            }"
          >
            <button
              type="button"
              class="ramp-chip ramp-suggestion"
              :aria-label="`Préremplir ${step.weight} ${weightUnit} × ${step.reps}`"
              @click="fillRampStep(step)"
            >
              {{ step.weight }} {{ weightUnit }} × {{ step.reps }}
            </button>
          </li>
        </ol>
      </div>

      <p class="warmup-hint">
        Charges croissantes, répétitions décroissantes, explosives — la dernière peut
        n’être qu’une seule rep. Hors fantôme, séries 1–3, records et volume de travail.
      </p>
    </div>

    <form v-if="!isResting" class="set-form" @submit.prevent="addSet">
      <label>
        <span>Répétitions</span>
        <input v-model.number="reps" type="number" min="1" step="1" inputmode="numeric" />
      </label>

      <label>
        <span>{{ isDumbbell ? 'Poids par haltère' : 'Poids' }}</span>
        <div class="weight-input">
          <input v-model.number="weight" type="number" min="0.5" step="0.5" inputmode="decimal" />
          <span>{{ weightUnit }}</span>
        </div>
        <span v-if="isDumbbell" class="dumbbell-hint">
          = {{ totalWeight }} {{ weightUnit }} au total
        </span>
      </label>

      <div v-if="!isWarmup" class="rpe-picker" role="group" aria-label="Effort perçu (RPE)">
        <span class="rpe-picker-label">Effort</span>
        <div class="rpe-options">
          <button
            v-for="choice in RPE_CHOICES"
            :key="choice.value"
            type="button"
            class="rpe-option"
            :class="{ 'rpe-option--active': rpe === choice.value }"
            :aria-pressed="rpe === choice.value"
            @click="toggleRpe(choice.value)"
          >
            {{ choice.label }}
            <small>RPE {{ choice.value }}</small>
          </button>
        </div>
      </div>

      <button type="submit">
        {{ isWarmup ? 'Ajouter l’échauffement' : 'Ajouter la série' }}
      </button>
    </form>

    <div v-else class="rest-panel" :class="{ 'rest-panel--warmup': lastSetWasWarmup }" aria-live="polite">
      <p v-if="isLatestSetNewRecord" class="badge badge-positive">Nouveau record</p>
      <p
        v-if="verdictLabel"
        class="verdict"
        :class="`verdict--${lastVerdict?.outcome}`"
      >
        {{ verdictLabel }}
      </p>
      <p class="rest-label">{{ lastSetWasWarmup ? 'Repos · échauffement' : 'Repos' }}</p>
      <p class="rest-countdown">{{ formatRestTime(restSecondsRemaining) }}</p>
      <div class="rest-controls">
        <button type="button" @click="adjustRest(-15)">-15 s</button>
        <button type="button" @click="adjustRest(15)">+15 s</button>
        <button type="button" class="skip-button" @click="skipRest">Passer</button>
      </div>
    </div>

    <div class="stats-grid" aria-label="Totaux d'entraînement">
      <div>
        <span>Répétitions cette semaine</span>
        <strong>{{ weeklyReps }}</strong>
      </div>
      <div>
        <span>Volume cette semaine</span>
        <strong>{{ weeklyVolume }} {{ weightUnit }}</strong>
      </div>
      <div>
        <span>Charge max cette semaine</span>
        <strong>{{ heaviestSet ? `${heaviestSet.weight} ${weightUnit}` : '—' }}</strong>
      </div>
    </div>

    <div
      v-if="isWarmup || latestWeekWarmups.length > 0"
      class="warmup-stats-grid"
      aria-label="Totaux d'échauffement"
    >
      <div>
        <span>Séries d’échauffement cette semaine</span>
        <strong>{{ latestWeekWarmups.length }}</strong>
      </div>
      <div>
        <span>Volume d’échauffement</span>
        <strong>{{ warmupWeeklyVolume }} {{ weightUnit }}</strong>
      </div>
      <div>
        <span>Charge max d’échauffement</span>
        <strong>{{ warmupHeaviest ? `${warmupHeaviest.weight} ${weightUnit}` : '—' }}</strong>
      </div>
    </div>

    <SessionDiff
      :latest-session="latestSession"
      :previous-session="previousSession"
      :weight-unit="weightUnit"
    />

    <SetGhostChart
      :latest-session="latestSession"
      :previous-session="previousSession"
      :weight-unit="weightUnit"
    />

    <WeeklyVolumeGraph :sets="sortedSets" :weight-unit="weightUnit" />

    <div class="sets-panel">
      <div class="sets-head">
        <h2>Séries</h2>
      </div>

      <div class="sets-actions">
        <button
          v-if="sortedAllSets.length > 0"
          type="button"
          class="sets-action export-sets"
          @click="emit('exportSets')"
        >
          Exporter
        </button>
        <button type="button" class="sets-action import-sets" @click="emit('importSets')">
          Importer
        </button>
        <button
          v-if="sortedAllSets.length > 0"
          type="button"
          class="sets-action clear-sets"
          :class="{ 'clear-sets--confirm': confirmClearSets }"
          @click="clearSets"
        >
          {{ confirmClearSets ? 'Confirmer ?' : 'Supprimer' }}
        </button>
      </div>

      <p v-if="importReport" class="sets-report" role="status">{{ importReport }}</p>

      <p v-if="visibleSets.length === 0" class="empty-state">Aucune série ajoutée pour l'instant.</p>

      <ul v-else class="set-list">
        <li
          v-for="set in visibleSets"
          :key="set.id"
          :class="set.isWarmup ? 'set-row--warmup' : 'set-row--work'"
        >
          <button
            type="button"
            class="set-kind set-warmup-toggle"
            :aria-pressed="Boolean(set.isWarmup)"
            :aria-label="`${set.isWarmup ? 'Reclasser en série de travail' : 'Marquer comme série d’échauffement'} : ${set.reps} répétitions à ${set.weight} ${weightUnit}`"
            :title="set.isWarmup ? 'Reclasser en série de travail' : 'Marquer comme échauffement'"
            @click="emit('setWarmup', set.id, !set.isWarmup)"
          >
            <span class="set-kind-label">{{ setKindLabel(set) }}</span>
          </button>
          <form
            v-if="editingSetId === set.id"
            class="set-edit"
            aria-label="Corriger la série"
            @submit.prevent="saveEditSet(set)"
          >
            <label>
              <span>Répétitions</span>
              <input v-model.number="editReps" type="number" min="1" step="1" inputmode="numeric" />
            </label>
            <label>
              <span>{{ isDumbbell ? 'Poids par haltère' : 'Poids' }}</span>
              <div class="weight-input">
                <input
                  v-model.number="editWeight"
                  type="number"
                  min="0.5"
                  step="0.5"
                  inputmode="decimal"
                />
                <span>{{ weightUnit }}</span>
              </div>
            </label>
            <div v-if="!set.isWarmup" class="rpe-options rpe-options--edit">
              <button
                v-for="choice in RPE_CHOICES"
                :key="choice.value"
                type="button"
                class="rpe-option"
                :class="{ 'rpe-option--active': editRpe === choice.value }"
                :aria-pressed="editRpe === choice.value"
                @click="toggleEditRpe(choice.value)"
              >
                {{ choice.label }}
                <small>RPE {{ choice.value }}</small>
              </button>
            </div>
            <div class="set-edit-actions">
              <button type="submit">Enregistrer</button>
              <button type="button" class="set-edit-cancel" @click="cancelEditSet">Annuler</button>
            </div>
          </form>

          <template v-else>
            <div class="set-summary">
              <strong>{{ set.reps }} répétitions</strong>
              <span>
                {{ set.weight }} {{ weightUnit }} le {{ formatCompletedAt(set.completedAt) }}
                <span v-if="set.rpe != null" class="set-rpe">RPE {{ set.rpe }}</span>
              </span>
            </div>
            <div class="set-row-actions">
              <button
                type="button"
                class="edit-set"
                :aria-label="`Corriger la série : ${set.reps} répétitions à ${set.weight} ${weightUnit}`"
                @click="startEditSet(set)"
              >
                Modifier
              </button>
              <button
                type="button"
                class="remove-set"
                aria-label="Supprimer la série"
                @click="removeSet(set.id)"
              >
                Retirer
              </button>
            </div>
          </template>
        </li>
      </ul>

      <button
        v-if="hasMoreSets"
        type="button"
        class="show-more-sets"
        @click="visibleSetCount += 12"
      >
        Afficher les séries précédentes
      </button>
    </div>
  </section>
</template>

<style scoped>
.exercise-tracker {
  width: min(100%, 760px);
  padding: 32px;
  color: var(--text);
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  box-shadow: var(--panel-shadow);
}

/* En mode échauffement, tout le panneau change de teinte : la couleur bleue
   dit d'un coup d'œil que ce qui est saisi ici ne compte pas comme travail. */
.exercise-tracker--warmup {
  background:
    linear-gradient(180deg, var(--warmup-dim), transparent 320px),
    var(--panel-bg);
  border-color: var(--warmup);
  transition: border-color 0.25s var(--ease);
}

.exercise-tracker--warmup .eyebrow {
  color: var(--warmup);
}

.tracker-header {
  margin-bottom: 20px;
}

/* Sélecteur de mode : deux segments, laiton pour le travail, bleu pour
   l'échauffement. Le segment actif est plein pour que le mode courant ne se
   devine pas — il se lit. */
.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 4px;
  margin-bottom: 24px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--pill-radius);
}

.mode-option {
  min-height: 44px;
  padding: 0 16px;
  color: var(--muted);
  font-weight: 800;
  background: transparent;
  border: 0;
  border-radius: var(--pill-radius);
}

.mode-option:hover {
  color: var(--text);
  background: var(--ghost-dim);
  transform: none;
}

.mode-option--work.mode-option--active,
.mode-option--work.mode-option--active:hover {
  color: var(--on-fire);
  background: var(--fire);
}

.mode-option--warmup.mode-option--active,
.mode-option--warmup.mode-option--active:hover {
  color: var(--on-warmup);
  background: var(--warmup);
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--fire);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-family: var(--font-display);
  font-size: clamp(1.9rem, 5vw, 2.5rem);
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.15;
}

h2 {
  margin-bottom: 16px;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 6px 12px;
  margin-top: 12px;
  margin-bottom: 0;
  font-size: 0.82rem;
  font-weight: 800;
  border-radius: 999px;
}

.badge-negative {
  color: var(--blood-text);
  background: var(--blood-dim);
  border: 1px solid var(--blood);
}

.badge-positive {
  color: var(--gain);
  background: var(--gain-dim);
  border: 1px solid var(--gain);
}

.ghost-target {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 24px;
}

.ghost-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 14px;
  color: var(--ghost-bright);
  font-weight: 700;
  background: var(--ghost-dim);
  border: 1px dashed var(--ghost);
  border-radius: var(--control-radius);
}

.ghost-label {
  padding: 3px 8px;
  color: var(--ghost);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid var(--ghost);
  border-radius: 999px;
}

.target-chip {
  padding: 10px 14px;
  color: var(--fire);
  font-weight: 800;
  background: var(--fire-dim);
  border: 1px solid var(--fire);
  border-radius: var(--control-radius);
}

/* Fantôme et cible restent visibles en échauffement — c'est vers eux que
   monte la rampe — mais en retrait. */
.exercise-tracker--warmup .ghost-row,
.exercise-tracker--warmup .target-chip {
  opacity: 0.7;
}

.warmup-panel {
  display: grid;
  gap: 12px;
  padding: 18px 20px;
  margin-bottom: 24px;
  background: var(--warmup-dim);
  border: 1px solid var(--warmup);
  border-radius: var(--panel-radius);
}

.warmup-title {
  margin: 0;
  color: var(--warmup);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ramp {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.ramp-label {
  min-width: 96px;
  color: var(--muted);
  font-size: 0.85rem;
  font-weight: 700;
}

.ramp-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 0;
  margin: 0;
  list-style: none;
}

.ramp-step {
  display: flex;
  gap: 6px;
  align-items: center;
}

.ramp-step + .ramp-step::before {
  content: '→';
  color: var(--warmup);
  font-weight: 700;
}

.ramp-chip {
  padding: 6px 12px;
  color: var(--warmup-text);
  font-family: var(--font-num);
  font-size: 0.9rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: var(--surface);
  border: 1px solid var(--warmup);
  border-radius: 999px;
}

.ramp-label small {
  display: block;
  font-size: 0.72rem;
  font-weight: 600;
}

/* La rampe proposée est un fantôme : gris, pointillés — sauf la marche
   suivante, pleine, et les marches faites, effacées. Chaque puce est un
   bouton qui préremplit le formulaire. */
.ramp-suggestion {
  min-height: 0;
  color: var(--ghost-bright);
  background: transparent;
  border: 1px dashed var(--ghost);
  cursor: pointer;
  transition: background-color 0.2s var(--ease);
}

.ramp-suggestion:hover {
  background: var(--warmup-dim);
  transform: none;
}

.ramp-step--next .ramp-suggestion {
  color: var(--on-warmup);
  background: var(--warmup);
  border: 1px solid var(--warmup);
}

.ramp-step--next .ramp-suggestion:hover {
  background: var(--warmup-text);
}

.ramp-step--done .ramp-suggestion {
  opacity: 0.45;
}

.ramp--suggested .ramp-step + .ramp-step::before {
  color: var(--ghost);
}

.ramp--previous .ramp-step + .ramp-step::before {
  color: var(--ghost);
}

.ramp-empty {
  color: var(--muted);
  font-size: 0.9rem;
}

.dumbbell-toggle {
  min-height: 44px;
  padding: 0 16px;
  color: var(--muted);
  font-weight: 800;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
}

.dumbbell-toggle:hover {
  color: var(--text);
  background: var(--ghost-dim);
}

.dumbbell-toggle--active,
.dumbbell-toggle--active:hover {
  color: var(--fire);
  background: var(--fire-dim);
  border-color: var(--fire);
}

.dumbbell-hint {
  color: var(--muted);
  font-size: 0.85rem;
  font-weight: 700;
}

.set-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  gap: 16px;
  align-items: end;
  margin-bottom: 24px;
}

.set-form > button[type='submit'] {
  grid-column: 3;
  grid-row: 1;
}

/* Le sélecteur d'effort occupe sa propre ligne sous les champs : trois crans
   optionnels, dans les couleurs du mode travail. */
.rpe-picker {
  display: flex;
  grid-column: 1 / -1;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.rpe-picker-label {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.rpe-options {
  display: flex;
  gap: 8px;
}

.rpe-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 44px;
  padding: 5px 14px;
  color: var(--muted);
  font-weight: 800;
  line-height: 1.15;
  background: transparent;
  border: 1px solid var(--panel-border);
  border-radius: var(--pill-radius);
}

.rpe-option small {
  font-size: 0.66rem;
  font-weight: 700;
  opacity: 0.75;
}

.rpe-option:hover {
  color: var(--text);
  background: var(--ghost-dim);
  transform: none;
}

.rpe-option--active,
.rpe-option--active:hover {
  color: var(--on-fire);
  background: var(--fire);
  border-color: var(--fire);
}

.set-rpe {
  margin-left: 6px;
  padding: 1px 8px;
  font-size: 0.72rem;
  font-weight: 800;
  white-space: nowrap;
  background: var(--ghost-dim);
  border-radius: var(--pill-radius);
}

/* L'édition en place d'une série : les mêmes champs que la saisie, dans la
   ligne du carnet. */
.set-edit {
  display: flex;
  flex: 1;
  gap: 12px;
  align-items: end;
  flex-wrap: wrap;
}

.set-edit label {
  display: grid;
  gap: 4px;
  font-size: 0.78rem;
  font-weight: 700;
}

.set-edit input {
  width: 90px;
}

.rpe-options--edit .rpe-option {
  min-height: 40px;
  padding: 3px 10px;
}

.set-edit-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.set-edit-cancel {
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--panel-border);
}

.edit-set {
  min-height: 36px;
  padding: 0 12px;
  font-size: 0.8rem;
}

.warmup-hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.exercise-tracker--warmup input:focus,
.exercise-tracker--warmup .weight-input:focus-within {
  border-color: var(--warmup);
  outline-color: var(--warmup-ring);
}

.exercise-tracker--warmup .set-form > button[type='submit'] {
  color: var(--on-warmup);
  background: var(--warmup);
}

.exercise-tracker--warmup .set-form > button[type='submit']:hover {
  background: var(--warmup-text);
}

label {
  display: grid;
  gap: 8px;
  font-weight: 700;
}

label span {
  font-size: 0.9rem;
  color: var(--muted);
}

input {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  color: var(--text-strong);
  font: inherit;
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  border-radius: var(--control-radius);
}

input:focus {
  border-color: var(--field-focus-border);
  outline: 3px solid var(--field-focus-ring);
}

.weight-input {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  border: 1px solid var(--field-border);
  border-radius: var(--control-radius);
  background: var(--field-bg);
}

.weight-input:focus-within {
  border-color: var(--field-focus-border);
  outline: 3px solid var(--field-focus-ring);
}

.weight-input input {
  border: 0;
  outline: 0;
}

.weight-input span {
  padding-right: 14px;
  color: var(--muted);
  font-weight: 700;
}

button {
  min-height: 48px;
  padding: 0 22px;
  color: var(--accent-text-on-fill);
  font: inherit;
  font-weight: 600;
  background: var(--accent);
  border: 0;
  border-radius: var(--pill-radius);
  cursor: pointer;
  transition: transform 0.2s var(--ease), background-color 0.2s var(--ease);
}

button:hover {
  background: var(--accent-hover);
  transform: scale(1.02);
}

button:active {
  transform: scale(0.98);
}

.rest-panel {
  display: grid;
  gap: 14px;
  padding: 24px;
  margin-bottom: 24px;
  text-align: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--panel-radius);
}

.rest-panel .badge {
  justify-self: center;
  margin-top: 0;
}

.rest-panel--warmup {
  background: var(--warmup-dim);
  border-color: var(--warmup);
}

.rest-panel--warmup .rest-label {
  color: var(--warmup);
}

.verdict {
  margin: 0;
  color: var(--muted);
  font-weight: 700;
}

.verdict--progress {
  color: var(--gain-text);
}

.verdict--regress {
  color: var(--blood-text);
}

.rest-label {
  margin: 0;
  color: var(--fire);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.rest-countdown {
  margin: 0;
  color: var(--text-strong);
  font-family: var(--font-num);
  font-size: clamp(2.6rem, 8vw, 4rem);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.rest-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}

.rest-controls button {
  min-height: 48px;
  padding: 0 18px;
}

.skip-button {
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--border-strong);
}

.skip-button:hover {
  color: var(--text);
  background: var(--ghost-dim);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.stats-grid div {
  display: grid;
  gap: 8px;
  min-height: 92px;
  padding: 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}

.stats-grid span,
.set-list span,
.empty-state {
  color: var(--muted);
}

.stats-grid strong {
  font-family: var(--font-display);
  font-size: 1.7rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/* Les totaux d'échauffement ont leur propre grille, bleue, pour ne jamais
   être confondus avec le volume de travail juste au-dessus. */
.warmup-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.warmup-stats-grid div {
  display: grid;
  gap: 8px;
  min-height: 92px;
  padding: 16px;
  background: var(--warmup-dim);
  border: 1px solid var(--warmup);
  border-radius: var(--control-radius);
}

.warmup-stats-grid span {
  color: var(--muted);
}

.warmup-stats-grid strong {
  color: var(--warmup-text);
  font-family: var(--font-display);
  font-size: 1.7rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.sets-panel {
  padding-top: 8px;
}

.sets-head {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

/* Les trois actions partagent la largeur : chacune reste atteignable au pouce
   sur un téléphone, et aucune ne prend le pas visuel sur les autres par sa
   taille — seule la couleur les hiérarchise. */
.sets-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.sets-action {
  flex: 1;
  min-height: 44px;
  padding: 0 8px;
  color: var(--text);
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--pill-radius);
  transition: border-color 0.2s var(--ease), background 0.2s var(--ease);
}

/* Importer est la seule action qui apporte quelque chose, et la seule
   disponible sur un exercice vide : c'est elle qui porte le laiton. */
.import-sets {
  color: var(--fire);
  border-color: var(--fire);
}

.import-sets:hover {
  background: var(--fire-dim);
}

.export-sets:hover {
  border-color: var(--ghost-bright);
}

.clear-sets {
  color: var(--blood-text);
}

.clear-sets:hover,
.clear-sets--confirm {
  color: var(--text-strong);
  background: var(--blood-dim);
  border-color: var(--blood);
}

.sets-report {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 0.86rem;
}

.empty-state {
  margin-bottom: 0;
}

.set-list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* Chaque ligne du carnet porte la couleur de sa nature : liseré laiton et
   numéro de série pour le travail, liseré bleu et fond teinté pour
   l'échauffement. La puce colorée est aussi le bouton qui reclasse la série. */
.set-list li {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-left-width: 4px;
  border-radius: var(--control-radius);
}

.set-row--work {
  border-left-color: var(--fire);
}

.set-row--warmup {
  background: var(--warmup-dim);
  border-color: var(--warmup);
  border-left-color: var(--warmup);
}

.set-summary {
  display: grid;
  flex: 1;
  gap: 4px;
  min-width: 0;
}

.set-kind {
  flex-shrink: 0;
  min-width: 52px;
  min-height: 36px;
  padding: 0 12px;
  font-family: var(--font-num);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid;
  border-radius: 999px;
}

.set-row--work .set-kind {
  color: var(--fire);
  background: var(--fire-dim);
  border-color: var(--fire);
}

.set-row--work .set-kind:hover {
  color: var(--warmup-text);
  background: var(--warmup-dim);
  border-color: var(--warmup);
}

.set-row--warmup .set-kind {
  color: var(--on-warmup);
  background: var(--warmup);
  border-color: var(--warmup);
}

.set-row--warmup .set-kind:hover {
  color: var(--fire);
  background: var(--fire-dim);
  border-color: var(--fire);
}

.set-row-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.remove-set {
  min-height: 44px;
  padding: 0 16px;
  border-radius: var(--pill-radius);
  color: var(--blood-text);
  background: var(--blood-dim);
}

.remove-set:hover {
  color: var(--text-strong);
  background: var(--blood);
}

.show-more-sets {
  width: 100%;
  min-height: 44px;
  margin-top: 12px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--border-strong);
}

.show-more-sets:hover {
  background: var(--ghost-dim);
}

@media (max-width: 680px) {
  .exercise-tracker {
    padding: 24px;
  }

  .set-form,
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .set-form > button[type='submit'] {
    grid-column: 1;
    grid-row: auto;
  }

  .set-form,
  .stats-grid,
  .warmup-stats-grid {
    grid-template-columns: 1fr;
  }

  .set-list li {
    gap: 10px;
    padding: 10px 12px;
  }

  .set-kind {
    min-width: 44px;
    padding: 0 8px;
  }

  /* Sur un téléphone, « Échauffement » en capitales mangerait la ligne :
     abrégé à l'écran, le nom complet reste dans l'aria-label du bouton. */
  .set-row--warmup .set-kind-label {
    display: none;
  }

  .set-row--warmup .set-kind::after {
    content: 'Éch.';
  }

  .remove-set {
    padding: 0 12px;
  }

  .ramp-label {
    min-width: 100%;
  }
}
</style>
