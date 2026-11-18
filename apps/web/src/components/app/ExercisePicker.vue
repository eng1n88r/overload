<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { MUSCLES } from '@overload/shared';
import { labelize } from '@/composables/format';
import { api } from '@/api/client';

export interface PickerExercise {
  id: string;
  name: string;
  category: string;
  equipment: string;
  images: string[];
  primaryMuscles: string[];
  /** Only on suggestions: completed sessions this lift has appeared in. */
  timesDone?: number;
}

const props = withDefaults(
  defineProps<{
    /** Offered before anything is typed — the caller's best guesses. */
    suggestions?: PickerExercise[];
    suggestionsLabel?: string;
    /** Catalog ids never to offer, e.g. the lift being replaced. */
    exclude?: string[];
    /** Icon on each row: what picking one will do. */
    icon?: string;
  }>(),
  { suggestions: () => [], suggestionsLabel: 'Suggested', exclude: () => [], icon: 'ti-plus' },
);
const emit = defineEmits<{ pick: [exercise: PickerExercise] }>();

const query = ref('');
const muscle = ref('');
const results = ref<PickerExercise[]>([]);
/** False while a search is still on its way — an empty list is not yet an answer. */
const answered = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const searching = computed(() => Boolean(query.value.trim() || muscle.value));
const rows = computed(() =>
  (searching.value ? results.value : props.suggestions).filter((ex) => !props.exclude.includes(ex.id)),
);

function search() {
  clearTimeout(timer);
  answered.value = false;
  timer = setTimeout(async () => {
    if (!searching.value) {
      results.value = [];
      return;
    }
    const { data } = await api.get('/exercises', {
      params: {
        search: query.value || undefined,
        muscle: muscle.value || undefined,
        // Browsing by muscle means lifting; a typed name can be anything.
        category: query.value ? undefined : 'strength',
        limit: 8,
      },
    });
    results.value = data.exercises;
    answered.value = true;
  }, 250);
}
onBeforeUnmount(() => clearTimeout(timer));

function pick(ex: PickerExercise) {
  emit('pick', ex);
  query.value = '';
  results.value = [];
}
</script>
<template>
  <input v-model="query" @input="search" class="form-control mb-2" placeholder="Search catalog..." />
  <select v-model="muscle" @change="search" class="form-select form-select-sm mb-2">
    <option value="">Filter by muscle...</option>
    <option v-for="m in MUSCLES" :key="m" :value="m">{{ labelize(m) }}</option>
  </select>
  <div v-if="!searching && rows.length" class="text-inverse text-opacity-50 small mt-3 mb-1">{{ suggestionsLabel }}</div>
  <!-- The whole row is the target: on a phone a 30px button at the end of a
       line is the hard part of picking an exercise. -->
  <div
    v-for="ex in rows"
    :key="ex.id"
    class="d-flex align-items-center py-2 border-bottom border-inverse border-opacity-10"
    role="button"
    :title="ex.name"
    @click="pick(ex)"
  >
    <img v-if="ex.images[0]" :src="ex.images[0]" class="rounded object-fit-cover me-2 flex-shrink-0" style="width: 48px; height: 36px" :alt="ex.name" />
    <div v-else class="rounded bg-white bg-opacity-10 d-flex align-items-center justify-content-center me-2 flex-shrink-0" style="width: 48px; height: 36px">
      <i class="ti ti-barbell text-inverse text-opacity-25"></i>
    </div>
    <div class="flex-grow-1 lh-sm">
      <div class="text-inverse small fw-500">{{ ex.name }}</div>
      <div class="text-inverse text-opacity-50" style="font-size: 0.7rem">
        {{ ex.primaryMuscles.join(', ') }} · {{ ex.equipment }}<template v-if="ex.timesDone"> · done {{ ex.timesDone }}×</template>
      </div>
    </div>
    <span class="btn btn-sm btn-outline-theme ms-2 flex-shrink-0"><i class="ti" :class="icon"></i></span>
  </div>
  <div v-if="searching && answered && !rows.length" class="text-inverse text-opacity-50 small py-2">Nothing in the catalog matches.</div>
</template>
