import asyncio
import os
import random
from contextlib import asynccontextmanager
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from models import VehicleState, PredictionItem, HistoryPoint
from anomaly import AnomalyDetector


@asynccontextmanager
async def lifespan(_app: FastAPI):
    asyncio.create_task(telemetry_simulation())
    yield


app = FastAPI(title="Applied Jarvis — Mining Truck Digital Twin", lifespan=lifespan)

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
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
detector = AnomalyDetector()

# Baseline values
ENGINE_BASELINE = 92.0
TIRE_BASELINE = 100.0

# Simulation flags
sim_tire_fail = False
sim_tire_fail_wheel = "rl"


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
    state.telemetry.speed_kph = 35 if mode == "autonomous" else 0
    if mode == "manual":
        global sim_tire_fail
        state.telemetry.engine_temp_c = ENGINE_BASELINE
        state.telemetry.tire_pressure_psi.fl = TIRE_BASELINE
        state.telemetry.tire_pressure_psi.fr = TIRE_BASELINE
        state.telemetry.tire_pressure_psi.rl = 98.0
        state.telemetry.tire_pressure_psi.rr = TIRE_BASELINE
        state.alert = None
        state.predictions = []
        state.telemetry_history = {}
        sim_tire_fail = False
        detector.__init__()
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


@app.post("/api/tire-fail")
async def toggle_tire_fail(payload: dict):
    """Toggle tire pressure failure simulation.
    Payload: {"active": true | false, "wheel": "fl"|"fr"|"rl"|"rr"}
    """
    global sim_tire_fail, sim_tire_fail_wheel
    active = payload.get("active", not sim_tire_fail)
    wheel = payload.get("wheel", "rl")
    sim_tire_fail = active
    sim_tire_fail_wheel = wheel
    if not active:
        psi = state.telemetry.tire_pressure_psi
        psi.fl = TIRE_BASELINE
        psi.fr = TIRE_BASELINE
        psi.rl = 98.0
        psi.rr = TIRE_BASELINE
        state.alert = None
        state.predictions = []
        state.telemetry_history = {}
        state.telemetry.speed_kph = 35 if state.mode == "autonomous" else 0
        detector.__init__()
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


# ── Background telemetry simulation ──────────────────────────────────────────
# Simulates realistic sensor drift: engine temp climbs under autonomous load,
# cools back toward baseline in manual. Feeds readings into the anomaly
# detector which computes trend predictions broadcast to all clients.

TICK_INTERVAL = 2  # seconds between simulation ticks

async def telemetry_simulation():
    while True:
        await asyncio.sleep(TICK_INTERVAL)
        t = state.telemetry

        if state.mode == "autonomous" and t.engine_temp_c >= 107:
            t.speed_kph = 0
            state.alert = {
                "component": "engine",
                "severity": "critical",
            }
            await broadcast()
            continue
        elif state.mode == "autonomous":
            t.engine_temp_c += 0.6 + random.uniform(-0.05, 0.05)
            t.fuel_percent = max(0, t.fuel_percent - 0.02)
        else:
            diff = t.engine_temp_c - ENGINE_BASELINE
            if abs(diff) > 0.1:
                t.engine_temp_c -= 0.2 * (1 if diff > 0 else -1)
            t.engine_temp_c += random.uniform(-0.05, 0.05)

        psi = t.tire_pressure_psi

        # Tire failure simulation — one tire loses pressure rapidly
        if sim_tire_fail:
            current_psi = getattr(psi, sim_tire_fail_wheel)
            if current_psi <= 85:
                t.speed_kph = 0
                tire_component = {
                    "fl": "tire_front_left", "fr": "tire_front_right",
                    "rl": "tire_rear_left", "rr": "tire_rear_right",
                }[sim_tire_fail_wheel]
                state.alert = {"component": tire_component, "severity": "critical"}
                await broadcast()
                continue
            setattr(psi, sim_tire_fail_wheel, current_psi - 1.5 + random.uniform(-0.1, 0.1))

        psi.fl += random.uniform(-0.15, 0.15)
        psi.fr += random.uniform(-0.15, 0.15)
        psi.rl += random.uniform(-0.15, 0.15)
        psi.rr += random.uniform(-0.15, 0.15)

        t.engine_temp_c = round(t.engine_temp_c, 1)
        psi.fl = round(psi.fl, 1)
        psi.fr = round(psi.fr, 1)
        psi.rl = round(psi.rl, 1)
        psi.rr = round(psi.rr, 1)

        detector.push("engine_temp_c", t.engine_temp_c)
        detector.push("tire_fl", psi.fl)
        detector.push("tire_fr", psi.fr)
        detector.push("tire_rl", psi.rl)
        detector.push("tire_rr", psi.rr)

        predictions = []
        for key in ["engine_temp_c", "tire_fl", "tire_fr", "tire_rl", "tire_rr"]:
            pred = detector.predict(key)
            if pred:
                predictions.append(PredictionItem(
                    component=pred.component,
                    current_value=pred.current_value,
                    threshold=pred.threshold,
                    slope_per_sec=pred.slope_per_sec,
                    seconds_to_threshold=pred.seconds_to_threshold,
                    severity=pred.severity,
                ))

        state.predictions = predictions
        history = {
            "engine_temp_c": [HistoryPoint(**p) for p in detector.get_history("engine_temp_c")],
        }
        if sim_tire_fail:
            key = f"tire_{sim_tire_fail_wheel}"
            history[key] = [HistoryPoint(**p) for p in detector.get_history(key)]
        state.telemetry_history = history

        await broadcast()


