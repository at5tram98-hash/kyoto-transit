# Stability pass — 2026-10-11

- City Bus arrival refresh now updates the oldest or missing directions first instead of relying on fixed 15-second modulo slots.
- Per-direction arrival cache retention is extended while source freshness remains explicitly bounded.
- City Bus and Kyoto Bus route-search feeds can fall back to official timetable sources when ODPT credentials are unavailable or stored GTFS is not usable.
- Kyoto Bus fallback uses official trip/stop timing data where available.
- City Bus fallback uses official departure boards and clearly marks completed segment timing as fallback-derived.
