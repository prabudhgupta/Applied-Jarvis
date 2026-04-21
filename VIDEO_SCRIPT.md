# Video Script: Applied Jarvis

Target length: 20-25 minutes

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

**[Demo voice control]**

> "One more thing before we get into the failure scenarios — the interface supports voice control. I can say 'raise bed'... 'camera top'... 'status report.' The system reads back telemetry: engine temp, speed, fuel, current mode. For a control room operator managing 20 trucks, hands-free control matters — they're watching multiple screens, they can't always click."

---

## DEMO — ENGINE FAILURE SCENARIO (5:00 - 9:00)
**[Screen: click SIM ENGINE FAIL]**

> "Now here's where it gets interesting — and where the AI engineering comes in.
>
> I'm starting the engine failure simulation. The truck goes into autonomous mode — notice the wheels are spinning, the ground is scrolling, it's driving.
>
> Watch the analytics panel at the top. There's a sparkline showing engine temperature over time. The backend is running a linear regression on the telemetry stream — it's fitting a trend line to the temperature readings every two seconds.
>
> See the dotted projection line extending beyond the data? That's the anomaly detector predicting where the temperature is heading. And now — there's the warning: 'Engine critical in X minutes.' And listen — the system is speaking the warning out loud. The operator doesn't even need to be looking at this screen to know something's wrong.
>
> The engine area is starting to glow yellow... now orange... now red. The sparkline shows exactly WHY the alert fired — the operator can see the trend, the threshold, and the projection.
>
> And there — 107 degrees. The system automatically shuts the truck down. Speed drops to zero, critical alert fires. The operator didn't have to react — the system caught it proactively."

**[Click SIM ENGINE FAIL again to reset]**

> "One click resets everything — temp back to baseline, sparkline clears, truck returns to normal."

---

## DEMO — TIRE FAILURE SCENARIO (9:00 - 11:00)
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

## ARCHITECTURE (11:00 - 14:00)
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

## TRADEOFFS & DECISIONS (14:00 - 17:00)
**[Screen: can show CLAUDE.md or just talk over the app]**

> "A few key tradeoffs I want to call out:
>
> Procedural truck model instead of a GLTF import — I evaluated several Sketchfab Cat 797F models, but ran into two blockers. First, licensing: most detailed mining truck models are under restrictive licenses that prohibit modification and redistribution in derivative works. Second, and more importantly, the GLTF meshes aren't segmented by physical component — a single mesh might span the entire truck from bumper to bed. That makes it impossible to independently animate the dump bed, rotate individual wheels, or target specific components for alert overlays. So I built the truck procedurally with each part as a separate named object — cab, engine hood, bed group, individual wheels. Every component is independently animatable. In production, you'd work with the CAD team to get properly segmented models, but for this demo, procedural geometry gave me full control over the component hierarchy.
>
> The holographic aesthetic isn't just visual — it's functional. The see-through geometry means the operator can identify which specific component has a problem from any angle. An opaque model would hide the engine behind the cab, or the rear tires behind the bed. Translucent holographic lets you see everything at once.
>
> Full state broadcast, not deltas — clean for a few toggles. Production with hundreds of sensors streaming at high frequency would use delta updates with a message broker.
>
> Custom GLSL shader instead of a library — the threejs-vanilla-holographic-material library hasn't been updated for Three.js r152 which removed the outputEncoding API it depends on. 80 lines of GLSL was simpler to own than to patch a dead library.
>
> In-memory state — resets on restart. Production would use Redis. The tradeoff was made consciously for demo scope.
>
> One thing I want to highlight about process — I maintained a CLAUDE.md file throughout development. Every time I hit a bug or made a wrong decision, I documented the rule to prevent repeating it. Things like 'don't call renderer.render() when EffectComposer is active,' or 'bedGroup pivot must be at the rear edge, not the center.' It's a living document of mistakes and corrections — basically a self-improving instruction set for the AI tooling I used to build this."

---

## PROCESS, PLANNING & FRICTION (17:00 - 22:00)
**[Screen: show CLAUDE.md, git log, or the app while narrating]**

> "Let me talk about how I approached this from scratch — the planning, the AI tooling, and where I hit friction.

### Planning & Prioritization

