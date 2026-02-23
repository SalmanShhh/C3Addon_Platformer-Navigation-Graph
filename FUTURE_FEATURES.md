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

### Recommendation
Keep grid-based as primary. NavMesh could be an optional advanced mode for specific use cases (large open areas, non-tile-based levels), but the tile grid is a better fit for C3's ecosystem.

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
