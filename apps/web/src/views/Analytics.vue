<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useAppVariableStore } from '@/stores/app-variable';
import apexchart from '@/components/plugins/ApexChart.vue';
import { labelize } from '@/composables/format';
import { useUnits } from '@/composables/units';
import { api } from '@/api/client';

const { unit, toDisplay } = useUnits();
const appVariable = useAppVariableStore();

interface PrRow {
  exerciseId: string;
  name: string;
  sessions: number;
  maxWeightKg: number;
  bestE1rm: number;
  bestE1rmDate: string;
  lastDate: string;
}
interface WeekRow { week: string; volumeKg: number; sets: number; workouts: number }
interface E1rmPoint { date: string; e1rm: number; topWeightKg: number; topSetReps: number }
interface MuscleRow { muscle: string; weeklyAvg: number; weeks: { week: string; sets: number }[] }

const prs = ref<PrRow[]>([]);
const weeks = ref<WeekRow[]>([]);
const muscles = ref<MuscleRow[]>([]);
const weight = ref<{ date: string; value: number }[]>([]);
const targetDays = ref<number | null>(null);
const selectedExercise = ref('');
const series = ref<E1rmPoint[]>([]);

onMounted(async () => {
  const [prRes, volRes, muscleRes, wRes, planRes] = await Promise.all([
    api.get('/analytics/prs'),
    api.get('/analytics/volume', { params: { weeks: 12 } }),
    api.get('/analytics/muscle-volume', { params: { weeks: 12 } }),
    api.get('/body-metrics', { params: { type: 'weight', limit: 60 } }),
    api.get('/plans'),
  ]);
  prs.value = prRes.data.prs;
  weeks.value = volRes.data.weeks;
  muscles.value = muscleRes.data.muscles;
  weight.value = [...wRes.data.metrics].reverse();
  targetDays.value = planRes.data.plans?.find((p: { status: string }) => p.status === 'active')?.daysPerWeek ?? null;
  if (prs.value.length) selectedExercise.value = prs.value[0].exerciseId;
});

watch(selectedExercise, async (id) => {
  if (!id) return;
  series.value = (await api.get(`/analytics/e1rm/${id}`)).data.series;
});

const axisStyle = computed(() => ({ style: { colors: appVariable.color.bodyColor, fontSize: '11px' } }));
const gridColor = computed(() => `rgba(${appVariable.color.bodyColorRgb}, .15)`);
const baseChart = computed(() => ({
  toolbar: { show: false },
  fontFamily: 'inherit',
  animations: { enabled: false },
  parentHeightOffset: 0,
}));

/* ---- headline figures -------------------------------------------------- */

const recent = computed(() => weeks.value.slice(-4));

const sessionsPerWeek = computed(() => {
  if (!recent.value.length) return null;
  return recent.value.reduce((a, w) => a + w.workouts, 0) / recent.value.length;
});

// This week against the trailing average, which is the number the plan's
// "never raise weekly volume by more than 20%" rule is actually about.
const volumeVsAverage = computed(() => {
  const current = weeks.value[weeks.value.length - 1];
  if (!current) return null;
  // Prefer a four-week baseline; early on there isn't one, so fall back to the
  // previous trained week rather than showing a dash for the first month.
  const prior = weeks.value.slice(-5, -1).filter((w) => w.volumeKg > 0);
  if (!prior.length) return null;
  const avg = prior.reduce((a, w) => a + w.volumeKg, 0) / prior.length;
  return avg ? { pct: Math.round(((current.volumeKg - avg) / avg) * 100), weeks: prior.length } : null;
});

/** Until there is something to compare against, show the figure itself. */
const volumeThisWeek = computed(() => toDisplay(weeks.value[weeks.value.length - 1]?.volumeKg ?? 0, 0) ?? 0);

const weightChange = computed(() => {
  if (weight.value.length < 2) return null;
  const cutoff = Date.now() - 30 * 864e5;
  const window = weight.value.filter((w) => +new Date(w.date) >= cutoff);
  const from = (window.length >= 2 ? window : weight.value)[0];
  const to = weight.value[weight.value.length - 1];
  return from && to && from !== to ? to.value - from.value : null;
});

// A lift counts as progressing when its best estimate landed in the last month.
const progressing = computed(() => {
  const cutoff = Date.now() - 28 * 864e5;
  const tracked = prs.value.filter((p) => p.sessions >= 2);
  return { n: tracked.filter((p) => +new Date(p.bestE1rmDate) >= cutoff).length, of: tracked.length };
});

/* ---- consistency ------------------------------------------------------- */

const sessionsAxisMax = computed(() =>
  Math.max(targetDays.value ?? 0, ...weeks.value.map((w) => w.workouts), 1) + 1);