> Before writing any code, I broke the problem into layers by what would be hardest to change later:
>
> Layer 1 — the data flow architecture. REST endpoints, WebSocket broadcast, Pydantic state model. If this is wrong, everything built on top breaks. So I started here. Got the backend running with five endpoints and a WebSocket broadcast loop before I touched any frontend code.
>
> Layer 2 — the 3D scene and shader pipeline. Three.js with EffectComposer, bloom, and a custom holographic ShaderMaterial. This was the visual foundation — camera, lighting, post-processing. I needed this working before I could build any features on top of it.
>
> Layer 3 — the interactive features. Bed animation, wheel rotation, LIDAR sweep, alert overlays. Each one follows the same pattern: button → REST POST → backend mutates state → WebSocket broadcast → frontend animates. I built them one at a time, each building on the same state flow.
>
> Layer 4 — the AI/ML layer. Anomaly detection with linear regression, predictive sparklines, spoken alerts. This was the capstone — it's what turns a visualization into a digital twin that actually helps an operator.
>
> I deliberately left voice control and visual polish for last. Those are high-impact demo features but low-risk — they don't affect the architecture."

### AI Tooling & Prompting

> "I used Claude Code throughout this project — not as a code generator, but as a pair programmer. Here's how I prompted:
>
> For architecture decisions, I'd describe the problem space and constraints, then ask for the tradeoff analysis. 'I need real-time state sync between a FastAPI backend and a Three.js frontend — WebSocket full-state broadcast vs. delta updates vs. SSE. What are the tradeoffs for a demo with 4-5 toggles?' The AI lays out the options, I pick the one that fits the scope.
>
> For implementation, I'd prompt with the specific behavior I wanted and the constraints. 'Build a dump bed animation where the hinge is at the rear-bottom edge of the chassis. The bed extends in +X from the pivot. rotation.z should lift the front up.' Being precise about the coordinate system and hinge placement saved iteration cycles.
>
> For debugging, I'd paste the symptom and let the AI diagnose. 'The bloom pass is rendering washed-out colors — everything looks white instead of cyan.' It identified the missing OutputPass immediately. That's the kind of thing that could take an hour of Stack Overflow diving."

### Friction & Course-Correction

> "A few places where things went sideways and how I recovered:
>
> **The bed hinge.** My first implementation pivoted at the center of the bed — which created a scissors-lift motion instead of a realistic dump truck tilt. I looked at reference photos of a Cat 797F mid-dump and realized the hinge needs to be at the rear-bottom edge, with the bed extending forward. The fix was repositioning the group origin. Took about five iterations to get the rotation direction and sign correct — I documented the rule in CLAUDE.md so I wouldn't repeat it.
>
> **The GLTF model.** I found a detailed Cat 797F model on Sketchfab — 413,000 triangles, 43 meshes. Loaded it up, looked great... until I tried to animate the bed. The meshes aren't segmented by physical component. A single mesh spans the entire truck from bumper to bed. I couldn't rotate the dump bed without rotating half the chassis with it. I couldn't spin individual wheels without chunks of the truck flying apart. I tried writing a feature-based segmentation pipeline using triangle centroid classification — splitting geometry by bounding-box-relative thresholds. It worked technically but the results were rough. That's when I pivoted to procedural geometry. Every part is its own mesh, its own material, independently animatable. The lesson: for a digital twin where components need to move independently, you need component-level geometry from the start.
>
> **The shader library.** I initially tried using threejs-vanilla-holographic-material. It crashed immediately — the library uses `renderer.outputEncoding` which was removed in Three.js r152. The library hasn't been updated. Rather than forking and patching a dead dependency, I wrote 80 lines of custom GLSL. Fresnel edge glow, world-space scanlines, an alert color blend uniform. Owning the shader meant I could add the alert tinting feature later without fighting someone else's API.
>
> **The double-render bug.** Early on, the scene was rendering twice per frame — once by EffectComposer and once by a stray `renderer.render()` call. The result was washed-out bloom and doubled GPU cost. The fix was one line: remove the `renderer.render()` call. But diagnosing it took a while because the visual artifact looked like a bloom intensity issue, not a double-render. Documented that in CLAUDE.md too."

---

## REFLECTION (22:00 - 24:00)
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