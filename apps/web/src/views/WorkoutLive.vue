<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useDistanceUnit, useUnits } from '@/composables/units';
import { api } from '@/api/client';

const { unit, toDisplay, toKg, weightStep } = useUnits();
const { distanceUnit, toDisplay: distanceToDisplay, toMeters } = useDistanceUnit();

interface SetRow {
  id: string;
  order: number;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  distanceM: number | null;
  resistance: number | null;
  rpe: number | null;
  isWarmup: boolean;
}
interface LiveExercise {
  id: string;
  exerciseId: string;
  exerciseName: string;
  image: string | null;
  category: string;
  equipment: string;
  /** 'reps' | 'seconds', resolved server-side from the workout or catalog default */
  unit: string;
  targetSets: number | null;
  targetRepsLow: number | null;
  targetRepsHigh: number | null;
  targetWeightKg: number | null;
  notes: string | null;
  sets: SetRow[];
  /** weight/distance are in the user's display unit; converted on log */
  input: {
    reps: number | null;
    weight: number | null;
    durationMin: number | null;
    /** Set once the field is edited by hand; until then it tracks the clock. */
    durationEdited: boolean;
    seconds: number | null;
    distance: number | null;
    resistance: number | null;
    isWarmup: boolean;
  };
}

type InputMode = 'cardio' | 'timed' | 'reps';

/** Three modes, not two: a timed hold is not cardio and is not reps. */
function modeOf(we: { category: string; unit: string }): InputMode {
  if (we.category === 'cardio') return 'cardio';
  return we.unit === 'seconds' ? 'timed' : 'reps';
}

/** How the load is expressed — bands are resistance, bodyweight is unloaded. */
type LoadKind = 'weight' | 'band' | 'bodyweight';
function loadKindOf(equipment: string): LoadKind {
  if (equipment === 'resistance band') return 'band';
  if (equipment === 'bodyweight') return 'bodyweight';
  return 'weight';
}

function fmtDuration(sec: number): string {
  return sec < 60 ? `${Math.round(sec)}s` : `${Math.round(sec / 60)} min`;
}

function setText(s: SetRow): string {
  if (s.durationSec) {
    const dur = fmtDuration(s.durationSec);
    return s.distanceM ? `${dur} · ${distanceToDisplay(s.distanceM)} ${distanceUnit.value}` : dur;
  }
  const reps = s.reps ?? '—';
  // An unloaded set is "15 reps", never "15 × — kg".
  if (s.weightKg != null) return `${reps} × ${toDisplay(s.weightKg)} ${unit.value}`;
  if (s.resistance != null) return `${reps} reps · band ${s.resistance}`;
  return `${reps} reps`;
}

const route = useRoute();
const router = useRouter();
const workoutId = route.params.id as string;

const name = ref('');
const status = ref('');
const exercises = ref<LiveExercise[]>([]);
const startedAt = ref(Date.now());
const elapsed = ref(0);
const restLeft = ref(0);
const restEndsAt = ref(0);
const restTotal = ref(90);
let tick: ReturnType<typeof setInterval> | undefined;

/** Session and rest timers are persisted as absolute timestamps rather than
 *  held as countdowns in component state: leaving the page (checking an
 *  exercise mid-rest) unmounts this view, and phones evict backgrounded tabs.
 *  Timestamps also mean both clocks keep running while away — matching the
 *  gym, where rest elapses whether or not you're looking at the screen. */
const TIMER_KEY = `ovl_live_${workoutId}`;
const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

function saveTimers() {
  localStorage.setItem(
    TIMER_KEY,
    JSON.stringify({ startedAt: startedAt.value, restEndsAt: restEndsAt.value, restTotal: restTotal.value }),
  );
}

function restoreTimers() {
  const raw = localStorage.getItem(TIMER_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      // A session left running overnight is abandoned, not resumable.
      if (typeof saved.startedAt === 'number' && Date.now() - saved.startedAt < STALE_SESSION_MS) {
        startedAt.value = saved.startedAt;
        if (typeof saved.restTotal === 'number') restTotal.value = saved.restTotal;
        if (typeof saved.restEndsAt === 'number') restEndsAt.value = saved.restEndsAt;
      }
    } catch {
      // corrupt entry — fall through and start this session fresh
    }
  }
  saveTimers();
}

