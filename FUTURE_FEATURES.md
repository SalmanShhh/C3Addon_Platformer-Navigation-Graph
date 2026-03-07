# Future Feature Considerations

Features and enhancements to consider for future versions of the Platformer Navigation Graph addon.

---

## Moving Platform Support

Moving platforms change position at runtime, making static graph nodes invalid.

### Approach Options

**Option A: Platform-Attached Nodes (Recommended)**
- Tag certain nodes as belonging to a moving platform instance
- Each tick, update those nodes' world positions based on the platform's current position
- Connections to/from moving platform nodes are recalculated when the platform moves significantly (> 1 tile)
- A* uses current positions, so paths adapt to where platforms ARE
- Cost: periodic partial graph updates, not full regeneration

**Option B: Temporal Graph**
- Pre-calculate platform positions over time
- A* considers when the character will reach a node, checking if the platform is there at that time
- Much more complex but handles timed jumps (wait for platform to arrive)

**Option C: Portal-Based**
- Treat moving platform stop positions as portal entry/exit points
- Portal is "enabled" only when the platform is at that stop
- Simpler but only works for platforms with discrete stops (not continuous movement)

### What Would Need to Change
1. Node structure: Add `attachedPlatformUID` field
2. `_tick()`: Update attached node positions each tick
3. Connection invalidation: Check connections when platform moves
4. ACEs: `AttachTilesToPlatform(platformUID, gx, gy, width, height)`
5. Shared graph mode: Moving platform node updates must propagate to all subscribers

### C3 Scripting APIs
- `runtime.getInstanceByUid(uid)` — retrieve the platform instance each tick by its stored UID to read current position
- `inst.x` / `inst.y` — read platform world position each frame; compare against stored last position to detect movement > 1 tile
- `inst.getBoundingBox()` — get current platform bounds as a `DOMRect` for the node attachment region
- `runtime.collisions.getCollisionCandidates([platformClass], domRect)` — find which agents are currently standing on the platform to flag them as "riding" for path updates
- `_tick()` in the behavior — update attached node positions each frame; only invalidate connections when displacement exceeds `cellSize`

---

## Dynamic Obstacle Avoidance

Real-time avoidance of moving objects (enemies, projectiles) during path execution.

