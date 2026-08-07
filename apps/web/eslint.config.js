import { globalIgnores } from 'eslint/config';
import pluginVue from 'eslint-plugin-vue';
import { withVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';

export default withVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    name: 'app/vue-rule-overrides',
    rules: {
      // Card/Header/Sidebar are intentional single-word names for these
      // app-shell components.
      'vue/multi-word-component-names': ['error', { ignores: ['Card', 'Header', 'Sidebar'] }],
    },
  },
  {
    // Route-level pages aren't used as custom elements, so single-word names are fine.
    name: 'app/views-single-word-names',
    files: ['src/views/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  skipFormatting,
);
