# Contributing

Thanks for taking an interest. The short version: make the change, keep every control tested, and let CI confirm.

## Set up

```bash
cd frontend
npm install
npm run dev            # http://localhost:3002 — the browser edition, hot reloading
```

The server edition needs Python, not Docker (see [`backend/README.md`](backend/README.md)):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-test.txt
pytest                 # a throwaway SQLite database; add TEST_DATABASE_URL to run on PostgreSQL
ruff check .
```

## Before you open a pull request

```bash
npm run lint           # ESLint, including the React hooks rules
npm test               # unit tests for the in-browser engine
npm run test:e2e       # builds the production bundle and drives it in a real browser
```

If you touched `backend/`, also run `pytest` and `ruff check .` there.

`npm run test:e2e` also runs the accessibility audit (axe-core, WCAG 2.1 AA, light and dark, desktop and phone)
and, together with `npm run census` and `node scripts/coverage-gate.mjs`, the check that **every interactive element
in the source was exercised by a test**. That gate is what keeps a button from shipping untested.

The same suite can drive a site that is already deployed, to check what visitors actually get:

```bash
E2E_BASE_URL=https://paulelisha500-ops.github.io/retailmind/ npm run test:e2e         # GitHub Pages
E2E_BASE_URL=https://elisha622-retailmind.static.hf.space/ npm run test:e2e           # Hugging Face Space
```

(PowerShell: `$env:E2E_BASE_URL = "..."` first.) The four tests that type an email and password into the sign-in form
are skipped against a deployed site unless `E2E_LIVE_CREDENTIALS=1` is set by the site's owner.

## House rules

- **Every control gets a test id.** Pass `tid="screen.thing"` to the shared controls (`Button`, `Input`, `Switch`,
  `Segmented`, …) or put `data-tid` on a raw element. The census fails the build if a button, link, field or handler
  has none, and the gate fails it if no test used it.
- **Change both editions together.** The browser engine (`frontend/src/engine`) and the FastAPI backend
  (`backend/app`) answer the same API; a response shape that changes in one changes in the other.
- **Controls respond instantly.** Update the screen first and roll back if the change is refused (see `optimistic`
  in `frontend/src/lib/query.js`); do not leave a switch waiting on a round trip.
- **Check accessibility as you build.** Text needs 4.5:1 contrast in both themes (use the `--tint-fill` and
  `--red-fill` tokens behind white text), form fields go through `Field`, and anything unnamed needs an `aria-label`.
- **Keep first load small.** The first screen's JavaScript is about 62 kB gzipped; `scripts/bench-load.mjs`
  compares builds if you are unsure what a change cost.

## Commits and pull requests

Small, focused commits with a message that says why. Pull requests run the full pipeline; a green run is required
to merge, and merging to `main` publishes the site to GitHub Pages and the Hugging Face Space.
