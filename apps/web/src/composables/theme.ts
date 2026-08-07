import { useAppOptionStore } from '@/stores/app-option';
import { useAppVariableStore, generateVariables } from '@/stores/app-variable';
import useEmitter from '@/composables/useEmitter';

export type ColorMode = 'system' | 'light' | 'dark';

// Held for the life of the module rather than re-queried per call. A
// MediaQueryList only keeps delivering events while something still references
// it, and this is the reference.
let darkQuery: MediaQueryList | null = null;
function prefersDark(): MediaQueryList {
  darkQuery ??= window.matchMedia('(prefers-color-scheme: dark)');
  return darkQuery;
}

/** What 'system' resolves to right now; the other two answer for themselves. */
export function resolveColorMode(mode: ColorMode): 'light' | 'dark' {
  return mode === 'system' ? (prefersDark().matches ? 'dark' : 'light') : mode;
}

// restoreTheme runs from App.vue, which can remount; without this the OS
// listener would stack up a copy per mount.
let watchingSystem = false;

/**
 * Applies + persists theme options (colour mode, accent colour).
 * Restoration runs from App.vue so it also covers pages without the
 * header (login), where the theme dropdowns aren't mounted.
 */
export function useTheme() {
  const appOption = useAppOptionStore();
  const appVariable = useAppVariableStore();
  const emitter = useEmitter();

  function reloadVariable() {
    const newVariables = generateVariables();
    appVariable.font = newVariables.font;
    appVariable.color = newVariables.color;
  }

  function setMode(mode: ColorMode) {
    appOption.appMode = mode;
    if (localStorage) localStorage.appMode = mode;
    document.documentElement.setAttribute('data-bs-theme', resolveColorMode(mode));
    emitter.emit('theme-reload', true);
    reloadVariable();
  }

  function setThemeClass(themeClass: string) {
    appOption.appThemeClass = themeClass;
    if (localStorage) localStorage.appThemeClass = themeClass;
    for (const targetClass of [...document.body.classList]) {
      if (targetClass.startsWith('theme-')) document.body.classList.remove(targetClass);
    }
    document.body.classList.add(themeClass);
    emitter.emit('theme-reload', true);
    reloadVariable();
  }

  function restoreTheme() {
    if (!localStorage) return;
    if (localStorage.appThemeClass) setThemeClass(localStorage.appThemeClass);
    setMode((localStorage.appMode as ColorMode) || 'system');

    if (!watchingSystem) {
      watchingSystem = true;
      // Follow the OS while it is what we are following. The inline script in
      // index.html handles the first paint; this handles changes after it.
      prefersDark().addEventListener('change', () => {
        if (appOption.appMode === 'system') setMode('system');
      });
    }
  }

  return { setMode, setThemeClass, restoreTheme };
}
