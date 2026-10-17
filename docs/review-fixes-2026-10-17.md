# MyMap UX / ride-detection review fixes — 2026-10-17

This note tracks the production changes applied from the combined Grok and ChatGPT review.

Priorities:

- P0: reduce false ride detection while stationary / at complex stations.
- P0: move actionable departure information above system-status chrome on the Now screen.
- P1: replace ambiguous operation-status question marks with explicit state text.
- P1: normalize Japanese navigation labels and prevent internal IDs from leaking into user-facing text.
- P1: keep ride correction, destination change and ride termination reachable near the top of the riding experience.
- P2: consolidate visual geometry and improve map readability without removing existing capabilities.

Implementation should preserve existing route search, timetable, pass, foldback and realtime functionality.