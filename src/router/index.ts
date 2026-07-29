import { createRouter, createWebHistory } from 'vue-router'
import { useSeanceStore } from '../stores/seances'
import CreateSeanceView from '../views/CreateSeanceView.vue'
import SeanceSelectView from '../views/SeanceSelectView.vue'
import SeanceView from '../views/SeanceView.vue'
import CreateExerciseView from '../views/CreateExerciseView.vue'
import ExerciseTrackerView from '../views/ExerciseTrackerView.vue'
import DashboardView from '../views/DashboardView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: () => {
        const seanceStore = useSeanceStore()

        return seanceStore.hasOnboarded ? '/seances' : '/onboarding'
      },
    },
    {
      path: '/onboarding',
      name: 'onboarding',
      component: CreateSeanceView,
    },
    {
      path: '/seances',
      name: 'seance-select',
      component: SeanceSelectView,
    },
    {
      path: '/seances/new',
      name: 'seance-new',
      component: CreateSeanceView,
    },
    {
      path: '/seances/:seanceSlug',
      name: 'seance',
      component: SeanceView,
      props: true,
    },
    {
      path: '/seances/:seanceSlug/exercises/new',
      name: 'exercise-new',
      component: CreateExerciseView,
      props: true,
    },
    {
      path: '/seances/:seanceSlug/exercises/:exerciseSlug',
      name: 'exercise-tracker',
      component: ExerciseTrackerView,
      props: true,
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: DashboardView,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})