const consistencyChart = computed(() => ({
  options: {
    ...baseChart.value,
    chart: { ...baseChart.value, type: 'bar' },
    colors: [appVariable.color.theme],
    plotOptions: { bar: { borderRadius: 2, columnWidth: '55%' } },
    dataLabels: { enabled: false },
    grid: { borderColor: gridColor.value, padding: { left: 4, right: 4 } },
    states: { hover: { filter: { type: 'none' } } },
    xaxis: { categories: weeks.value.map((w) => w.week.slice(5)), labels: axisStyle.value, axisTicks: { show: false } },
    yaxis: {
      labels: { ...axisStyle.value, formatter: (v: number) => String(Math.round(v)) },
      // Headroom for the target line: with a 3/week target and a best week of 2,
      // the annotation sat above the axis maximum and never rendered. min: 0
      // because a free tickAmount put ticks at -2 on a count that cannot go
      // below zero, and one tick per session keeps them whole numbers.
      min: 0,
      max: sessionsAxisMax.value,
      tickAmount: sessionsAxisMax.value,
    },
    tooltip: { y: { formatter: (v: number) => `${v} session${v === 1 ? '' : 's'}` } },
    annotations: targetDays.value
      ? {
          // Deliberately unlabelled: an in-plot label collides with the y-axis
          // ticks at one end and rides over a bar at the other whenever a week
          // beats the target. The card header carries the legend instead.
          yaxis: [{
            y: targetDays.value,
            borderColor: `rgba(${appVariable.color.inverseRgb}, .45)`,
            strokeDashArray: 4,
          }],
        }
      : {},
  },
  series: [{ name: 'Sessions', data: weeks.value.map((w) => w.workouts) }],
}));

/* ---- strength ---------------------------------------------------------- */

/** Outer radius of a marker: `size` 4 plus its 2px stroke. */
const E1RM_MARKER = 6;

/** Smallest round step of at least `raw`, so every gridline is a whole number. */
function integerStep(raw: number): number {
  if (raw <= 1) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
}

/**
 * Whole-number bounds for the e1RM axis.
 *
 * Left to itself ApexCharts picked fractional ticks and the integer formatter
 * collapsed them: 41, 41.6, 42.2 ... rendered as 41, 42, 42, leaving gridlines
 * duplicated or blank. A repeated lift also has no range at all — two sessions
 * at the same estimate is a flat line — so a constant series gets a band
 * around it rather than whatever lopsided window the library invents.
 */
const e1rmAxis = computed(() => {
  const vals = series.value.map((p) => toDisplay(p.e1rm) ?? 0);
  if (!vals.length) return { min: 0, max: 1, tickAmount: 1 };
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const step = integerStep((hi - lo) / 4);
  const min = Math.max(0, Math.floor(lo / step) * step);
  const max = Math.ceil(hi / step) * step;
  return { min, max, tickAmount: Math.max(1, Math.round((max - min) / step)) };
});

const e1rmChart = computed(() => ({
  options: {
    ...baseChart.value,
    chart: { ...baseChart.value, type: 'line' },
    colors: [appVariable.color.theme],
    stroke: { curve: 'straight', width: 2 },
    markers: { size: 4, strokeWidth: 2 },
    dataLabels: { enabled: false },
    // The first marker sits on the plot's left edge, so its radius plus stroke
    // hangs into the y-axis gutter and lands on top of the tick label. Pad the
    // grid by more than the marker's outer radius to keep the two apart.
    grid: { borderColor: gridColor.value, padding: { left: E1RM_MARKER + 4, right: E1RM_MARKER + 4 } },
    xaxis: { categories: series.value.map((p) => p.date.slice(5)), labels: axisStyle.value, axisTicks: { show: false } },
    // One axis, not two: the second scale doubled the axis furniture on a phone
    // for a number the tooltip can carry instead.
    yaxis: {
      labels: { ...axisStyle.value, formatter: (v: number) => String(Math.round(v)) },
      ...e1rmAxis.value,
    },
    tooltip: {
      custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
        const p = series.value[dataPointIndex];
        if (!p) return '';
        return `<div class="px-2 py-1 small"><b>${toDisplay(p.e1rm)} ${unit.value}</b> est. 1RM<br>`
          + `top set ${p.topSetReps} × ${toDisplay(p.topWeightKg)} ${unit.value}</div>`;
      },
    },
  },
  series: [{ name: 'e1RM', data: series.value.map((p) => toDisplay(p.e1rm) ?? 0) }],
}));

/* ---- volume ------------------------------------------------------------ */

