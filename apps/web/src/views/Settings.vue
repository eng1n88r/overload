<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { EQUIPMENT_GROUPS, type ApiKeyPublic } from '@overload/shared';
import { labelize } from '@/composables/format';
import { api, errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const equipment = ref<string[]>([]);
const equipmentSaved = ref(false);
const trainingMode = ref('hypertrophy');
const unitPreference = ref<'kg' | 'lb'>('kg');
const distanceUnitPreference = ref<'km' | 'mi'>('km');

const MODE_INFO: Record<string, string> = {
  strength: 'Heavy: 3–6 reps @ ~85–95% of your estimated 1RM, long rests, warm-up ramps.',
  hypertrophy: 'Muscle growth: 6–15 reps @ ~65–80%, moderate rests. The default.',
  endurance: 'Muscular endurance: 15–25 reps @ ~40–60%, short rests, fewer sets.',
  power: 'Explosive: 3–5 fast reps @ ~50%, compounds only, never near failure.',
};

async function loadEquipment() {
  const { data } = await api.get('/auth/me');
  equipment.value = data.equipment ?? [];
  trainingMode.value = data.user?.trainingMode ?? 'hypertrophy';
  unitPreference.value = data.user?.unitPreference ?? 'kg';
  distanceUnitPreference.value = data.user?.distanceUnitPreference ?? 'km';
}

async function saveEquipment() {
  await api.patch('/auth/me', {
    equipment: equipment.value,
    trainingMode: trainingMode.value,
    unitPreference: unitPreference.value,
    distanceUnitPreference: distanceUnitPreference.value,
  });
  await auth.fetchMe(); // refresh so unit preference applies app-wide immediately
  equipmentSaved.value = true;
  setTimeout(() => (equipmentSaved.value = false), 2000);
}

const avatarBusy = ref(false);
const avatarError = ref('');

/** Downscale to a 192px square JPEG client-side so uploads stay tiny. */
function resizeAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const SIZE = 192;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d')!;
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Not a readable image'));
    };
    img.src = url;
  });
}

async function onAvatarPick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) return;
  avatarBusy.value = true;
  avatarError.value = '';
  try {
    const avatar = await resizeAvatar(file);
    await api.patch('/auth/me', { avatar });
    await auth.fetchMe();
  } catch (e) {
    avatarError.value = errorMessage(e);
  } finally {
    avatarBusy.value = false;
  }
}

async function removeAvatar() {
  avatarBusy.value = true;
  try {
    await api.patch('/auth/me', { avatar: null });
    await auth.fetchMe();
  } finally {
    avatarBusy.value = false;
  }
}

function groupState(items: string[]): boolean {
  return items.every((i) => equipment.value.includes(i));
}

function toggleGroup(items: string[]) {
  if (groupState(items)) {
    equipment.value = equipment.value.filter((i) => !items.includes(i));
  } else {
    equipment.value = [...new Set([...equipment.value, ...items])];
  }
}
const keys = ref<ApiKeyPublic[]>([]);
const newKeyName = ref('');
const createdToken = ref('');
const error = ref('');
const busy = ref(false);

async function loadKeys() {
  const { data } = await api.get('/api-keys');
  keys.value = data.keys;
}

onMounted(() => {
  loadKeys();
  loadEquipment();
  loadAdmin();
});

