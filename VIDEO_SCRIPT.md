# Video Script: Applied Jarvis

Target length: 15-20 minutes

---

## INTRO (0:00 - 2:00)
**[Screen: browser open to the app]**

> "Hi, I'm Prabudh. For this take-home, I built a real-time 3D digital twin of an autonomous mining haul truck — styled as a Jarvis holographic interface.
>
> Why mining? Applied Intuition's highest-growth vertical. The Komatsu partnership, the Cabin Intelligence product — autonomous mining is where the company is expanding. Only about 3% of global mining trucks are autonomous today, so there's a massive opportunity.
>
> The user persona I designed for: a remote operations supervisor in a control room, monitoring 20-30 autonomous haul trucks. When something goes wrong, they need instant spatial understanding — where's the problem, what's the truck's state."

---

## DEMO — THE HAPPY PATH (2:00 - 5:00)
**[Screen: app running, orbit around the truck]**

> "Let me show you the final product first, then I'll walk through how I built it.
>
> This is the truck — custom GLSL holographic shader with Fresnel edge glow, animated scanlines, and bloom post-processing. You can orbit 360 degrees, zoom in and out."

**[Click camera preset buttons]**

> "Three camera presets — top-down for spatial awareness, side profile for loading assessment, and operator-cab view. Smooth easing between them."

**[Click TOGGLE BED]**

> "The dump bed raises with the hinge at the rear — matching real Cat 797F mechanics. The load weight drops to zero in the HUD when the bed is raised."

**[Click TOGGLE LIDAR]**

> "LIDAR sweep — a rotating arc scanning the ground plane around the truck."

---

## DEMO — ENGINE FAILURE SCENARIO (5:00 - 8:00)
**[Screen: click SIM ENGINE FAIL]**

> "Now here's where it gets interesting — and where the AI engineering comes in.
>
> I'm starting the engine failure simulation. The truck goes into autonomous mode — notice the wheels are spinning, the ground is scrolling, it's driving.
>
> Watch the analytics panel at the top. There's a sparkline showing engine temperature over time. The backend is running a linear regression on the telemetry stream — it's fitting a trend line to the temperature readings every two seconds.
>
> See the dotted projection line extending beyond the data? That's the anomaly detector predicting where the temperature is heading. And now — there's the warning: 'Engine critical in X minutes.'
>
> The engine area is starting to glow yellow... now orange... now red. The sparkline shows exactly WHY the alert fired — the operator can see the trend, the threshold, and the projection.
>
> And there — 107 degrees. The system automatically shuts the truck down. Speed drops to zero, critical alert fires. The operator didn't have to react — the system caught it proactively."

**[Click SIM ENGINE FAIL again to reset]**

> "One click resets everything — temp back to baseline, sparkline clears, truck returns to normal."

---

## DEMO — TIRE FAILURE SCENARIO (8:00 - 10:00)
**[Screen: click SIM TIRE FAIL]**

> "Same anomaly detection pipeline, different scenario. Now the rear-left tire is losing pressure.
>
> Watch the tire sparkline — pressure dropping. The anomaly detector picks up the downward trend and projects when it'll cross the critical threshold.
>
> And look at the 3D model — the rear-left wheel is turning yellow... now red. The operator can see exactly WHICH tire has the problem spatially, not just as a number on a dashboard.
>
> Pressure hits 85 PSI — truck stops, critical alert. Same pipeline, different sensor, same result."

**[Reset]**

---

## ARCHITECTURE (10:00 - 13:00)
**[Screen: show code — main.py, then the architecture diagram]**

> "Let me walk through the architecture.
>
> Backend is FastAPI — five REST endpoints plus a WebSocket. When you click a button, it's a POST to the API. The backend mutates state and broadcasts over WebSocket to all connected clients. The 3D scene is NEVER updated directly from button clicks — everything flows through the WebSocket loop.
>
> This means any client — curl, another browser tab, a real sensor feed — that mutates state will propagate correctly. It's the same architecture you'd use in production with Kafka or Redis Pub-Sub, just simplified for the demo."

**[Screen: show anomaly.py]**

> "The anomaly detector keeps a rolling window of 60 samples per sensor. Every tick, it fits a linear regression and projects time-to-threshold.
>
> In production, you'd use an LSTM or transformer on multivariate sensor history. I chose linear regression deliberately — it demonstrates the pipeline without overengineering a demo. The ARCHITECTURE is what matters: rolling window, trend detection, predictive alert. That's the same shape as production systems."

**[Screen: show effects.js briefly]**

> "Frontend uses a target-lerp animation pattern. WebSocket callbacks set targets; the animation loop lerps toward them each frame. This prevents visual jank from WebSocket floods — a hundred rapid state changes just update the same target."

---

## TRADEOFFS & DECISIONS (13:00 - 15:00)
**[Screen: can show CLAUDE.md or just talk over the app]**

> "A few key tradeoffs I want to call out:
>
> Full state broadcast, not deltas — clean for a few toggles. Production with hundreds of sensors streaming at high frequency would use delta updates with a message broker.
>
> Custom GLSL shader instead of a library — the threejs-vanilla-holographic-material library hasn't been updated for Three.js r152 which removed the outputEncoding API it depends on. 80 lines of GLSL was simpler to own than to patch a dead library.
>
> In-memory state — resets on restart. Production would use Redis. The tradeoff was made consciously for demo scope.
>
> The GLTF mesh segmentation pipeline uses bbox-relative thresholds, not hardcoded coordinates. It auto-detects orientation and splits body from bed using triangle centroid classification. This means it works on any truck model, not just the one I tested with."

---

## REFLECTION (15:00 - 17:00)
**[Screen: the app, orbiting slowly]**

> "What I'd add with more time:
>
> Fleet view — multiple trucks on a map, click to focus on one. That's where the digital twin concept really shines operationally.
>
> Multivariate anomaly detection — correlating engine temp WITH tire pressure WITH load weight. An engine that's hot with a full load is normal; hot with an empty load is a problem.
>
> And real sensor data visualization — point clouds from LIDAR, occupancy grids from perception. That's the bridge between this demo and Applied Intuition's actual product.
>
> Thank you for watching. The code is on GitHub, and there's a live deployment at [URL]. I'd love to discuss this further."

---

## Recording Tips

- **Pace yourself** — pause between sections, let the viewer see the visuals
- **Don't rush the engine failure demo** — that's the money shot. Let the sparkline build up before talking over it
- **Orbit the truck** while talking about architecture to keep the visual interesting
- **Reset cleanly** between scenarios — click the button, wait for the sparkline to clear, then start the next one
- **Show DevTools Network > WS tab** briefly during the engine failure to show real-time WebSocket messages flowing
- **Keep energy up** — you're selling your thinking, not reading a script