/** Drop timers left behind by sessions that were never completed. */
function pruneAbandonedTimers() {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('ovl_live_') || key === TIMER_KEY) continue;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
      if (typeof saved.startedAt !== 'number' || Date.now() - saved.startedAt > STALE_SESSION_MS) {
        localStorage.removeItem(key);
      }
    } catch {
      localStorage.removeItem(key);
    }
  }
}

/** Derive both clocks from wall time, so they stay correct across navigation
 *  and while the tab is backgrounded (where interval ticks get throttled). */
function syncTimers() {
  elapsed.value = Math.floor((Date.now() - startedAt.value) / 1000);
  if (!restEndsAt.value) {
    restLeft.value = 0;
    return;
  }
  restLeft.value = Math.max(0, Math.ceil((restEndsAt.value - Date.now()) / 1000));
  if (restLeft.value === 0) {
    restEndsAt.value = 0;
    saveTimers();
  }
}

function startRest() {
  restEndsAt.value = Date.now() + restTotal.value * 1000;
  saveTimers();
  syncTimers();
}

function skipRest() {
  restEndsAt.value = 0;
  restLeft.value = 0;
  saveTimers();
}

watch(restTotal, saveTimers);

function fmtClock(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const MODE_REST: Record<string, number> = { strength: 180, power: 180, endurance: 60, hypertrophy: 90 };

async function load() {
  const { data } = await api.get(`/workouts/${workoutId}`);
  const w = data.workout;
  name.value = w.name ?? 'Workout';
  status.value = w.status;
  if (w.mode && MODE_REST[w.mode]) restTotal.value = MODE_REST[w.mode];
  exercises.value = w.exercises.map((we: Omit<LiveExercise, 'input'>) => ({
    ...we,
    sets: we.sets,
    input: {
      reps: we.sets.at(-1)?.reps ?? we.targetRepsLow ?? null,
      weight: toDisplay(we.sets.at(-1)?.weightKg ?? we.targetWeightKg ?? null),
      durationMin: we.sets.at(-1)?.durationSec ? Math.round(we.sets.at(-1)!.durationSec! / 60) : null,
      durationEdited: false,
      // Timed holds prefill from the last set, else the prescribed low target
      // (a plan's "15-25 seconds" arrives in targetRepsLow/High).
      seconds: we.sets.at(-1)?.durationSec ?? (modeOf(we) === 'timed' ? we.targetRepsLow : null) ?? null,
      distance: null,
      resistance: we.sets.at(-1)?.resistance ?? null,
      isWarmup: false,
    },
  }));
  if (w.status === 'planned') {
    await api.post(`/workouts/${workoutId}/start`);
    status.value = 'in_progress';
  }
}

onMounted(async () => {
  await load();
  // after load(), so a persisted rest length wins over the mode default
  restoreTimers();
  pruneAbandonedTimers();
  syncTimers();
  tick = setInterval(syncTimers, 1000);
});
onBeforeUnmount(() => clearInterval(tick));

/**
 * Minutes of the session not yet accounted for by a logged set.
 *
 * A cardio set has to record a duration, but the app is already timing the
 * session — asking someone to read the clock and type the same number back is
 * the confusing part. The field starts here and keeps counting until it is
 * edited, so finishing a walk is one tap.
 *
 * Derived from the sets themselves rather than a running marker, so reloading
 * the page mid-session does not start the count over from the top.
 */
const loggedSec = computed(() =>
  exercises.value.reduce((a, we) => a + we.sets.reduce((b, st) => b + (st.durationSec ?? 0), 0), 0));
const untrackedMinutes = computed(() => Math.max(0, Math.round((elapsed.value - loggedSec.value) / 60)));

/** The minutes shown for a cardio set: the clock until someone overrides it. */
function durationModel(we: LiveExercise) {
  if (we.input.durationEdited) return we.input.durationMin;
  // Blank, not 0, in the first minute after a set: an explicit zero reads as a
  // value to correct, where an empty box reads as nothing to log yet.
  return untrackedMinutes.value || null;
}
function setDuration(we: LiveExercise, value: number | null) {
  we.input.durationEdited = true;
  we.input.durationMin = value == null ? null : Math.max(0, value);
}

/**
 * The set awaiting an effort rating.
 *
 * RPE is asked after the set rather than before it, because that is when you
 * know the answer — and during the rest that follows, when the screen is
 * otherwise just a countdown. Nothing is added to the logging row, and a set
 * left unrated logs exactly as it did before.
 */
// Halves only above 8: near failure the difference between "2 left" and "1-2
// left" is the one that changes next week's weight, and below that nobody can
// tell the halves apart anyway.
const RPE_SCALE = [6, 7, 8, 8.5, 9, 9.5, 10];
const pendingRpe = ref<{ weId: string; setId: string; value: number | null } | null>(null);
/** Set whose row was tapped to rate or re-rate it, away from the rest prompt. */
const rpeEditing = ref<string | null>(null);

/** Tapping the number already chosen clears it — the way back from a mis-tap. */
async function writeRpe(weId: string, setId: string, current: number | null, value: number) {
  const next = current === value ? null : value;
  const row = exercises.value.find((x) => x.id === weId)?.sets.find((st) => st.id === setId);
  if (row) row.rpe = next;
  if (pendingRpe.value?.setId === setId) pendingRpe.value.value = next;
  // Answered: let the choice register, then get out of the way. Clearing is not
  // an answer, so that leaves the panel open to pick another number.
  if (next != null) {
    setTimeout(() => {
      if (pendingRpe.value?.setId === setId) pendingRpe.value = null;
      if (rpeEditing.value === setId) rpeEditing.value = null;
    }, 700);
  }
  await api.patch(`/workouts/${workoutId}/exercises/${weId}/sets/${setId}`, { rpe: next });
}

function rateSet(value: number) {
  const p = pendingRpe.value;
  if (p) void writeRpe(p.weId, p.setId, p.value, value);
}

// The rest prompt only exists while a rest runs, so a set logged after Skip —
// often the last of an exercise — would never be asked about. The row itself
// is the fallback, and doubles as the way to correct a rating later.
function toggleRpeRow(setId: string) {
  rpeEditing.value = rpeEditing.value === setId ? null : setId;
}

async function logSet(we: LiveExercise) {
  const mode = modeOf(we);
  const load = loadKindOf(we.equipment);
  const i = we.input;

  // Nothing meaningful entered for this mode.
  const durationMin = mode === 'cardio' ? durationModel(we) : i.durationMin;
  if (mode === 'cardio' && !durationMin && i.distance == null) return;
  if (mode === 'timed' && i.seconds == null) return;
  if (mode === 'reps' && i.reps == null && i.weight == null && i.resistance == null) return;

  const { data: created } = await api.post(`/workouts/${workoutId}/exercises/${we.id}/sets`, {
    reps: mode === 'reps' ? i.reps : null,
    // Bands carry resistance, bodyweight carries nothing — offering a kg field
    // for either is what put a band's lb rating in the weight column twice.
    weightKg: mode !== 'cardio' && load === 'weight' ? toKg(i.weight) : null,
    resistance: load === 'band' ? i.resistance : null,
    // Ungated: a timed hold is not cardio but still records duration.
    durationSec:
      mode === 'cardio' ? (durationMin != null ? durationMin * 60 : null) : mode === 'timed' ? i.seconds : null,
    distanceM: mode === 'cardio' ? toMeters(i.distance) : null,
    isWarmup: i.isWarmup,
  });
  // Read before the checkbox is cleared: `i` is we.input, so resetting it below
  // would make every warm-up look like a working set to the RPE prompt.
  const wasWarmup = i.isWarmup;
  we.input.isWarmup = false;
  // Hand the field back to the clock; the set just logged is now part of
  // loggedSec, so the next one counts from where this one ended.
  if (mode === 'cardio') {
    we.input.durationEdited = false;
    we.input.durationMin = null;
  }
  // Rest is the gap between efforts. There is no such gap after cardio — a
  // 1:00 countdown following a 35-minute walk is a clock for nothing.
  if (mode !== 'cardio') {
    startRest();
    // Warm-ups are not efforts worth rating, and the prompt rides the rest bar.
    pendingRpe.value = wasWarmup || !created?.set?.id
      ? null
      : { weId: we.id, setId: created.set.id, value: null };
  } else {
    pendingRpe.value = null;
  }
  const { data } = await api.get(`/workouts/${workoutId}`);
  const fresh = data.workout.exercises.find((x: Omit<LiveExercise, 'input'>) => x.id === we.id);
  if (fresh) we.sets = fresh.sets;
}

async function removeSet(we: LiveExercise, setId: string) {
  await api.delete(`/workouts/${workoutId}/exercises/${we.id}/sets/${setId}`);
  we.sets = we.sets.filter((s) => s.id !== setId);
}

async function complete() {
  await api.post(`/workouts/${workoutId}/complete`, { durationSec: elapsed.value });
  localStorage.removeItem(TIMER_KEY);
  router.push(`/workouts/${workoutId}`);
}

const doneSets = computed(() => exercises.value.reduce((a, we) => a + we.sets.length, 0));
</script>
<template>
  <div class="d-flex align-items-center flex-wrap gap-2 mb-2">
    <h1 class="page-header mb-0 me-auto">{{ name }} <small class="d-none d-sm-inline">live session</small></h1>
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <span class="badge bg-inverse bg-opacity-25 fs-6 font-monospace">
        <i class="ti ti-stopwatch me-1"></i>{{ fmtClock(elapsed) }}
      </span>
      <span class="badge bg-inverse bg-opacity-25 fs-6">{{ doneSets }} sets</span>
      <select v-model.number="restTotal" class="form-select form-select-sm w-auto" title="Rest between sets">
        <option :value="60">Rest 1:00</option>
        <option :value="90">Rest 1:30</option>
        <option :value="120">Rest 2:00</option>
        <option :value="180">Rest 3:00</option>
      </select>
      <button class="btn btn-theme" @click="complete"><i class="ti ti-check me-1"></i>Finish</button>
    </div>
  </div>

  <!-- Rest bar and the rating prompt pin together: a set is usually logged from
       an exercise far down the page, and a prompt sitting in flow at the top is
       a prompt nobody sees. -->
  <div
    v-if="restLeft > 0"
    class="sticky-top"
    style="z-index: 1020; top: calc(var(--bs-app-header-height, 52px) + 8px)"
  >
    <div class="alert alert-info d-flex align-items-center py-2" :class="pendingRpe ? 'mb-2' : 'mb-3'">
      <i class="ti ti-hourglass me-2"></i>
      <strong class="me-2 font-monospace">{{ fmtClock(restLeft) }}</strong>
      <div class="progress flex-grow-1 mx-2" style="height: 6px">
        <div class="progress-bar bg-theme" :style="{ width: (restLeft / restTotal) * 100 + '%' }"></div>
      </div>
      <button class="btn btn-sm btn-outline-secondary" @click="skipRest">Skip</button>
    </div>

    <!-- Cards are transparent; pinned over scrolling content this one needs a
         solid backdrop. -->
    <Card v-if="pendingRpe" class="mb-3" style="background-color: var(--bs-body-bg)">
      <CardBody class="py-2">
        <div class="text-inverse text-opacity-50 small mb-1">how hard was that set?</div>
        <div class="effort-scale">
          <button
            v-for="n in RPE_SCALE"
            :key="n"
            type="button"
            class="btn btn-sm"
            :class="pendingRpe.value === n ? 'btn-theme' : 'btn-outline-secondary'"
            :aria-pressed="pendingRpe.value === n"
            :title="`RPE ${n}`"
            @click="rateSet(n)"
          >{{ n }}</button>
        </div>
      </CardBody>
    </Card>
  </div>

  <div class="row g-3">
    <div v-for="we in exercises" :key="we.id" class="col-xl-6">
      <Card>
        <CardBody>
          <div class="d-flex mb-2">
            <RouterLink :to="`/exercises/${we.exerciseId}`" class="flex-shrink-0 me-3">
              <img
                v-if="we.image"
                :src="we.image"
                class="rounded object-fit-cover"
                style="width: 96px; height: 72px"
                :alt="we.exerciseName"
              />
              <div
                v-else
                class="rounded bg-white bg-opacity-10 d-flex align-items-center justify-content-center"
                style="width: 96px; height: 72px"
              >
                <i class="ti ti-barbell fs-18px text-inverse text-opacity-25"></i>
              </div>
            </RouterLink>
            <div>
              <RouterLink :to="`/exercises/${we.exerciseId}`" class="fw-500 fs-5 text-inverse text-decoration-none">
                {{ we.exerciseName }}
              </RouterLink>
              <div v-if="we.targetSets" class="small text-inverse text-opacity-50">
                Target: {{ we.targetSets }} × {{ we.targetRepsLow }}–{{ we.targetRepsHigh }}{{ modeOf(we) === 'timed' ? 's' : '' }}
                <template v-if="we.targetWeightKg"> @ {{ toDisplay(we.targetWeightKg) }} {{ unit }}</template>
              </div>
              <div v-if="we.notes" class="small text-warning">{{ we.notes }}</div>
            </div>
          </div>

          <template v-for="s in we.sets" :key="s.id">
            <div
              class="d-flex align-items-center py-1 border-bottom border-inverse border-opacity-10 small"
              :class="{ 'border-bottom-0': rpeEditing === s.id }"
              role="button"
              :title="s.rpe ? `RPE ${s.rpe} — tap to change` : 'Tap to rate how hard it was'"
              @click="toggleRpeRow(s.id)"
            >
              <span class="text-inverse text-opacity-50 me-2" style="width: 2rem">#{{ s.order + 1 }}</span>
              <span class="text-inverse">
                <i v-if="s.isWarmup" class="ti ti-flame text-warning me-1" title="warmup"></i>
                {{ setText(s) }}
              </span>
              <span v-if="s.rpe" class="badge bg-inverse bg-opacity-15 text-inverse text-opacity-75 ms-2">RPE {{ s.rpe }}</span>
              <button class="btn btn-sm btn-link text-danger ms-auto py-0" @click.stop="removeSet(we, s.id)">
                <i class="ti ti-x"></i>
              </button>
            </div>
            <div v-if="rpeEditing === s.id" class="pb-2 border-bottom border-inverse border-opacity-10">
              <div class="text-inverse text-opacity-50 small mb-1">how hard was that set?</div>
              <div class="effort-scale">
                <button
                  v-for="n in RPE_SCALE"
                  :key="n"
                  type="button"
                  class="btn btn-sm"
                  :class="s.rpe === n ? 'btn-theme' : 'btn-outline-secondary'"
                  :aria-pressed="s.rpe === n"
                  :title="`RPE ${n}`"
                  @click="writeRpe(we.id, s.id, s.rpe, n)"
                >{{ n }}</button>
              </div>
            </div>
          </template>

          <div class="row g-2 mt-1 align-items-center">
            <template v-if="modeOf(we) === 'cardio'">
              <div class="col-6">
                <div class="text-inverse text-opacity-50 small text-center mb-1">
                  minutes <span v-if="!we.input.durationEdited" class="text-theme">· from timer</span>
                </div>
                <div class="input-group input-group-lg">
                  <button class="btn btn-outline-secondary px-3" @click="setDuration(we, (durationModel(we) ?? 0) - 5)">−</button>
                  <input type="number" inputmode="numeric" :value="durationModel(we)" @input="setDuration(we, ($event.target as HTMLInputElement).valueAsNumber)" class="form-control text-center px-1" placeholder="min" min="0" />
                  <button class="btn btn-outline-secondary px-3" @click="setDuration(we, (durationModel(we) ?? 0) + 5)">+</button>
                </div>
              </div>
              <div class="col-6">
                <div class="text-inverse text-opacity-50 small text-center mb-1">{{ distanceUnit }}</div>
                <div class="input-group input-group-lg">
                  <button class="btn btn-outline-secondary px-3" @click="we.input.distance = Math.max(0, Math.round(((we.input.distance ?? 0) - 0.5) * 10) / 10)">−</button>
                  <input type="number" inputmode="decimal" v-model.number="we.input.distance" class="form-control text-center px-1" :placeholder="distanceUnit" min="0" step="0.1" />
                  <button class="btn btn-outline-secondary px-3" @click="we.input.distance = Math.round(((we.input.distance ?? 0) + 0.5) * 10) / 10">+</button>
                </div>
              </div>
            </template>
            <!-- timed hold: seconds, never a reps stepper -->
            <template v-else-if="modeOf(we) === 'timed'">
              <div :class="loadKindOf(we.equipment) === 'weight' ? 'col-6' : 'col-12'">
                <div class="text-inverse text-opacity-50 small text-center mb-1">seconds (hold)</div>
                <div class="input-group input-group-lg">
                  <button class="btn btn-outline-secondary px-3" @click="we.input.seconds = Math.max(0, (we.input.seconds ?? 0) - 5)">−</button>
                  <input type="number" inputmode="numeric" v-model.number="we.input.seconds" class="form-control text-center px-1" placeholder="sec" min="0" step="5" />
                  <button class="btn btn-outline-secondary px-3" @click="we.input.seconds = (we.input.seconds ?? 0) + 5">+</button>
                </div>
              </div>
              <div class="col-6" v-if="loadKindOf(we.equipment) === 'weight'">
                <div class="text-inverse text-opacity-50 small text-center mb-1">{{ unit }} (added)</div>
                <div class="input-group input-group-lg">
                  <button class="btn btn-outline-secondary px-3" @click="we.input.weight = Math.max(0, (we.input.weight ?? 0) - weightStep)">−</button>
                  <input type="number" inputmode="decimal" v-model.number="we.input.weight" class="form-control text-center px-1" :placeholder="unit" min="0" step="0.5" />
                  <button class="btn btn-outline-secondary px-3" @click="we.input.weight = (we.input.weight ?? 0) + weightStep">+</button>
                </div>
              </div>
            </template>
            <!-- reps: load control follows the equipment -->
            <template v-else>
              <div :class="loadKindOf(we.equipment) === 'bodyweight' ? 'col-12' : 'col-6'">
                <div class="text-inverse text-opacity-50 small text-center mb-1">reps</div>
                <div class="input-group input-group-lg">
                  <button class="btn btn-outline-secondary px-3" @click="we.input.reps = Math.max(0, (we.input.reps ?? 0) - 1)">−</button>
                  <input type="number" inputmode="numeric" v-model.number="we.input.reps" class="form-control text-center px-1" placeholder="reps" min="0" />
                  <button class="btn btn-outline-secondary px-3" @click="we.input.reps = (we.input.reps ?? 0) + 1">+</button>
                </div>
              </div>
              <div class="col-6" v-if="loadKindOf(we.equipment) === 'weight'">
                <div class="text-inverse text-opacity-50 small text-center mb-1">{{ unit }}</div>
                <div class="input-group input-group-lg">
                  <button class="btn btn-outline-secondary px-3" @click="we.input.weight = Math.max(0, (we.input.weight ?? 0) - weightStep)">−</button>
                  <input type="number" inputmode="decimal" v-model.number="we.input.weight" class="form-control text-center px-1" :placeholder="unit" min="0" step="0.5" />
                  <button class="btn btn-outline-secondary px-3" @click="we.input.weight = (we.input.weight ?? 0) + weightStep">+</button>
                </div>
              </div>
              <!-- bands record resistance; a kg field here is what logged a band rating as weight -->
              <div class="col-6" v-else-if="loadKindOf(we.equipment) === 'band'">
                <div class="text-inverse text-opacity-50 small text-center mb-1">band</div>
                <div class="input-group input-group-lg">
                  <button class="btn btn-outline-secondary px-3" @click="we.input.resistance = Math.max(0, (we.input.resistance ?? 0) - 1)">−</button>
                  <input type="number" inputmode="decimal" v-model.number="we.input.resistance" class="form-control text-center px-1" placeholder="level / lb" min="0" />
                  <button class="btn btn-outline-secondary px-3" @click="we.input.resistance = (we.input.resistance ?? 0) + 1">+</button>
                </div>
              </div>
            </template>
            <div class="col-auto" v-if="modeOf(we) !== 'cardio'">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" v-model="we.input.isWarmup" :id="`lwu-${we.id}`" />
                <label class="form-check-label" :for="`lwu-${we.id}`">warmup</label>
              </div>
            </div>
            <div class="col">
              <button class="btn btn-outline-theme btn-lg w-100" @click="logSet(we)">
                <i class="ti ti-check me-1"></i>Log set
              </button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  </div>
</template>
