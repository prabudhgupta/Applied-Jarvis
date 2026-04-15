# Applied Jarvis — Autonomous Mining Truck Digital Twin

> A web-based 3D digital twin of an autonomous haul truck, styled as a holographic "Jarvis" interface.
> Built for the Applied Intuition AI Engineer take-home challenge.

---

## What This Is

**A digital twin** is a software replica of a physical vehicle that mirrors its real-time state using sensor data. This isn't a pretty spinning model — it's a prototype of the kind of operational tool a remote mine supervisor would use to monitor 20–30 autonomous haul trucks from a control room.

When a real truck's dump bed tilts to 45°, the model's bed rotates to match. When tire pressure drops, the model highlights that tire. When the LIDAR detects something, you see the scan sweep. No cameras needed — this is data-driven 3D reconstruction.

**Why mining?** Applied Intuition's highest-growth vertical right now. Their Komatsu partnership (Sep 2025) was their first major mining customer. The autonomous mining truck market is projected to grow from $1.6B to $12.6B by 2031 — and only ~3% of global mining trucks currently operate autonomously. This demo is a prototype of their "Cabin Intelligence" product concept.

---

## Demo

The app opens to a holographic haul truck (cyan Fresnel glow, scanlines, bloom) on a dark grid. Four buttons at the bottom trigger state changes via REST API — the backend broadcasts over WebSocket and the 3D scene responds in real time.

| Button | What happens |
|---|---|
| **TOGGLE MODE** | Autonomous: sensor cones appear at truck corners, LIDAR dome glows, HUD turns green. Manual: cones fade out, HUD turns amber. |
| **TOGGLE BED** | Dump bed smoothly rotates to 45° (raised = material dumped, load weight drops to 0). |
| **TOGGLE LIDAR** | Rotating scan arc sweeps 360° around the truck at ground level. |
| **TRIGGER ALERT** | A random component (tire, engine, chassis, etc.) glows red. HUD flashes the alert banner. Auto-clears after 5 seconds. |

You can also orbit, zoom, and pan the camera freely (360°).

---

## Running Locally (3 commands)

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

- API live at `http://localhost:8000`
- Interactive OpenAPI docs at `http://localhost:8000/docs` — every endpoint documented with schemas

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

- Opens at `http://localhost:5173`
- Connects to backend automatically via WebSocket

---

## Architecture

```
Browser (Three.js + CSS HUD)        FastAPI Backend
┌────────────────────────┐          ┌──────────────────────┐
│  scene.js              │          │  main.py             │
│    WebGLRenderer       │          │    VehicleState      │
│    OrbitControls       │◄─ WS ────│    (in-memory)       │
│    EffectComposer+Bloom│          │    5 REST endpoints  │
│  vehicle.js            │          │    /ws broadcast     │
│    Holographic shader  │──REST───►└──────────────────────┘
│    Procedural geometry │
│  effects.js            │
│    Bed lerp animation  │
│    LIDAR sweep plane   │
│    Sensor cone fade    │
│    Alert glow overlay  │
│  hud.js  websocket.js  │
└────────────────────────┘
```

**State flow:**
```
Button click → POST /api/... → backend mutates state → broadcast() over WS
  → onState(state) in frontend → updateHUD() + set animation targets
  → tickEffects(delta) lerps toward targets each frame → composer.render()
```

The 3D scene is never updated directly from button clicks — all changes flow through the WebSocket loop. This means the UI is always in sync with the actual backend state, and any external client (curl, another browser tab, a real sensor feed) that mutates state will propagate correctly.

---

## REST API

| Method | Path | Payload | Effect |
|---|---|---|---|
| GET | `/api/state` | — | Full current state |
| POST | `/api/mode` | `{"mode": "autonomous" \| "manual"}` | Toggle drive mode |
| POST | `/api/bed` | `{"position": "raised" \| "lowered"}` | Raise/lower dump bed |
| POST | `/api/lidar` | `{"active": bool}` | Toggle LIDAR sweep |
| POST | `/api/alert` | `{"component": str, "severity": str}` | Trigger alert (auto-clears 5s) |
| WS | `/ws` | — | Real-time state broadcast |

**Alert components:** `chassis`, `cab`, `engine`, `lidar`, `tire_front_left`, `tire_front_right`, `tire_rear_left`, `tire_rear_right`

