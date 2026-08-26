<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MUSCLES } from '@overload/shared';
import { dismissPicker, labelize, todayLocal } from '@/composables/format';
import { useDistanceUnit, useUnits } from '@/composables/units';
import { api, errorMessage } from '@/api/client';

const { unit, toDisplay, toKg } = useUnits();
const { distanceUnit, toDisplay: distanceToDisplay, toMeters } = useDistanceUnit();

interface SetForm {
  reps: number | null;
  /** display unit; converted to kg on save */
  weight: number | null;
  durationMin: number | null;
  /** timed holds: seconds, stored straight into durationSec */
  seconds: number | null;
  /** display unit; converted to meters on save */
  distance: number | null;
  resistance: number | null;
  isWarmup: boolean;
}

type InputMode = 'cardio' | 'timed' | 'reps';
function modeOf(we: { category: string; unit?: string | null }): InputMode {
  if (we.category === 'cardio') return 'cardio';
  return we.unit === 'seconds' ? 'timed' : 'reps';
}
type LoadKind = 'weight' | 'band' | 'bodyweight';
function loadKindOf(equipment?: string | null): LoadKind {
  if (equipment === 'resistance band') return 'band';
  if (equipment === 'bodyweight') return 'bodyweight';
  return 'weight';
}
interface ExerciseForm {
  exerciseId: string;
  exerciseName: string;
  image: string | null;
  category: string;
  equipment: string | null;
  unit: string | null;
  sets: SetForm[];
}
interface PickerResult {
  id: string;
  name: string;
  category: string;
  equipment: string;
  images: string[];
  primaryMuscles: string[];
}
interface RawSet {
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  distanceM: number | null;
  resistance: number | null;
  isWarmup: boolean;
}
interface RawExercise {
  exerciseId: string;
  exerciseName: string;
  image: string | null;
  category: string | null;
  equipment: string | null;
  unit: string | null;
  sets: RawSet[];
}

const route = useRoute();
const router = useRouter();
const editId = computed(() => (route.params.id as string) || null);

const date = ref(todayLocal());
const name = ref('');
const status = ref('completed');
const notes = ref('');
const exercises = ref<ExerciseForm[]>([]);
const error = ref('');
const busy = ref(false);

const pickerQuery = ref('');
const pickerMuscle = ref('');
const pickerResults = ref<PickerResult[]>([]);
let pickerTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(async () => {
  if (!editId.value) return;
  const { data } = await api.get(`/workouts/${editId.value}`);
  const w = data.workout;
  date.value = w.date.slice(0, 10);
  name.value = w.name ?? '';
  status.value = w.status;
  notes.value = w.notes ?? '';
  exercises.value = w.exercises.map((we: RawExercise) => ({
    exerciseId: we.exerciseId,
    exerciseName: we.exerciseName,
    image: we.image,
    category: we.category ?? 'strength',
    equipment: we.equipment ?? null,
    unit: we.unit ?? null,
    sets: we.sets.map((s: RawSet) => ({
      reps: s.reps,
      weight: toDisplay(s.weightKg),
      durationMin: s.durationSec != null ? Math.round(s.durationSec / 60) : null,
      seconds: s.durationSec,
      distance: distanceToDisplay(s.distanceM),
      resistance: s.resistance,
      isWarmup: s.isWarmup,
    })),
  }));
});

function searchExercises() {
  clearTimeout(pickerTimer);
  pickerTimer = setTimeout(async () => {
    if (!pickerQuery.value.trim() && !pickerMuscle.value) {
      pickerResults.value = [];
      return;
    }
    const { data } = await api.get('/exercises', {
      params: {
        search: pickerQuery.value || undefined,
        muscle: pickerMuscle.value || undefined,
        category: pickerQuery.value ? undefined : 'strength',
        limit: 8,
      },
    });
    pickerResults.value = data.exercises;
  }, 250);
}

const emptySet = (): SetForm => ({ reps: null, weight: null, durationMin: null, seconds: null, distance: null, resistance: null, isWarmup: false });

function addExercise(ex: PickerResult) {
  exercises.value.push({
    exerciseId: ex.id,
    exerciseName: ex.name,
    image: ex.images[0] ?? null,
    category: ex.category,
    equipment: ex.equipment,
    unit: null,
    sets: [emptySet()],
  });
  pickerQuery.value = '';
  pickerResults.value = [];
}

