<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useAppVariableStore } from '@/stores/app-variable';
import apexchart from '@/components/plugins/ApexChart.vue';
import { fmtWorkoutDate, labelize } from '@/composables/format';
import { useUnits } from '@/composables/units';
import { api } from '@/api/client';

const { unit, toDisplay } = useUnits();

const appVariable = useAppVariableStore();

interface DashboardData {
  thisWeek: { volumeKg: number; sets: number; workouts: number };
  weeklyVolume: { week: string; volumeKg: number; sets: number; workouts: number }[];
  muscleWeeklySets: { muscle: string; weeklyAvg: number }[];
  recovery: { muscle: string; recoveryPct: number; lastTrained: string | null }[];
  recentWorkouts: { id: string; date: string; name: string | null; exerciseNames: string[] }[];
  upcomingWorkouts: { id: string; date: string; name: string | null; status: string; exerciseNames: string[] }[];
}

const data = ref<DashboardData | null>(null);
const weight = ref<{ date: string; value: number }[]>([]);

onMounted(async () => {
  const [res, weightRes] = await Promise.all([
    api.get('/analytics/dashboard'),
    api.get('/body-metrics', { params: { type: 'weight', limit: 30 } }),
  ]);
  data.value = res.data;
  weight.value = [...weightRes.data.metrics].reverse();
});

const weightSpark = computed(() => ({
  options: {
    chart: { type: 'line', sparkline: { enabled: true } },
    colors: [appVariable.color.theme],
    stroke: { curve: 'smooth', width: 2 },
    tooltip: { fixed: { enabled: false }, x: { show: false }, marker: { show: false } },
  },
  series: [{ name: unit.value, data: weight.value.map((w) => toDisplay(w.value) ?? 0) }],
}));

const volumeChart = computed(() => {
  const weeks = data.value?.weeklyVolume ?? [];
  return {
    options: {
      chart: { type: 'area', toolbar: { show: false }, sparkline: { enabled: false } },
      colors: [appVariable.color.theme],
      stroke: { curve: 'smooth', width: 2 },
      fill: { type: 'gradient', gradient: { opacityFrom: 0.5, opacityTo: 0.05 } },
      dataLabels: { enabled: false },
      grid: { borderColor: `rgba(${appVariable.color.bodyColorRgb}, .15)` },
      xaxis: {
        categories: weeks.map((w) => w.week.slice(5)),
        labels: { style: { colors: appVariable.color.bodyColor } },
      },
      yaxis: { labels: { style: { colors: appVariable.color.bodyColor } } },
      tooltip: { y: { formatter: (v: number) => `${v.toLocaleString()} ${unit.value}` } },
    },
    series: [{ name: 'Volume', data: weeks.map((w) => toDisplay(w.volumeKg, 0) ?? 0) }],
  };
});

const muscleChart = computed(() => {
  const muscles = (data.value?.muscleWeeklySets ?? []).slice(0, 12);
  return {
    options: {
      chart: { type: 'bar', toolbar: { show: false } },
      colors: [appVariable.color.theme],
      plotOptions: { bar: { horizontal: true, borderRadius: 2, barHeight: '60%' } },
      dataLabels: { enabled: false },
      grid: { borderColor: `rgba(${appVariable.color.bodyColorRgb}, .15)` },
      states: { hover: { filter: { type: 'none' } }, active: { filter: { type: 'none' } } },
      xaxis: {
        categories: muscles.map((m) => labelize(m.muscle)),
        labels: { style: { colors: appVariable.color.bodyColor } },
        crosshairs: { show: false },
      },
      yaxis: { labels: { style: { colors: appVariable.color.bodyColor } } },
      tooltip: { y: { formatter: (v: number) => `${v} sets/week` } },
    },
    // Averaged over the weeks actually trained, not a fixed 4 — a week-old account
    // would otherwise show every muscle at a quarter of its real volume.
    series: [{ name: 'Avg sets/week', data: muscles.map((m) => m.weeklyAvg) }],
  };
});

function recoveryColor(pct: number) {
  if (pct >= 80) return 'bg-theme';
  if (pct >= 50) return 'bg-warning';
  return 'bg-danger';
}

const router = useRouter();
const generating = ref(false);

/** The one action that matters when you open the app: continue > start planned > generate. */
const primaryAction = computed(() => {
  const inProgress = data.value?.upcomingWorkouts.find((w) => w.status === 'in_progress');
  if (inProgress) return { label: 'Continue workout', icon: 'ti-player-play', to: `/workouts/${inProgress.id}/live` };
  const planned = data.value?.upcomingWorkouts.find((w) => w.status === 'planned');
  if (planned) return { label: `Start: ${planned.name ?? 'planned workout'}`, icon: 'ti-player-play', to: `/workouts/${planned.id}/live` };
  return null;
});

