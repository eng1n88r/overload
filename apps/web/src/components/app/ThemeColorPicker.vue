<script setup lang="ts">
import { useAppOptionStore } from '@/stores/app-option';
import { useTheme } from '@/composables/theme';

const appOption = useAppOptionStore();
const theme = useTheme();

// `key` is the $theme-colors key, which is what _theme-colors.scss keys its
// hover rules off, so the two lists cannot drift apart.
const colors = [
  { name: 'Teal', key: 'teal' },
  { name: 'Cyan', key: 'info' },
  { name: 'Blue', key: 'primary' },
  { name: 'Indigo', key: 'indigo' },
  { name: 'Purple', key: 'purple' },
  { name: 'Pink', key: 'pink' },
  { name: 'Red', key: 'red' },
  { name: 'Orange', key: 'warning' },
  { name: 'Yellow', key: 'yellow' },
  { name: 'Lime', key: 'lime' },
  { name: 'Green', key: 'green' },
  { name: 'Grey', key: 'gray-200' },
];

// Teal is what the app falls back to before anything is stored, so it is the
// one that shows as selected while appThemeClass is still empty.
const isActive = (key: string) =>
  appOption.appThemeClass === `theme-${key}` || (!appOption.appThemeClass && key === 'teal');
</script>
<template>
  <div class="menu-item dropdown dropdown-mobile-full">
    <a href="#" data-bs-toggle="dropdown" data-bs-display="static" class="menu-link" aria-label="Theme">
      <div class="menu-icon"><i class="ti ti-color-swatch nav-icon"></i></div>
    </a>
    <div class="dropdown-menu dropdown-menu-end mt-1">
      <h6 class="dropdown-header fs-12px mb-1">THEME</h6>
      <div class="theme-color-list">
        <button
          v-for="c in colors"
          :key="c.key"
          type="button"
          class="theme-color-item"
          :class="`accent-${c.key}`"
          :aria-pressed="isActive(c.key)"
          @click="theme.setThemeClass(`theme-${c.key}`)"
        >
          {{ c.name }}
          <i v-if="isActive(c.key)" class="ti ti-check theme-color-check fs-14px"></i>
        </button>
      </div>
    </div>
  </div>
</template>
