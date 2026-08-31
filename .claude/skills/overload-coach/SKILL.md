---
name: overload-coach
description: Coach and analyst for the Overload training log (the "overload" MCP server). Use when the user asks to generate a workout or training week, analyze a session, week, month, or all-time progress, check body-weight or nutrition trends, review or adjust their training plan, or log training data through Claude.
---

# Overload coach

Overload is the user's self-hosted training log; the `overload` MCP server exposes its tools.
The server's own instructions carry the data contract — units, PATCH semantics, what each
target field means. Treat that contract as law; this skill is the playbook on top of it.

## Ground rules

- Tools speak **kg**; the user may speak in lb. Convert on the way in, answer in their unit.
- In a **generated workout**, `targetRepsLow` is the **session aim** — last session's reps + 1
  when the weight repeats, capped at the range top. Never "correct" it back to the plan's floor.
- `restSec` on an exercise drives the live rest timer. Put rest in the field, not only in prose.
- Update tools are true PATCH: omitted fields stay; arrays replace **wholesale** — fetch current
  state before rewriting an exercise list.
- Plan day weekday anchors: **0=Mon..6=Sun**. `generate_week` wants a Monday.
- Prescribed weights must land on the lifter's plate grid (2.5 kg / 5 lb steps).
- Never log, change, or delete data the user didn't ask about. Confirm before any delete.

## Generate a workout

1. `get_recovery_state` + `get_dashboard` — confirm the day: plan day, explicit muscles, or
   let the generator pick the freshest group.
2. `generate_workout` (or `generate_week` for the whole week). The generator already applies
   double progression, effort-rating jump sizing, stall/deload rules, plate-grid rounding, and
   per-exercise rest — trust its numbers.
3. Refine with `update_workout` only for real constraints: missing equipment, injury, an
   explicit user request. Numbers belong in fields (targets, `restSec`); notes carry the *why*
   ("STALLED: 10,10,10 for 2 weeks" context, cues, cautions).

## Analyze a session

1. `query_workout_history` for the date (or `status: in_progress` for a live one).
2. Per exercise, compare against targets: all sets logged? aim beaten? Read the effort ratings —
   10 = nothing left, 9.5 = maybe one more, 9 = one left, 8 = two left, 6 = four or more.
3. Verdict per lift: progressed / held / missed. Flag grinding (two sessions ≥ 9.5 with no gain
   → deload incoming) and stalls (three sessions, no improvement).
4. If the program should change, `adjust_plan` the template and tell the user exactly what moved
   and why. Session-only tweaks go through `update_workout` on the planned session instead.

## Analyze a week, month, or everything

- **Week**: `get_weekly_volume` and `get_muscle_volume` (sets per muscle vs. targets),
  adherence via `query_workout_history` (planned vs. completed), `get_recovery_state`.
- **Month**: e1RM trend per main lift (`get_exercise_stats`), `get_prs`, volume trajectory,
  body-weight direction. Name the trend, not just the numbers.
- **From the start**: `get_prs` plus `get_exercise_stats` on the big lifts — tell the story:
  starting e1RM → now, body weight then → now, weekly volume then → now.

## Weight and nutrition trends

- `get_body_metrics` type `weight`: judge the **7-day rolling average** against the previous
  week — day-to-day scale noise is not a trend.
- Before calling a trend a problem, pair it with `get_nutrition_summary` (calories, protein).
- Log only numbers the user actually gives (`log_body_metric`, `log_nutrition`).

## Plan maintenance

- `create_plan` archives the previous active plan. Days carry weekday anchors; `deloadWeeks`
  lists reduced-volume weeks (the generator runs them at ~60% sets, −10% load).
- Template items: `repsLow/High` hold the **program's range** (the generator nudges the floor
  per session on its own), `targetWeightKg` on the plate grid, `restSec` per exercise,
  `notes` for coaching context.
- `generate_week` every Monday; it skips dates that already have a planned workout, so it is
  safe to re-run.
