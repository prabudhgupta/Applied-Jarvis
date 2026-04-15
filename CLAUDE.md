# CLAUDE.md — Applied Jarvis: Mining Truck Digital Twin

Project-specific guidance for Claude Code. Based on Boris Cherny's CLAUDE.md template.
Update this file whenever Claude does something incorrectly so it learns not to repeat mistakes.

---

## Project Overview

**Applied Jarvis** is a web-based 3D digital twin of an autonomous mining haul truck, styled as a Jarvis/Iron Man holographic interface. Built as a take-home challenge for Applied Intuition (the autonomous vehicle software company whose highest-growth vertical is mining).

**The user persona:** A remote operations supervisor monitoring 20–30 autonomous haul trucks from a control room. When a truck flags an anomaly, they need instant spatial understanding — where is the problem, what's the truck's state, is it loaded?

**Stack:**
- `backend/` — FastAPI (Python), in-memory Pydantic state, 5 REST endpoints + `/ws` WebSocket broadcast
- `frontend/` — Three.js (vanilla), Vite 6, custom GLSL holographic ShaderMaterial, EffectComposer bloom, HTML/CSS HUD overlay

---

## Development Workflow

Give Claude verification loops for quality improvement:

1. Make changes
2. Run the backend and confirm `/docs` OpenAPI UI loads
3. Run the frontend dev server and confirm the 3D scene renders
4. Test each API endpoint (mode, bed, lidar, alert) via the browser buttons or curl
5. Confirm WebSocket state propagates to the HUD and 3D scene
6. Before committing: run `npm run build` in `frontend/` to confirm no Vite build errors

---

## Commands Reference

```sh
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload          # API at :8000, OpenAPI docs at :8000/docs

# Frontend
cd frontend
npm install
npm run dev                        # Dev server at :5173
npm run build                      # Production build to dist/
npm run preview                    # Preview production build locally

# Quick API tests
curl http://localhost:8000/api/state
curl -X POST http://localhost:8000/api/mode   -H "Content-Type: application/json" -d '{"mode":"autonomous"}'
curl -X POST http://localhost:8000/api/bed    -H "Content-Type: application/json" -d '{"position":"raised"}'
curl -X POST http://localhost:8000/api/lidar  -H "Content-Type: application/json" -d '{"active":true}'
curl -X POST http://localhost:8000/api/alert  -H "Content-Type: application/json" -d '{"component":"tire_rear_left","severity":"warning"}'
```

---

## Code Style & Conventions

### Python (backend)
- Pydantic v2 — use `.model_dump()` and `.model_dump_json()`, not `.dict()` (deprecated)
- Type everything explicitly; no bare `dict` returns from endpoints — return the Pydantic model
- `broadcast()` must iterate `clients.copy()` — never mutate a set while iterating it
- Alert auto-clear tasks must capture the alert value at task creation and check before clearing (prevents race conditions with rapid re-triggers)

### JavaScript (frontend)
- All Three.js imports via `three/examples/jsm/...` — Vite resolves bare `'three'` specifiers at build time
- **Always call `composer.render()`** in the animation loop — never `renderer.render()` (double-render bug)
- **`OutputPass` must be the last pass** in the EffectComposer chain — missing it causes washed-out bloom colors
- **`renderer.outputColorSpace = THREE.SRGBColorSpace`** — `outputEncoding` was removed in Three.js r152
- `AdditiveBlending + depthWrite: false` on all holographic/transparent meshes — prevents depth artifacts
- The animation architecture uses a **target/lerp pattern**: WebSocket callbacks set target values; `tickEffects(delta)` lerps toward them each frame. Never update the 3D scene directly from button clicks.
- `bedGroup` pivot must be at the rear-bottom edge of the chassis — center pivot creates a scissors-lift instead of a realistic dump motion

### Shared
- Environment variables: `VITE_API_URL` and `VITE_WS_URL` — set in `.env.local` for dev, Vercel env vars for production
- Production WebSocket URL must use `wss://` (not `ws://`) — browsers block mixed content on HTTPS pages

