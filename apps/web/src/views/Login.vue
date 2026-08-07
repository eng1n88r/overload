<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppOptionStore } from '@/stores/app-option';
import { useAuthStore } from '@/stores/auth';
import { api, errorMessage } from '@/api/client';

const appOption = useAppOptionStore();
const auth = useAuthStore();
const router = useRouter();

const mode = ref<'login' | 'register'>('login');
const firstUser = ref(false);
const email = ref('');
const name = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

onMounted(async () => {
  appOption.appSidebarHide = true;
  appOption.appHeaderHide = true;
  appOption.appContentClass = 'p-0';
  try {
    const { data } = await api.get('/auth/registration-open');
    firstUser.value = data.firstUser;
    if (data.firstUser) mode.value = 'register';
  } catch {
    /* server unreachable; login form still shown */
  }
});

onBeforeUnmount(() => {
  appOption.appSidebarHide = false;
  appOption.appHeaderHide = false;
  appOption.appContentClass = '';
});

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    if (mode.value === 'register') {
      await auth.register(email.value, name.value, password.value);
    } else {
      await auth.login(email.value, password.value);
    }
    router.push('/');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <!-- BEGIN login -->
  <div class="login">
    <!-- BEGIN login-content -->
    <div class="login-content">
      <form @submit.prevent="submit()" method="POST" name="login_form">
        <h1 class="text-center">{{ mode === 'register' ? 'Create Account' : 'Sign In' }}</h1>
        <div class="text-inverse text-opacity-50 text-center mb-4">
          <template v-if="firstUser">Welcome to Overload! Create the first (admin) account.</template>
          <template v-else-if="mode === 'register'">Create your account.</template>
          <template v-else>Sign in to track your workouts.</template>
        </div>
        <div v-if="error" class="alert alert-danger">{{ error }}</div>
        <div class="mb-3">
          <label class="form-label">Email Address <span class="text-danger">*</span></label>
          <input
            type="email"
            v-model="email"
            required
            class="form-control form-control-lg bg-white bg-opacity-5"
          />
        </div>
        <div v-if="mode === 'register'" class="mb-3">
          <label class="form-label">Name <span class="text-danger">*</span></label>
          <input
            type="text"
            v-model="name"
            required
            class="form-control form-control-lg bg-white bg-opacity-5"
          />
        </div>
        <div class="mb-3">
          <label class="form-label">Password <span class="text-danger">*</span></label>
          <input
            type="password"
            v-model="password"
            required
            minlength="8"
            class="form-control form-control-lg bg-white bg-opacity-5"
          />
        </div>
        <button type="submit" :disabled="busy" class="btn btn-outline-theme btn-lg d-block w-100 fw-500 mb-3">
          {{ mode === 'register' ? 'Create Account' : 'Sign In' }}
        </button>
        <div v-if="!firstUser" class="text-center text-inverse text-opacity-50">
          <template v-if="mode === 'login'">
            No account yet?
            <a href="#" @click.prevent="mode = 'register'">Sign up</a>.
          </template>
          <template v-else>
            Already registered?
            <a href="#" @click.prevent="mode = 'login'">Sign in</a>.
          </template>
        </div>
      </form>
    </div>
    <!-- END login-content -->
  </div>
  <!-- END login -->
</template>
