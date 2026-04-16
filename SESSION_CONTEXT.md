# Session Context — Applied Jarvis

**Repo:** `prabudhgupta/Applied-Jarvis`
**Branch:** `claude/mining-truck-digital-twin-Uyfmr`
**Session date:** 2026-04-15
**Purpose:** Take-home AI engineer challenge submission for Applied Intuition

---

## What This Is

A web-based 3D **digital twin** of an autonomous mining haul truck, styled as a Jarvis/Iron Man holographic interface. Built as a complete submission for Applied Intuition's AI Engineer take-home challenge. The challenge required: 360° orbit camera, "Jarvis hologram" aesthetic, REST API controlling the visualization in real-time, runs in Chrome with no special setup, and a narrated screenshare of the build process.

---

## Research Conducted This Session

### Applied Intuition — Why Mining

- Applied Intuition operates across 6 verticals: automotive, defense, trucking, **mining**, construction, agriculture
- **Mining is their highest-growth vertical right now** — Komatsu partnership announced Sep 2025 (first major mining customer, featured prominently on their homepage with a quote from Komatsu Mining's president)
- Caterpillar collaboration for virtual testing of autonomous machines
- Autonomous mining truck market projected to grow from $1.6B → $12.6B by 2031
- Only ~3% of global mining trucks currently operate autonomously — massive greenfield
- Applied Intuition's "Cabin Intelligence" product for mining: "transforms the cab into an intelligent command center" — this project is a prototype of that concept

**Decision:** Build a mining truck, not a car. Most applicants will build a Tesla or Porsche. Mining signals "I researched the company."

### Digital Twin Concept

- A digital twin is a software replica of a physical vehicle that mirrors real-time state using sensor data
- **User persona:** Remote operations supervisor monitoring 20–30 autonomous haul trucks from a control room
- **Problem solved:** When a truck flags an anomaly, supervisor needs instant spatial understanding — 2D dashboards don't give spatial intuition, a 3D digital twin does
- **Why 3D over cameras:** Cameras show one angle, fail in dust/rain/darkness, can't visualize invisible things (sensor coverage zones, planned routes). Digital twin shows everything from any angle.

### Boris Cherny's CLAUDE.md

- Boris Cherny is the creator and head of Claude Code at Anthropic
- He published a CLAUDE.md template that has become a standard in the Claude Code community
- Source: `https://github.com/0xquinto/bcherny-claude`
- Key philosophy: **self-improvement loop** — after every correction, update CLAUDE.md with a rule to prevent repeating the mistake
- We adapted this template for the project and it lives at `/CLAUDE.md` in the repo

---

## Architecture Decisions Made

| Concern | Decision | Rationale |
|---|---|---|
| Frontend bundler | Vite 6 | Three.js jsm addons import from bare `'three'` specifier — requires a bundler. Importmap alternative needs 9+ entries and breaks fragily. |
| 3D framework | Three.js vanilla (no React Three Fiber) | Single scene, custom shaders — direct render loop control. R3F adds abstraction suited for multi-view apps. |
| Holographic material | Custom GLSL ShaderMaterial | `threejs-vanilla-holographic-material` library is incompatible with Three.js r152+ (removed `outputEncoding` API). Custom shader is ~80 lines and fully controllable. |
| Backend | FastAPI + in-memory state | Auto-generates `/docs` OpenAPI UI. No DB needed for demo. |
| Real-time | WebSocket full-state broadcast | Clean for 4 toggles. Production would use delta updates + Kafka/Redis. Tradeoff narrated in video. |
| 3D model | Procedural geometry with GLTF fallback | Always works without a .glb file. GLTF loads if `frontend/public/models/truck.glb` present. |
| Deployment | Vercel (frontend) + Render (backend) | Both free tier, both one-click from GitHub. |

---

## What Was Built

### File Structure

```
Applied-Jarvis/
├── CLAUDE.md                        ← Boris Cherny's template, adapted to project
├── README.md                        ← Full project explainer
├── .gitignore
├── backend/
│   ├── main.py                      ← FastAPI, 5 REST endpoints, WebSocket broadcast
│   ├── models.py                    ← VehicleState, Telemetry, TirePressure (Pydantic v2)
│   ├── requirements.txt
│   └── render.yaml                  ← Render deployment config
└── frontend/
    ├── package.json                 ← three@^0.176, vite@^6.3
    ├── package-lock.json
    ├── vite.config.js               ← base: './', manualChunks
    ├── vercel.json
    ├── .env.production              ← wss:// URLs for production
    ├── index.html                   ← HUD DOM structure, 4 control buttons, canvas
    ├── css/hud.css                  ← Monospace, cyan, corner brackets, scanlines
    └── js/
        ├── main.js                  ← Orchestrator: init + WS + buttons + telemetry drift
        ├── scene.js                 ← Renderer, OrbitControls, EffectComposer+Bloom, particles
        ├── vehicle.js               ← Holographic ShaderMaterial + procedural truck + GLTF fallback
        ├── effects.js               ← Sensor cones, LIDAR sweep, bed lerp, alert glow, tickEffects()
        ├── hud.js                   ← DOM updates from VehicleState
        └── websocket.js             ← Connect, exponential backoff reconnect, 30s ping keepalive
```

### Backend (`main.py` + `models.py`)

**State model:**
```python
VehicleState:
  mode: "autonomous" | "manual"        default: "manual"
  bed_position: "raised" | "lowered"   default: "lowered"
  lidar_active: bool                   default: False
  alert: { component, severity } | None
  telemetry: { load_weight_tons, tire_pressure_psi {fl,fr,rl,rr}, engine_temp_c, fuel_percent, speed_kph }
```

**5 REST endpoints:**
- `GET  /api/state` — full current state
- `POST /api/mode`  — `{"mode": "autonomous"|"manual"}`
- `POST /api/bed`   — `{"position": "raised"|"lowered"}` (also sets load_weight_tons to 0 when raised)
- `POST /api/lidar` — `{"active": bool}`
- `POST /api/alert` — `{"component": str, "severity": str}` (auto-clears after 5s)
- `WS   /ws`        — broadcasts full state JSON to all clients on every change

**Key backend patterns:**
- `broadcast()` iterates `clients.copy()` — never mutates the set while iterating
- Alert auto-clear captures the alert value at task creation and checks before clearing (prevents race condition with rapid re-alerts)
- CORS allows `localhost:5173` + `FRONTEND_URL` env var (set in Render dashboard)

### Frontend — Key Modules

**`scene.js`:**
- WebGLRenderer with `outputColorSpace = THREE.SRGBColorSpace` (not `outputEncoding` — removed in r152)
- OrbitControls: 360° orbit, zoom, pan; `maxPolarAngle = PI/2` to stay above ground
- EffectComposer pipeline: `RenderPass → UnrealBloomPass(strength=1.2, threshold=0.15) → OutputPass`
- **`composer.render()` in loop — never `renderer.render()`** (double-render bug)
- **`OutputPass` must be last** — without it bloom colors wash out
- 500 cyan `THREE.Points` (AdditiveBlending, DynamicDrawUsage) drifting upward at 0.3 units/s, wrapping at y=22

**`vehicle.js`:**
- Custom `ShaderMaterial`: Fresnel edge glow + world-space horizontal scanlines + AdditiveBlending
- `uAlertBlend` uniform (0→1) lerps the mesh color toward red for alerts
- Procedural Caterpillar 797 silhouette: chassis, cab (left-offset like a real haul truck), engine hood, bumper, exhaust stacks, dump bed + walls, **dual rear wheels** (2 per side — critical for visual accuracy), lidar dome
- `bedGroup` pivot at rear-bottom edge of chassis — `rotation.x` creates realistic dump motion
- GLTF fallback: tries `./models/truck.glb`, applies holographic material to all meshes, catches 404 and falls through to procedural

**`effects.js`:**
- Target/lerp animation pattern: WS callbacks only set target values; `tickEffects(delta)` lerps toward them each frame
- Bed: `bedTargetAngle` (0 or PI*0.27), lerped at 1.4 rad/s
- Sensor cones: 4x `ConeGeometry` at truck corners, opacity lerped 0↔0.55 at 1.8/s (appear in autonomous mode)
- LIDAR sweep: `PlaneGeometry(18,18)` lying flat, fragment shader draws 28° arc, only `uAngle` uniform advances each frame (**do NOT change `rotation.z`** — this tilts the plane; the shader handles rotation visually)
- Alert glow: cloned mesh with red `MeshBasicMaterial` (AdditiveBlending), scaled 1.03×, disposed and recreated on each alert change

**`main.js`:**
- `currentState` module-level var tracks latest WS state for toggle button logic
- All button clicks → REST POST → backend broadcast → WS → visual update (never update 3D directly from clicks)
- `setInterval` every 2s drifts tire PSI (±0.3) and engine temp (±0.5°C) in frontend layer only (backend stores commanded state; sensor noise is a frontend concern)

**`websocket.js`:**
- Exponential backoff reconnect: 1s → 2s → 4s → … capped at 30s
- 30s ping keepalive (`ws.send('ping')`) — Render free tier drops idle WS at ~55s

### HUD (`index.html` + `hud.css`)

4 panels with corner brackets, monospace font, cyan color scheme:
- Top-left: VEHICLE STATUS (mode / bed / lidar)
- Top-right: TELEMETRY (load / speed / fuel / engine temp)
- Bottom-left: TIRE PSI (FL/FR/RL/RR, turns red if < 95 PSI)
- Bottom-right: SYSTEM (connection status, LIVE dot)
- Center-bottom: Alert banner (hidden by default, flashes red on alert)
- Bottom-center: 4 control buttons

---

## Critical Gotchas Discovered / Documented

1. `composer.render()` not `renderer.render()` in animation loop
2. `OutputPass` must be last in EffectComposer chain
3. `renderer.outputColorSpace = THREE.SRGBColorSpace` — `outputEncoding` removed in r152
4. `AdditiveBlending + depthWrite: false` on all transparent meshes
5. `bedGroup` pivot at rear edge, not center — wrong pivot = scissors-lift motion
6. `broadcast()` iterates `clients.copy()` — mutating set during iteration throws RuntimeError
7. Render deployment: `$PORT` in startCommand — hardcoded 8000 fails
8. Production WebSocket must use `wss://` — `ws://` blocked on HTTPS pages
9. Alert auto-clear must capture alert value at task creation before async sleep
10. Dual rear wheels required — single rears look like a pickup truck
11. **LIDAR bug fixed:** `lidarSweepMesh.rotation.z = lidarAngle` tilts the flat plane — only `uAngle` uniform should advance
12. Particle `BufferAttribute` must be at module scope to be accessible from `startAnimationLoop`

---

## Git History

```
6defc42  chore: add package-lock.json
d54133e  fix: LIDAR sweep bug, live telemetry drift, particle atmosphere
98bea76  docs: add CLAUDE.md and rewrite README
81197e7  feat: complete mining truck digital twin implementation
cc9e1f1  Initial commit
```

**PRs merged to main:** #1 (implementation), #2 (docs)
**PR open:** #3 (visual fixes — needs merge)

---

## Current State

### What's working (verified by running locally)
- Backend: all 5 endpoints respond correctly, WebSocket broadcasts on every state change
- Frontend: Vite dev server serves at `http://localhost:5173`
- All API mutations propagate to the HUD and 3D scene via WebSocket
- Telemetry drifts every 2s in the HUD
- Bed raise drops load_weight to 0T

### What's NOT yet done
- **PR #3 not yet merged** — visual fixes are on the branch but not on `main`
- **Not deployed** — Vercel + Render setup not done yet
- **No `.env.local`** — dev machine needs `VITE_API_URL=http://localhost:8000` and `VITE_WS_URL=ws://localhost:8000/ws` in `frontend/.env.local` (gitignored)
- **No real GLTF model** — running on procedural geometry; a Sketchfab haul truck .glb placed at `frontend/public/models/truck.glb` would be loaded automatically
- **Submission video not recorded** — the narrated screenshare is the actual deliverable

---

## How to Run Locally

```bash
# Terminal 1 — backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
# → http://localhost:8000/docs

# Terminal 2 — frontend
cd frontend
echo "VITE_API_URL=http://localhost:8000" > .env.local
echo "VITE_WS_URL=ws://localhost:8000/ws" >> .env.local
npm install
npm run dev
# → http://localhost:5173
```

---

## Deployment (not yet done)

### Frontend → Vercel
1. Import repo, set Root Directory to `frontend`
2. Set env vars: `VITE_API_URL=https://<render-url>`, `VITE_WS_URL=wss://<render-url>/ws`

### Backend → Render
1. Connect repo, Render auto-detects `backend/render.yaml`
2. Set `FRONTEND_URL=https://<vercel-url>` in Render env vars (for CORS)

---

## Submission Details

- **Submit to:** `ai-eng-sk-submissions@applied.co`
- **Deliverables:** Private video link (narrated screenshare) + optional live deployment URL
- **Video structure:** (0-5 min) Why mining / digital twin concept → (5-10 min) tech stack tradeoffs → (10-40 min) live build narration → (final) demo + reflection
