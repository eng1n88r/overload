<script setup lang="ts">
import { computed } from 'vue';
import { useAppOptionStore } from '@/stores/app-option';
import { useTheme, type ColorMode } from '@/composables/theme';

const appOption = useAppOptionStore();
const theme = useTheme();

const modes: { value: ColorMode; label: string; icon: string }[] = [
  { value: 'system', label: 'System', icon: 'ti-contrast' },
  { value: 'light', label: 'Light', icon: 'ti-sun' },
  { value: 'dark', label: 'Dark', icon: 'ti-moon-stars' },
];

// The header icon shows which mode is selected, so 'System' reads as itself
// rather than as whichever of light/dark the OS happens to be serving.
const current = computed(() => modes.find((m) => m.value === appOption.appMode) ?? modes[0]);
</script>
<template>
  <div class="menu-item dropdown dropdown-mobile-full">
    <a
      href="#"
      data-bs-toggle="dropdown"
      data-bs-display="static"
      class="menu-link"
      :aria-label="`Appearance: ${current.label}`"
    >
      <div class="menu-icon"><i class="ti nav-icon" :class="current.icon"></i></div>
    </a>
    <div class="dropdown-menu dropdown-menu-end mt-1">
      <h6 class="dropdown-header fs-12px mb-1">APPEARANCE</h6>
      <a
        v-for="m in modes"
        :key="m.value"
        href="#"
        class="dropdown-item d-flex align-items-center"
        @click.prevent="theme.setMode(m.value)"
      >
        <i class="ti me-2 fs-16px my-n1" :class="m.icon"></i>{{ m.label.toUpperCase() }}
        <i v-if="appOption.appMode === m.value" class="ti ti-check ms-auto text-theme fs-16px my-n1"></i>
      </a>
    </div>
  </div>
</template>
