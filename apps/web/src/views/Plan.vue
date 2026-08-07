<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { labelize } from '@/composables/format';
import MarkdownText from '@/components/app/MarkdownText.vue';
import { api, errorMessage } from '@/api/client';

interface PlanDay {
  id: string;
  dayIndex: number;
  name: string;
  targetMuscles: string[];
  template: { exerciseId: string; sets?: number; repsLow?: number; repsHigh?: number }[];
}
interface PlanRow {
  id: string;
  name: string;
  status: string;
  startDate: string;
  weeks: number;
  daysPerWeek: number;
  notes: string | null;
  createdBy: string;
  days: PlanDay[];
}

const router = useRouter();
const plans = ref<PlanRow[]>([]);
const error = ref('');
const busy = ref(false);

async function load() {
  const { data } = await api.get('/plans');
  plans.value = data.plans;
}
onMounted(load);

async function generateFreestyle() {
  error.value = '';
  busy.value = true;
  try {
    const { data } = await api.post('/workouts/generate', {});
    router.push(`/workouts/${data.workout.id}`);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function generateFromDay(dayId: string) {
  error.value = '';
  busy.value = true;
  try {
    const { data } = await api.post('/workouts/generate', { planDayId: dayId });
    router.push(`/workouts/${data.workout.id}`);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function setStatus(plan: PlanRow, status: 'active' | 'archived') {
  await api.patch(`/plans/${plan.id}`, { status });
  await load();
}

async function removePlan(plan: PlanRow) {
  if (!confirm(`Delete plan "${plan.name}"? This cannot be undone.`)) return;
  await api.delete(`/plans/${plan.id}`);
  await load();
}

const showNotes = ref(false);

const editing = ref<PlanRow | null>(null);
const editForm = ref({ name: '', startDate: '', weeks: 8, daysPerWeek: 3, notes: '' });
const editError = ref('');

function openEdit(plan: PlanRow) {
  editing.value = plan;
  editError.value = '';
  editForm.value = {
    name: plan.name,
    startDate: plan.startDate,
    weeks: plan.weeks,
    daysPerWeek: plan.daysPerWeek,
    notes: plan.notes ?? '',
  };
}

async function saveEdit() {
  if (!editing.value) return;
  busy.value = true;
  editError.value = '';
  try {
    await api.patch(`/plans/${editing.value.id}`, {
      name: editForm.value.name,
      startDate: editForm.value.startDate,
      weeks: editForm.value.weeks,
      daysPerWeek: editForm.value.daysPerWeek,
      notes: editForm.value.notes || null,
    });
    editing.value = null;
    await load();
  } catch (err) {
    editError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

const activePlan = () => plans.value.find((p) => p.status === 'active');
</script>
<template>
  <div class="d-flex align-items-center mb-3 flex-wrap gap-2">
    <h1 class="page-header mb-0">Plan <small>your training program</small></h1>
    <button class="btn btn-outline-theme ms-auto" :disabled="busy" @click="generateFreestyle">
      <i class="ti ti-sparkles me-1"></i>Generate today's workout
    </button>
  </div>

  <div v-if="error" class="alert alert-danger">{{ error }}</div>

  <template v-if="activePlan()">
    <Card class="mb-3">
      <CardBody>
        <div class="d-flex fw-bold small mb-1 align-items-center flex-wrap gap-1">
          <span>{{ activePlan()!.name.toUpperCase() }}</span>
          <span class="badge bg-theme text-theme-900 ms-2">active</span>
          <div class="btn-group ms-auto">
            <button class="btn btn-sm btn-outline-secondary" title="Edit plan" @click="openEdit(activePlan()!)">
              <i class="ti ti-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary" title="Archive plan" @click="setStatus(activePlan()!, 'archived')">
              <i class="ti ti-archive"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary" title="Delete plan" @click="removePlan(activePlan()!)">
              <i class="ti ti-trash"></i>
            </button>
          </div>
        </div>
        <div class="small text-inverse text-opacity-50 mb-3">
          {{ activePlan()!.daysPerWeek }} days/week · {{ activePlan()!.weeks }} weeks · since {{ activePlan()!.startDate }}
        </div>
        <div class="row g-3">
          <div v-for="day in activePlan()!.days" :key="day.id" class="col-xl-3 col-md-6">
            <Card class="h-100 border border-theme border-opacity-25">
              <CardBody class="d-flex flex-column h-100">
                <div class="fw-bold text-inverse mb-1">{{ day.name }}</div>
                <div class="d-flex flex-wrap gap-1 mb-2">
                  <span v-for="m in day.targetMuscles" :key="m" class="badge bg-inverse bg-opacity-25">
                    {{ labelize(m) }}
                  </span>
                </div>
                <div class="small text-inverse text-opacity-50 mb-2">
                  {{ day.template.length }} exercises
                </div>
                <button class="btn btn-sm btn-outline-theme w-100 mt-auto" :disabled="busy" @click="generateFromDay(day.id)">
                  <i class="ti ti-player-play me-1"></i>Generate session
                </button>
              </CardBody>
            </Card>
          </div>
        </div>
        <div v-if="activePlan()!.notes" class="mt-3">
          <a href="#" class="text-decoration-none text-inverse small fw-bold" @click.prevent="showNotes = !showNotes">
            <i class="ti me-1" :class="showNotes ? 'ti-chevron-down' : 'ti-chevron-right'"></i>PLAN NOTES
          </a>
          <MarkdownText v-if="showNotes" :text="activePlan()!.notes!" class="alert alert-secondary py-2 mt-2 mb-0" />
        </div>
      </CardBody>
    </Card>
  </template>
  <Card v-else class="mb-3">
    <CardBody class="text-inverse text-opacity-50">
      No active plan. Generate freestyle workouts above, or ask Claude (via MCP) to build you a program from your
      history — it will appear here.
    </CardBody>
  </Card>

  <Card v-if="plans.filter((p) => p.status === 'archived').length">
    <CardBody>
      <div class="d-flex fw-bold small mb-3">
        <span class="flex-grow-1">ARCHIVED PLANS</span>
      </div>
      <div class="mx-n3 mb-n3">
      <table class="table table-sm align-middle mb-0">
        <tbody>
          <tr v-for="p in plans.filter((p) => p.status === 'archived')" :key="p.id">
            <td class="ps-3">{{ p.name }}</td>
            <td class="text-inverse text-opacity-50">{{ p.startDate }} · {{ p.daysPerWeek }}d/wk</td>
            <td class="text-end pe-3">
              <div class="btn-group">
                <button class="btn btn-sm btn-outline-theme" @click="setStatus(p, 'active')">Re-activate</button>
                <button class="btn btn-sm btn-outline-secondary" title="Delete plan" @click="removePlan(p)">
                  <i class="ti ti-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </CardBody>
  </Card>

  <div v-if="editing" class="modal fade show d-block" style="background: rgba(0, 0, 0, 0.5)" @click.self="editing = null">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Edit plan</h5>
          <button type="button" class="btn-close" @click="editing = null"></button>
        </div>
        <div class="modal-body">
          <div v-if="editError" class="alert alert-danger py-2">{{ editError }}</div>
          <div class="mb-3">
            <label class="form-label">Name</label>
            <input v-model="editForm.name" class="form-control" />
          </div>
          <div class="row g-2 mb-3">
            <div class="col-4">
              <label class="form-label">Start date</label>
              <input v-model="editForm.startDate" type="date" class="form-control" />
            </div>
            <div class="col-4">
              <label class="form-label">Weeks</label>
              <input v-model.number="editForm.weeks" type="number" min="1" max="52" class="form-control" />
            </div>
            <div class="col-4">
              <label class="form-label">Days/week</label>
              <input v-model.number="editForm.daysPerWeek" type="number" min="1" max="7" class="form-control" />
            </div>
          </div>
          <div>
            <label class="form-label">Notes <span class="text-inverse text-opacity-50">(markdown)</span></label>
            <textarea v-model="editForm.notes" rows="8" class="form-control font-monospace fs-13px"></textarea>
          </div>
          <div class="small text-inverse text-opacity-50 mt-2">
            Training days and exercises are edited by Claude through MCP ("adjust my plan…") or by re-generating the plan.
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline-secondary" @click="editing = null">Cancel</button>
          <button class="btn btn-theme" :disabled="busy || !editForm.name" @click="saveEdit">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>
