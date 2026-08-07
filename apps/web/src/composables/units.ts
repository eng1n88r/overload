import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

const KG_PER_LB = 0.45359237;

/** Weights are stored in kg; the user's unit preference only affects
 *  display and input. */
export function useUnits() {
  const auth = useAuthStore();
  const unit = computed<'kg' | 'lb'>(() => (auth.user?.unitPreference === 'lb' ? 'lb' : 'kg'));
  const isLb = computed(() => unit.value === 'lb');

  function toDisplay(kg: number | null | undefined, digits = 1): number | null {
    if (kg == null) return null;
    const v = isLb.value ? kg / KG_PER_LB : kg;
    const f = 10 ** digits;
    return Math.round(v * f) / f;
  }

  function toKg(value: number | null | undefined): number | null {
    if (value == null) return null;
    return isLb.value ? Math.round(value * KG_PER_LB * 100) / 100 : value;
  }

  /** Sensible plate-jump step in the display unit. */
  const weightStep = computed(() => (isLb.value ? 5 : 2.5));

  return { unit, isLb, toDisplay, toKg, weightStep };
}

const M_PER_MI = 1609.344;

/** Distances are stored in meters; the user's distance unit preference only
 *  affects display and input. */
export function useDistanceUnit() {
  const auth = useAuthStore();
  const distanceUnit = computed<'km' | 'mi'>(() => (auth.user?.distanceUnitPreference === 'mi' ? 'mi' : 'km'));
  const isMi = computed(() => distanceUnit.value === 'mi');

  function toDisplay(m: number | null | undefined, digits = 2): number | null {
    if (m == null) return null;
    const v = isMi.value ? m / M_PER_MI : m / 1000;
    const f = 10 ** digits;
    return Math.round(v * f) / f;
  }

  function toMeters(value: number | null | undefined): number | null {
    if (value == null) return null;
    return Math.round(isMi.value ? value * M_PER_MI : value * 1000);
  }

  return { distanceUnit, isMi, toDisplay, toMeters };
}
