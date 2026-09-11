import { ref } from 'vue';

/**
 * Rest-timer sounds, shared between the live view (which triggers them) and the
 * app header (which shows the toggle). Module-scope singletons so both agree on
 * one preference and one audio context.
 *
 * A soft tick at 3-2-1 and a two-tone chime at zero, synthesized with Web
 * Audio — no files, nothing to load. A device preference, so it lives in
 * localStorage, not on the server. iOS only unlocks audio inside a user
 * gesture, so the context is primed from the Log set / toggle taps — and the
 * ringer switch still wins.
 */
const soundOn = ref(localStorage.getItem('ovl_rest_sound') !== 'off');
let audioCtx: AudioContext | null = null;
/** Whether the context is live, so the UI can say "tap once" instead of just
 *  staying quiet. iOS hands back a suspended context outside a gesture. */
const armed = ref(false);

export function primeAudio(): void {
  if (!soundOn.value) return;
  type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
  const Ctx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctx) return;
  audioCtx = audioCtx ?? new Ctx();
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().then(() => {
      armed.value = audioCtx?.state === 'running';
    });
  }
  armed.value = audioCtx.state === 'running';
}

/**
 * Arm from any tap anywhere in the app, not only Log set and the toggle.
 *
 * A reload — a deploy, a swipe-back, Safari reaping the tab — drops the
 * context, and everything after that failed silently until the next set was
 * logged. Which is backwards: the beeps matter most during the rest that
 * follows a set, and by then there is nothing left to tap. Any pointer or key
 * event re-arms it; the listeners stay for the life of the page because the
 * context can be suspended again at any time (backgrounding, a phone call,
 * another app taking the audio session).
 */
if (typeof window !== 'undefined') {
  const rearm = () => {
    if (soundOn.value && (!audioCtx || audioCtx.state !== 'running')) primeAudio();
  };
  for (const evt of ['pointerdown', 'touchend', 'keydown']) {
    window.addEventListener(evt, rearm, { passive: true });
  }
  // Coming back from a backgrounded tab is the other moment iOS suspends it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rearm();
  });
}

function beep(freq: number, delaySec = 0, durSec = 0.09, gain = 0.2): void {
  // Best-effort revive: a suspended context cannot be resumed here without a
  // gesture, but asking costs nothing and covers the cases where it can.
  if (audioCtx && audioCtx.state === 'suspended') primeAudio();
  if (!audioCtx || audioCtx.state !== 'running') {
    armed.value = false;
    return;
  }
  const at = audioCtx.currentTime + delaySec;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + durSec);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(at);
  osc.stop(at + durSec + 0.05);
}

export const tickSound = (): void => beep(880, 0, 0.06, 0.12);

export function doneChime(): void {
  beep(880, 0, 0.12);
  beep(1318.5, 0.14, 0.22);
}

export function toggleSound(): void {
  soundOn.value = !soundOn.value;
  localStorage.setItem('ovl_rest_sound', soundOn.value ? 'on' : 'off');
  // Audible feedback doubles as the unlock gesture.
  if (soundOn.value) {
    primeAudio();
    tickSound();
  }
}

export function useRestSound() {
  return { soundOn, armed, primeAudio, tickSound, doneChime, toggleSound };
}