---

## Architecture

```
Browser (Three.js + HUD)            FastAPI Backend
┌───────────────────────┐           ┌─────────────────────┐
│  js/scene.js          │           │  main.py            │
│  js/vehicle.js        │◄── WS ────│  VehicleState       │
│  js/effects.js        │           │  (in-memory)        │
│  js/hud.js            │──REST────►│  5 endpoints        │
│  js/websocket.js      │           │  /ws broadcast      │
│  js/main.js           │           └─────────────────────┘
└───────────────────────┘
```

**Key design tradeoffs (narrate these in the video):**
- Full state broadcast not deltas: clean for 4 toggles; production → delta updates + Kafka/Redis Pub-Sub
- Procedural truck geometry: always works without a GLTF file; GLTF loads from `/models/truck.glb` if present
- In-memory state: resets on restart; production → Redis
- Custom ShaderMaterial not vendored library: `threejs-vanilla-holographic-material` is incompatible with r152+

---

## Self-Improvement

After every correction or mistake, update this CLAUDE.md with a rule to prevent repeating it.

End corrections with: "Now update CLAUDE.md so you don't make that mistake again."

---

## Working with Plan Mode

- Start every complex task in plan mode (shift+tab to cycle)
- Pour energy into the plan so Claude can 1-shot the implementation
- When something goes sideways, switch back to plan mode and re-plan. Don't keep pushing.
- Use plan mode for verification steps too, not just for the build

## Parallel Work

- For tasks that need more compute, use subagents to work in parallel
- Offload individual tasks to subagents to keep the main context window clean and focused
- When working in parallel, only one agent should edit a given file at a time
- For fully parallel workstreams, use git worktrees:
  `git worktree add .claude/worktrees/<name> origin/main`

## Automation

- Use `/loop` to run a skill on a recurring interval (e.g. `/loop 5m /babysit`)
- Turn repetitive workflows into skills, then loop them for hands-free automation

## Session Management

- Use `/branch` to fork a session, or `claude --resume <session-id> --fork-session` from CLI
- Use `/btw` for side queries without interrupting the agent's current work
- Use `/voice` (CLI) or the voice button (Desktop) for voice input

---

## Things Claude Should NOT Do

- Don't call `renderer.render()` when EffectComposer is active — always use `composer.render()`
- Don't omit `OutputPass` as the final composer pass
- Don't use `renderer.outputEncoding` — it was removed in Three.js r152; use `outputColorSpace`
- Don't write to `depthWrite: true` on AdditiveBlending transparent meshes
- Don't iterate directly over `clients` in `broadcast()` — always use `clients.copy()`
- Don't hardcode port 8000 in the Render start command — must use `$PORT`
- Don't use `ws://` for production WebSocket URLs — always `wss://` on HTTPS deployments
- Don't place `bedGroup` pivot at the bed's center — pivot at the rear edge for realistic dump motion
- Don't use single rear wheels — haul trucks have dual rear wheels (two per side); single rears look like a pickup truck
- Don't use `interface` in TypeScript; prefer `type`
- Don't use `any` type without explicit approval
- Don't commit without running `npm run build` first

---

## Project-Specific Patterns

- **State flow:** REST call → backend mutates state → `broadcast()` → WebSocket message → `onState(state)` in frontend → update HUD + set animation targets → `tickEffects(delta)` lerps toward targets each frame
- **Adding a new API endpoint:** (1) add route in `main.py`, (2) mutate state, (3) call `await broadcast()`, (4) add handler in `effects.js`/`hud.js`, (5) add button in `index.html` and wire in `main.js`
- **Adding a new alertable component:** add to `resolveComponentMesh()` map in `effects.js` and to the `componentMap` comment in `main.py`

---

_Update this file continuously. Every mistake Claude makes is a learning opportunity._

_Boris Cherny's original template: https://github.com/0xquinto/bcherny-claude_
