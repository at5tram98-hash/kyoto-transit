# Production completion 2026-10-11

- Kyoto City Bus live arrivals: prefer the official all-selected approach page (one stop = one upstream request), then fall back to the last full snapshot and per-direction cache.
- Never convert official `N stops away` into invented minutes.
- Restore the requested 20-second foreground refresh cadence.
- Add a Service Worker and version all local CSS/assets to make the PWA update reliably on iPhone Safari/Home Screen.
- Keep rail arrival requests disabled outside the Kintetsu/Karasuma corridor context.
- Validate all route/direction parsing and production build before deployment.
