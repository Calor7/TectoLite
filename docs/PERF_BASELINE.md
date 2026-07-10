# TectoLite Performance Baseline

Date: 2026-07-10

Measurement harness: `?perf` enables the live overlay. `?perf=bench1` loads the deterministic benchmark world, and `?perf=bench3` loads the stress variant.

## Scenarios

| Scenario | World | Metric | Baseline | After TASK_07 | After TASK_08 | After TASK_09 | After TASK_10 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Idle | bench1 | frame avg / p95 | 3.9 ms / 5.2 ms | - | - | - | - |
| Playback | bench1 | frame avg / p95 | pending manual capture | - | - | - | - |
| Time scrub | bench1 | frame avg / p95 | pending manual capture | - | - | - | - |
| Undo push | bench1, 50 edits | ms / heap method | pending manual capture | - | - | - | - |

## Machine

Initial idle smoke capture used the Codex in-app browser against the Vite dev server at `http://127.0.0.1:5173/?perf=bench1`. Overlay reported 102 plates and 72 rings. Add CPU, memory, and browser details when doing the full benchmark pass.

## Notes

- Harness landed before optimization tasks.
- Do not fill optimization columns from different worlds or settings.
- WebGL fence verdict remains pending until TASK_07 through TASK_10 have measured results.