async function createKey() {
  error.value = '';
  busy.value = true;
  try {
    const { data } = await api.post('/api-keys', { name: newKeyName.value });
    createdToken.value = data.token;
    newKeyName.value = '';
    await loadKeys();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function revokeKey(id: string) {
  await api.delete(`/api-keys/${id}`);
  await loadKeys();
}

function copyToken() {
  navigator.clipboard.writeText(createdToken.value);
}

function fmt(date: string | null) {
  return date ? new Date(date).toLocaleString() : 'never';
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  workouts: number;
  plans: number;
}

const isAdmin = computed(() => auth.user?.role === 'admin');
const adminUsers = ref<AdminUser[]>([]);
const regOpen = ref(false);
const adminError = ref('');
const newUser = ref({ email: '', name: '', password: '' });

async function loadAdmin() {
  if (!isAdmin.value) return;
  const [u, r] = await Promise.all([api.get('/users'), api.get('/users/registration')]);
  adminUsers.value = u.data.users;
  regOpen.value = r.data.open;
}

async function toggleRegistration() {
  const { data } = await api.patch('/users/registration', { open: !regOpen.value });
  regOpen.value = data.open;
}

async function createUser() {
  adminError.value = '';
  try {
    await api.post('/users', newUser.value);
    newUser.value = { email: '', name: '', password: '' };
    await loadAdmin();
  } catch (err) {
    adminError.value = errorMessage(err);
  }
}

async function resetPassword(u: AdminUser) {
  const pw = prompt(`New password for ${u.email} (min 8 characters). Their sessions will be logged out:`);
  if (!pw) return;
  adminError.value = '';
  try {
    await api.patch(`/users/${u.id}`, { password: pw });
  } catch (err) {
    adminError.value = errorMessage(err);
  }
}

async function setRole(u: AdminUser, role: string) {
  adminError.value = '';
  try {
    await api.patch(`/users/${u.id}`, { role });
  } catch (err) {
    adminError.value = errorMessage(err);
  } finally {
    await loadAdmin();
  }
}

async function deleteUser(u: AdminUser) {
  if (!confirm(`Delete ${u.email} and ALL their data (${u.workouts} workouts, ${u.plans} plans)? This cannot be undone.`))
    return;
  adminError.value = '';
  try {
    await api.delete(`/users/${u.id}`);
  } catch (err) {
    adminError.value = errorMessage(err);
  } finally {
    await loadAdmin();
  }
}
</script>
<template>
  <h1 class="page-header">
    Settings <small>account &amp; Claude access</small>
  </h1>

  <div class="row">
    <div class="col-xl-6">
      <Card class="mb-3">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">ACCOUNT</span>
          </div>
          <div class="d-flex align-items-center gap-3 mb-3">
            <img
              v-if="auth.user?.avatar"
              :src="auth.user.avatar"
              class="rounded-circle object-fit-cover"
              style="width: 64px; height: 64px"
              alt="avatar"
            />
            <div
              v-else
              class="d-flex align-items-center justify-content-center rounded-circle bg-inverse bg-opacity-25 text-inverse text-opacity-50"
              style="width: 64px; height: 64px"
            >
              <i class="ti ti-user-circle fs-3"></i>
            </div>
            <div>
              <label class="btn btn-sm btn-outline-theme mb-0" :class="{ disabled: avatarBusy }">
                {{ auth.user?.avatar ? 'Change avatar' : 'Upload avatar' }}
                <input type="file" accept="image/*" class="d-none" @change="onAvatarPick" />
              </label>
              <button
                v-if="auth.user?.avatar"
                class="btn btn-sm btn-outline-secondary ms-2"
                :disabled="avatarBusy"
                @click="removeAvatar"
              >
                Remove
              </button>
              <div v-if="avatarError" class="small text-danger mt-1">{{ avatarError }}</div>
            </div>
          </div>
          <div class="mb-2"><span class="text-inverse text-opacity-50">Name:</span> {{ auth.user?.name }}</div>
          <div class="mb-2"><span class="text-inverse text-opacity-50">Email:</span> {{ auth.user?.email }}</div>
          <div><span class="text-inverse text-opacity-50">Role:</span> {{ labelize(auth.user?.role ?? '') }}</div>
        </CardBody>
      </Card>
      <Card class="mb-3">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">TRAINING</span>
          </div>
          <div class="row g-2 mb-1">
            <div class="col-12 col-md-6">
              <label class="form-label">Default training mode</label>
              <select v-model="trainingMode" class="form-select">
                <option value="hypertrophy">Hypertrophy</option>
                <option value="strength">Strength</option>
                <option value="endurance">Endurance</option>
                <option value="power">Power</option>
              </select>
            </div>
            <div class="col-6 col-md-3">
              <label class="form-label">Weight units</label>
              <div class="btn-group w-100" role="group">
                <input type="radio" class="btn-check" id="unit-kg" value="kg" v-model="unitPreference" />
                <label class="btn btn-outline-theme" for="unit-kg">kg</label>
                <input type="radio" class="btn-check" id="unit-lb" value="lb" v-model="unitPreference" />
                <label class="btn btn-outline-theme" for="unit-lb">lb</label>
              </div>
            </div>
            <div class="col-6 col-md-3">
              <label class="form-label">Distance units</label>
              <div class="btn-group w-100" role="group">
                <input type="radio" class="btn-check" id="dist-km" value="km" v-model="distanceUnitPreference" />
                <label class="btn btn-outline-theme" for="dist-km">km</label>
                <input type="radio" class="btn-check" id="dist-mi" value="mi" v-model="distanceUnitPreference" />
                <label class="btn btn-outline-theme" for="dist-mi">mi</label>
              </div>
            </div>
          </div>
          <p class="text-inverse text-opacity-50 small mb-3">{{ MODE_INFO[trainingMode] }}</p>
          <p class="text-inverse text-opacity-50 small mb-1">
            <strong>My equipment</strong> — the generator only picks exercises you can actually do: both the
            weights and the specific machine or station an exercise needs must be checked. Leave everything
            unchecked to allow the full catalog.
          </p>
          <div v-for="group in EQUIPMENT_GROUPS" :key="group.key" class="mb-2">
            <div class="d-flex align-items-center small fw-bold text-inverse text-opacity-75 mt-2 mb-1">
              {{ group.label.toUpperCase() }}
              <a href="#" class="ms-2 fw-normal text-decoration-none" @click.prevent="toggleGroup(group.items)">
                {{ groupState(group.items) ? 'none' : 'all' }}
              </a>
            </div>
            <div class="row g-0">
              <div v-for="e in group.items" :key="e" class="col-6 col-md-4">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" :value="e" v-model="equipment" :id="`eq-${e}`" />
                  <label class="form-check-label" :for="`eq-${e}`">{{ labelize(e) }}</label>
                </div>
              </div>
            </div>
          </div>
          <button class="btn btn-outline-theme mt-2" @click="saveEquipment">
            {{ equipmentSaved ? 'Saved ✓' : 'Save training settings' }}
          </button>
        </CardBody>
      </Card>
    </div>
    <div class="col-xl-6">
      <Card class="mb-3">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">API KEYS (FOR CLAUDE / MCP)</span>
          </div>
          <p class="text-inverse text-opacity-50">
            Use a key as <code>Authorization: Bearer &lt;token&gt;</code> against the REST API, or connect
            Claude to the MCP endpoint at <code>{{ '/mcp' }}</code> with it.
          </p>
          <div v-if="error" class="alert alert-danger">{{ error }}</div>
          <div v-if="createdToken" class="alert alert-success">
            <div class="fw-bold mb-1">Key created — copy it now, it won't be shown again:</div>
            <code class="user-select-all">{{ createdToken }}</code>
            <button class="btn btn-sm btn-outline-theme ms-2" @click="copyToken">Copy</button>
          </div>
          <form class="d-flex mb-3" @submit.prevent="createKey">
            <input
              v-model="newKeyName"
              required
              class="form-control me-2"
              placeholder="Key name (e.g. claude-code)"
            />
            <button type="submit" :disabled="busy" class="btn btn-outline-theme text-nowrap">Create key</button>
          </form>
          <div class="table-responsive" v-if="keys.length">
            <table class="table table-sm align-middle">
              <thead>
                <tr><th class="text-nowrap">Name</th><th class="text-nowrap">Prefix</th><th class="text-nowrap">Created</th><th class="text-nowrap">Last used</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="k in keys" :key="k.id">
                  <td class="text-nowrap">{{ k.name }}</td>
                  <td class="text-nowrap"><code>{{ k.keyPrefix }}…</code></td>
                  <td class="text-nowrap">{{ fmt(k.createdAt) }}</td>
                  <td class="text-nowrap">{{ fmt(k.lastUsedAt) }}</td>
                  <td class="text-end">
                    <button class="btn btn-sm btn-outline-danger" @click="revokeKey(k.id)">Revoke</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="text-inverse text-opacity-50">No API keys yet.</div>
        </CardBody>
      </Card>

      <Card v-if="isAdmin" class="mb-3">
        <CardBody>
          <div class="d-flex fw-bold small mb-3">
            <span class="flex-grow-1">USERS (ADMIN)</span>
          </div>
          <div v-if="adminError" class="alert alert-danger py-2">{{ adminError }}</div>
          <div class="form-check form-switch mb-3">
            <input class="form-check-input" type="checkbox" id="reg-open" :checked="regOpen" @change="toggleRegistration" />
            <label class="form-check-label" for="reg-open">
              Registration open <span class="text-inverse text-opacity-50">(anyone who can reach the app can sign up)</span>
            </label>
          </div>
          <div class="table-responsive" v-if="adminUsers.length">
            <table class="table table-sm align-middle">
              <thead>
                <tr><th>User</th><th>Role</th><th class="text-end">Data</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="u in adminUsers" :key="u.id">
                  <td>
                    <div class="text-inverse">{{ u.name }}</div>
                    <div class="small text-inverse text-opacity-50">{{ u.email }}</div>
                  </td>
                  <td>
                    <select
                      class="form-select form-select-sm w-auto"
                      :value="u.role"
                      :disabled="u.id === auth.user?.id"
                      @change="setRole(u, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td class="text-end small text-inverse text-opacity-50 text-nowrap">
                    {{ u.workouts }} workouts<br />{{ u.plans }} plans
                  </td>
                  <td class="text-end text-nowrap">
                    <button class="btn btn-sm btn-outline-secondary" title="Reset password" @click="resetPassword(u)">
                      <i class="ti ti-key"></i>
                    </button>
                    <button
                      class="btn btn-sm btn-outline-danger ms-1"
                      title="Delete user and all their data"
                      :disabled="u.id === auth.user?.id"
                      @click="deleteUser(u)"
                    >
                      <i class="ti ti-trash"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <form class="row g-2" @submit.prevent="createUser">
            <div class="col-12 col-md-4"><input v-model="newUser.email" type="email" required class="form-control form-control-sm" placeholder="email" /></div>
            <div class="col-12 col-md-3"><input v-model="newUser.name" required class="form-control form-control-sm" placeholder="name" /></div>
            <div class="col-12 col-md-3"><input v-model="newUser.password" type="password" required minlength="8" class="form-control form-control-sm" placeholder="password" /></div>
            <div class="col-12 col-md-2"><button type="submit" class="btn btn-sm btn-outline-theme w-100">Add user</button></div>
          </form>
        </CardBody>
      </Card>
    </div>
  </div>
</template>