async function generateNow() {
  generating.value = true;
  try {
    const { data: res } = await api.post('/workouts/generate', {});
    router.push(`/workouts/${res.workout.id}`);
  } finally {
    generating.value = false;
  }
}
</script>
<template>
  <div class="d-flex align-items-center flex-wrap gap-2 mb-3">
    <h1 class="page-header mb-0 me-auto">Dashboard <small>your training at a glance</small></h1>
    <RouterLink v-if="primaryAction" :to="primaryAction.to" class="btn btn-theme">
      <i class="ti me-1" :class="primaryAction.icon"></i>{{ primaryAction.label }}
    </RouterLink>
    <button v-else-if="data" class="btn btn-theme" :disabled="generating" @click="generateNow">
      <i class="ti ti-sparkles me-1"></i>Generate today's workout
    </button>
  </div>

  <template v-if="data">
    <div class="row g-3 mb-3">
      <div class="col-md-3 col-6">
        <Card class="h-100">
          <CardBody>
            <div class="text-inverse text-opacity-50 fw-bold small mb-1">THIS WEEK VOLUME</div>
            <h2 class="mb-0">{{ (toDisplay(data.thisWeek.volumeKg, 0) ?? 0).toLocaleString() }} {{ unit }}</h2>
          </CardBody>
        </Card>
      </div>
      <div class="col-md-3 col-6">
        <Card class="h-100">
          <CardBody>
            <div class="text-inverse text-opacity-50 fw-bold small mb-1">THIS WEEK WORKOUTS</div>
            <h2 class="mb-0">{{ data.thisWeek.workouts }}</h2>
          </CardBody>
        </Card>
      </div>
      <div class="col-md-3 col-6">
        <Card class="h-100">
          <CardBody>
            <div class="text-inverse text-opacity-50 fw-bold small mb-1">THIS WEEK WORKING SETS</div>
            <h2 class="mb-0">{{ data.thisWeek.sets }}</h2>
          </CardBody>
        </Card>
      </div>
      <div class="col-md-3 col-6">
        <Card class="h-100">
          <CardBody>
            <div class="d-flex align-items-center">
              <div>
                <div class="text-inverse text-opacity-50 fw-bold small mb-1">BODY WEIGHT</div>
                <h2 class="mb-0">{{ toDisplay(weight.at(-1)?.value) ?? '—' }}<small v-if="weight.length"> {{ unit }}</small></h2>
              </div>
              <div class="ms-auto" style="width: 40%" v-if="weight.length > 1">
                <apexchart type="line" height="40" :options="weightSpark.options" :series="weightSpark.series" />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>

    <div class="row g-3 mb-3">
      <div class="col-lg-7">
        <Card class="h-100">
          <CardBody>
            <div class="d-flex fw-bold small mb-3">
              <span class="flex-grow-1">WEEKLY VOLUME (12 WEEKS)</span>
              <CardExpandToggler />
            </div>
            <apexchart type="area" height="260" :options="volumeChart.options" :series="volumeChart.series" />
          </CardBody>
        </Card>
      </div>
      <div class="col-lg-5">
        <Card class="h-100">
          <CardBody>
            <div class="d-flex fw-bold small mb-3">
              <span class="flex-grow-1">WEEKLY SETS PER MUSCLE</span>
              <CardExpandToggler />
            </div>
            <apexchart type="bar" height="260" :options="muscleChart.options" :series="muscleChart.series" />
          </CardBody>
        </Card>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-lg-4">
        <Card class="h-100">
          <CardBody>
            <div class="d-flex fw-bold small mb-3">
              <span class="flex-grow-1">MUSCLE RECOVERY</span>
              <CardExpandToggler />
            </div>
            <div v-for="m in data.recovery.slice(0, 12)" :key="m.muscle" class="mb-2">
              <div class="d-flex small mb-1">
                <span class="text-inverse">{{ labelize(m.muscle) }}</span>
                <span class="ms-auto text-inverse text-opacity-50">{{ m.recoveryPct }}%</span>
              </div>
              <div class="progress" style="height: 5px">
                <div class="progress-bar" :class="recoveryColor(m.recoveryPct)" :style="{ width: m.recoveryPct + '%' }"></div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
      <div class="col-lg-4">
        <Card class="h-100">
          <CardBody>
            <div class="d-flex fw-bold small mb-3">
              <span class="flex-grow-1">RECENT WORKOUTS</span>
              <CardExpandToggler />
            </div>
            <div class="list-group list-group-flush mx-n3 mb-n3">
              <RouterLink
                v-for="w in data.recentWorkouts"
                :key="w.id"
                :to="`/workouts/${w.id}`"
                class="list-group-item list-group-item-action bg-none"
              >
                <div class="fw-500 text-inverse">{{ w.name || 'Workout' }}</div>
                <div class="small text-inverse text-opacity-50">
                  {{ fmtWorkoutDate(w.date) }} ·
                  {{ w.exerciseNames.slice(0, 3).join(', ') }}<span v-if="w.exerciseNames.length > 3">…</span>
                </div>
              </RouterLink>
              <div v-if="!data.recentWorkouts.length" class="p-3 text-inverse text-opacity-50">
                Nothing logged yet.
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
      <div class="col-lg-4">
        <Card class="h-100">
          <CardBody>
            <div class="d-flex fw-bold small mb-3">
              <span class="flex-grow-1">UP NEXT</span>
              <CardExpandToggler />
            </div>
            <div class="list-group list-group-flush mx-n3 mb-n3">
              <RouterLink
                v-for="w in data.upcomingWorkouts"
                :key="w.id"
                :to="`/workouts/${w.id}`"
                class="list-group-item list-group-item-action bg-none"
              >
                <div class="fw-500 text-inverse">{{ w.name || 'Planned workout' }}</div>
                <div class="small text-inverse text-opacity-50">
                  {{ fmtWorkoutDate(w.date) }} ·
                  {{ w.exerciseNames.slice(0, 3).join(', ') }}<span v-if="w.exerciseNames.length > 3">…</span>
                </div>
              </RouterLink>
              <div v-if="!data.upcomingWorkouts.length" class="p-3 text-inverse text-opacity-50">
                No planned workouts — create one or ask Claude.
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  </template>
</template>
