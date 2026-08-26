import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: () => import('../views/Home.vue') },
    { path: '/login', component: () => import('../views/Login.vue'), meta: { public: true } },
    { path: '/exercises', component: () => import('../views/Exercises.vue') },
    { path: '/exercises/:id', component: () => import('../views/ExerciseDetail.vue') },
    { path: '/workouts', component: () => import('../views/Workouts.vue') },
    { path: '/history', redirect: '/workouts' },
    { path: '/analytics', component: () => import('../views/Analytics.vue') },
    { path: '/plan', component: () => import('../views/Plan.vue') },
    { path: '/body', component: () => import('../views/Body.vue') },
    { path: '/nutrition', component: () => import('../views/Nutrition.vue') },
    { path: '/workouts/new', component: () => import('../views/WorkoutEdit.vue') },
    { path: '/workouts/:id', component: () => import('../views/WorkoutDetail.vue') },
    { path: '/workouts/:id/live', component: () => import('../views/WorkoutLive.vue') },
    { path: '/workouts/:id/edit', component: () => import('../views/WorkoutEdit.vue') },
    { path: '/settings', component: () => import('../views/Settings.vue') },
    { path: '/:pathMatch(.*)*', component: () => import('../views/PageError.vue'), meta: { public: true } }
  ],
});

/** A deploy replaces the content-hashed chunks, but a tab that was already
 *  open keeps the old chunk map — so navigating to a view it hasn't visited
 *  yet fetches a file that no longer exists, the import rejects, and the
 *  navigation dies with a full progress bar and no page change. A hard load
 *  at the target URL picks up the fresh index.html. At most once per 10 s,
 *  so a genuinely broken build cannot reload-loop. */
router.onError((error, to) => {
  const chunkFailure =
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
      String(error?.message ?? error),
    );
  if (!chunkFailure) return;
  const last = Number(sessionStorage.getItem('ovl_chunk_reload') ?? 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem('ovl_chunk_reload', String(Date.now()));
  window.location.assign(to.fullPath);
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  const auth = useAuthStore();
  if (!auth.loaded) await auth.fetchMe();
  if (!auth.user) return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  return true;
});

export default router;
