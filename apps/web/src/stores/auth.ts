import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { UserPublic } from '@overload/shared';
import { api } from '@/api/client';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserPublic | null>(null);
  const loaded = ref(false);

  async function fetchMe(): Promise<UserPublic | null> {
    try {
      const { data } = await api.get('/auth/me');
      user.value = data.user;
    } catch {
      user.value = null;
    } finally {
      loaded.value = true;
    }
    return user.value;
  }

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    user.value = data.user;
  }

  async function register(email: string, name: string, password: string) {
    const { data } = await api.post('/auth/register', { email, name, password });
    user.value = data.user;
  }

  async function logout() {
    await api.post('/auth/logout');
    user.value = null;
  }

  return { user, loaded, fetchMe, login, register, logout };
});