function move(i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= exercises.value.length) return;
  const arr = exercises.value;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

async function save() {
  error.value = '';
  busy.value = true;
  try {
    const payload = {
      date: new Date(`${date.value}T12:00:00`).toISOString(),
      name: name.value || null,
      status: status.value,
      notes: notes.value || null,
      exercises: exercises.value.map((we) => {
        const mode = modeOf(we);
        const load = loadKindOf(we.equipment);
        return {
          exerciseId: we.exerciseId,
          sets: we.sets
            .filter(
              (s) =>
                s.reps != null || s.weight != null || s.durationMin != null || s.seconds != null ||
                s.distance != null || s.resistance != null,
            )
            .map((s) => ({
              reps: mode === 'reps' ? s.reps : null,
              weightKg: mode !== 'cardio' && load === 'weight' ? toKg(s.weight) : null,
              resistance: load === 'band' ? s.resistance : null,
              durationSec:
                mode === 'cardio'
                  ? s.durationMin != null
                    ? s.durationMin * 60
                    : null
                  : mode === 'timed'
                    ? s.seconds
                    : null,
              distanceM: mode === 'cardio' ? toMeters(s.distance) : null,
              isWarmup: s.isWarmup,
            })),
        };
      }),
    };
    if (editId.value) {
      await api.patch(`/workouts/${editId.value}`, payload);
      router.push(`/workouts/${editId.value}`);
    } else {
      const { data } = await api.post('/workouts', payload);
      router.push(`/workouts/${data.workout.id}`);
    }
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <h1 class="page-header">{{ editId ? 'Edit workout' : 'New workout' }}</h1>

  <div v-if="error" class="alert alert-danger">{{ error }}</div>

  <div class="row g-3">
    <div class="col-lg-8">
      <Card class="mb-3">
        <CardBody>
          <div class="row g-2 mb-2">
            <div class="col-md-3"><label class="form-label">Date</label><input type="date" v-model="date" @change="dismissPicker($event)" class="form-control" /></div>
            <div class="col-md-5"><label class="form-label">Name</label><input v-model="name" class="form-control" placeholder="e.g. Upper A" /></div>
            <div class="col-md-4">
              <label class="form-label">Status</label>
              <select v-model="status" class="form-select">
                <option value="planned">Planned</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="skipped">Skipped</option>
              </select>
            </div>
          </div>
          <label class="form-label">Notes</label>
          <textarea v-model="notes" class="form-control" rows="2"></textarea>
        </CardBody>
      </Card>

      <Card v-for="(we, i) in exercises" :key="i" class="mb-3">
        <CardBody>
          <div class="d-flex align-items-center mb-2">
            <img v-if="we.image" :src="we.image" class="rounded object-fit-cover me-2" style="width: 56px; height: 42px" />
            <div v-else class="rounded bg-white bg-opacity-10 d-flex align-items-center justify-content-center me-2 flex-shrink-0" style="width: 56px; height: 42px">
              <i class="ti ti-barbell text-inverse text-opacity-25"></i>
            </div>
            <span class="fw-500 text-inverse">{{ we.exerciseName }}</span>
            <div class="ms-auto btn-group">
              <button class="btn btn-sm btn-outline-secondary" @click="move(i, -1)"><i class="ti ti-arrow-up"></i></button>
              <button class="btn btn-sm btn-outline-secondary" @click="move(i, 1)"><i class="ti ti-arrow-down"></i></button>
              <button class="btn btn-sm btn-outline-secondary" title="Remove exercise" @click="exercises.splice(i, 1)"><i class="ti ti-trash"></i></button>
            </div>
          </div>
          <div v-for="(s, j) in we.sets" :key="j" class="d-flex align-items-center gap-2 mb-1">
            <span class="text-inverse text-opacity-50 small" style="width: 2rem">#{{ j + 1 }}</span>
            <template v-if="modeOf(we) === 'cardio'">
              <input type="number" v-model.number="s.durationMin" class="form-control form-control-sm" style="width: 100px" placeholder="min" min="0" />
              <span class="text-inverse text-opacity-50">min</span>
              <input type="number" v-model.number="s.distance" class="form-control form-control-sm" style="width: 110px" :placeholder="distanceUnit" min="0" step="0.1" />
              <span class="text-inverse text-opacity-50">{{ distanceUnit }}</span>
            </template>
            <template v-else-if="modeOf(we) === 'timed'">
              <input type="number" v-model.number="s.seconds" class="form-control form-control-sm" style="width: 100px" placeholder="sec" min="0" step="5" />
              <span class="text-inverse text-opacity-50">sec hold</span>
              <template v-if="loadKindOf(we.equipment) === 'weight'">
                <input type="number" v-model.number="s.weight" class="form-control form-control-sm" style="width: 110px" :placeholder="unit" min="0" step="0.5" />
                <span class="text-inverse text-opacity-50">{{ unit }} added</span>
              </template>
            </template>
            <template v-else>
              <input type="number" v-model.number="s.reps" class="form-control form-control-sm" style="width: 90px" placeholder="reps" min="0" />
              <span class="text-inverse text-opacity-50" v-if="loadKindOf(we.equipment) === 'weight'">×</span>
              <input v-if="loadKindOf(we.equipment) === 'weight'" type="number" v-model.number="s.weight" class="form-control form-control-sm" style="width: 110px" :placeholder="unit" min="0" step="0.5" />
              <template v-else-if="loadKindOf(we.equipment) === 'band'">
                <input type="number" v-model.number="s.resistance" class="form-control form-control-sm" style="width: 110px" placeholder="band" min="0" />
                <span class="text-inverse text-opacity-50">band</span>
              </template>
              <span class="text-inverse text-opacity-50" v-else>reps</span>
              <div class="form-check ms-2">
                <input class="form-check-input" type="checkbox" v-model="s.isWarmup" :id="`wu-${i}-${j}`" />
                <label class="form-check-label small" :for="`wu-${i}-${j}`">warmup</label>
              </div>
            </template>
            <button class="btn btn-sm btn-link text-inverse text-opacity-50 ms-auto" title="Remove set" @click="we.sets.splice(j, 1)"><i class="ti ti-x"></i></button>
          </div>
          <button class="btn btn-sm btn-outline-theme mt-1" @click="we.sets.push({ ...(we.sets.at(-1) ?? emptySet()), isWarmup: false })">
            <i class="ti ti-plus me-1"></i>Add set
          </button>
        </CardBody>
      </Card>

      <button class="btn btn-outline-theme btn-lg w-100 mb-3" :disabled="busy || !exercises.length" @click="save">
        {{ editId ? 'Save changes' : 'Create workout' }}
      </button>
    </div>

    <div class="col-lg-4">
      <Card>
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">ADD EXERCISE</span>
          </div>
          <input
            v-model="pickerQuery"
            @input="searchExercises"
            class="form-control mb-2"
            placeholder="Search catalog..."
          />
          <select v-model="pickerMuscle" @change="searchExercises" class="form-select form-select-sm mb-2">
            <option value="">Filter by muscle...</option>
            <option v-for="m in MUSCLES" :key="m" :value="m">{{ labelize(m) }}</option>
          </select>
          <div v-for="ex in pickerResults" :key="ex.id" class="d-flex align-items-center py-1 border-bottom border-inverse border-opacity-10">
            <img v-if="ex.images[0]" :src="ex.images[0]" class="rounded object-fit-cover me-2" style="width: 48px; height: 36px" />
            <div v-else class="rounded bg-white bg-opacity-10 d-flex align-items-center justify-content-center me-2 flex-shrink-0" style="width: 48px; height: 36px">
              <i class="ti ti-barbell text-inverse text-opacity-25"></i>
            </div>
            <div class="flex-grow-1 lh-sm">
              <div class="text-inverse small fw-500">{{ ex.name }}</div>
              <div class="text-inverse text-opacity-50" style="font-size: 0.7rem">
                {{ ex.primaryMuscles.join(', ') }} · {{ ex.equipment }}
              </div>
            </div>
            <button class="btn btn-sm btn-outline-theme ms-2" @click="addExercise(ex)"><i class="ti ti-plus"></i></button>
          </div>
        </CardBody>
      </Card>
    </div>
  </div>
</template>
