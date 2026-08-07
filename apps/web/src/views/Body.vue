<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useAppVariableStore } from '@/stores/app-variable';
import apexchart from '@/components/plugins/ApexChart.vue';
import { BODY_MEASUREMENT_TYPES } from '@overload/shared';
import { labelize, todayLocal } from '@/composables/format';
import { useUnits } from '@/composables/units';
import { api } from '@/api/client';

const { unit, toDisplay, toKg } = useUnits();

const appVariable = useAppVariableStore();

interface MetricRow {
  id: string;
  date: string;
  type: string;
  value: number;
  unit: string;
}

const today = todayLocal();

const weightDate = ref(today);
const weightValue = ref<number | null>(null);
const weightSeries = ref<MetricRow[]>([]);

const types = ref<string[]>([]);
const selectedType = ref('waist');
const newType = ref('');
const metricDate = ref(today);
const metricValue = ref<number | null>(null);
const metricUnit = ref('cm');
const metricSeries = ref<MetricRow[]>([]);

async function loadWeight() {
  const { data } = await api.get('/body-metrics', { params: { type: 'weight', limit: 400 } });
  weightSeries.value = [...data.metrics].reverse();
}

async function loadTypes() {
  const { data } = await api.get('/body-metrics/types');
  types.value = data.types.filter((t: string) => t !== 'weight');
}

/** Standard measurement sites plus any custom types the user has logged. */
const typeOptions = computed(() => {
  const known = new Set(BODY_MEASUREMENT_TYPES.map((t) => t.type));
  const custom = types.value.filter((t) => !known.has(t));
  return [
    ...BODY_MEASUREMENT_TYPES.map((t) => ({ value: t.type, label: t.label })),
    ...custom.map((t) => ({ value: t, label: labelize(t) })),
  ];
});

async function loadMetric() {
  if (!selectedType.value) {
    metricSeries.value = [];
    return;
  }
  const { data } = await api.get('/body-metrics', { params: { type: selectedType.value, limit: 400 } });
  metricSeries.value = [...data.metrics].reverse();
  const last = metricSeries.value.at(-1);
  metricUnit.value =
    last?.unit ?? BODY_MEASUREMENT_TYPES.find((t) => t.type === selectedType.value)?.unit ?? 'cm';
}

onMounted(async () => {
  await Promise.all([loadWeight(), loadTypes()]);
  await loadMetric();
});
watch(selectedType, loadMetric);

async function saveWeight() {
  if (weightValue.value == null) return;
  await api.put('/body-metrics', { date: weightDate.value, type: 'weight', value: toKg(weightValue.value)!, unit: 'kg' });
  weightValue.value = null;
  await loadWeight();
}

async function saveMetric() {
  const type = (newType.value.trim() || selectedType.value).toLowerCase().replace(/\s+/g, '_');
  if (!type || metricValue.value == null) return;
  await api.put('/body-metrics', { date: metricDate.value, type, value: metricValue.value, unit: metricUnit.value });
  metricValue.value = null;
  newType.value = '';
  await loadTypes();
  selectedType.value = type;
  await loadMetric();
}

async function removeMetric(id: string, isWeight: boolean) {
  await api.delete(`/body-metrics/${id}`);
  await (isWeight ? loadWeight() : loadMetric());
}

function movingAvg(rows: MetricRow[], window = 7) {
  return rows.map((_, i) => {
    const slice = rows.slice(Math.max(0, i - window + 1), i + 1);
    return Math.round((slice.reduce((a, r) => a + r.value, 0) / slice.length) * 100) / 100;
  });
}

const weightChart = computed(() => ({
  options: {
    chart: { type: 'line', toolbar: { show: false } },
    colors: [`rgba(${appVariable.color.inverseRgb}, .3)`, appVariable.color.theme],
    stroke: { curve: 'smooth', width: [2, 3] },
    dataLabels: { enabled: false },
    grid: { borderColor: `rgba(${appVariable.color.bodyColorRgb}, .15)` },
    xaxis: {
      categories: weightSeries.value.map((m) => m.date),
      labels: { style: { colors: appVariable.color.bodyColor }, rotate: -45, hideOverlappingLabels: true },
    },
    yaxis: {
      labels: { style: { colors: appVariable.color.bodyColor }, formatter: (v: number) => v.toFixed(1) },
      forceNiceScale: true,
    },
    legend: { labels: { colors: appVariable.color.bodyColor } },
  },
  series: [
    { name: 'Weight', data: weightSeries.value.map((m) => toDisplay(m.value) ?? 0) },
    { name: '7-day avg', data: movingAvg(weightSeries.value).map((v) => toDisplay(v) ?? 0) },
  ],
}));

