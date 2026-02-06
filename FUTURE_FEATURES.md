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
5. SPOT pattern: Moving platform node updates must propagate to all subscribers

---

## Dynamic Obstacle Avoidance

Real-time avoidance of moving objects (enemies, projectiles) during path execution.

### Considerations
- **Detection layer**: Object tagging system (tag C3 object types as "dynamic obstacles" or making use of C3's Instance Tags feature) + configurable detection radius around the AI character
- **Reaction approach**: Local steering (temporary path deviation without recalculating) vs full re-path with temporary cost inflation vs hybrid (local for small deviations, re-path if blocked too long)
- **Performance**: Checking distances to all dynamic obstacles every tick for every AI instance is O(n*m) — needs spatial partitioning (grid-based bucketing) for levels with many agents/obstacles
- **Interaction with re-path system**: Dynamic avoidance could trigger re-paths, needs cooldown coordination
- **Multi-agent avoidance overlap**: Similar concept but for static positions; dynamic obstacles move continuously
- **SPOT compatibility**: Per-instance temporary costs need a separate layer from the shared graph since dynamic obstacles are different per-instance
- **Prediction vs reactive**: Predicting where obstacles will BE is harder but avoids walking into enemy paths
- **Movement state machine complexity**: The physics-aware controller needs to know about avoidance (stop? reverse? jump over?)

---

## Water/Swimming Zones

Tile regions with modified gravity/speed and a separate movement controller.

### Considerations
- New tile state for water zones
- Modified physics parameters inside water (slower speed, reduced gravity, different jump behavior)
- Transition connections between water and land
- Swimming movement controller (separate from Platform behavior)
- Cost adjustments for underwater paths

---

## AI Behavior Trees Integration

Exposing graph data to behavior tree plugins for complex AI decision-making.

### Considerations
- Expressions already expose most graph data, making integration possible via event sheets
- Could add a scripting API for direct behavior tree plugin access
- Node queries (nearest node, connection data) already available
- Path results already accessible for custom decision logic

---

## Weighted Node Preferences

Per-node cost overrides for terrain preferences (e.g., prefer high ground, avoid narrow platforms).

### Considerations
- Add a `costOverride` field to nodes
- ACEs to set per-tile cost multipliers
- A* uses the override during neighbor expansion
- Useful for AI personality (aggressive AI prefers high ground, cautious AI avoids narrow platforms)

---

## Path Prediction/Preview

Expression to get estimated travel time, preview path without executing.

### Considerations
- Calculate estimated time from path cost and movement speed
- "Dry run" pathfinding that returns data without setting the active path
- Useful for AI decision-making (compare multiple targets before committing)
- Could visualize predicted path for debug purposes

---

## Graph Regions/Zones

Tag groups of nodes as zones for area-based AI logic (patrol zones, safe zones).

### Considerations
- Zone IDs assigned to nodes via ACEs
- Conditions like "Is character in zone X"
- Path queries constrained to zones ("find path within zone")
- Useful for patrol behavior, territorial AI, zone-based objectives

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
- SPOT mode would need to share mesh data instead of grid arrays
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
- SPOT mode becomes "shared per layer" instead of "shared per type"
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
- **SPOT compatible**: Filtering is per-instance at query time
- **Implementation effort**: Low — jump/fall connections already compute needed heights during generation; main work is adding ceiling clearance scanning to walk connections

---

## Time-Slicing for Expensive Operations

Spread heavy computations across multiple frames to avoid frame drops.

### Candidates
- Graph generation (`_generateGraph` — node creation + all connection passes)
- A* pathfinding (large graphs with many nodes)
- Obstacle map scanning
- Hazard cost recalculation

### Approach
Use `_tick()` as the scheduling mechanism. Each tick, process N nodes/connections, save progress in instance state, resume next tick. Track progress with a generation state machine (phase + index).

### Implications
- Graph generation becomes async — `OnGraphGenerated` trigger fires when complete, not immediately after the action
- All code that assumes the graph exists after calling generate must handle the async gap
- A* could be split across frames but introduces latency (path not available until future frame)
- Users would need a "generating graph" state condition

### Pros
- Eliminates frame drops on large levels
- Allows bigger graphs without performance concerns
- Smoother gameplay during graph updates

### Cons
- Adds complexity to the state machine
- Introduces latency for pathfinding results
- Harder to debug (results span multiple frames)
- SPOT mode must handle partial graph updates

### Priority
Medium — only needed for large levels (1000+ nodes). Current synchronous approach is fine for typical platformer level sizes.
