# Bug: live session timer silently resets and writes a false duration

Verified against the live database and current source, 2026-08-17.

## Symptom

A walk logged on 2026-08-15 recorded a **16-second** session with **zero sets**. The user
started the session, walked, forgot to stop it, and on reopening the app in a phone browser
found the timer had restarted from zero. The real session data was unrecoverable.

Contrast with sessions that worked — the workout-level timer normally tracks the logged set:

| Date | `Workout.durationSec` | Set duration |
|---|---|---|
| 2026-08-08 | 2,101 s | 2,100 s |
| 2026-08-11 | 1,387 s | 1,358 s |
| 2026-08-13 | 1,793 s | 1,800 s |
| **2026-08-15** | **16 s** | **none** |

The failure is **silent**. Nothing errors, nothing warns; a wrong duration is written and
accepted.

## Root cause

**Session timing exists only in the browser.** `apps/web/src/views/WorkoutLive.vue`:

```js
const startedAt = ref(Date.now());            // :89  — default is "now"
const TIMER_KEY = `ovl_live_${workoutId}`;    // :101 — per-origin, per-browser-profile
const STALE_SESSION_MS = 12 * 60 * 60 * 1000; // :102
```

`restoreTimers()` (:111–127) reads that `localStorage` key. If it is missing, unparseable, or
older than 12 hours, the function **falls through and leaves `startedAt` at `Date.now()`** —
the clock silently restarts at zero. `elapsed` is then derived from it (:147) and posted
verbatim on completion (:329):

```js
await api.post(`/workouts/${workoutId}/complete`, { durationSec: elapsed.value });
```

The server accepts it unconditionally — `apps/server/src/routes/workouts.ts:138,148`:

```ts
body: z.object({ durationSec: z.number().int().positive().nullish() }),
data: { status: 'completed', durationSec: request.body.durationSec ?? existing.durationSec },
```

**`model Workout` has no `startedAt` field** (`schema.prisma`: `status`, `durationSec`,
`createdAt` only). So when a workout flips to `in_progress`, *the server never records when*.
There is no second source of truth and no way to recover.

### Three ways the localStorage key goes away

1. **Different browser or storage context.** `localStorage` is per-origin *per browser
   profile*. On iOS, a home-screen/standalone view and a Safari tab may not share storage.
2. **iOS Safari eviction.** Safari caps storage for non-installed sites at ~7 days of
   inactivity and clears under storage pressure. Silent.
3. **The 12-hour cutoff, by design.** :117 discards anything older — "a session left running
   overnight is abandoned, not resumable." Sound intent, but it throws the session away
   instead of asking.

## Fix

**1 — Give the server the session start.** Add `startedAt DateTime?` to `model Workout`; set
it on the `planned → in_progress` transition; return it from `serializeWorkout`. This is the
actual fix — everything below is defence in depth.

*Accept:* starting a session on one device and opening the workout on another shows the same
elapsed time.

**2 — Make the server authoritative for duration.** When `startedAt` is present, compute
duration server-side at completion and treat the client's `durationSec` as advisory. Reject or
clamp values that contradict it (a 16 s duration against a `startedAt` 40 minutes earlier is
not a valid completion).

*Accept:* posting an implausible `durationSec` cannot overwrite a server-derived duration.

**3 — Prefer server over localStorage.** `restoreTimers()` should seed from the server's
`startedAt` and use `localStorage` only as an offline fallback, not the source of truth.

**4 — Stop failing silently.** Two prompts where there is currently none:
- Stale session found (>12 h): ask "started 14 hours ago — resume, or start fresh?" instead of
  silently zeroing.
- At completion, if elapsed is implausibly small (< 60 s) or contradicts `startedAt`, confirm
  before writing rather than accepting it.

*Accept:* neither a reset timer nor an abandoned session can write a wrong duration without
the user seeing it.

## Notes

- **Live exposure:** a workout can sit `in_progress` indefinitely with no server-side start
  time. At time of writing, `Day A — 2026-08-17` is in that state.
- **Data integrity:** the 2026-08-15 walk has been re-entered as an approximate reconstruction
  (`externalId: walk-2026-08-15-reconstructed`) from the user's recall — roughly 18 min /
  1.22 km — and is flagged as estimated in its notes. The empty 16-second original was
  repurposed for the 2026-08-16 walk. Do not treat 08-15 as measured data.
- Out of scope: the 12-hour abandonment threshold itself is reasonable. The defect is
  discarding silently, not the cutoff.
