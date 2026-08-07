<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { fmtDuration, fmtWorkoutDate, labelize, todayLocal, workoutDateKey } from '@/composables/format';
import { useUnits } from '@/composables/units';
import { api } from '@/api/client';

const { unit, toDisplay } = useUnits();

interface WorkoutRow {
  id: string;
  date: string;
  name: string | null;
  status: string;
  source: string;
  durationSec: number | null;
  exercises: {
    exerciseName: string;
    sets: { reps: number | null; weightKg: number | null; isWarmup: boolean; multiplier: number }[];
  }[];
}

const workouts = ref<WorkoutRow[]>([]);
const total = ref(0);
const loading = ref(false);
const statusFilter = ref('');
const PAGE = 30;

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
];

async function load(append = false) {
  loading.value = true;
  try {
    const { data } = await api.get('/workouts', {
      params: {
        status: statusFilter.value || undefined,
        limit: PAGE,
        offset: append ? workouts.value.length : 0,
      },
    });
    total.value = data.total;
    workouts.value = append ? [...workouts.value, ...data.workouts] : data.workouts;
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());
watch(statusFilter, () => load());

async function remove(id: string) {
  if (!confirm('Delete this workout?')) return;
  await api.delete(`/workouts/${id}`);
  await load();
}

function volume(w: WorkoutRow) {
  let v = 0;
  for (const we of w.exercises)
    // must match setVolume() in services/analytics.ts — reps × weight × multiplier
    for (const s of we.sets) if (!s.isWarmup && s.reps && s.weightKg) v += s.reps * s.weightKg * (s.multiplier || 1);
  return Math.round(v);
}

const statusBadge: Record<string, string> = {
  planned: 'bg-inverse bg-opacity-25',
  in_progress: 'bg-warning text-dark',
  completed: 'bg-theme text-theme-900',
  skipped: 'bg-danger',
};

// The API returns date-desc pages; that reads backwards for future workouts.
// Split: what's next (soonest first, incl. anything in progress), then history.
const sections = computed(() => {
  // Compare calendar days, not instants: a workout stored at UTC midnight today
  // is "yesterday evening" as an instant for anyone behind UTC, which filed
  // today's session under history.
  const today = todayLocal();
  const isUpcoming = (w: WorkoutRow) => w.status === 'in_progress' || workoutDateKey(w.date) >= today;
  const upcoming = workouts.value
    .filter(isUpcoming)
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const past = workouts.value.filter((w) => !isUpcoming(w));
  return [
    { title: 'UPCOMING', items: upcoming },
    { title: 'HISTORY', items: past },
  ].filter((s) => s.items.length);
});
</script>
<template>
  <div class="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-center gap-2 mb-4">
    <h1 class="page-header mb-0 me-sm-auto">Workouts <small>{{ total }} total</small></h1>
    <div class="btn-group" role="group">
      <template v-for="f in FILTERS" :key="f.value">
        <input type="radio" class="btn-check" :id="`wf-${f.value || 'all'}`" :value="f.value" v-model="statusFilter" />
        <label class="btn btn-sm btn-outline-theme" :for="`wf-${f.value || 'all'}`">{{ f.label }}</label>
      </template>
    </div>
    <RouterLink to="/workouts/new" class="btn btn-outline-theme">
      <i class="ti ti-plus me-1"></i> New workout
    </RouterLink>
  </div>

  <Card>
    <CardBody class="p-0">
      <div class="list-group list-group-flush">
        <template v-for="section in sections" :key="section.title">
        <div v-if="sections.length > 1" class="list-group-item bg-none py-2 small fw-bold text-inverse text-opacity-50">
          {{ section.title }}
        </div>
        <div v-for="w in section.items" :key="w.id" class="list-group-item bg-none d-flex align-items-center gap-3 py-3">
          <div class="text-center flex-shrink-0" style="width: 4.5rem">
            <div class="fw-500 text-inverse text-nowrap">
              {{ fmtWorkoutDate(w.date, { month: 'short', day: 'numeric' }) }}
            </div>
            <span class="badge fs-11px" :class="statusBadge[w.status]">{{ labelize(w.status) }}</span>
          </div>
          <div class="flex-grow-1 overflow-hidden">
            <RouterLink :to="`/workouts/${w.id}`" class="text-inverse text-decoration-none fw-500 d-block">
              {{ w.name || 'Workout' }}
            </RouterLink>
            <div class="small text-inverse text-opacity-50 text-truncate">
              {{ w.exercises.slice(0, 4).map((e) => e.exerciseName).join(', ') }}
              <span v-if="w.exercises.length > 4">+{{ w.exercises.length - 4 }} more</span>
            </div>
          </div>
          <div class="text-end d-none d-sm-block flex-shrink-0" style="min-width: 3rem">
            <template v-if="volume(w)">
              <div class="fw-500 text-inverse text-nowrap">{{ toDisplay(volume(w), 0) }}</div>
              <div class="small text-inverse text-opacity-50">{{ unit }}</div>
            </template>
            <div v-else-if="!fmtDuration(w.durationSec)" class="text-inverse text-opacity-25">—</div>
            <div v-if="fmtDuration(w.durationSec)" class="small text-inverse text-opacity-50 text-nowrap">
              {{ fmtDuration(w.durationSec) }}
            </div>
          </div>
          <div class="btn-group flex-shrink-0">
            <RouterLink :to="`/workouts/${w.id}/edit`" class="btn btn-sm btn-outline-secondary" title="Edit">
              <i class="ti ti-pencil"></i>
            </RouterLink>
            <button class="btn btn-sm btn-outline-secondary" title="Delete workout" @click="remove(w.id)">
              <i class="ti ti-trash"></i>
            </button>
          </div>
        </div>
        </template>
        <div v-if="!loading && !workouts.length" class="list-group-item bg-none text-center text-inverse text-opacity-50 py-4">
          No workouts yet — log your first one.
        </div>
      </div>
    </CardBody>
  </Card>

  <div class="text-center my-3" v-if="workouts.length < total">
    <button class="btn btn-outline-theme" :disabled="loading" @click="load(true)">Load more</button>
  </div>
</template>
