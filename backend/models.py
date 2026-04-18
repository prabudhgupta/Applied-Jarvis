from pydantic import BaseModel
from typing import Literal, Optional


class TirePressure(BaseModel):
    fl: float = 100
    fr: float = 100
    rl: float = 98
    rr: float = 100


class Telemetry(BaseModel):
    load_weight_tons: float = 380
    tire_pressure_psi: TirePressure = TirePressure()
    engine_temp_c: float = 92
    fuel_percent: float = 67
    speed_kph: float = 0


class PredictionItem(BaseModel):
    component: str
    current_value: float
    threshold: float
    slope_per_sec: float
    seconds_to_threshold: Optional[float] = None
    severity: str = "normal"


class HistoryPoint(BaseModel):
    t: float
    v: float


class VehicleState(BaseModel):
    mode: Literal["autonomous", "manual"] = "manual"
    bed_position: Literal["raised", "lowered"] = "lowered"
    lidar_active: bool = False
    alert: Optional[dict] = None
    telemetry: Telemetry = Telemetry()
    predictions: list[PredictionItem] = []
    telemetry_history: dict[str, list[HistoryPoint]] = {}