const volumeChart = computed(() => ({
  options: {
    ...baseChart.value,
    chart: { ...baseChart.value, type: 'bar' },
    colors: [appVariable.color.theme],
    plotOptions: { bar: { borderRadius: 2, columnWidth: '55%' } },
    dataLabels: { enabled: false },
    grid: { borderColor: gridColor.value, padding: { left: 4, right: 4 } },
    states: { hover: { filter: { type: 'none' } } },
    xaxis: { categories: weeks.value.map((w) => w.week.slice(5)), labels: axisStyle.value, axisTicks: { show: false } },
    yaxis: {
      labels: {
        ...axisStyle.value,
        formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))),
      },
      tickAmount: 3,
    },
    tooltip: { y: { formatter: (v: number) => `${v.toLocaleString()} ${unit.value}` } },
  },
  series: [{ name: 'Volume', data: weeks.value.map((w) => toDisplay(w.volumeKg, 0) ?? 0) }],
}));

/* ---- muscle balance ---------------------------------------------------- */

const topMuscles = computed(() => muscles.value.slice(0, 8));
const muscleChart = computed(() => ({
  options: {
    ...baseChart.value,
    chart: { ...baseChart.value, type: 'bar' },
    colors: [appVariable.color.theme],
    plotOptions: { bar: { horizontal: true, borderRadius: 2, barHeight: '62%' } },
    dataLabels: { enabled: false },
    grid: { borderColor: gridColor.value, padding: { left: 4, right: 4 } },
    states: { hover: { filter: { type: 'none' } } },
    xaxis: {
      categories: topMuscles.value.map((m) => labelize(m.muscle)),
      labels: axisStyle.value,
      crosshairs: { show: false },
    },
    yaxis: { labels: axisStyle.value },
    tooltip: { y: { formatter: (v: number) => `${v} sets/week` } },
  },
  series: [{ name: 'Sets', data: topMuscles.value.map((m) => m.weeklyAvg) }],
}));

const hasTraining = computed(() => weeks.value.some((w) => w.workouts > 0));
</script>