### Considerations
- **Detection layer**: Object tagging system (tag C3 object types as "dynamic obstacles" or making use of C3's Instance Tags feature) + configurable detection radius around the AI character
- **Reaction approach**: Local steering (temporary path deviation without recalculating) vs full re-path with temporary cost inflation vs hybrid (local for small deviations, re-path if blocked too long)
- **Performance**: SpatialHash class is already implemented for multi-agent avoidance — could be reused for dynamic obstacle lookups instead of brute-force O(n*m) distance checks
- **Interaction with re-path system**: Dynamic avoidance could trigger re-paths, needs cooldown coordination
- **Multi-agent avoidance overlap**: Multi-agent avoidance already handles static agent positions via spatial hash; dynamic obstacles move continuously and need per-tick updates
- **Shared graph compatibility**: Per-instance temporary costs need a separate layer from the shared graph since dynamic obstacles are different per-instance
- **Prediction vs reactive**: Predicting where obstacles will BE is harder but avoids walking into enemy paths
- **Movement state machine complexity**: The physics-aware controller needs to know about avoidance (stop? reverse? jump over?)

### C3 Scripting APIs
- `inst.hasTag(tag)` / `inst.getAllTags()` — query C3 instance tags to identify dynamic obstacles without object type checks; users tag enemies/hazards in the editor (e.g., tag `"nav-obstacle"`)
- `runtime.collisions.getCollisionCandidates([obstacleClasses], domRect)` — efficient spatial query for obstacles near the agent using a `DOMRect` built from `(agentX - radius, agentY - radius, radius*2, radius*2)`; avoids O(n) `getAllInstances()` scan
- `inst.getBoundingBox()` — get exact obstacle bounds for fine-grained avoidance (not just center point)
- Results may include duplicates per the C3 docs — deduplicate with a `Set` before processing (same pattern as `ScanObjectsIntoObstacleMap`)

---

## Moving Hazard Avoidance

Extending the static hazard system (circles, rects, tile severities) to track objects whose positions change at runtime — bouncing fireballs, patrol-zone enemies, projectiles, moving spike traps.

### The Problem

The current hazard system bakes cost inflation into the graph at build time: `AddRectHazard`/`AddCircleHazard` store fixed positions and inflate edge costs during `GenerateGraph`. Moving hazards make those baked costs invalid the moment the object moves, so re-generating the graph every tick is not viable.

### Approach Options

**Option A: Object-Linked Hazards (Recommended)**
- New ACE: `AddTrackedHazard(object, radius, severity)` — registers a C3 instance (by UID) as a dynamic hazard
- Each tick, read current position from `runtime.getInstanceByUid(uid).x/.y`
- Cost inflation applied **per A* query** (not at graph build): `tentativeG += _getDynamicHazardCost(node)` during neighbor expansion
- Shared graph is untouched — each instance evaluates dynamic costs independently

**Option B: Manual Update ACE**
- User calls `UpdateHazardPosition(id, x, y)` each tick in their event sheet
- Simpler to implement; puts the update burden on the user
- Works for any hazard source, not limited to C3 objects

**Option C: Tag-Based Auto-Scan**
- Each tick, query all instances tagged `"nav-hazard"` and treat them as dynamic hazards
- Zero per-hazard ACE setup — users just tag objects in the editor
- More expensive per tick (full tag scan vs direct UID lookup)

### What Would Need to Change

1. **New data structure**: `dynamicHazards` Map: `uid → { radius, severity, lastX, lastY }` — separate from the static `hazards` array
2. **`_tick()`**: Update cached positions each tick via `runtime.getInstanceByUid(uid)`; auto-remove entries where the object has been destroyed (returns `null`)
3. **A* cost function**: Add `_getDynamicHazardCost(node)` checked during neighbor expansion — **not** during graph build; feeds into the existing `hazardMultiplier` term alongside static costs
4. **Re-path triggering**: When a dynamic hazard moves into or out of the current path corridor by more than one tile, optionally trigger a re-path (gated by the existing `rePathCooldown` to prevent thrashing)
5. **ACEs**: `AddTrackedHazard(object, radius, severity)`, `RemoveTrackedHazard(id)`, `ClearAllTrackedHazards()`

### Key Design Decision

Dynamic hazard costs must be evaluated **at pathfinding time** (inside the A* loop), not baked into the shared graph. The shared graph stores static edge costs only; dynamic inflation is applied per-instance inline during each A* traversal.

### C3 Scripting APIs

- `runtime.getInstanceByUid(uid)` — retrieve hazard object each tick by stored UID; returns `null` if destroyed — auto-remove from the `dynamicHazards` map on null
- `inst.x` / `inst.y` — read current world position each tick for cost evaluation and movement-delta detection
- `inst.getBoundingBox()` — use actual bounds (not just center) for rect-shaped moving hazards to match their visual footprint
- `inst.hasTag(tag)` — for Option C: query `"nav-hazard"` tagged instances without hardcoding object types
- `runtime.collisions.getCollisionCandidates([hazardClasses], pathRect)` — spatial pre-filter: only evaluate dynamic hazards whose cell overlaps the agent's path bounding box, avoiding O(d×n) full pairwise checks

### Considerations

- **Shared graph mode**: Dynamic costs are per-instance (each agent occupies a different position and sees hazards differently). The shared graph stores static costs only; dynamic inflation is per-query and never written back to the shared structure.
- **Re-path thrashing**: A hazard oscillating across a path corridor can trigger rapid re-paths. Gate with the existing `rePathCooldown`; alternatively, only re-path when the hazard enters the *next* 2–3 waypoints rather than anywhere on the full path.
- **Destroyed objects**: `runtime.getInstanceByUid(uid)` returns `null` when the hazard object is destroyed — prune these entries from `dynamicHazards` during the next tick update.
- **Interaction with static hazards**: Static (baked) and dynamic (per-query) costs are additive — both feed into the same `hazardMultiplier` expression used in `tentativeG`.
- **Performance**: Per-node dynamic hazard checks during A* add O(d) overhead per expanded node (d = tracked hazard count). Reusing the existing `SpatialHash` (already in place for multi-agent avoidance) reduces this to O(1) average-case lookups.
- **Prediction**: Purely reactive — costs reflect where hazards ARE this tick, not where they will be. A prediction layer (extrapolating velocity) is possible but significantly more complex.

---

## Water/Swimming Zones

Tile regions with modified gravity/speed and a separate movement controller.

### Considerations
- New tile state for water zones
- Modified physics parameters inside water (slower speed, reduced gravity, different jump behavior)
- Transition connections between water and land
- Swimming movement controller (separate from Platform behavior)
- Cost adjustments for underwater paths

### C3 Scripting APIs
- `tilemapInst.getTileAt(gx, gy)` — scan water tile IDs during obstacle map build to mark water cells (new obstacle map value, e.g., `4 = water`)
- `platformBehavior.gravity` — read/write gravity; set lower value when agent enters a water zone (e.g., `gravity *= 0.3`)
- `platformBehavior.maxSpeed` / `platformBehavior.acceleration` / `platformBehavior.deceleration` — reduce movement speed and responsiveness inside water
- `platformBehavior.maxFallSpeed` — cap terminal velocity for water
- `platformBehavior.vectorX` / `platformBehavior.vectorY` / `platformBehavior.setVector(x, y)` — apply water drag each tick by multiplying the current vector by a drag coefficient
- `platformBehavior.isEnabled = false` — disable Platform behavior entirely for full swimming zones, replacing with custom vector-based movement via `inst.setPosition()`
- `runtime.collisions.getCollisionCandidates([waterTilemapClass], agentRect)` — detect when agent enters/exits a water region at runtime each tick

---

## AI Behavior Trees Integration

Exposing graph data to behavior tree plugins for complex AI decision-making.

### Considerations
- Expressions already expose most graph data, making integration possible via event sheets
- Could add a scripting API for direct behavior tree plugin access
- Node queries (nearest node, connection data) already available
- Path results already accessible for custom decision logic

### C3 Scripting APIs
- All existing ACE expressions (`NodeCount`, `WaypointX(i)`, `WaypointY(i)`, `PathLength`, `CurrentAction`, etc.) are accessible from behavior tree plugins via the standard C3 expression system — no additional scripting layer needed for basic integration
- `runtime.objects.MyAgent.getAllInstances()` — behavior tree plugins can iterate agents and read navigation state via expressions or direct instance property access
- `IBehaviorInstance.instance` — behavior trees accessing the addon behavior instance can read `instance.x` / `instance.y` and cross-reference with navigation expressions

---

## Weighted Node Preferences

Per-node cost overrides for terrain preferences (e.g., prefer high ground, avoid narrow platforms).

### Considerations
- Add a `costOverride` field to nodes
- ACEs to set per-tile cost multipliers
- A* uses the override during neighbor expansion
- Useful for AI personality (aggressive AI prefers high ground, cautious AI avoids narrow platforms)

### C3 Scripting APIs
- No special C3 runtime API required — cost overrides live entirely in the addon's own node data structures
- `runtime.collisions.getCollisionCandidates([preferenceZoneClass], fullRect)` — existing hazard cost system already demonstrates per-tile cost inflation via spatial query; same approach extended to user-defined cost zones
- `inst.getBoundingBox()` — define preference zone boundaries from sprite bounding boxes (same as hazard radius scanning)

---

## Path Prediction/Preview

Expression to get estimated travel time, preview path without executing.

### Considerations
- Calculate estimated time from path cost and movement speed
- "Dry run" pathfinding that returns data without setting the active path
- Useful for AI decision-making (compare multiple targets before committing)
- Could visualize predicted path for debug purposes

### C3 Scripting APIs
- No special C3 API needed — dry-run A* runs entirely within the addon using the existing graph; returns a temporary path object without assigning `this.waypoints`
- `platformBehavior.maxSpeed` — read actual movement speed for travel time estimation (`estimatedTime = pathCost / maxSpeed`)
- For debug visualization: users can read `WaypointCount` + `WaypointX(i)` / `WaypointY(i)` expressions from the event sheet to place debug marker sprites at each waypoint position

---

## Graph Regions/Zones

Tag groups of nodes as zones for area-based AI logic (patrol zones, safe zones).

### Considerations
- Zone IDs assigned to nodes via ACEs (e.g., `SetNodeZone(gx, gy, zoneId)`)
- Conditions like "Is character in zone X"
- Path queries constrained to zones ("find path within zone")
- Useful for patrol behavior, territorial AI, zone-based objectives

### C3 Scripting APIs
- `inst.hasTag(tag)` / `inst.getAllTags()` — C3 instance tags could define zone membership for region objects; the addon scans tagged instances at setup time to assign zone IDs to overlapping nodes
- `runtime.collisions.getCollisionCandidates([zoneClass], fullRect)` — find all zone-defining objects at graph build time; for each node, check which zone object's bounding box it falls inside
- `inst.getBoundingBox()` — zone objects use their bounding box as the zone boundary rectangle; `DOMRect` contains-point check assigns each node to a zone

---

## Auto Slope Detection

Auto-classify slope tiles from their collision polygon shape, eliminating the need for `MapSlopeTilesFromTilemap` tile-ID lists.

### How It Would Work
- `IAnimationFrame.getPolyPoint(index)` exposes per-tile collision polygon vertices (normalized 0–1 within the tile)
- Triangle with vertices at (0,1)→(1,0)→(1,1) → `slope_right` (\)
- Triangle with vertices at (0,0)→(1,1)→(0,1) → `slope_left` (/)
- Similar classification for 4-point gentle 22.5° slope polygons
- Iterate all tile IDs in the tilemap, read their collision polygons, and auto-populate `slopeMap`

### Implementation Approach
- New ACE: `AutoDetectSlopeTiles(tilemap)` — scans collision polygons and calls the internal slope mapping logic for each matched tile ID
- Or: optional flag on `ScanSolidObjectsIntoObstacleMap` to also auto-detect slopes during the scan pass

### C3 Scripting APIs
- `tilemapInst.getTileSize()` — returns `[tileWidth, tileHeight]`; confirm tile size matches `cellSize` before scanning
- `tilemapInst.getMapSize()` — returns `[width, height]` in tiles for full-map iteration
- `tilemapInst.getTileAt(gx, gy)` — get tile ID at each cell; mask with `TILE_ID_MASK` to strip flip flags before polygon lookup
- `IAnimationFrame.getPolyPointCount()` — number of polygon points for this tile; 3 = 45° slope candidate, 4 = gentle slope candidate, 0 or 4-rect default = flat/solid
- `IAnimationFrame.getPolyPointX(i)` / `getPolyPointY(i)` — normalized (0–1) polygon vertex coordinates for shape classification (exact tilemap frame access path needs verification against C3 SDK)

### Considerations
- Only works if tilemap tiles have per-tile collision polygons set up in the C3 editor (not just bounding boxes)
- Polygons with more than 4 points or non-standard shapes would need fallback (treat as solid) or be skipped
- Eliminates the most common setup mistake: unregistered slope tiles are invisible to arc checks and create invalid jump connections
- Would not handle slope tiles registered as jump-thru (those still need explicit type mapping)

---

## Savegame Backwards Compatibility (Save/Load Versioning)

When future versions add new save data fields, `_loadFromJson` will need version checking to handle saves from older addon versions gracefully.

### Implementation
- Current version uses `version: 1` in save data
- Future versions increment to `version: 2`, `3`, etc.
- `_loadFromJson` checks version and applies defaults for missing fields:
  ```javascript
  if (o.version >= 2) {
    this.newFeature = o.newFeature || defaultValue;
  }
  ```
- For now (v1), no backwards compatibility is needed since this is the first release

---

## NavMesh Alternative

Replace or supplement the tile grid with a navigation mesh (polygonal regions).

### Pros
- Smoother paths (no grid snapping)
- Works naturally with slopes and irregular terrain
- Smaller data footprint for large open areas
- More natural diagonal movement without zigzagging

### Cons
- Much more complex to generate (requires polygon decomposition of walkable space)
- Harder to integrate with C3's tile-based Tilemap/Pathfinding behaviors
- Jump arc collision checking becomes ray-vs-polygon instead of simple grid lookups
- Harder for users to understand and debug
- Dynamic updates (adding/removing obstacles) require expensive re-triangulation

### Implications
- Would need a separate graph representation alongside or replacing the current grid
- A* algorithm works on any graph so pathfinding core stays similar
- All connection generation (walk, jump, fall) and collision checking need complete rewrites
- ACE interface changes significantly (no grid coordinates, replaced with polygon IDs or world-position queries)
- Shared graph mode would need to share mesh data instead of grid arrays
- Users lose the intuitive "set tile solid/clear" workflow

---

### How It Would Actually Work

A full navmesh pipeline has six phases. For a platformer, several phases are much simpler than the general 3D case because all walkable surfaces are (nearly) horizontal.

**Phase 1 — Identify walkable cells**

Same scan as `_scanObstacles` already performs: a cell is walkable if it is `clear` and the cell directly below is `solid`, `jump_thru`, or a slope. The existing `Uint8Array` obstacle map is the correct data source — no new C3 API needed here.

**Phase 2 — Flood-fill into contiguous regions**

4-connected flood fill across walkable cells groups them into labelled regions (each cell gets a `regionId`). Each connected platform surface becomes one region. This is pure JS on the obstacle map array — O(W×H), same cost as the current node-scan pass.

**Phase 3 — Boundary tracing / polygon extraction**

Walk the boundary of each region using a marching-squares–style border trace to produce a closed polygon of world-space vertices. For typical platformer layouts (axis-aligned rectangular platforms) this produces very clean rectangles with 4–8 vertices before simplification.

**Phase 4 — Polygon simplification**

Ramer–Douglas–Peucker on each boundary polygon. Collinear points on horizontal/vertical edges collapse to nothing. A platform that spans 20 tiles reduces to 4 corner vertices. Pure JS — no C3 API.

**Phase 5 — Convex decomposition**

Most platformer regions are already convex (horizontal floor, two vertical side edges). Non-convex cases (L-shaped or U-shaped platforms) can be decomposed by splitting on reflex vertices. Ear-clipping triangulation then greedy triangle merging produces convex sub-polygons. For the platformer case this is rarely needed — most splits happen at natural ledge boundaries that the flood-fill already separates.

**Phase 6 — Portal edges and jump/fall connections**

- **Walk portals**: Shared vertical edges between adjacent regions — a character can walk from one region to another where they touch. Found by checking which regions share a border cell.
- **Jump/fall arcs**: Same arc validation as the current `_canJump` / `_canDiagonalFall` system, but checking against the obstacle map `Uint8Array` rather than individual grid cells. The arc math is identical — the data source does not change.

**Phase 7 — A\* on region graph**

Nodes are region centroids or portal edge midpoints. Edges are walk portals and jump/fall arcs. The existing `BinaryHeap` A* implementation works unchanged — it operates on any node/edge graph. Path result is a sequence of regions + portal crossing points.

**Phase 8 — String-pulling / waypoint generation**

Within a region, movement is a straight line to the next portal crossing point (no grid snapping). The funnel algorithm (Simple Stupid Funnel Algorithm) on the portal sequence generates minimal-turn waypoints. Movement code executes waypoints identically to the current system.

---

### Platformer-Specific Simplifications

Most general navmesh literature targets 3D worlds with arbitrary polygon terrain. A 2D platformer has strong constraints that make several phases trivial:

- **Walkable surfaces are horizontal** → flood-fill regions are naturally wide, short rectangles. Polygon extraction produces near-rectangles with ≤8 vertices.
- **Gravity is fixed downward** → no need for surface normals or slope-aware traversal in the mesh itself. Jump/fall arc validation handles gravity implicitly.
- **Tile grid is the source of truth** → no polygon soup input. The obstacle map `Uint8Array` already encodes all geometry. Phases 1–4 are deterministic and fast.
- **`requiresDoubleJump` per-connection** → already implemented. Works identically on navmesh connections.

---

### Recommended Implementation: Hybrid Grid + NavMesh

Rather than replacing the grid, build the navmesh as a post-processing layer on top of it:

1. Keep the obstacle map `Uint8Array` — it remains the geometry source for arc validation, slope detection, and user configuration.
2. Run phases 1–6 after `_generateGraph` to produce a region graph alongside the existing node graph.
3. Use the **region graph for A\*** (fewer nodes → faster search on large open levels).
4. Use the **existing grid arc checks for connection validation** (no ray-vs-polygon rewrite needed).
5. Use **string-pulling within regions** for smooth movement (replaces current grid-snapped walk waypoints).

This gives most of the navmesh benefits (smooth paths, smaller graph) without replacing the existing geometry pipeline. The grid stays as the backing store; the navmesh is a derived acceleration structure.

---

### What Would Need to Change

1. **New data structures**: `regions[]` (polygon vertices, centroid, portal list) + `portals[]` (shared edge, two region IDs, crossing point)
2. **New generation pass**: `_buildNavMesh()` — phases 1–6 above, called at the end of `_generateGraph`
3. **A\* variant**: `_findPathNavMesh()` — searches region graph; falls back to node graph if region graph not built
4. **String-pulling**: `_stringPullPath(regionSequence)` — funnel algorithm producing world-space waypoints
5. **Movement code**: Walk actions within a region use direct X movement to the portal crossing point — no per-tile arrival checks needed
6. **ACEs**: `IsNavMeshEnabled` condition, `NavMeshRegionCount` / `NavMeshRegionAt(index)` expressions for debug visualization
7. **Shared graph**: `NavigationManager` stores the region graph alongside the node graph; same sharing semantics

### C3 Scripting APIs

- **Phases 1–5** (scan, flood fill, polygon extraction, simplification): Operate entirely on `this.obstacleMap` (`Uint8Array`) — no C3 runtime API calls needed beyond what `_scanObstacles` already uses
- **Phase 6 arc validation**: `this.obstacleMap` + existing `_canJump` / `_canDiagonalFall` math — no change to validation code
- `tilemapInst.getTileAt(gx, gy)` — if slope auto-detection (see Auto Slope Detection) is implemented, the navmesh builder can use slope polygon data to align region boundaries to slope surfaces rather than cell edges
- `runtime.collisions.getCollisionCandidates([tilemapClass], regionRect)` — for dynamic obstacle integration: re-scan a region's bounding rect to detect mid-game tile changes that invalidate that region's polygon
- `inst.getBoundingBox()` — for non-tilemap level geometry (sprite-based platforms): rasterize sprite bounds into the obstacle map before navmesh build, same as `ScanSolidObjectsIntoObstacleMap`
- `Uint8Array.buffer` as a `Transferable` — if navmesh generation is offloaded to a Web Worker (see DOM-Side Web Worker Offloading), the obstacle map transfers zero-copy; phases 1–5 run entirely in the worker since they only read the array

### Sprite-Based Level Considerations

The grid mismatch problem is the primary reason to pursue navmesh for sprite-based levels. Physics and planning are handled separately — the Platform behavior moves the character against actual C3 solid collisions, so the character always stands at the correct surface height. But path planning uses the obstacle map, and the mismatch creates specific failure modes:

- **Node Y positions are wrong.** Nodes are placed at the top of solid grid cells. A 48px sprite platform at y=100 occupies cells y=96–128 and y=128–160 (32px cells). The node ends up at y=96 — 4px above the actual surface. If this offset exceeds the waypoint arrival tolerance, the agent never "arrives" and the path stalls.
- **Arc validation over- or under-blocks.** A 20px gap between two sprites rounds to 0 cells (blocked) or 1 cell (clear) depending on alignment. Either creates wrong jump or fall connections.
- **Bounding box rasterization ignores shape.** `ScanSolidObjectsIntoObstacleMap` fills the bounding rectangle of each sprite. A round boulder rasterizes as a square — cells are marked solid where the character could actually walk (the corners above and beside the sphere).

| Level type | Grid works well? | Navmesh advantage |
|---|---|---|
| Tilemap-based, cell size matches tilemap | Yes — perfect alignment | Minimal |
| Sprite-based, sprites are tile-sized rectangles | Yes — bounding box ≈ actual shape | Minor |
| Sprite-based, varying sizes and heights | Workable with small cell size | Significant — exact surfaces |
| Sprite-based, irregular collision polygons | Breaks down | Large — traces actual poly outline |

**Cell size guidance for sprite-based levels:** cell size should be ≤ the smallest meaningful platform height ÷ 2. If platforms vary from 20px to 200px, 16px cells work better than 32px — at the cost of a larger graph.

**Middle-ground option (no full navmesh required):** Replace bounding-box rasterization with collision-polygon rasterization in `ScanSolidObjectsIntoObstacleMap`. Use `inst.getPolyPointX(i)` / `inst.getPolyPointY(i)` (world-space collision polygon vertices on `IWorldInstance`) to get the actual outline of each sprite, then fill that polygon using a scanline rasterizer. The surface cell would then match the actual top edge of the collision polygon rather than the bounding rectangle. This is a moderate-effort accuracy improvement that works entirely within the current grid architecture and eliminates most of the shape-mismatch problem without a full navmesh build.

### Recommendation

Keep grid-based as primary. The hybrid approach above is the lowest-risk path: navmesh regions are built on top of the existing grid rather than replacing it, the arc validation code is untouched, and the grid remains the user-facing configuration API. The main payoff is smoother within-region movement and faster A* on large open levels with many walkable tiles but few natural ledge nodes.

For sprite-based levels with varied sizes or irregular shapes, the collision-polygon rasterization improvement to `ScanSolidObjectsIntoObstacleMap` is worth doing regardless of whether navmesh is pursued — it directly fixes the surface position accuracy problem with moderate effort.

---

## Multiple Graph Layers

Separate navigation graphs for different character types or movement capabilities.

### Pros
- Different-sized characters navigate correctly (tall characters can't fit through 1-tile gaps)
- Flying characters use a different graph than walkers
- Characters with different jump heights see different connections
- Clean separation of movement capabilities

### Cons
- Memory multiplied by number of layers
- Graph generation time multiplied
- Complexity in managing which instance uses which layer
- Shared graph mode becomes "shared per layer" instead of "shared per type"
- Users need to understand which layer to assign

### Implications
- NavigationManager would need to key graphs by `(layoutUID, layerID)` instead of just `layoutUID`
- Each layer has its own obstacle map, node set, and connections
- Instances subscribe to a specific layer
- ACE interface needs a "graph layer" parameter or per-instance "active layer" property
- Save/load must serialize which layer each instance belongs to

### Simpler Alternative (Recommended)
Per-instance connection filtering during A*:
- Store one shared graph with ALL nodes generated using the most permissive parameters
- Each connection stores requirement metadata (`requiredClearance`, `requiredJumpHeight`, `requiredJumpDistance`)
- During A*, each instance skips connections exceeding its capabilities
- **Handles**: Different character heights, different jump strengths, different fall tolerances
- **Does NOT handle**: Character width differences (no horizontal clearance tracking), node-level exclusion
- **Shared graph compatible**: Filtering is per-instance at query time
- **Implementation effort**: Low — jump/fall connections already compute needed heights during generation; main work is adding ceiling clearance scanning to walk connections
- **Partially implemented**: `requiresDoubleJump` flag on connections is already filtered per-instance in A* (instances without double jump skip those connections). Graph capability tracking triggers rebuild when a double-jump instance joins a shared graph built without it.

### C3 Scripting APIs
- `inst.getBoundingBox()` — read character `height` / `width` at runtime for per-instance capability detection (already used for `characterHeight` / `characterWidth`)
- `platformBehavior.jumpStrength` / `platformBehavior.jumpSustain` / `platformBehavior.gravity` — compute `maxJumpHeight` / `maxJumpDistance` per-instance for capability-based connection filtering (already used on first tick)

---

## Time-Sliced Graph Generation

Spread graph generation across multiple frames to avoid frame drops on very large levels.

### Status
**Pathfinding time-slicing is implemented** — `SetMaxPathsPerTick` limits path calculations per tick, with queuing, sync-first approach, and 10 edge cases handled. Graph generation itself is still synchronous.

### Remaining Candidates
- Graph generation (`_generateGraph` — node creation + all connection passes)
- Obstacle map scanning
- Hazard cost recalculation

### Approach
Use `_tick()` as the scheduling mechanism. Each tick, process N nodes/connections, save progress in instance state, resume next tick. Track progress with a generation state machine (phase + index).

### C3 Scripting APIs
- `_tick()` — existing per-frame callback in the behavior; graph generation state machine advances N steps per tick, resuming where it left off via saved `_genPhase` / `_genIndex` fields
- `"pretick"` runtime event — graph work could run before the main tick to ensure the graph is maximally up-to-date before movement decisions are made that same frame
- `this._trigger("OnGraphGenerated")` — existing trigger deferred until generation completes across multiple ticks

### Implications
- Graph generation becomes async — `OnGraphGenerated` trigger fires when complete, not immediately after the action
- All code that assumes the graph exists after calling generate must handle the async gap
- Users would need a "generating graph" state condition

### Pros
- Eliminates frame drops on large levels
- Allows bigger graphs without performance concerns
- Smoother gameplay during graph updates

### Cons
- Adds complexity to the state machine
- Introduces latency for graph availability
- Harder to debug (results span multiple frames)
- Shared graph mode must handle partial graph updates

### Priority
Low — BinaryHeap, Uint8Array obstacle maps, and numeric grid keys already cut graph build time roughly in half. Combined with pathfinding time-slicing, this is only needed for extremely large levels (2000+ nodes).

---

## Performance Optimizations

Targeted improvements using C3 scripting interfaces to reduce CPU time, memory pressure, and GC pauses.

---

### Collision Cell Size Tuning

The C3 collision engine partitions the layout into a spatial grid for candidate queries. By default this grid may not match the navigation cell size, causing `getCollisionCandidates()` to return more candidates than necessary.

**C3 Scripting APIs**
- `runtime.collisions.setCollisionCellSize(width, height)` — set the collision grid cell size to match `cellSize` (e.g., 32×32 px); candidates returned by `getCollisionCandidates()` are those whose cells overlap the query `DOMRect`, so a matching cell size minimises over-fetching
- `runtime.collisions.getCollisionCellSize()` — read current cell size to determine if tuning is needed
- **When to apply**: Call once after `BuildObstacleMapFromLayout`, before any scan ACEs

---

### TypedArray Graph Storage

Node positions and connection data are currently stored as plain JS objects. Replacing hot fields with TypedArrays removes pointer-chasing and improves cache locality during A* traversal.

**Candidates**
- Node `x`, `y` (world positions) → `Float32Array` of length `nodeCount * 2`
- Connection `cost` → `Float32Array`
- Connection flags (`requiresDoubleJump`, `isSlope`, etc.) → packed `Uint8Array` bitfield
- A* `gScore` / `fScore` → `Float64Array` indexed by node ID (already partially done for open-set)

**C3 Scripting APIs**
- No C3-specific API — TypedArrays are standard JS; the benefit is lower GC pressure since the runtime doesn't need to trace typed array internals
- `Uint8Array` for `obstacleMap` and `slopeMap` is already implemented; connection arrays are the next candidate

---

### DOM-Side Web Worker Offloading

C3's DOM-side script (`domside/index.js`) runs in the same thread as the browser's DOM but can spawn `Worker` threads for CPU-heavy tasks. Graph generation (node creation + connection passes) is a strong candidate.

**Approach**
- Serialize the obstacle map (`Uint8Array`) and config params to a `Worker` via `postMessage` with `Transferable` (zero-copy transfer)
- Worker runs `_generateGraph` logic in pure JS (no C3 API calls needed — graph generation only reads the obstacle map)
- Worker posts back a serialized node/connection list; main thread deserializes into the shared graph

**C3 Scripting APIs**
- `hasDomside: true` in addon config — enables the domside script environment
- C3's domside messaging (`this._sendWrapper` / `this._receiveFromDOMSide`) for round-trip communication between behavior instance and domside
- `Uint8Array.buffer` as a `Transferable` — zero-copy transfer of the obstacle map to the worker
- **Limitation**: The Worker cannot call any C3 scripting APIs (`runtime.*`, `inst.*`) — it only receives plain data and returns plain data; all C3 interaction stays on the main thread

**Priority**: Medium — most impactful for large levels (1000+ nodes) where graph generation causes a visible frame spike at startup.

---

### Object Pooling for Path Nodes

Every `FindPath` call allocates a new array of waypoint objects. On 100+ agent scenes with frequent repathing, GC pressure from short-lived waypoint arrays is measurable.

**Approach**
- Pre-allocate a pool of waypoint objects (`{ x, y, action, node, peakHeight }`) at initialization
- `FindPath` reuses pooled objects; old path waypoints are returned to the pool when a new path is set or the agent stops
- Pool size = `maxPathLength * maxAgentCount` (configurable)

**C3 Scripting APIs**
- No C3-specific API — pure JS object pooling
- `runtime.objects.MyAgent.getAllInstances().length` — read agent count at startup to size the pool appropriately

---

### Incremental Obstacle Map Updates

Currently any change to the obstacle map (e.g., a destructible tile breaking) requires a full `GenerateGraph` call. Partial updates would rebuild only the nodes and connections touching the changed cells.

**Approach**
- New ACE: `SetObstacleCell(gx, gy, value)` — marks a single cell dirty and queues a local graph patch
- Patch process: remove all nodes whose `gx/gy` matches the changed cell; re-scan the cell's immediate neighbourhood (±`maxJumpDistance` radius) for new nodes/connections
- `_tick()` applies queued patches N cells per frame (same time-slicing pattern as graph generation)

**C3 Scripting APIs**
- `tilemapInst.setTileAt(gx, gy, tileId)` — C3 tilemap edit that the user calls to break a tile; the addon's `SetObstacleCell` should be called alongside it to keep the obstacle map in sync
- `runtime.collisions.getCollisionCandidates([tilemapClass], cellRect)` — re-scan a small `DOMRect` around the changed cell instead of scanning the full layout
- **Shared graph mode**: Patches must be applied to the shared `NavigationManager` graph and version-stamped so subscriber instances know to re-query their cached path

---

### `pretick` Scheduling for Graph Patches

Graph patch work (incremental updates, hazard cost recalculation) currently runs inside `_tick()`, which can delay movement decisions if the patch happens mid-frame.

**C3 Scripting APIs**
- `runtime.addEventListener("pretick", handler)` — run graph maintenance work before the main tick so all movement decisions that frame use an up-to-date graph
- `runtime.addEventListener("tick2", handler)` — alternatively, defer non-urgent bookkeeping (e.g., portal pause timer, repath cooldown decay) to `tick2` to spread work across sub-ticks
- `inst.dt` — delta-time remains accurate in both `pretick` and `tick2` handlers
