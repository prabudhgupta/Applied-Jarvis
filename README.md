# Applied Jarvis — Mining Truck Digital Twin

A web-based 3D digital twin of an autonomous mining haul truck, styled as a Jarvis/Iron Man holographic interface. Built for the Applied Intuition AI Engineer take-home challenge.

**Why mining?** Applied Intuition's highest-growth vertical (Komatsu partnership, Sep 2025). The remote-supervisor use case — monitoring 20-30 autonomous trucks from a control room — is the exact problem their Cabin Intelligence product solves.

---

## Quick Start (3 commands)

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
# API + WebSocket live at http://localhost:8000
# OpenAPI docs at http://localhost:8000/docs
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Opens http://localhost:5173
```

---

## API Reference

| Method | Endpoint    | Payload                                       | Effect                          |
|--------|-------------|-----------------------------------------------|---------------------------------|
| GET    | /api/state  | —                                             | Returns full vehicle state      |
| POST   | /api/mode   | `{"mode": "autonomous" \| "manual"}`          | Toggle mode; broadcasts via WS  |
| POST   | /api/bed    | `{"position": "raised" \| "lowered"}`         | Raise/lower dump bed            |
| POST   | /api/lidar  | `{"active": true \| false}`                   | Toggle LIDAR scan animation     |
| POST   | /api/alert  | `{"component": str, "severity": str}`         | Trigger alert (auto-clears 5s)  |
| WS     | /ws         | —                                             | Real-time state broadcast       |

**Alert components:** `chassis`, `cab`, `engine`, `lidar`, `tire_front_left`, `tire_front_right`, `tire_rear_left`, `tire_rear_right`

### Example curl calls
```bash
# Switch to autonomous mode
curl -X POST http://localhost:8000/api/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "autonomous"}'

# Raise the dump bed
curl -X POST http://localhost:8000/api/bed \
  -H "Content-Type: application/json" \
  -d '{"position": "raised"}'

# Trigger a tire warning
curl -X POST http://localhost:8000/api/alert \
  -H "Content-Type: application/json" \
  -d '{"component": "tire_rear_left", "severity": "warning"}'
```

---

## Architecture

```
Browser (Three.js)          FastAPI Backend
┌─────────────────┐         ┌──────────────────┐
│  3D Scene       │◄── WS ──│  VehicleState    │
│  HUD Overlay    │         │  (in-memory)     │
│  Control Panel  │──REST──►│  5 REST endpoints│
└─────────────────┘         └──────────────────┘
```

**Key tradeoffs narrated in the video:**
- Full state broadcast (not deltas): clean for 4 toggles; production would use delta updates + message broker (Kafka/Redis Pub-Sub)
- Procedural truck geometry: always works without a GLTF file; GLTF loads if `/models/truck.glb` is present
- In-memory state: resets on restart; production → Redis
- Custom ShaderMaterial (not vendored holographic library): library is incompatible with Three.js r152+

---

## Deployment

**Frontend → Vercel**
- Set Root Directory to `frontend` in Vercel project settings
- Set env vars: `VITE_API_URL`, `VITE_WS_URL` (use `wss://` for production)

**Backend → Render**
- Uses `backend/render.yaml`
- Set `FRONTEND_URL` env var in Render dashboard (for CORS)
- Must use `$PORT` env var in start command (Render injects it)

---

## Tech Stack

- **Frontend:** Three.js (vanilla), Vite 6, custom GLSL ShaderMaterial, EffectComposer + UnrealBloomPass, HTML/CSS HUD, native WebSocket
- **Backend:** FastAPI, uvicorn, Pydantic v2, asyncio WebSocket broadcast
- **Deployment:** Vercel (frontend) + Render (backend)
