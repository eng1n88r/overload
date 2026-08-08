<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAppVariableStore } from '@/stores/app-variable';
import apexchart from '@/components/plugins/ApexChart.vue';
import { todayLocal } from '@/composables/format';
import { api } from '@/api/client';

const appVariable = useAppVariableStore();

interface LogRow {
  id: string;
  date: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  note: string | null;
}

const today = todayLocal();
const form = ref({ date: today, calories: null as number | null, proteinG: null as number | null, carbsG: null as number | null, fatG: null as number | null });
const logs = ref<LogRow[]>([]);

async function load() {
  const { data } = await api.get('/nutrition', { params: { limit: 30 } });
  logs.value = data.logs;
  const existing = logs.value.find((l) => l.date === form.value.date);
  if (existing) {
    form.value = { date: existing.date, calories: existing.calories, proteinG: existing.proteinG, carbsG: existing.carbsG, fatG: existing.fatG };
  }
}
onMounted(load);

async function save() {
  await api.put('/nutrition', form.value);
  await load();
}

function onDateChange() {
  const existing = logs.value.find((l) => l.date === form.value.date);
  form.value = existing
    ? { date: existing.date, calories: existing.calories, proteinG: existing.proteinG, carbsG: existing.carbsG, fatG: existing.fatG }
    : { date: form.value.date, calories: null, proteinG: null, carbsG: null, fatG: null };
}

const chronological = computed(() => [...logs.value].reverse());

const macroChart = computed(() => ({
  options: {
    chart: { type: 'bar', stacked: true, toolbar: { show: false } },
    colors: [appVariable.color.theme, appVariable.color.pink, appVariable.color.warning],
    plotOptions: { bar: { columnWidth: '60%', borderRadius: 2 } },
    dataLabels: { enabled: false },
    grid: { borderColor: `rgba(${appVariable.color.bodyColorRgb}, .15)` },
    legend: { labels: { colors: appVariable.color.bodyColor } },
    states: { hover: { filter: { type: 'none' } }, active: { filter: { type: 'none' } } },
    // Thirty daily labels do not fit across a phone: ApexCharts rotated them
    // and drew every one anyway, so the axis came out an unreadable stack of
    // dates. Cap the count and let it drop the ones that would collide.
    xaxis: {
      categories: chronological.value.map((l) => l.date.slice(5)),
      labels: { style: { colors: appVariable.color.bodyColor }, rotate: 0, hideOverlappingLabels: true },
      tickAmount: 6,
      crosshairs: { show: false },
    },
    yaxis: { labels: { style: { colors: appVariable.color.bodyColor } }, title: { text: 'grams', style: { color: appVariable.color.bodyColor } } },
    // shared, or the tooltip renders one series group and leaves the other two
    // hidden but filled from series 0 -- pointing at the carbs band of a stack
    // read back "Protein" with protein's number.
    tooltip: { shared: true, y: { formatter: (v: number) => `${v} g` } },
  },
  series: [
    { name: 'Protein', data: chronological.value.map((l) => l.proteinG ?? 0) },
    { name: 'Carbs', data: chronological.value.map((l) => l.carbsG ?? 0) },
    { name: 'Fat', data: chronological.value.map((l) => l.fatG ?? 0) },
  ],
}));

const caloriesChart = computed(() => ({
  options: {
    chart: { type: 'area', toolbar: { show: false } },
    colors: [appVariable.color.theme],
    stroke: { curve: 'smooth', width: 2 },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0.05 } },
    dataLabels: { enabled: false },
    grid: { borderColor: `rgba(${appVariable.color.bodyColorRgb}, .15)` },
    xaxis: {
      categories: chronological.value.map((l) => l.date.slice(5)),
      labels: { style: { colors: appVariable.color.bodyColor }, rotate: 0, hideOverlappingLabels: true },
      tickAmount: 6,
    },
    yaxis: { labels: { style: { colors: appVariable.color.bodyColor } } },
    tooltip: { y: { formatter: (v: number) => `${v} kcal` } },
  },
  series: [{ name: 'Calories', data: chronological.value.map((l) => l.calories ?? 0) }],
}));
</script>
<template>
  <h1 class="page-header">Nutrition <small>daily macros</small></h1>

  <div class="row g-3">
    <div class="col-lg-4">
      <Card class="mb-3">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">LOG DAY</span>
          </div>
          <form @submit.prevent="save">
            <div class="mb-2">
              <label class="form-label">Date</label>
              <input type="date" v-model="form.date" @change="onDateChange" class="form-control" />
            </div>
            <div class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label">Calories</label>
                <input type="number" v-model.number="form.calories" min="0" class="form-control" placeholder="kcal" />
              </div>
              <div class="col-6">
                <label class="form-label">Protein (g)</label>
                <input type="number" v-model.number="form.proteinG" min="0" step="0.1" class="form-control" />
              </div>
              <div class="col-6">
                <label class="form-label">Carbs (g)</label>
                <input type="number" v-model.number="form.carbsG" min="0" step="0.1" class="form-control" />
              </div>
              <div class="col-6">
                <label class="form-label">Fat (g)</label>
                <input type="number" v-model.number="form.fatG" min="0" step="0.1" class="form-control" />
              </div>
            </div>
            <button class="btn btn-outline-theme w-100" type="submit">Save</button>
          </form>
        </CardBody>
      </Card>
    </div>
    <div class="col-lg-8">
      <Card class="mb-3">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">MACROS (LAST 30 DAYS)</span>
            <CardExpandToggler />
          </div>
          <apexchart v-if="logs.length" type="bar" height="240" :options="macroChart.options" :series="macroChart.series" />
          <div v-else class="text-inverse text-opacity-50">Nothing logged yet.</div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">CALORIES</span>
            <CardExpandToggler />
          </div>
          <apexchart v-if="logs.length" type="area" height="200" :options="caloriesChart.options" :series="caloriesChart.series" />
          <div v-else class="text-inverse text-opacity-50">Nothing logged yet.</div>
        </CardBody>
      </Card>
    </div>
  </div>
</template>
