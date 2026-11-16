# gaik-toolkit-desktop agent instructions

Experimental desktop app for the GAIK Toolkit. README.md explains the design.

- `src/` is the Electron main process (plain JS): `main.js` owns the window, the engine
  process and IPC; `settings.js` and `files.js` hold the unit-tested logic; `preload.js`
  is the only bridge to the renderer.
- `renderer/` is the UI (React, TypeScript, Tailwind v4, Vite). It has no Node access and
  reaches the engine only through `window.gaik.api`, which allows the routes listed in
  `API_ROUTES` in `main.js`. Add a route there when the engine gets one.
- `sidecar/server.py` is the engine: FastAPI over `gaik` from PyPI. Toolkit behaviour is
  fixed in `GAIK-project/gaik-toolkit`, not worked around here; bump the pin in
  `sidecar/requirements.txt` to take a new release.
- Checks: `bun run check`, and for the engine `python -m pytest sidecar/test_offline.py -q`
  with the engine's Python (no model key needed). CI runs both. A change to a model call
  or to start-up also needs a real run: `sidecar/smoke_live.py` with provider keys, then
  `bun start`.
- Secrets never reach the renderer or a file in plain text: the page gets `publicView()`,
  the store encrypts with `safeStorage`. Keep `contextIsolation`, `sandbox` and the
  navigation guard.
- UI text is English and short; no decorative badges, one accent colour, tokens in
  `renderer/src/styles.css`.
