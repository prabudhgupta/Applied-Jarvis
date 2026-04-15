import asyncio
import os
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from models import VehicleState

app = FastAPI(title="Applied Jarvis — Mining Truck Digital Twin")

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:4173",
    os.getenv("FRONTEND_URL", "https://applied-jarvis.vercel.app"),
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory state — resets on restart (fine for demo; production would use Redis)
state = VehicleState()
clients: Set[WebSocket] = set()


async def broadcast():
    """Send current state JSON to all connected WebSocket clients."""
    data = state.model_dump_json()
    for ws in clients.copy():
        try:
            await ws.send_text(data)
        except Exception:
            clients.discard(ws)


# ── REST endpoints ────────────────────────────────────────────────────────────

@app.get("/api/state")
async def get_state():
    return state


@app.post("/api/mode")
async def set_mode(payload: dict):
    """Toggle autonomous / manual mode.
    Payload: {"mode": "autonomous" | "manual"}
    """
    mode = payload.get("mode")
    if mode not in ("autonomous", "manual"):
        return {"error": "mode must be 'autonomous' or 'manual'"}, 400
    state.mode = mode
    await broadcast()
    return state


@app.post("/api/bed")
async def set_bed(payload: dict):
    """Raise or lower the dump bed.
    Payload: {"position": "raised" | "lowered"}
    """
    position = payload.get("position")
    if position not in ("raised", "lowered"):
        return {"error": "position must be 'raised' or 'lowered'"}, 400
    state.bed_position = position
    # Load weight drops to 0 when bed is raised (material dumped)
    state.telemetry.load_weight_tons = 0 if position == "raised" else 380
    await broadcast()
    return state


@app.post("/api/lidar")
async def set_lidar(payload: dict):
    """Toggle LIDAR scan animation.
    Payload: {"active": true | false}
    """
    active = payload.get("active")
    if not isinstance(active, bool):
        return {"error": "active must be a boolean"}, 400
    state.lidar_active = active
    await broadcast()
    return state


@app.post("/api/alert")
async def trigger_alert(payload: dict):
    """Trigger a component alert. Auto-clears after 5 seconds.
    Payload: {"component": str, "severity": str}
    Valid components: chassis, cab, engine, lidar,
                      tire_front_left, tire_front_right,
                      tire_rear_left, tire_rear_right
    """
    component = payload.get("component", "chassis")
    severity = payload.get("severity", "warning")
    alert_value = {"component": component, "severity": severity}
    state.alert = alert_value
    await broadcast()

    # Auto-clear after 5s — only if the same alert is still active
    async def _auto_clear(captured_alert: dict):
        await asyncio.sleep(5)
        if state.alert == captured_alert:
            state.alert = None
            await broadcast()

    asyncio.create_task(_auto_clear(alert_value))
    return state


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.add(websocket)
    # Send current state immediately on connect so the client can hydrate
    await websocket.send_text(state.model_dump_json())
    try:
        while True:
            # Keep connection alive; content is ignored (client sends 'ping')
            await websocket.receive_text()
    except WebSocketDisconnect:
        clients.discard(websocket)
