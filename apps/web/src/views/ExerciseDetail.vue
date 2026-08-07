<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAppVariableStore } from '@/stores/app-variable';
import apexchart from '@/components/plugins/ApexChart.vue';
import { labelize } from '@/composables/format';
import { useUnits } from '@/composables/units';
import { api } from '@/api/client';

const { unit, toDisplay } = useUnits();

const appVariable = useAppVariableStore();

interface ExerciseFull {
  id: string;
  name: string;
  category: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string;
  instructions: string[];
  images: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  aliases: string[];
}

const route = useRoute();
const exercise = ref<ExerciseFull | null>(null);
const notFound = ref(false);
const series = ref<{ date: string; e1rm: number; topWeightKg: number; volumeKg: number }[]>([]);

onMounted(async () => {
  try {
    const { data } = await api.get(`/exercises/${route.params.id}`);
    exercise.value = data.exercise;
    const e1rm = await api.get(`/analytics/e1rm/${route.params.id}`);
    series.value = e1rm.data.series;
  } catch {
    notFound.value = true;
  }
});

const e1rmChart = computed(() => ({
  options: {
    chart: { type: 'line', toolbar: { show: false } },
    colors: [appVariable.color.theme],
    stroke: { curve: 'smooth', width: 3 },
    dataLabels: { enabled: false },
    grid: { borderColor: `rgba(${appVariable.color.bodyColorRgb}, .15)` },
    xaxis: {
      categories: series.value.map((p) => p.date),
      labels: { style: { colors: appVariable.color.bodyColor }, rotate: -45, hideOverlappingLabels: true },
    },
    yaxis: { labels: { style: { colors: appVariable.color.bodyColor } } },
    tooltip: { y: { formatter: (v: number) => `${v} ${unit.value}` } },
  },
  series: [{ name: 'e1RM', data: series.value.map((p) => toDisplay(p.e1rm) ?? 0) }],
}));
</script>
<template>
  <template v-if="exercise">
    <h1 class="page-header">
      {{ exercise.name }}
      <small>{{ exercise.equipment }} · {{ exercise.level ?? exercise.category }}</small>
    </h1>

    <div class="row g-3">
      <div class="col-lg-6">
        <Card class="mb-3">
          <CardBody>
            <div class="d-flex fw-bold small mb-3">
              <span class="flex-grow-1">EXECUTION</span>
              <CardExpandToggler />
            </div>
            <div class="row g-2" v-if="exercise.images.length">
              <div v-for="(img, i) in exercise.images" :key="img" class="col-6">
                <img :src="img" class="img-fluid rounded" :alt="`${exercise.name} step ${i + 1}`" />
              </div>
            </div>
            <div v-else class="text-center py-4">
              <i class="ti ti-barbell fs-42px text-inverse text-opacity-25"></i>
              <div class="small text-inverse text-opacity-50 mt-2">No demo photos yet — follow the instructions.</div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div class="d-flex fw-bold small mb-3">
              <span class="flex-grow-1">DETAILS</span>
            </div>
            <div class="d-flex flex-wrap align-items-center gap-1 mb-2">
              <span class="text-inverse text-opacity-50 me-1">Primary:</span>
              <span v-for="m in exercise.primaryMuscles" :key="m" class="badge bg-theme text-theme-900">
                {{ labelize(m) }}
              </span>
              <span v-if="!exercise.primaryMuscles.length" class="text-inverse text-opacity-50">—</span>
            </div>
            <div class="d-flex flex-wrap align-items-center gap-1 mb-2">
              <span class="text-inverse text-opacity-50 me-1">Secondary:</span>
              <span v-for="m in exercise.secondaryMuscles" :key="m" class="badge bg-inverse bg-opacity-25">
                {{ labelize(m) }}
              </span>
              <span v-if="!exercise.secondaryMuscles.length" class="text-inverse text-opacity-50">—</span>
            </div>
            <div class="mb-2" v-if="exercise.mechanic">
              <span class="text-inverse text-opacity-50 me-2">Mechanic:</span>{{ exercise.mechanic }}
            </div>
            <div v-if="exercise.force">
              <span class="text-inverse text-opacity-50 me-2">Force:</span>{{ exercise.force }}
            </div>
          </CardBody>
        </Card>
      </div>
      <div class="col-lg-6">
        <Card v-if="series.length" class="mb-3">
          <CardBody>
            <div class="d-flex fw-bold small mb-3">
              <span class="flex-grow-1">YOUR E1RM HISTORY</span>
              <CardExpandToggler />
            </div>
            <apexchart type="line" height="220" :options="e1rmChart.options" :series="e1rmChart.series" />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div class="d-flex fw-bold small mb-3">
              <span class="flex-grow-1">INSTRUCTIONS</span>
            </div>
            <ol class="mb-0 ps-3">
              <li v-for="(step, i) in exercise.instructions" :key="i" class="mb-2">{{ step }}</li>
            </ol>
            <div v-if="!exercise.instructions.length" class="text-inverse text-opacity-50">
              No instructions available.
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  </template>
  <div v-else-if="notFound" class="text-inverse text-opacity-50">Exercise not found.</div>
</template>