```bash
# Example curl calls
curl http://localhost:8000/api/state

curl -X POST http://localhost:8000/api/mode \
  -H "Content-Type: application/json" -d '{"mode": "autonomous"}'

curl -X POST http://localhost:8000/api/alert \
  -H "Content-Type: application/json" \
  -d '{"component": "tire_rear_left", "severity": "warning"}'
```

---

## Tech Stack & Key Decisions

### Frontend: Three.js (vanilla) + Vite 6
Not React Three Fiber. Single scene with custom shaders — direct control over the render loop and material pipeline. Less dependency surface, easier to debug.

Three.js r176+ `examples/jsm` addons import from bare `'three'` specifier — requires a bundler. Vite resolves this at build time; an importmap would need 9+ entries for every jsm sub-path and breaks fragily.

### Holographic Material: Custom ShaderMaterial
Not the `threejs-vanilla-holographic-material` library (last updated for r152, which removed the `outputEncoding` API it depends on). The holographic effect needs exactly: Fresnel edge glow, horizontal scanlines, emissive base, transparency. That's ~80 lines of GLSL — simpler to own than to patch a dead library.

### Backend: FastAPI
Auto-generates `/docs` OpenAPI UI — a reviewer can hit that URL and see every endpoint documented with request/response schemas. Small signal, but it says "I think about DX."

### Real-time: WebSocket broadcast (not polling)
Full state object on every change — clean for 4 toggles. In production with hundreds of sensors streaming at high frequency: delta updates + message broker (Kafka/Redis Pub-Sub). Tradeoff made consciously for demo scope.

### State: In-memory Python dict
Resets on restart. Fine for a demo. Production → Redis.

### 3D Model: Procedural geometry with GLTF fallback
The truck is built from Three.js primitives (BoxGeometry, CylinderGeometry) replicating a Caterpillar 797 haul truck silhouette. If a `frontend/public/models/truck.glb` file is present, it loads that instead and applies the holographic material automatically.

---

## Deployment

### Frontend → Vercel
1. Import the repo in Vercel, set **Root Directory** to `frontend`
2. Set environment variables:
   ```
   VITE_API_URL=https://your-backend.onrender.com
   VITE_WS_URL=wss://your-backend.onrender.com/ws
   ```
   (Note: `wss://` not `ws://` — browsers block mixed content on HTTPS)

### Backend → Render
1. Connect repo, use `backend/render.yaml` (auto-detected)
2. Set environment variable `FRONTEND_URL` to your Vercel URL (for CORS)
3. The `render.yaml` uses `$PORT` — Render injects this; hardcoded port 8000 fails

---

## File Structure

```
Applied-Jarvis/
├── CLAUDE.md                    ← AI coding instructions (Boris Cherny's template)
├── README.md                    ← This file
├── .gitignore
├── backend/
│   ├── main.py                  ← FastAPI app, 5 REST endpoints, WebSocket broadcast
│   ├── models.py                ← VehicleState, Telemetry, TirePressure (Pydantic v2)
│   ├── requirements.txt
│   └── render.yaml              ← Render deployment config
└── frontend/
    ├── package.json             ← three@^0.176, vite@^6.3
    ├── vite.config.js
    ├── vercel.json
    ├── .env.production          ← wss:// URLs for production
    ├── index.html               ← HUD DOM, canvas, control buttons
    ├── css/
    │   └── hud.css              ← Monospace, cyan, corner brackets, scanlines
    └── js/
        ├── main.js              ← Orchestrator: scene + truck + effects + WS + buttons
        ├── scene.js             ← Renderer, camera, OrbitControls, EffectComposer+Bloom
        ├── vehicle.js           ← Holographic ShaderMaterial + procedural truck geometry
        ├── effects.js           ← Sensor cones, LIDAR sweep, bed lerp, alert glow
        ├── hud.js               ← DOM updates from VehicleState
        └── websocket.js         ← Connect, reconnect backoff, 30s ping keepalive
```

---

## What I'd Add With More Time

- **Multiple truck support** — click to focus on one truck from a fleet view
- **Route path visualization** — glowing line on the ground showing planned haul path
- **Camera presets** — smooth transitions between front/side/operator-cab views
- **Delta WebSocket updates** — only broadcast changed fields, not full state
- **Simulated telemetry drift** — tire pressure slowly decreasing, engine temp fluctuating
- **Sound design** — subtle hum when autonomous mode activates

---

*Model attribution: procedural geometry. No external 3D asset used.*
