import { onBeforeUnmount, ref } from 'vue';

/**
 * Keeps the screen awake for as long as the caller holds it — a live session
 * is minutes of looking at a rest timer without touching anything, which is
 * exactly when a phone decides to lock.
 *
 * The platform drops the lock whenever the page is hidden (tab switch, app
 * backgrounded, screen manually locked) and does not restore it, so the
 * visibility listener re-acquires on the way back. Safari 16.4+, Chrome 84+;
 * anywhere else this is inert rather than an error.
 */
export function useWakeLock() {
  const active = ref(false);
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;

  async function acquire() {
    if (!supported || sentinel || document.visibilityState !== 'visible') return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      active.value = true;
      // Fires on the platform's own release, not just ours.
      sentinel.addEventListener('release', () => {
        sentinel = null;
        active.value = false;
      });
    } catch {
      // Low battery, permission policy, an OS in the way — a screen that
      // sleeps is a lesser problem than a logger that throws. WebKit also
      // lands here when the request had no transient user activation, which
      // is what the gesture listeners below are for.
      active.value = false;
    }
  }

  /**
   * Re-take the lock from any tap.
   *
   * WebKit refuses a wake lock asked for without transient user activation,
   * so the request made on mount — the natural place for it — is exactly the
   * one the platform is entitled to throw away. Rather than depend on that
   * request landing, treat every interaction as another chance: opening the
   * page and touching anything is enough, and a lock already held makes this
   * a no-op. Cheap insurance against a policy that can tighten under us, as
   * it did between iOS releases.
   */
  function onGesture() {
    if (wanted && !sentinel) void acquire();
  }

  async function release() {
    wanted = false;
    if (!sentinel) return;
    try {
      await sentinel.release();
    } catch {
      // already gone
    }
    sentinel = null;
    active.value = false;
  }

  function onVisibility() {
    if (wanted && document.visibilityState === 'visible') void acquire();
  }

  async function request() {
    wanted = true;
    await acquire();
  }

  const GESTURES = ['pointerdown', 'touchend', 'keydown'] as const;
  if (supported) {
    document.addEventListener('visibilitychange', onVisibility);
    for (const evt of GESTURES) window.addEventListener(evt, onGesture, { passive: true });
  }
  onBeforeUnmount(() => {
    if (supported) {
      document.removeEventListener('visibilitychange', onVisibility);
      for (const evt of GESTURES) window.removeEventListener(evt, onGesture);
    }
    void release();
  });

  return { supported, active, request, release };
}
