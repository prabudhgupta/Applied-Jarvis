"""
anomaly.py — Lightweight predictive anomaly detection on telemetry streams.

Keeps a rolling window of recent readings and fits a linear trend.
When the projected value crosses a danger threshold within a configurable
horizon, it emits a prediction that the frontend renders as an early warning.

Production would use an LSTM or transformer on multivariate sensor history;
linear regression demonstrates the pipeline without overengineering a demo.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Optional
from time import time


@dataclass
class Prediction:
    component: str
    current_value: float
    threshold: float
    slope_per_sec: float
    seconds_to_threshold: Optional[float]
    severity: str  # "normal" | "warning" | "critical"


THRESHOLDS = {
    "engine_temp_c": {"warning": 100.0, "critical": 105.0},
    "tire_fl": {"warning": 92.0, "critical": 88.0},
    "tire_fr": {"warning": 92.0, "critical": 88.0},
    "tire_rl": {"warning": 92.0, "critical": 88.0},
    "tire_rr": {"warning": 92.0, "critical": 88.0},
}

MAX_WINDOW = 60  # keep last 60 samples
HORIZON_SECONDS = 600  # predict up to 10 minutes ahead


class AnomalyDetector:
    def __init__(self):
        self._windows: dict[str, deque[tuple[float, float]]] = {}
        for key in THRESHOLDS:
            self._windows[key] = deque(maxlen=MAX_WINDOW)

    def push(self, key: str, value: float, ts: float | None = None):
        if key not in self._windows:
            return
        t = ts or time()
        self._windows[key].append((t, value))

    def predict(self, key: str) -> Prediction | None:
        if key not in THRESHOLDS:
            return None
        window = self._windows.get(key)
        if not window or len(window) < 3:
            return None

        thresholds = THRESHOLDS[key]
        current = window[-1][1]
        slope = self._linear_slope(window)

        is_rising = key == "engine_temp_c"

        if is_rising:
            critical_thresh = thresholds["critical"]
            warning_thresh = thresholds["warning"]
            if slope > 0.001:
                secs_to_critical = (critical_thresh - current) / slope
                secs_to_warning = (warning_thresh - current) / slope
            else:
                secs_to_critical = None
                secs_to_warning = None
        else:
            critical_thresh = thresholds["critical"]
            warning_thresh = thresholds["warning"]
            if slope < -0.001:
                secs_to_critical = (current - critical_thresh) / abs(slope)
                secs_to_warning = (current - warning_thresh) / abs(slope)
            else:
                secs_to_critical = None
                secs_to_warning = None

        if current >= critical_thresh if is_rising else current <= critical_thresh:
            severity = "critical"
            secs = 0
        elif secs_to_critical is not None and 0 < secs_to_critical <= HORIZON_SECONDS:
            severity = "critical"
            secs = secs_to_critical
        elif current >= warning_thresh if is_rising else current <= warning_thresh:
            severity = "warning"
            secs = 0
        elif secs_to_warning is not None and 0 < secs_to_warning <= HORIZON_SECONDS:
            severity = "warning"
            secs = secs_to_warning
        else:
            severity = "normal"
            secs = None

        return Prediction(
            component=key,
            current_value=round(current, 1),
            threshold=critical_thresh,
            slope_per_sec=round(slope, 4),
            seconds_to_threshold=round(secs, 1) if secs is not None else None,
            severity=severity,
        )

    def get_history(self, key: str, max_points: int = 30) -> list[dict]:
        window = self._windows.get(key)
        if not window:
            return []
        points = list(window)
        if len(points) > max_points:
            step = len(points) / max_points
            points = [points[int(i * step)] for i in range(max_points)]
        t0 = points[0][0] if points else 0
        return [{"t": round(t - t0, 1), "v": round(v, 1)} for t, v in points]

    @staticmethod
    def _linear_slope(window: deque[tuple[float, float]]) -> float:
        n = len(window)
        if n < 2:
            return 0.0
        t0 = window[0][0]
        sum_x = sum_y = sum_xy = sum_xx = 0.0
        for t, v in window:
            x = t - t0
            sum_x += x
            sum_y += v
            sum_xy += x * v
            sum_xx += x * x
        denom = n * sum_xx - sum_x * sum_x
        if abs(denom) < 1e-10:
            return 0.0
        return (n * sum_xy - sum_x * sum_y) / denom
