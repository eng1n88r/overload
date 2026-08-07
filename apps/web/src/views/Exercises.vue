<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { MUSCLES, EQUIPMENT_GROUPS } from '@overload/shared';
import { labelize } from '@/composables/format';
import { api } from '@/api/client';

interface ExerciseCard {
  id: string;
  name: string;
  category: string;
  equipment: string;
  level: string | null;
  images: string[];
  primaryMuscles: string[];
}

const filters = reactive({ search: '', muscle: '', equipment: '', category: '' });
const exercises = ref<ExerciseCard[]>([]);
const total = ref(0);
const loading = ref(false);
const PAGE = 60;

let searchTimer: ReturnType<typeof setTimeout> | undefined;

async function load(append = false) {
  loading.value = true;
  try {
    const { data } = await api.get('/exercises', {
      params: {
        search: filters.search || undefined,
        muscle: filters.muscle || undefined,
        equipment: filters.equipment || undefined,
        category: filters.category || undefined,
        limit: PAGE,
        offset: append ? exercises.value.length : 0,
      },
    });
    total.value = data.total;
    exercises.value = append ? [...exercises.value, ...data.exercises] : data.exercises;
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());
watch(() => [filters.muscle, filters.equipment, filters.category], () => load());
watch(
  () => filters.search,
  () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(), 300);
  },
);
</script>
<template>
  <h1 class="page-header">Exercises <small>{{ total }} in catalog</small></h1>

  <div class="row g-2 mb-3">
    <div class="col-md-4">
      <input v-model="filters.search" class="form-control" placeholder="Search exercises..." />
    </div>
    <div class="col-md-3 col-6">
      <select v-model="filters.muscle" class="form-select">
        <option value="">All muscles</option>
        <option v-for="m in MUSCLES" :key="m" :value="m">{{ labelize(m) }}</option>
      </select>
    </div>
    <div class="col-md-3 col-6">
      <select v-model="filters.equipment" class="form-select">
        <option value="">All equipment</option>
        <optgroup v-for="g in EQUIPMENT_GROUPS" :key="g.key" :label="g.label">
          <option v-for="e in g.items" :key="e" :value="e">{{ labelize(e) }}</option>
        </optgroup>
      </select>
    </div>
    <div class="col-md-2">
      <select v-model="filters.category" class="form-select">
        <option value="">All types</option>
        <option value="strength">Strength</option>
        <option value="cardio">Cardio</option>
        <option value="stretch">Stretch</option>
      </select>
    </div>
  </div>

  <div class="row g-3">
    <div v-for="ex in exercises" :key="ex.id" class="col-xl-2 col-lg-3 col-md-4 col-sm-6">
      <RouterLink :to="`/exercises/${ex.id}`" class="text-decoration-none">
        <Card class="h-100">
          <div class="card-img ratio ratio-4x3 bg-white bg-opacity-10 overflow-hidden">
            <img
              v-if="ex.images[0]"
              :src="ex.images[0]"
              class="object-fit-cover w-100 h-100"
              loading="lazy"
              :alt="ex.name"
            />
            <div v-else class="d-flex align-items-center justify-content-center">
              <i class="ti ti-barbell fs-28px text-inverse text-opacity-25"></i>
            </div>
          </div>
          <CardBody class="p-2">
            <div class="fw-500 text-inverse lh-sm mb-2 fs-14px">{{ ex.name }}</div>
            <div class="d-flex flex-wrap gap-1">
              <span
                v-for="m in ex.primaryMuscles.slice(0, 2)"
                :key="m"
                class="badge bg-theme text-theme-900 fs-12px"
              >
                {{ labelize(m) }}
              </span>
              <span v-if="!ex.primaryMuscles.length" class="badge bg-theme text-theme-900 fs-12px">
                {{ labelize(ex.category) }}
              </span>
              <span class="badge bg-inverse bg-opacity-25 text-inverse fs-12px">{{ labelize(ex.equipment) }}</span>
            </div>
          </CardBody>
        </Card>
      </RouterLink>
    </div>
  </div>

  <div class="text-center my-3" v-if="exercises.length < total">
    <button class="btn btn-outline-theme" :disabled="loading" @click="load(true)">
      Load more ({{ exercises.length }} / {{ total }})
    </button>
  </div>
  <div v-if="!loading && !exercises.length" class="text-inverse text-opacity-50">No exercises match.</div>
</template>