const metricChart = computed(() => ({
  options: {
    chart: { type: 'line', toolbar: { show: false } },
    colors: [appVariable.color.theme],
    stroke: { curve: 'smooth', width: 3 },
    dataLabels: { enabled: false },
    grid: { borderColor: `rgba(${appVariable.color.bodyColorRgb}, .15)` },
    xaxis: {
      categories: metricSeries.value.map((m) => m.date),
      labels: { style: { colors: appVariable.color.bodyColor }, rotate: -45, hideOverlappingLabels: true },
    },
    yaxis: { labels: { style: { colors: appVariable.color.bodyColor } }, forceNiceScale: true },
  },
  series: [{ name: selectedType.value, data: metricSeries.value.map((m) => m.value) }],
}));

const latestWeight = computed(() => weightSeries.value.at(-1));
</script>
<template>
  <h1 class="page-header">
    Body <small>weigh-ins &amp; measurements</small>
  </h1>

  <div class="row g-3">
    <div class="col-lg-7">
      <Card class="mb-3">
        <CardBody>
          <div class="d-flex fw-bold small mb-3 align-items-center">
            <span class="flex-grow-1">BODY WEIGHT</span>
            <span v-if="latestWeight" class="fw-normal text-inverse text-opacity-50 me-2">
              latest: <span class="text-theme fw-500">{{ toDisplay(latestWeight.value) }} {{ unit }}</span> ({{ latestWeight.date }})
            </span>
            <CardExpandToggler />
          </div>
          <form class="row g-2 mb-3" @submit.prevent="saveWeight">
            <div class="col-auto"><input type="date" v-model="weightDate" class="form-control" /></div>
            <div class="col-auto">
              <input type="number" v-model.number="weightValue" step="0.1" min="20" max="400" class="form-control" :placeholder="unit" required style="width: 110px" />
            </div>
            <div class="col-auto"><button class="btn btn-outline-theme" type="submit">Log weight</button></div>
          </form>
          <apexchart v-if="weightSeries.length" type="line" height="260" :options="weightChart.options" :series="weightChart.series" />
          <div v-else class="text-inverse text-opacity-50">No weigh-ins yet.</div>
        </CardBody>
      </Card>
    </div>

    <div class="col-lg-5">
      <Card class="mb-3">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">MEASUREMENTS</span>
            <CardExpandToggler />
          </div>
          <form class="row g-2 mb-3" @submit.prevent="saveMetric">
            <div class="col-6">
              <select v-model="selectedType" class="form-select" :disabled="!!newType.trim()">
                <option v-for="t in typeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </div>
            <div class="col-6"><input v-model="newType" class="form-control" placeholder="...or new type" /></div>
            <div class="col-4"><input type="date" v-model="metricDate" class="form-control" /></div>
            <div class="col-3"><input type="number" v-model.number="metricValue" step="0.1" class="form-control" placeholder="value" required /></div>
            <div class="col-2"><input v-model="metricUnit" class="form-control" placeholder="unit" /></div>
            <div class="col-3"><button class="btn btn-outline-theme w-100" type="submit">Log</button></div>
          </form>
          <apexchart v-if="metricSeries.length" type="line" height="220" :options="metricChart.options" :series="metricChart.series" />
          <div v-else class="text-inverse text-opacity-50">No entries for this type yet.</div>
        </CardBody>
      </Card>
      <Card v-if="metricSeries.length">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">RECENT {{ selectedType.replace('_', ' ').toUpperCase() }} ENTRIES</span>
          </div>
          <div class="mx-n3 mb-n3">
          <table class="table table-sm align-middle mb-0">
            <tbody>
              <tr v-for="m in [...metricSeries].reverse().slice(0, 8)" :key="m.id">
                <td class="ps-3">{{ m.date }}</td>
                <td class="text-end">{{ m.value }} {{ m.unit }}</td>
                <td class="text-end pe-2" style="width: 3rem">
                  <button class="btn btn-sm btn-link text-danger" @click="removeMetric(m.id, false)"><i class="ti ti-x"></i></button>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </CardBody>
      </Card>
    </div>
  </div>
</template>
