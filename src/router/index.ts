import { createRouter, createWebHistory } from 'vue-router'
import ExerciseView from '../views/ExerciseView.vue'
import NextExerciseView from '../views/NextExerciseView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/exercises/bench-press',
    },
    {
      path: '/exercises/next',
      name: 'next-exercise',
      component: NextExerciseView,
    },
    {
      path: '/exercises/:slug',
      name: 'exercise',
      component: ExerciseView,
      props: true,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/exercises/bench-press',
    },
  ],
})
