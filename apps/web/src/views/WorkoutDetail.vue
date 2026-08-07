<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { fmtDuration, fmtWorkoutDate, labelize } from '@/composables/format';
import MarkdownText from '@/components/app/MarkdownText.vue';
import { useDistanceUnit, useUnits } from '@/composables/units';
import { api } from '@/api/client';

const { unit, toDisplay } = useUnits();
const { distanceUnit, toDisplay: distanceToDisplay } = useDistanceUnit();

interface SetRow {
  id: string;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  distanceM: number | null;
  isWarmup: boolean;
  multiplier: number;
  resistance: number | null;
}
interface WorkoutExerciseRow {
  id: string;
  exerciseId: string;
  exerciseName: string;
  image: string | null;
  targetSets: number | null;
  targetRepsLow: number | null;
  targetRepsHigh: number | null;
  targetWeightKg: number | null;
  sets: SetRow[];
}
interface WorkoutFull {
  id: string;
  date: string;
  name: string | null;
  status: string;
  notes: string | null;
  durationSec: number | null;
  exercises: WorkoutExerciseRow[];
}

const route = useRoute();
const workout = ref<WorkoutFull | null>(null);

onMounted(async () => {
  const { data } = await api.get(`/workouts/${route.params.id}`);
  workout.value = data.workout;
});

function setLabel(s: SetRow) {
  if (s.durationSec) {
    // Sub-minute holds must not round to "1 min" / "0 min".
    const dur = s.durationSec < 60 ? `${Math.round(s.durationSec)}s` : `${Math.round(s.durationSec / 60)} min`;
    return s.distanceM ? `${dur} · ${distanceToDisplay(s.distanceM)} ${distanceUnit.value}` : dur;
  }
  if (s.reps == null) return '—';
  return s.weightKg
    ? `${s.reps} × ${toDisplay(s.weightKg)} ${unit.value}${s.multiplier > 1 ? ` ×${s.multiplier}` : ''}`
    : s.resistance != null
      ? `${s.reps} reps · band ${s.resistance}`
      : `${s.reps} reps`;
}
</script>
<template>
  <template v-if="workout">
    <div class="d-sm-flex align-items-center mb-3 gap-2">
      <div class="mb-2 mb-sm-0">
        <h1 class="page-header mb-0">{{ workout.name || 'Workout' }}</h1>
        <div class="text-inverse text-opacity-50">
          {{ fmtWorkoutDate(workout.date, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) }}
          · {{ labelize(workout.status) }}<template v-if="fmtDuration(workout.durationSec)">
          · {{ fmtDuration(workout.durationSec) }}</template>
        </div>
      </div>
      <div class="ms-sm-auto d-flex gap-2">
        <RouterLink
          v-if="workout.status === 'planned' || workout.status === 'in_progress'"
          :to="`/workouts/${workout.id}/live`"
          class="btn btn-theme"
        >
          <i class="ti ti-player-play me-1"></i>{{ workout.status === 'in_progress' ? 'Continue' : 'Start' }}
        </RouterLink>
        <RouterLink :to="`/workouts/${workout.id}/edit`" class="btn btn-outline-theme">
          <i class="ti ti-pencil me-1"></i> Edit
        </RouterLink>
      </div>
    </div>

    <MarkdownText v-if="workout.notes" :text="workout.notes" class="alert alert-secondary" />

    <div class="row g-3">
      <div v-for="we in workout.exercises" :key="we.id" class="col-12 col-md-6 col-lg-4">
        <Card class="h-100">
          <CardBody class="d-flex">
            <RouterLink :to="`/exercises/${we.exerciseId}`" class="flex-shrink-0 me-3">
              <img
                v-if="we.image"
                :src="we.image"
                class="rounded object-fit-cover"
                style="width: 84px; height: 63px"
                :alt="we.exerciseName"
              />
              <div
                v-else
                class="rounded bg-white bg-opacity-10 d-flex align-items-center justify-content-center"
                style="width: 84px; height: 63px"
              >
                <i class="ti ti-barbell fs-18px text-inverse text-opacity-25"></i>
              </div>
            </RouterLink>
            <div class="flex-grow-1">
              <RouterLink :to="`/exercises/${we.exerciseId}`" class="fw-500 text-inverse text-decoration-none">
                {{ we.exerciseName }}
              </RouterLink>
              <div v-if="we.targetSets" class="small text-inverse text-opacity-50">
                target {{ we.targetSets }} × {{ we.targetRepsLow }}–{{ we.targetRepsHigh }}
                <template v-if="we.targetWeightKg">@ {{ toDisplay(we.targetWeightKg) }} {{ unit }}</template>
              </div>
              <div class="mt-1">
                <div v-for="s in we.sets" :key="s.id" class="small">
                  <i v-if="s.isWarmup" class="ti ti-flame text-warning" title="warmup"></i>
                  {{ setLabel(s) }}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  </template>
</template>