<template>
  <h1 class="page-header">Analytics <small>trends &amp; progress</small></h1>

  <!-- Two per row on a phone, four on a laptop. Each tile is one number and one
       line of context, so nothing has to wrap at 390px. -->
  <div class="row g-2 g-md-3 mb-3">
    <div class="col-6 col-lg-3">
      <Card class="h-100">
        <CardBody class="py-3">
          <div class="text-inverse text-opacity-50 fw-bold fs-11px mb-1">SESSIONS / WEEK</div>
          <div class="fs-3 fw-500 lh-1">{{ sessionsPerWeek != null ? sessionsPerWeek.toFixed(1) : '—' }}</div>
          <div class="small text-inverse text-opacity-50 text-truncate">
            <template v-if="targetDays">4-wk avg · target {{ targetDays }}</template>
            <template v-else>4-week average</template>
          </div>
        </CardBody>
      </Card>
    </div>
    <div class="col-6 col-lg-3">
      <Card class="h-100">
        <CardBody class="py-3">
          <div class="text-inverse text-opacity-50 fw-bold fs-11px mb-1">
            {{ volumeVsAverage ? 'VOLUME vs AVG' : 'VOLUME' }}
          </div>
          <div class="fs-3 fw-500 lh-1" :class="volumeVsAverage && volumeVsAverage.pct > 20 ? 'text-warning' : ''">
            <template v-if="volumeVsAverage">
              {{ volumeVsAverage.pct > 0 ? '+' : '' }}{{ volumeVsAverage.pct }}%
            </template>
            <template v-else>
              {{ volumeThisWeek.toLocaleString() }}<small class="fs-6 text-inverse text-opacity-50"> {{ unit }}</small>
            </template>
          </div>
          <div class="small text-inverse text-opacity-50 text-truncate">
            <template v-if="volumeVsAverage">
              {{ volumeVsAverage.pct > 20 ? 'ramping fast' : `this week vs ${volumeVsAverage.weeks}-wk avg` }}
            </template>
            <template v-else>this week</template>
          </div>
        </CardBody>
      </Card>
    </div>
    <div class="col-6 col-lg-3">
      <Card class="h-100">
        <CardBody class="py-3">
          <div class="text-inverse text-opacity-50 fw-bold fs-11px mb-1">BODY WEIGHT</div>
          <div class="fs-3 fw-500 lh-1">
            {{ weightChange == null ? '—' : `${weightChange > 0 ? '+' : ''}${toDisplay(weightChange, 1)}` }}
            <small v-if="weightChange != null" class="fs-6 text-inverse text-opacity-50">{{ unit }}</small>
          </div>
          <div class="small text-inverse text-opacity-50 text-truncate">last 30 days</div>
        </CardBody>
      </Card>
    </div>
    <div class="col-6 col-lg-3">
      <Card class="h-100">
        <CardBody class="py-3">
          <div class="text-inverse text-opacity-50 fw-bold fs-11px mb-1">
            {{ progressing.of ? 'PROGRESSING' : 'LIFTS TRACKED' }}
          </div>
          <div class="fs-3 fw-500 lh-1">
            <template v-if="progressing.of">
              {{ progressing.n }}<small class="fs-6 text-inverse text-opacity-50">/{{ progressing.of }}</small>
            </template>
            <template v-else>{{ prs.length }}</template>
          </div>
          <div class="small text-inverse text-opacity-50 text-truncate">
            {{ progressing.of ? 'best in last 4 wks' : 'repeat one to compare' }}
          </div>
        </CardBody>
      </Card>
    </div>
  </div>

  <div class="row g-3">
    <div class="col-lg-6">
      <Card class="h-100">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">SESSIONS PER WEEK</span>
            <span v-if="targetDays" class="d-inline-flex align-items-center gap-1 fw-normal text-inverse text-opacity-50 me-2 text-nowrap">
              <span class="d-inline-block" style="width: 14px; border-top: 1px dashed currentColor"></span>
              target {{ targetDays }}
            </span>
            <CardExpandToggler />
          </div>
          <apexchart v-if="hasTraining" type="bar" height="220" :options="consistencyChart.options" :series="consistencyChart.series" />
          <div v-else class="text-inverse text-opacity-50 py-4 text-center small">Nothing logged yet.</div>
        </CardBody>
      </Card>
    </div>

    <div class="col-lg-6">
      <Card class="h-100">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">WEEKLY VOLUME</span>
            <CardExpandToggler />
          </div>
          <apexchart v-if="hasTraining" type="bar" height="220" :options="volumeChart.options" :series="volumeChart.series" />
          <div v-else class="text-inverse text-opacity-50 py-4 text-center small">Nothing logged yet.</div>
        </CardBody>
      </Card>
    </div>

    <div class="col-lg-6">
      <Card class="h-100">
        <CardBody>
          <!-- The selector gets its own row: inline beside the heading it squeezed
               "ESTIMATED 1RM" onto two lines at phone widths. -->
          <div class="d-flex fw-bold small mb-2">
            <span class="flex-grow-1">STRENGTH TREND</span>
            <CardExpandToggler />
          </div>
          <select v-model="selectedExercise" class="form-select form-select-sm mb-3">
            <option v-for="p in prs" :key="p.exerciseId" :value="p.exerciseId">{{ p.name }}</option>
          </select>
          <apexchart
            v-if="series.length > 1"
            type="line"
            height="220"
            :options="e1rmChart.options"
            :series="e1rmChart.series"
          />
          <div v-else-if="series.length === 1" class="text-inverse text-opacity-50 py-4 text-center small">
            One session logged. A second gives this lift a trend to draw.
          </div>
          <div v-else class="text-inverse text-opacity-50 py-4 text-center small">No strength data for this exercise.</div>
        </CardBody>
      </Card>
    </div>

    <div class="col-lg-6">
      <Card class="h-100">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">SETS PER MUSCLE <span class="fw-normal text-inverse text-opacity-50">weekly avg</span></span>
            <CardExpandToggler />
          </div>
          <apexchart v-if="topMuscles.length" type="bar" height="260" :options="muscleChart.options" :series="muscleChart.series" />
          <div v-else class="text-inverse text-opacity-50 py-4 text-center small">No strength volume logged yet.</div>
        </CardBody>
      </Card>
    </div>

    <div class="col-12">
      <Card>
        <CardBody>
          <div class="d-flex fw-bold small mb-2">
            <span class="flex-grow-1">PERSONAL RECORDS</span>
            <CardExpandToggler />
          </div>
          <!-- A five-column table wrapped every cell onto three lines at 390px,
               dates included. One row per lift, name over figures, nothing wraps. -->
          <div class="row g-0">
            <div v-for="p in prs" :key="p.exerciseId" class="col-12 col-md-6 col-xxl-4">
              <RouterLink
                :to="`/exercises/${p.exerciseId}`"
                class="d-block text-decoration-none py-2 px-1 border-bottom border-inverse border-opacity-10"
              >
                <div class="text-inverse text-truncate fw-500">{{ p.name }}</div>
                <div class="small text-inverse text-opacity-50 text-truncate">
                  <span class="text-theme">{{ toDisplay(p.bestE1rm) }} {{ unit }}</span> est. 1RM ·
                  {{ toDisplay(p.maxWeightKg) }} {{ unit }} best ·
                  {{ p.sessions }} session{{ p.sessions === 1 ? '' : 's' }}
                </div>
              </RouterLink>
            </div>
            <div v-if="!prs.length" class="text-inverse text-opacity-50 py-4 text-center small">No records yet.</div>
          </div>
        </CardBody>
      </Card>
    </div>
  </div>
</template>
