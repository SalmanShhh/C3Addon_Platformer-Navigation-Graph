# Platformer Navigation Graph

Smart pathfinding for platformer games. Add this behavior to any character with the Platform behavior and it builds a navigation graph from your level geometry, calculates routes that involve jumping across gaps, falling between platforms, and walking up slopes, then drives the Platform behavior so the character actually follows the route. You get full platformer AI, including portals (doors, elevators, ziplines), hazard avoidance, multi-agent crowds, and selectable path strategies, without writing a single line of movement math. In the simplest setup you enable one property and add one event.

---

## Table of Contents

1. [Scenarios Where This Addon Excels](#1-scenarios-where-this-addon-excels)
2. [Core Concepts](#2-core-concepts)
3. [Project Setup](#3-project-setup)
4. [Behavior Properties](#4-behavior-properties)
5. [Obstacle Maps: Giving the Graph Level Data](#5-obstacle-maps-giving-the-graph-level-data)
6. [Finding Paths](#6-finding-paths)
7. [Movement Control](#7-movement-control)
8. [Slopes](#8-slopes)
9. [Portals: Doors, Elevators, and Ziplines](#9-portals-doors-elevators-and-ziplines)
10. [Hazards: Danger Zone Avoidance](#10-hazards-danger-zone-avoidance)
11. [Multi-Agent Support and Performance](#11-multi-agent-support-and-performance)
12. [Actions Reference](#12-actions-reference)
13. [Conditions Reference](#13-conditions-reference)
14. [Expressions Reference](#14-expressions-reference)
15. [Triggers Reference](#15-triggers-reference)
16. [System Use Cases](#16-system-use-cases)
17. [Game Use Cases](#17-game-use-cases)
18. [C3 Debugger](#18-c3-debugger)
19. [Scripting (C3 Script / JavaScript)](#19-scripting-c3-script--javascript)
20. [Tips and Common Mistakes](#20-tips-and-common-mistakes)

---

## 1. Scenarios Where This Addon Excels

- **Chase enemies.** A goblin that pursues the player up staircases, jumps across gaps, and drops through one-way platforms to cut them off. No manual movement code, no jump arc math.
- **Escort and companion NPCs.** A partner who follows the player through a multi-level dungeon, taking sensible routes without getting stuck on ledges or falling into pits.
- **Patrol guards.** Guards that walk a route between markers, with ledge restriction so they never wander off their rooftop, and coyote jumps disabled where precision matters.
- **Stealth AI.** Guards that avoid marked hazard zones (lit areas, laser tripwires) using the Safest Route strategy, then switch to Shortest Distance when the alarm sounds.
- **Tower defense and horde waves.** Fifty creeps sharing one navigation graph, with per-tick path budgeting so a full wave spawning at once does not drop frames.
- **Bosses with special moves.** A boss that navigates normally, then uses the standalone jump-toward action for lunge attacks, independent of pathfinding.
- **Elevators, doors, and ziplines.** Multi-floor levels where characters ride elevators, pass through doors with opening animations, and take ziplines as part of a normal calculated route.

---

## 2. Core Concepts

### The problem this addon solves

Making an AI character navigate a platformer level is genuinely hard. The character needs to know which tiles are solid, where platform edges are, which gaps are jumpable with the current jump strength, which drops are survivable, and how to chain those moves into a coherent route. Building that by hand means writing jump arc validation, ledge detection, path search, and re-pathing logic before you can even start on game content.

Platformer Navigation Graph automates all of it. It scans your level geometry into an **obstacle map**, builds a **navigation graph** of every walkable position and every physically possible move between them (walk, jump, fall, coyote jump, slope walk, portal), and runs A* over that graph to find routes. Every frame it reads the current waypoint and pushes the right inputs into the Platform behavior so the character actually moves.

### Key design decisions

**The behavior attaches to characters, not the level.** Add it to every sprite that needs AI movement. Each instance manages its own current path and movement state, while the expensive part (the graph) is shared across all instances on the layout.

**The graph is built once and reused.** Graph generation is not a per-frame scan. It happens at startup (automatically with Auto-Build Graph, or when you call a generate action) and again only when you request a rebuild after changing the level.

**Graph builds are time-sliced.** On large maps the build spreads across several ticks, a few milliseconds of work per tick, instead of stalling one frame. `On navigation graph generated` fires when it completes. Calling any Find path action while a build is still in progress finishes the build immediately first, so you never path against a half-built graph.

**Everything physical is auto-detected.** Jump height, jump distance, and fall distance are calculated from the attached Platform behavior's physics. Character size comes from the sprite. Tile Size can auto-detect from your Pathfinding behavior or solid tilemap. You can override any of these, but the defaults are computed, not guessed.

**Auto-control is optional.** By default the behavior drives the Platform behavior itself: call Find path and the character moves. Turn auto-control off and the behavior still calculates paths and exposes every waypoint through expressions, so you can drive movement from your own state machine.

### Key concepts at a glance

| Term | What it means |
|---|---|
| **Obstacle map** | A grid of tile states (solid, clear, jump-thru, avoid, slope) that the graph builder reads. Comes from the Pathfinding behavior, a Solid/Jump-thru object scan, or manual actions. |
| **Navigation graph** | Every walkable tile position (a **node**) plus every possible movement between nodes (a **connection**). Built from the obstacle map. |
| **Waypoint** | One step in a calculated path. Each waypoint has a world position and an action such as `walk_left`, `jump`, `fall_right`, or `portal_instant`. |
| **Portal** | A shortcut connection the graph cannot express with jump or fall arcs. Instant portals teleport; gradual portals move the character at a set speed (elevators, ziplines). |
| **Hazard** | A marked danger area (circle, rectangle, or tile) that raises pathfinding cost nearby, so the AI prefers safer routes without being hard-blocked. |
| **Shared map** | Instances with the same Map Tag on a layout read one obstacle map and graph, so building it once serves every agent. The empty default tag means everyone shares. |

---

## 3. Project Setup

### Quick start (zero setup events)

1. Select your character sprite. In the Properties panel, add both the built-in **Platform** behavior and **Platformer Navigation Graph**.
2. Add one event:

```
Event: Every 0.5 seconds
  Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y
```

That is the whole setup; the defaults do the rest. On startup, **Auto-Build Graph** (default Auto) builds the obstacle map automatically: from the Pathfinding behavior's map if one is attached to the character, otherwise by scanning every object that has an enabled **Solid** or **Jump-thru** behavior. **Detect Slopes** (default on) registers slope tiles automatically from their collision shapes. Jump physics are read from the Platform behavior, and the simple `Find path` action snaps start and target to walkable ground and paths as close as possible when the exact target is unreachable, so it never fails outright.

One property to check: **Tile Size** defaults to 32 px. If your level grid uses a different tile size, set it to match, or set it to 0 to auto-detect from the Pathfinding behavior or your solid tilemap.

If your slope tiles do not carry sloped collision polygons (so automatic detection cannot see them), register them manually once at startup instead (see [Slopes](#8-slopes)); the graph rebuilds itself when slopes are registered:

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> MapSlopeTilesFromTilemap  TilemapWalls, "3,4", "5,6", "", ""
```

### Manual setup (full control)

If you prefer explicit control, or you need a custom obstacle map, leave **Auto-Build Graph** on **Off** and set things up in events. Using the Pathfinding behavior as the source:

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> UsePathfindingObstacleMap  "Yes (auto-regenerate)"
  // Waits for Pathfinding to finish its async map build, then generates the graph

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Reach", "Default"
  // Graph is ready, start pathfinding
```

Or, without the Pathfinding behavior, build the map from your solid objects:

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> ScanJumpThruObjectsIntoObstacleMap  TilemapPlatforms
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Reach", "Default"
```

**A note on Tile Size.** Tile Size (default 32) MUST match the Cell Size of your Pathfinding behavior (or your tilemap's tile size). A mismatch misaligns the graph with your geometry, and characters will try to walk through walls. Setting Tile Size to 0 (auto-detect) avoids the problem entirely.

With **Auto-Control Movement** enabled (the default), the character starts moving the moment `On path found` fires.

### Large levels

Graph generation is time-sliced. On big maps the build spreads across several ticks instead of stalling a single frame, and `On navigation graph generated` fires when it completes. Any Find path call made while the build is in progress finishes the build synchronously first, so the same-tick patterns above always work.

---

## 4. Behavior Properties

| Property | Type | Default | Description |
|---|---|---|---|
| **Enable Debug Logging** | Boolean | On | Logs graph stats, path results, and movement decisions to the browser console (F12). Turn off in release builds for performance. |
| **Tile Size** | Integer (0 to 128) | 32 | Grid resolution in pixels. Must match your tilemap's tile size / Pathfinding Cell Size exactly. Set to 0 to auto-detect it from the Pathfinding behavior or the solid tilemap. |
| **Max Search Nodes** | Integer (100 to 10000) | 2000 | How many graph nodes A* may visit before giving up. Raise for very large open levels; lower to cap worst-case path cost. |
| **Max Fall Distance** | Integer | 0 | Maximum safe fall in pixels. 0 auto-detects from Platform physics. -1 means unlimited. A positive value is an explicit override. |
| **Auto-Control Movement** | Boolean | On | When on, the behavior drives the Platform behavior automatically. When off, path data is exposed through expressions for manual movement. |
| **Path Strategy** | Combo | Balanced | How the AI picks between valid routes: Balanced, Shortest Distance, Safest Route, or Simplest Path. See [Movement Control](#7-movement-control). |
| **Smooth Paths** | Boolean | On | Removes redundant waypoints so characters take direct walks instead of zigzagging between tile centers. |
| **Max Waypoint Time** | Float (1 to 30) | 5.0 | Seconds before the behavior gives up on a waypoint and fires `On waypoint stuck`. |
| **Coyote Time** | Float (0 to 1) | 0 | Seconds after walking off a ledge in which the AI may still jump. Only useful with Ledge Restriction off. 0 disables it. |
| **Strict Jump Positioning** | Boolean | On | The character slows down and centers on the departure tile before each jump or fall. Prevents missed jumps over pits. |
| **Ledge Restriction** | Boolean | Off | The character will not walk off platform edges unless the path specifically requires a jump or fall. Good for patrol guards. |
| **Ledge Leniency** | Float (0 to 64) | 0 | Pixels past a ledge edge the character may walk before stopping. Only applies with Ledge Restriction on. |
| **Re-Path Threshold** | Float (0 to 20) | 3.0 | Tiles of drift from the path before automatic re-pathing fires. 0 disables automatic re-pathing. |
| **Hazard Radius** | Integer (0 to 10) | 2 | Tile radius of cost falloff around each hazard. Tiles inside the radius get a partial penalty even without touching the hazard. |
| **Auto-Build Graph** | Combo | Auto | Zero-event startup. Auto: use the attached Pathfinding behavior's map when present, otherwise scan all Solid/Jump-thru objects; explicit setup actions always take precedence. From Pathfinding and From Solids force one source. Off: set the map up with actions only. |
| **Map Tag** | Text | (empty) | Instances with the same tag on a layout share one navigation map. Empty = share with everyone. Give special characters (wall-phasing ghosts, flyers) their own tag. Each tag builds its own map, so use few tags. |
| **Detect Slopes** | Boolean | On | During solid scanning (including Auto-Build), probe partially-solid tiles' collision shapes and register 45 and 22.5 degree surfaces as slopes automatically. Requires sloped collision polygons on the tiles. Unsupported angles stay solid. |
| **Enabled** | Boolean | On | Whether the behavior starts active. Disabled freezes navigation (path, graph, and settings are kept; resumes on re-enable). Toggle at runtime with Set enabled. |

---
## 5. Obstacle Maps: Giving the Graph Level Data

The navigation graph needs to know which tiles are solid, which are one-way platforms, and which are slopes. That information is the **obstacle map**, a grid of tile states the graph builder reads. There are four ways to provide one, from most to least automatic.

### Auto-Build Graph (the default)

**Auto-Build Graph** defaults to **Auto**, so the behavior handles everything at startup with no events, straight out of the box. If a Pathfinding behavior is attached to the character, its map is used; otherwise every object type with an enabled Solid or Jump-thru behavior is scanned into a layout-sized grid. Explicit setup actions in `On start of layout` always win over auto-build, because start-of-layout events run before the behavior's first tick. Set the property to Off to disable automatic map building entirely.

```
// No setup events at all. Just find paths:
Event: Every 0.5 seconds
  Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y
```

With **Detect Slopes** on (the default), auto-build also registers slope tiles automatically from their collision shapes. Slope tiles without sloped collision polygons scan as solid until you register them manually (see [Slopes](#8-slopes)), and the graph rebuilds automatically once you do.

### With or without the Pathfinding behavior

The addon does not require Construct's built-in Pathfinding behavior. Both map sources produce a full navigation graph; they differ in how the tile data arrives.

| Aspect | Pathfinding behavior source | Solid/Jump-thru scan (no Pathfinding) |
|---|---|---|
| Extra setup | Pathfinding behavior added to the character, Cell Size configured | Nothing beyond Solid/Jump-thru behaviors your level already uses |
| Timing | Asynchronous: the addon polls until the Pathfinding map is ready (ready/failed/timeout triggers) | Synchronous: the scan completes in the same call |
| One-way platforms | Not represented (the Pathfinding map only knows obstacles), so no fall-through connections from this source alone | Fully supported: Jump-thru objects scan as their own tile state |
| Rasterization | The Pathfinding behavior's own obstacle rasterization | Collision-polygon accurate: rotated sprites, per-tile polygons, and disabled-collision tiles are all honored |
| Tile Size | Auto-detects from the Pathfinding Cell Size | Auto-detects from the solid tilemap's tile size |
| Level changes | Auto-regenerate option reacts to Pathfinding map changes | Update tiles with SetTileState, then RegenerateGraph |
| Best for | Projects that already use the Pathfinding behavior for other AI | Everything else, including all new projects |

Recommendation: use the scan source unless the Pathfinding behavior is already in your project for other reasons. Auto-Build Graph set to Auto makes the choice for you: it uses the Pathfinding map when the behavior is attached to the character and the scan otherwise. Note that jump-thru platforms need the scan source (or manual SetTileState calls) even when the Pathfinding map provides the solids.

### Using the Pathfinding behavior

If your layout already uses Construct's built-in Pathfinding behavior, `UsePathfindingObstacleMap` copies its obstacle data. The Pathfinding map builds asynchronously, so the addon waits for it and fires triggers when ready.

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> UsePathfindingObstacleMap  "Yes (auto-regenerate)"
  // Auto-regenerate rebuilds the graph whenever the Pathfinding map changes
```

Triggers in this flow:

- **On Pathfinding map ready**: the map arrived; graph generation is about to start. Register slopes here if you have them.
- **On Pathfinding map timeout**: Pathfinding took too long (600 ticks). Useful for error handling.
- **On navigation graph generated**: the graph is built and ready for Find path.

### Building the map from solid objects

Without the Pathfinding behavior, build an empty grid and scan objects into it:

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> ScanJumpThruObjectsIntoObstacleMap  TilemapPlatforms
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph
```

Scanning is collision-polygon accurate. Sprites mark only the cells their collision polygon actually covers, so rotated or irregular solids do not over-fill their bounding box. Tilemap tiles are refined against their per-tile collision polygons: tiles with collisions disabled scan as clear, and partial polygons (half-height fences, thin floors) only mark the cells they cover. Objects must have the Solid or Jump-thru behavior enabled, and instances with collisions disabled are skipped, so temporarily disabled platforms are correctly ignored. Polygon features smaller than about a third of a cell are treated as not blocking.

### Setting individual tiles

For procedural levels or runtime changes:

```
Event: On player places wall block
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  Block.X, Block.Y, "Solid"
  Action: Enemy -> PlatformerNavGraph -> RegenerateGraph
  // Tile changes do not rebuild the graph by themselves (slope states are the exception)

Event: On lava tile created
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  Lava.X, Lava.Y, "Avoid"
  // "Avoid" tiles are walkable but get a strong pathfinding cost penalty
```

### Procedurally generated levels (best practices)

Procedural stages work reliably when the map build runs after generation finishes. Follow these rules.

**Rule 1: control the timing.** Auto-Build scans on the behavior's first tick, and On start of layout events run before that tick. If your generator finishes inside On start of layout, Auto-Build works as-is. If generation spans multiple frames, set Auto-Build Graph to Off and build explicitly when done.

**Rule 2 (recommended): write the obstacle map directly from generator data.** Your generator already knows which cells are solid, so skip the tilemap scan entirely. This is the fastest and most exact path, and it handles slopes and one-way platforms in the same loop:

```
Event: (generation complete)
  Action: Enemy -> PlatformerNavGraph -> CreateCustomObstacleMap  GridWidth, GridHeight
  // Inside your generation loop, mirror each cell you generate:
  Action: Enemy -> PlatformerNavGraph -> SetTileState  gx, gy, "Solid"
  Action: Enemy -> PlatformerNavGraph -> SetTileState  gx, gy, "Jump-thru"
  Action: Enemy -> PlatformerNavGraph -> SetTileState  gx, gy, "Slope left /"
  // After the loop:
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  // Spawn or activate enemies here
```

Note: with a custom map, set the Tile Size property explicitly (auto-detection reads tilemaps, and a custom map may not have one).

Alternatively, if your generator paints a tilemap, scan it after painting:

```
Event: (generation complete)
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph
```

**Rule 3: clean up between regenerations.** Portals and hazards persist across graph rebuilds by design. When regenerating a level in the same layout, clear them first or stale portals will reconnect at their old coordinates:

```
Event: (before regenerating the level)
  Action: Enemy -> PlatformerNavGraph -> ClearAllPortals
  Action: Enemy -> PlatformerNavGraph -> ClearAllHazards
  Action: Enemy -> PlatformerNavGraph -> ClearAllHazardTiles
```

**Rule 4: validate the generated level.** The graph doubles as a free traversability check for your generator:

```
Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Condition: Enemy.PlatformerNavGraph.GraphNodeCount < 20
  // Degenerate level: too little walkable ground, regenerate
  Action: (regenerate with a new seed)

Event: Enemy -> PlatformerNavGraph -> On failed to find path
  Condition: (this was the spawn-to-exit test path)
  // Exit unreachable from spawn: regenerate or add a connecting corridor
```

**Rule 5: spawn characters on walkable ground.** A character spawning mid-air or inside geometry gets `no_start_node` (ground correction searches about 10 tiles). Have the generator emit spawn points on floor cells, or check with `Graph node exists at world position` before spawning.

**Rule 6: cache repeatable seeds.** For daily seeds or revisitable floors, save the finished map once and reload it instantly on revisit (see the next section). The JSON carries slopes and tile hazards, so nothing needs re-registration.

For runtime digging and building after the level is live, update tiles with `SetTileState` plus `RegenerateGraph`; rebuilds are time-sliced, so tile-by-tile terrain changes do not hitch the frame.

### Saving and loading obstacle maps

For large fixed levels, build the map once, export it as JSON, and reload it at runtime to skip the scan:

```
Event: On "Export map" pressed
  Action: Browser -> LocalStorage.SetItem  "navmap", Enemy.PlatformerNavGraph.ObstacleMapJSON

Event: On start of layout
  Condition: Browser -> LocalStorage.HasItem("navmap")
  Action: Enemy -> PlatformerNavGraph -> LoadObstacleMapFromJSON  LocalStorage.GetItem("navmap")
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph
```

The JSON includes the obstacle grid, slope map, hazard tile map, and tile size, so a loaded map needs no re-registration.

---

## 6. Finding Paths

### Find path (simple)

For most games, use **Find path** or **Find path to object**. Both use sensible defaults: ground correction on, Nearest mode (never fails outright), and jump positioning from the property. With auto-control on, the character starts moving immediately.

```
Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y

Action: Enemy -> PlatformerNavGraph -> Find path to object  Player
// Same defaults, but reads the target object's position directly
```

### Find path to position (advanced)

The advanced `FindPath` action exposes every option:

```
Action: Enemy -> PlatformerNavGraph -> FindPath
  X: Player.X
  Y: Player.Y
  Correct to ground: Yes       // snap start/target to nearest walkable tile
  Mode: Reach                  // "Reach" fails if no complete path; "Nearest" always succeeds
  Jump positioning: Default    // "Default" uses the property; "Strict"/"Relaxed" override per path
```

**Correct to ground** matters when the target might be mid-air (a jumping player). It snaps the target down to the nearest standing position so the path ends somewhere reachable.

**Nearest mode** never fires `On failed to find path`. If the exact goal is unreachable, it paths to the closest reachable node instead. Use it for follow behavior where "get as close as possible" is always acceptable. The `PathEndX` / `PathEndY` expressions tell you where the character will actually stop, which is how you detect that the exact target was out of reach:

```
Event: Enemy -> PlatformerNavGraph -> On path found
  Condition: distance(Enemy.PlatformerNavGraph.PathEndX, Enemy.PlatformerNavGraph.PathEndY, Player.X, Player.Y) > 96
  Action: Enemy -> PlayAnimation  "Frustrated"
  // The path stops short of the player: react accordingly
```

**Jump positioning override** changes precision for this one path. Strict for narrow bridges over pits, Relaxed for chase sequences where speed beats precision.

### Reacting to path results

```
Event: Enemy -> PlatformerNavGraph -> On path found
  Action: Enemy -> PlayAnimation  "Run"

Event: Enemy -> PlatformerNavGraph -> On failed to find path
  Action: Enemy -> PlayAnimation  "Idle"
  // Common fail reasons: "no_start_node", "no_goal_node", "no_path", "search_exhausted"
  Action: Browser -> Log  Enemy.PlatformerNavGraph.PathFailReason

Event: Enemy -> PlatformerNavGraph -> On arrived
  Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y
  // Arrived. Immediately re-path to keep chasing.
```

### Monitoring waypoints

```
Event: Enemy -> PlatformerNavGraph -> On waypoint reached
  Local var action = Enemy.PlatformerNavGraph.CurrentPathAction(Enemy.PlatformerNavGraph.CurrentWaypoint)
  Condition: action = "jump"
  Action: Enemy -> PlayAnimation  "Jump"
  // Drive animations from the path's own action types
```

### Jump toward position (lunges and attacks)

`JumpTowardPosition` is not pathfinding. It launches the character at a target with a full-strength jump plus horizontal steering, and it works mid-air when the Platform behavior has double jump enabled. Use it for jump attacks, stomps, and lunges.

```
Event: Boss in range of player
  Action: Boss -> PlatformerNavGraph -> Stop
  Action: Boss -> PlatformerNavGraph -> JumpTowardPosition  Player.X, Player.Y

Event: Boss -> PlatformerNavGraph -> On jump toward launched
  Action: Boss -> PlayAnimation  "LungeAttack"
```

---

## 7. Movement Control

### Auto-control vs. manual control

With **Auto-Control Movement** on, the behavior reads the current waypoint every frame, decides walk, jump, or fall, and simulates Platform inputs. You only call Find path and respond to triggers.

With auto-control off, you drive movement yourself from path data:

```
Event: Every tick
  Condition: Enemy -> PlatformerNavGraph -> Is moving along path
  Local var action = Enemy.PlatformerNavGraph.CurrentPathAction(Enemy.PlatformerNavGraph.CurrentWaypoint)
  Condition: action = "walk_right"
  Action: Enemy -> Platform -> Simulate input "Right"
```

Toggle it at runtime to hand control back and forth, for example during knockback:

```
Event: On player hits enemy
  Action: Enemy -> PlatformerNavGraph -> SetAutoControl  "Disabled"
  Action: Enemy -> Platform -> Set vector X  -300
  // Restore auto-control and re-path once the knockback settles
```

### Path strategies

The **Path Strategy** property controls how A* weighs movement costs. Change it at runtime with `SetPathStrategy`.

| Strategy | Behavior | Best for |
|---|---|---|
| **Balanced** | Weighs distance and movement difficulty equally | Most games, the sensible default |
| **Shortest Distance** | Minimizes path length, including risky jumps | Speedrunner rivals, aggressive enemies |
| **Safest Route** | Strongly prefers walking over jumping or falling | Stealth NPCs, escorts, fragile characters |
| **Simplest Path** | Minimizes waypoint count for predictable movement | Tower defense creeps, simple patrols |

```
Event: Boss enters phase 2
  Action: Boss -> PlatformerNavGraph -> SetPathStrategy  "Shortest Distance"
  // Boss takes the fastest route regardless of risk
```

### Ledge restriction and leniency

**Ledge Restriction** stops casual wandering off platform edges. It does not block path-required departures: if the route needs a jump or fall, the character still leaves the platform.

```
Event: On start of layout
  Action: Guard -> PlatformerNavGraph -> SetLedgeRestriction  "Enabled"
  Action: Guard -> PlatformerNavGraph -> SetLedgeLeniency  8
  // Guard may overhang the edge by 8 px for natural-looking movement
```

With Ledge Restriction off, the AI can walk flush to a wall before jumping (wall-adjacent jumps), and **Coyote Time** becomes usable.

### Strict jump positioning

**Strict Jump Positioning** makes the character slow down and center on the departure tile before every jump or fall, preventing missed jumps caused by overshooting the edge.

```
Event: Boss enters rage mode
  Action: Boss -> PlatformerNavGraph -> SetStrictJumpPositioning  "Disabled"
  // Rage mode: faster but riskier departures
```

You can also override per path with the advanced FindPath's Jump Positioning parameter.

### Coyote time

Coyote time lets the AI jump during a short window after walking off a ledge, which makes slightly out-of-reach platforms accessible. It requires Ledge Restriction off.

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> SetCoyoteTime  0.15
  // 150 ms window after leaving a ledge in which the jump still fires
```

### Automatic re-pathing

The behavior monitors drift from the path. Past the **Re-Path Threshold** it recalculates automatically, which absorbs knockback and physics disturbances. `SetRePathCooldown` limits how often this may fire.

```
Event: Enemy -> PlatformerNavGraph -> On re-path triggered
  Action: Enemy -> PlayAnimation  "Confused"
  // Optional feedback when the automatic re-path fires
```

Set the threshold to 0 to disable automatic re-pathing and control it yourself.

---

## 8. Slopes

The graph understands 45 degree slopes (`/` and `\`) and 22.5 degree gentle slopes. Slope nodes connect with walk actions at true Euclidean cost, so A* naturally prefers walking a ramp over jumping when the ramp is cheaper.

### Registering slopes

Slopes must be declared, because a tilemap scan cannot tell a slope tile from a solid block. The easiest way is `MapSlopeTilesFromTilemap` with the tile IDs you used in the Tilemap editor:

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> MapSlopeTilesFromTilemap
    Tilemap: TilemapWalls
    Slope left IDs:   "3"      // 45 degree / slopes
    Slope right IDs:  "4"      // 45 degree \ slopes
    Gentle left IDs:  "5,6"    // 22.5 degree / slopes (two tiles per rise)
    Gentle right IDs: "7,8"
  // Pass "" for slope types you do not use
```

Horizontally flipped tile placements are detected automatically and their direction mirrored, so one base tile covers both orientations. Registration order does not matter: if the graph was already built (or is building), it rebuilds itself with the slope data immediately.

You can also mark tiles directly:

```
Action: Enemy -> PlatformerNavGraph -> SetTileState  5, 3, "Slope left /"
Action: Enemy -> PlatformerNavGraph -> MarkSlopeRegion  2, 8, 6, 4, "Slope right \"
```

### Automatic slope detection

There are two hands-off options, both built on the documented collision API (they probe the shapes characters actually collide with, so they cannot disagree with the physics):

**The Detect Slopes property** (on by default): slope detection happens during every solid scan, including Auto-Build. Partially-solid tiles are probed at three columns; a straight surface dropping one tile across the cell registers as a 45 degree slope, half a tile as a gentle slope, and anything else (half-blocks, decorations, unsupported angles) stays solid. Combined with Auto-Build Graph, a slope-heavy level needs zero setup events. This also classifies the diagonal edge cells of rotated solid sprites, so a 45 degree sprite ramp becomes walkable automatically.

**The AutoDetectSlopeTiles action**: the same probe classification run on demand against one tilemap, for projects that keep manual control of the scan sequence. Results are cached per tile shape, and flipped tile placements classify correctly on their own.

Both require slope tiles to have actual sloped collision polygons set in the C3 editor. A slope drawn in the art but carrying a square collision polygon probes as flat and stays solid, which matches how the character would actually collide with it. `MapSlopeTilesFromTilemap` with explicit tile IDs remains available as the manual override.

### Unregistered slope tiles

An unregistered slope tile looks like a solid block to walking and like empty air to the jump arc checker, so jumps can clip straight through the slope body. With Debug Logging on, the console lists every unregistered tile ID found during slope mapping, with example cell positions, which makes missing IDs easy to spot.

---

## 9. Portals: Doors, Elevators, and Ziplines

A **portal** is a shortcut connection the graph cannot express with normal movement. There are two types:

- **Instant portals** teleport the character from entry to exit. Doors, warp pads, teleporters.
- **Gradual portals** move the character linearly from entry to exit at a set speed, with the Platform behavior disabled during traversal. Elevators, lifts, ropes, ziplines.

### Adding portals

Add portals after the graph is generated; a graph rebuild reconnects all registered portals automatically, but portals added before any graph exists cannot resolve their entry and exit nodes.

```
Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddInstantPortalFromObjects
    Direction: One-way
    Entry object: DoorEntry
    Exit object: DoorExit
    Cost: 1
    Tag: "door"

  Action: Enemy -> PlatformerNavGraph -> AddGradualPortalFromObjects
    Direction: Two-way
    Entry object: ElevatorBottom
    Exit object: ElevatorTop
    Cost: 1
    Speed: 80
    Tag: "elevator"
  // Save Enemy.PlatformerNavGraph.LastPortalID if you need to modify it later
```

### Elevator groups

For elevators with more than two stops, use `AddElevatorStop`. Stops in the same group are connected pairwise with two-way gradual portals, so any floor reaches any floor:

```
Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift_A", Floor1Marker, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift_A", Floor2Marker, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift_A", Floor3Marker, 80
  // Creates portals Floor1-Floor2, Floor1-Floor3, Floor2-Floor3
```

### Pausing at portals for custom transitions

`PauseAtPortal` holds the character at the entry point before the portal executes. It only works inside `On portal entry`.

```
Event: Enemy -> PlatformerNavGraph -> On portal entry
  Action: Enemy -> PlatformerNavGraph -> PauseAtPortal
  Action: DoorSprite -> PlayAnimation  "Open"

Event: DoorSprite -> On animation "Open" finished
  Action: Enemy -> PlatformerNavGraph -> ResumePortal
  // NOW the built-in portal movement runs (teleport or gradual move)
```

After pausing you have two exits:

- **ResumePortal** runs the portal's built-in movement.
- **CompletePortal** finishes the portal without built-in movement, for when your events moved the character themselves (custom launch, cutscene, animation-driven motion).

```
Event: Enemy -> PlatformerNavGraph -> On portal entry
  Action: Enemy -> PlatformerNavGraph -> PauseAtPortal
  Action: Enemy -> PlatformerNavGraph -> TeleportToPosition  Enemy.PlatformerNavGraph.PortalExitX, Enemy.PlatformerNavGraph.PortalExitY
  Action: Enemy -> PlayAnimation  "Teleport"

Event: Enemy -> On animation "Teleport" finished
  Action: Enemy -> PlatformerNavGraph -> CompletePortal
```

### Tracking gradual traversal

```
Event: Every tick
  Condition: Enemy -> PlatformerNavGraph -> Is traversing portal
  Action: ElevatorCar -> Set Y  Enemy.Y
  // PortalProgress returns 0 to 1 during traversal

Event: Enemy -> PlatformerNavGraph -> On portal complete
  Action: ElevatorCar -> PlayAnimation  "Arrive"
```

### Moving portals

`SetPortalPositionFromObjects` moves an existing portal in place, keeping its ID, type, cost, speed, and tags, and re-wires its graph connections immediately (the re-wire is microseconds, so a timer-driven mover is fine):

```
Event: Every 0.25 seconds
  Action: Enemy -> PlatformerNavGraph -> SetPortalPositionFromObjects  dronePortalId, DroneEntry, DroneExit
  // A teleporter drone that drifts around the level; routes adapt on each re-path
```

A character already traversing the portal keeps its original destination; moving a portal never teleports anyone.

### Modifying and removing portals

```
Action: Enemy -> PlatformerNavGraph -> SetPortalCost  doorPortalId, 999
// Effectively locks the door without removing the portal

Action: Enemy -> PlatformerNavGraph -> RemovePortalAtObject  DoorEntry
// Removes the portal closest to this object (entry or exit side)

Action: Enemy -> PlatformerNavGraph -> ClearAllPortals
// Removes everything, including elevator groups
```

### Portal tags

Every portal takes an optional **tag** string for grouping and querying. Use commas for multiple tags; whitespace around commas is ignored.

```
Action: Enemy -> PlatformerNavGraph -> SetPortalTag  doorPortalId, "door,floor_1"

// Count and iterate portals by tag
Repeat Enemy.PlatformerNavGraph.PortalCountByTag("door") times:
  Local var id = Enemy.PlatformerNavGraph.PortalIDByTag("door", LoopIndex)

// Nearest / furthest portal, optionally filtered by tag ("" searches all)
Local var nearest = Enemy.PlatformerNavGraph.NearestPortalID(Enemy.X, Enemy.Y, "door")

// Remove a whole group at once
Action: Enemy -> PlatformerNavGraph -> RemovePortalsByTag  "door"
```

---

## 10. Hazards: Danger Zone Avoidance

**Hazards** raise the pathfinding cost of nearby tiles so the AI prefers safer routes. They bias the path; they do not hard-block it. If the only route runs through the hazard, the AI still takes it. Hazard avoidance switches on automatically when the first hazard is added, and the **Hazard Radius** property controls how far the penalty spreads.

### Shape hazards

```
Event: On spike trap activated
  Action: Enemy -> PlatformerNavGraph -> AddRectHazard
    X: SpikeTrap.X,  Y: SpikeTrap.Y
    Width: SpikeTrap.Width,  Height: SpikeTrap.Height
    Severity: 20

Event: On explosion created
  Action: Enemy -> PlatformerNavGraph -> AddCircleHazard  Explosion.X, Explosion.Y, 96, 30
  // Higher severity means stronger avoidance

Event: On explosion faded
  Action: Enemy -> PlatformerNavGraph -> ClearAllHazards
  // Or RemoveHazard with a saved ID for surgical removal
```

Rect hazards use X, Y as the top-left corner. Circle hazards use X, Y as the center.

### Tile hazards

For permanent static danger such as lava rows, mark tiles directly:

```
Action: Enemy -> PlatformerNavGraph -> SetTileHazard  5, 12, 15
// Tile (5,12) gets severity 15

Action: Enemy -> PlatformerNavGraph -> ClearAllHazardTiles   // tile hazards only
Action: Enemy -> PlatformerNavGraph -> ClearAllHazards       // circle/rect hazards only
```

### Querying hazard state

```
Condition: Enemy -> PlatformerNavGraph -> Is position hazardous (Target.X, Target.Y)
// True if any hazard affects the position

Expression: Enemy.PlatformerNavGraph.HazardSeverity(x, y)
// Total severity at a position, useful for driving visual warnings
```

Hazard changes take effect automatically: any add, remove, or change re-bakes node costs once per map before the next tick's movement or the next path search, no matter how many hazards changed or how many instances share the map. Re-path only when you want an already-moving character to reconsider its current route.

### Moving hazards

For hazards that move, use a **tracked hazard**: one action, and it follows the object automatically every tick with no per-frame events. Path costs update only when the object actually moves, and the hazard removes itself when its object is destroyed:

```
Event: Saw -> On created
  Action: Enemy -> PlatformerNavGraph -> AddTrackedHazard  Saw, 64, 30
  Set sawHazardId = Enemy.PlatformerNavGraph.LastHazardID
  // That's all. The hazard follows the saw and cleans itself up on destroy.
```

Tracking is single-flight per map (one update pass per tick regardless of instance count) and each hazard only touches its own area during re-bakes, so hundreds of tracked hazards stay cheap even when they move every frame. The real limit is **path staleness**, not cost: a path computed now is followed for seconds, so avoidance through the cost system suits hazards that move slower than characters re-path (patrolling saws, spreading fire, drifting gas). For fast movers like projectiles, cost-based avoidance is the wrong tool: react in events instead (a dodge with `JumpTowardPosition`, or `Stop` plus manual evasion) and re-path afterward.

---

## 11. Multi-Agent Support and Performance

### One graph, many agents

Every instance on the layout reads the same navigation graph (per map tag). The build cost is paid once no matter how many enemies you spawn.

Scanning and graph building are **single-flight**: with hundreds of instances carrying the behavior, exactly one instance performs the scan and build per map while the rest wait on the shared result. The map data itself (obstacle, slope, and hazard grids) is also **one copy per map**, shared by reference to every instance. Setup actions are deduplicated too: because event actions run once per picked instance, calling `UsePathfindingObstacleMap` on a type with 50 instances would repeat the copy 50 times, so the addon runs it once and the other 49 adopt the result. Instances spawned after the graph is built inherit both the graph and the map data immediately, without triggering a rebuild, so wave spawners are safe.

One rule keeps many agents on one map honest: **one movement class per map**. The graph's jump and fall connections are computed from the physics of the instance that built it, so characters with meaningfully different jump strength, gravity, or size should get their own Map Tag (see below). With Debug Logging on, the addon warns when an instance's jump physics differ more than about 20 percent from the graph it is sharing.

### Map tags: several shared maps on one layout

Sometimes different characters need different views of the same level: a wall-phasing ghost, a flyer that ignores floors, a giant that cannot fit through one-tile corridors. The **Map Tag** property handles this. Instances with the same tag share one navigation map; the empty default tag is the ordinary everyone-shares map.

```
// Ghost sprites: Map Tag property = "ghost"
// Everything else: Map Tag left empty

Event: On start of layout
  // Normal enemies use Auto-Build as usual (default tag map).
  // Build the ghost map by hand on a ghost instance: only boundary walls are solid.
  Action: Ghost -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Ghost -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapBoundary
  Action: Ghost -> PlatformerNavGraph -> GenerateNavigationGraph
```

Rules of thumb:

- **Each tag is a full map**: its own obstacle map, graph, build, and savegame payload. Two or three tags are cheap; ten are not.
- **Set up each tag's map on an instance carrying that tag.** Map actions (scans, tile states, slopes) affect the calling instance's map. Auto-Build works per tag too, but a special tag usually exists precisely because it needs a different source.
- **Portals and hazards are per tag.** A door portal added by a default-tag instance does not exist in the ghost map; register it from a ghost instance too if ghosts should use it.
- **Watch for typos.** A misspelled tag silently creates a separate, unconfigured map, and that character will have no paths. With Debug Logging on, the console lists the active tags on the layout whenever a new tag appears; the debugger also shows each instance's tag.
- **Multi-agent avoidance is per tag**: agents only avoid others on the same map.
- The `MapTag` expression returns the instance's tag for event logic and debugging.

### Per-tick path budget

When many agents request paths on the same tick, `SetMaxPathsPerTick` spreads the A* work across frames. Excess requests queue and resolve over the following ticks.

```
Event: On start of layout
  Action: AnyEnemy -> PlatformerNavGraph -> SetMaxPathsPerTick  4

Condition: AnyEnemy -> PlatformerNavGraph -> Is calculating path
// True while this agent's request is still queued
```

### Multi-agent avoidance

With avoidance enabled, agents share positions through a spatial hash and A* penalizes routes that pass close to other agents, so crowds fan out across parallel routes instead of stacking on one path. Avoidance is per map tag: agents only avoid others on the same map.

```
Event: On start of layout
  Action: AnyEnemy -> PlatformerNavGraph -> SetMultiAgentAvoidance  "Enabled"

Expression: AnyEnemy.PlatformerNavGraph.NearbyAgentCount
// Agents within three tiles of this character
```

### Tuning checklist

- **Tile Size**: the biggest lever. Node count scales with area divided by tile size squared, so 48 px tiles cost roughly half of 32 px tiles.
- **Graph builds are time-sliced** (about 6 ms of work per tick), so even large maps build without a frame hitch. The build finishes early and synchronously if anything calls Find path mid-build.
- **Max Search Nodes**: cap the worst-case A* cost. 500 to 1000 is plenty for small levels.
- **Disable Debug Logging in release.** Console output is expensive, especially on mobile.
- **Pre-scan large fixed levels** and reload with `LoadObstacleMapFromJSON` instead of scanning every run.
- **PathQueueSize** exposes the pending request count for a debug HUD.

---
## 12. Actions Reference

Categories mirror the built-in Pathfinding behavior's groups: Pathfinding (finding routes), Movement (following them), Obstacles (level data), plus Hazards, Portals, and Debug.

### Pathfinding

| Action | Description |
|---|---|
| **Find path** X, Y | Path to a position with sensible defaults: ground correction on, Nearest mode so it never fails outright. The recommended action for most games. |
| **Find path to object** Target | Same defaults as Find path, but reads the position of the target object's first picked instance. |
| **FindPath (advanced)** X, Y, CorrectToGround, Mode, JumpPositioning | Full-control pathing. CorrectToGround snaps to solid ground; Mode Reach fails when no complete path exists; JumpPositioning overrides precision per path. |
| **Stop** | Immediately stop the character and clear the active path. |
| **SetPathStrategy** Strategy | Switch the route weighting: Balanced, Shortest Distance, Safest Route, Simplest Path. |
| **SetRePathThreshold** Tiles | Tiles of drift that trigger automatic re-pathing. |
| **SetRePathCooldown** Seconds | Minimum time between automatic re-path attempts. |
| **SetMaxPathsPerTick** Count | Limit A* calculations per tick; extra requests queue. 0 means unlimited. |
| **SetMultiAgentAvoidance** Enabled | Toggle multi-agent path avoidance (agents on the same map fan out instead of stacking). |

### Movement

| Action | Description |
|---|---|
| **SetEnabled** State | Enable or disable the whole behavior. Disabled freezes navigation with all state kept; Find path is ignored while disabled, map setup actions still work. |
| **SetAutoControl** Enabled | Toggle whether the behavior drives the Platform behavior automatically. |
| **JumpTowardPosition** X, Y | Launch the character directly at the target with a full jump. Not pathfinding; used for lunges and attacks. Works mid-air with double jump. |
| **SetCoyoteTime** Seconds | Set the jump window after walking off a ledge. 0 disables coyote jumps. |
| **SetStrictJumpPositioning** Enabled | Toggle careful pre-jump centering for this character. |
| **SetLedgeRestriction** Enabled | Toggle whether the character stops at platform edges. |
| **SetLedgeLeniency** Pixels | How far past a ledge edge the character may walk (needs Ledge Restriction on). |
| **SetMaxJumpHeight** Pixels | Override the auto-detected maximum jump height. Regenerate the graph afterwards. |
| **SetMaxJumpDistance** Pixels | Override the auto-detected maximum horizontal jump distance. Regenerate the graph afterwards. |
| **SetMaxFallDistance** Pixels | Override the maximum fall distance used for fall connections. Regenerate the graph afterwards. |

### Obstacles

| Action | Description |
|---|---|
| **UsePathfindingObstacleMap** AutoRegen | Copy the obstacle map from the Pathfinding behavior, waiting for its async build if needed. Auto-regen rebuilds the graph when the map changes. |
| **BuildObstacleMapFromLayout** Width, Height | Create an empty grid from layout pixel dimensions. Call before the scan actions. |
| **ScanSolidObjectsIntoObstacleMap** Objects | Mark objects with an enabled Solid behavior into the map. Tilemaps scan cell by cell; sprites by bounding box. |
| **ScanJumpThruObjectsIntoObstacleMap** Objects | Mark one-way platforms (enabled Jump-thru behavior) into the map. |
| **CreateCustomObstacleMap** Width, Height | Create an empty map with explicit tile dimensions, for fully manual tile setup. |
| **GenerateNavigationGraph** | Build the navigation graph from the current obstacle map. Fires On navigation graph generated when done. |
| **RegenerateGraph** | Rebuild the navigation graph from the current obstacle map. Use after level changes. |
| **SetTileState** GridX, GridY, State | Set one tile: Solid, Clear, Jump-thru, Avoid, or a slope type. |
| **SetTileStateWorld** X, Y, State | Same as SetTileState using world pixel coordinates. |
| **MarkSlopeRegion** StartX, StartY, EndX, EndY, Direction | Mark a diagonal run of tiles as a slope type. |
| **MapSlopeTilesFromTilemap** Tilemap, LeftIDs, RightIDs, GentleLeftIDs, GentleRightIDs | Scan a tilemap and mark the given tile IDs as slopes. Comma-separated ID strings; flipped placements auto-mirror. |
| **AutoDetectSlopeTiles** Tilemap | Register slope tiles by probing their collision shapes with the documented collision API (45 and 22.5 degree surfaces). Needs sloped collision polygons; unsupported shapes stay solid. |
| **ClearAllSlopes** | Remove every slope marking and mark the graph for rebuild. |
| **LoadObstacleMapFromJSON** JSON | Restore a map (obstacles, slopes, tile hazards, tile size) saved with the ObstacleMapJSON expression. |
| **ClearObstacleMap** | Remove the obstacle map and all associated data. |

### Portals

| Action | Description |
|---|---|
| **AddInstantPortal** Direction, EntryX, EntryY, ExitX, ExitY, Cost, Tag | Add a teleport portal at world coordinates. |
| **AddInstantPortalFromObjects** Direction, EntryObj, ExitObj, Cost, Tag | Add a teleport portal between two objects' positions. |
| **AddGradualPortal** Direction, EntryX, EntryY, ExitX, ExitY, Cost, Speed, Tag | Add a linear-movement portal (elevator, zipline) at world coordinates. |
| **AddGradualPortalFromObjects** Direction, EntryObj, ExitObj, Cost, Speed, Tag | Add a linear-movement portal between two objects' positions. |
| **AddElevatorStop** GroupID, X, Y, Speed, Tag | Add a stop to an elevator group; auto-creates two-way gradual portals to every existing stop in the group. |
| **AddElevatorStopFromObject** GroupID, Object, Speed, Tag | Same as AddElevatorStop using an object's position. |
| **RemovePortal** ID | Remove one portal by ID, including its graph connections. |
| **RemovePortalAtObject** Object | Remove the portal whose entry or exit is closest to the object. |
| **RemovePortalsByTag** Tag | Remove every portal whose tag string contains the tag token. |
| **ClearAllPortals** | Remove all portals and their graph connections. |
| **SetPortalPosition** ID, EntryX, EntryY, ExitX, ExitY | Move a portal in place, preserving ID, type, cost, speed, and tags. Connections re-wire immediately. |
| **SetPortalPositionFromObjects** ID, EntryObj, ExitObj | Move a portal to two objects' positions. Combine with a timer for moving teleporters. |
| **SetPortalCost** ID, Cost | Change a portal's pathfinding cost. Higher cost means less preferred; very high effectively locks it. |
| **SetPortalSpeed** ID, Speed | Change a gradual portal's traversal speed in pixels per second. |
| **SetPortalIgnoreHazards** ID, Ignore | Whether the portal's connection ignores hazard cost multipliers. |
| **SetPortalTag** ID, Tag | Replace the portal's tag string. Use commas for multiple tags. |
| **PauseAtPortal** | Hold the character at the portal entry. Only valid inside On portal entry. |
| **ResumePortal** | Run the built-in portal movement after a pause. |
| **CompletePortal** | Finish the portal without built-in movement (your events moved the character). |
| **TeleportToPosition** X, Y | Instantly move the character. Suppresses drift re-pathing for one tick. |

### Hazards

| Action | Description |
|---|---|
| **AddRectHazard** X, Y, Width, Height, Severity | Mark a rectangle (top-left at X, Y) as dangerous. |
| **AddCircleHazard** X, Y, Radius, Severity | Mark a circle (center at X, Y) as dangerous. Good for explosions and AOE. |
| **AddTrackedHazard** Object, Radius, Severity | Add a circular hazard that follows an object automatically every tick. Removes itself when the object is destroyed. |
| **ClearAllTrackedHazards** | Remove every tracked (object-following) hazard. Static and tile hazards are untouched. |
| **RemoveHazard** ID | Remove one shape hazard by ID. |
| **ClearAllHazards** | Remove all circle and rect hazards. Tile hazards are untouched. |
| **ClearAllHazardTiles** | Reset all tile hazard severities. Shape hazards are untouched. |
| **SetTileHazard** GridX, GridY, Severity | Set the danger level of one tile. 0 removes the hazard. |
| **SetHazardRadius** Tiles | Cost falloff radius around each hazard. |

### Debug

| Action | Description |
|---|---|
| **LogGraphStats** | Print node, connection, ledge, slope, portal, and hazard counts to the browser console. |

---

## 13. Conditions Reference

| Condition | Description |
|---|---|
| **Is enabled** | True while this behavior is enabled (property or Set enabled action). |
| **Is moving along path** | True while the character is following a path. |
| **Is platform enabled** | True if the attached Platform behavior is currently enabled. |
| **Is at ledge** | True when the character stands on a ledge node (platform edge). |
| **Is at island** | True when the character stands on a single-tile isolated platform. |
| **Graph node exists at grid position** GridX, GridY | True if a navigation node exists at these grid coordinates. |
| **Graph node exists at world position** X, Y | True if a navigation node exists at this world position. |
| **Is node at ledge** GridX, GridY | True if the node at these coordinates is a left or right ledge. |
| **Is at portal** | True while paused at a portal entry (after PauseAtPortal, before Resume or Complete). |
| **Is traversing portal** | True while moving through a gradual portal. The Platform behavior is disabled during this. |
| **Tile has state** GridX, GridY, State | True if the tile has the given state (including "Slope (any)" and "Gentle slope"). |
| **Tile has state at world position** X, Y, State | Same as Tile has state using world coordinates. |
| **Is setting up Pathfinding** | True while waiting for the Pathfinding behavior's async map build. |
| **Is position hazardous** X, Y | True if any hazard (circle, rect, or tile) affects the position. |
| **Is multi-agent avoidance enabled** | True if avoidance is active. |
| **Is calculating path** | True while this agent's path request is queued behind the per-tick budget. |

---

## 14. Expressions Reference

### Pathfinding

| Expression | Returns | Description |
|---|---|---|
| **WaypointCount** | Number | Waypoints in the current path. 0 if no path. |
| **CurrentWaypoint** | Number | Index of the waypoint currently being approached. |
| **CurrentWaypointX / CurrentWaypointY** | Number | World position of the current waypoint. |
| **WaypointX(i) / WaypointY(i)** | Number | World position of waypoint i, centered in its tile. |
| **WaypointGridX(i) / WaypointGridY(i)** | Number | Grid coordinates of waypoint i. |
| **CurrentPathAction(i)** | String | Action of waypoint i: `walk_left`, `walk_right`, `jump`, `fall`, `fall_left`, `fall_right`, `coyote_jump`, `fall_through`, `portal_instant`, `portal_gradual`. |
| **PathFailReason** | String | Last failure: `no_start_node`, `no_goal_node`, `no_path`, `search_exhausted`, or empty on success. |
| **PathCost** | Number | Total cost of the current path. |
| **PathEndX / PathEndY** | Number | The calculated path's final position (the last waypoint), where the character will actually end up. In Nearest mode this can differ from the requested target. |
| **TargetX / TargetY** | Number | The REQUESTED target position, as passed to the last Find path. Use PathEndX/Y for where the path actually ends. |
| **TargetGridX / TargetGridY** | Number | The requested target's grid cell (after ground correction). |
| **AngleToWaypoint** | Number | Angle in degrees from the character to the current waypoint. |
| **DistanceToWaypoint** | Number | Pixel distance to the current waypoint. |
| **PathStrategy** | String | Active strategy: `balanced`, `shortest`, `safest`, `simplest`. |
| **RePathThreshold / RePathCooldown** | Number | Current re-path settings. |
| **MaxPathsPerTick** | Number | Current per-tick path budget. 0 means unlimited. |
| **PathQueueSize** | Number | Pending queued path requests. |
| **NearbyAgentCount** | Number | Path-following agents within three tiles (avoidance must be on). |

### Movement

| Expression | Returns | Description |
|---|---|---|
| **CoyoteTime / CoyoteTimer** | Number | Coyote setting and live countdown. |
| **StrictJumpPositioning / LedgeRestriction** | Number | 1 when enabled, 0 when not. |
| **LedgeLeniency** | Number | Current leniency in pixels. |
| **JumpTowardTargetX / JumpTowardTargetY** | Number | Target of the active jump-toward. |
| **EstimatedVelocityX** | Number | Estimated horizontal velocity from position deltas. |
| **StoppingDistance** | Number | Braking distance at current Platform speed. |

### Obstacles

| Expression | Returns | Description |
|---|---|---|
| **ObstacleMapJSON** | String | The full map (obstacles, slopes, tile hazards, tile size) as JSON. |
| **ObstacleMapSource** | String | `pathfinding`, `custom`, `collision`, or `none`. |
| **GridWidth / GridHeight** | Number | Map dimensions in tiles. |
| **GridTileSize** | Number | Tile size in pixels (the resolved value when Tile Size is auto). |
| **TileState(gx, gy)** | String | `solid`, `clear`, `jump_thru`, `avoid`, or a slope type name. |
| **SlopeDirection(gx, gy)** | String | `left`, `right`, `gentle_left`, `gentle_right`, or `none`. |
| **WorldToGridX(x) / WorldToGridY(y)** | Number | Convert world pixels to grid coordinates. |
| **WaitTickCount** | Number | Ticks spent waiting for the Pathfinding map. Debug aid. |
| **MapTag** | String | The map tag this instance navigates with. Empty string is the default shared map. |

### Portals

| Expression | Returns | Description |
|---|---|---|
| **PortalCount** | Number | Total registered portals. |
| **LastPortalID** | Number | ID of the most recently added portal. Read right after adding. |
| **CurrentPortalID** | Number | Portal being processed. Valid inside portal triggers. |
| **PortalProgress** | Number | Gradual traversal progress, 0 to 1. |
| **PortalExitX / PortalExitY** | Number | Exit position of the current portal. Valid inside portal triggers. |
| **PortalType(id)** | String | `instant` or `gradual`. |
| **PortalTag(id)** | String | The portal's tag string, or empty if it does not exist. |
| **PortalCountByTag(tag)** | Number | Portals whose tag string contains the token. |
| **PortalIDByTag(tag, i)** | Number | The i-th portal ID matching the tag, or -1 out of range. |
| **NearestPortalID(x, y, tag)** | Number | Portal with the nearest entry point. Empty tag searches all. -1 if none. |
| **FurthestPortalID(x, y, tag)** | Number | Portal with the furthest entry point. Empty tag searches all. -1 if none. |

### Hazards

| Expression | Returns | Description |
|---|---|---|
| **LastHazardID** | Number | ID of the most recently added shape hazard. Read right after adding, store to remove or track later. 0 if none. |
| **HazardCount** | Number | Active shape hazards (circles and rects), including tracked ones. |
| **TrackedHazardCount** | Number | Active tracked (object-following) hazards. |
| **PositionIsHazardous(x, y)** | Number | 1 if hazardous, 0 if safe. |
| **HazardSeverity(x, y)** | Number | Highest severity affecting the position. |
| **TileHazardSeverity(gx, gy)** | Number | Tile-only severity at grid coordinates. |
| **HazardRadius** | Number | Current hazard falloff radius in tiles. |

### Debug

| Expression | Returns | Description |
|---|---|---|
| **GraphNodeCount** | Number | Total nodes in the navigation graph. |
| **GraphNodeWorldX(gx, gy) / GraphNodeWorldY(gx, gy)** | Number | World position of the node at grid coordinates. |
| **GraphNodeAtIndexX(i) / GraphNodeAtIndexY(i)** | Number | World position of the i-th node in the graph array. |
| **GraphNodeAtIndexGridX(i) / GraphNodeAtIndexGridY(i)** | Number | Grid coordinates of the i-th node. |
| **GraphNodeAtIndexIsLeftLedge(i) / GraphNodeAtIndexIsRightLedge(i)** | Number | 1 if the i-th node has that ledge flag. |
| **GraphNodeAtIndexIsSlope(i)** | Number | 1 if the i-th node is a slope node. |
| **GraphNodeAtIndexConnectionCount(i)** | Number | Connections leaving the i-th node. |
| **GraphNodeConnectionCount(gx, gy)** | Number | Connections leaving the node at grid coordinates. |
| **GraphNodeConnectionTargetX(gx, gy, i) / GraphNodeConnectionTargetY(gx, gy, i)** | Number | Target position of the i-th connection. |
| **GraphNodeConnectionAction(gx, gy, i)** | String | Action of the i-th connection. |
| **GraphNodeConnectionCost(gx, gy, i)** | Number | Cost of the i-th connection. |
| **NearestGraphNodeX(x, y) / NearestGraphNodeY(x, y)** | Number | World position of the nearest node to a point. |
| **NearestGraphNodeGridX(x, y) / NearestGraphNodeGridY(x, y)** | Number | Grid coordinates of the nearest node. |
| **IsGraphNodeLeftLedge(gx, gy) / IsGraphNodeRightLedge(gx, gy)** | Number | 1 if the node has that ledge flag. |
| **IsGraphNodeIsland(gx, gy)** | Number | 1 if the node is a single-tile island. |
| **IsTileJumpThru(gx, gy)** | Number | 1 if the tile is a jump-thru platform. |
| **PlatformMaxSpeed** | Number | Max speed read from the Platform behavior. |
| **PlatformJumpStrength** | Number | Jump strength read from the Platform behavior. |
| **CalculatedJumpHeight** | Number | Auto-calculated maximum jump height in pixels. |
| **CalculatedJumpDistance** | Number | Auto-calculated maximum jump distance in pixels. |

---

## 15. Triggers Reference

| Trigger | When it fires |
|---|---|
| **On path found** | A path was calculated. With auto-control on, the character is already moving. |
| **On failed to find path** | No path could be found. Check PathFailReason. |
| **On arrived** | The character reached the final destination. |
| **On navigation graph generated** | The graph build finished. Safe to path and add portals. |
| **On waypoint reached** | The character arrived at one waypoint. |
| **On jump toward launched** | JumpTowardPosition fired its jump. |
| **On re-path triggered** | Automatic re-pathing fired due to drift. |
| **On waypoint stuck** | Max Waypoint Time was exceeded; the path was cancelled. |
| **On obstacle map created** | A map grid was created (custom or from layout). |
| **On obstacle map removed** | The obstacle map was cleared. |
| **On Pathfinding map ready** | The Pathfinding behavior's map became available. |
| **On Pathfinding map failed** | Copying the Pathfinding map failed. |
| **On Pathfinding map timeout** | Waiting for the Pathfinding map timed out. |
| **On portal entry** | The character arrived at a portal entry. Call PauseAtPortal here if needed. |
| **On portal complete** | Portal execution finished (teleport done, traversal reached exit, or CompletePortal called). |

---
## 16. System Use Cases

Focused examples that isolate one system at a time. Cross-system combinations live in [Game Use Cases](#17-game-use-cases).

### Graph building

The system that turns level geometry into a navigation graph.

**Zero-event startup.**
Scenario: a new project where you want pathfinding working in under a minute.

```
// Behavior properties: Auto-Build Graph = Auto, Tile Size = 0 (auto)
Event: Every 0.5 seconds
  Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y
```

Note: the first Find path call finishes any in-progress graph build synchronously, so even this single event is safe on tick one.

**Rebuild after level changes.**
Scenario: a destructible wall was just destroyed and routes should open up.

```
Event: Wall -> On destroyed
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  Wall.X, Wall.Y, "Clear"
  Action: Enemy -> PlatformerNavGraph -> RegenerateGraph

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y
```

**Verifying the build.**
Scenario: paths keep failing and you want to see what the graph looks like.

```
Event: On key G pressed
  Action: Enemy -> PlatformerNavGraph -> LogGraphStats
  // Console shows node, connection, ledge, slope, portal, and hazard counts.
  // Node count 0 means the obstacle map is empty or was never built.
```

### Pathfinding and movement

The per-character system that finds and follows routes.

**Choosing a strategy per character.**
Scenario: the same layout hosts a cautious NPC and a reckless enemy.

```
Event: On start of layout
  Action: NPC -> PlatformerNavGraph -> SetPathStrategy  "Safest Route"
  Action: Chaser -> PlatformerNavGraph -> SetPathStrategy  "Shortest Distance"
  // Strategy is per instance even though the graph is shared
```

**Manual movement from path data.**
Scenario: a custom animation state machine needs to own the Platform inputs.

```
// Property: Auto-Control Movement = Off
Event: Every tick
  Condition: NPC -> PlatformerNavGraph -> Is moving along path
  Local var a = NPC.PlatformerNavGraph.CurrentPathAction(NPC.PlatformerNavGraph.CurrentWaypoint)
  Condition: a = "walk_left"
  Action: NPC -> Platform -> Simulate input "Left"
  Condition: a = "jump"
  Action: NPC -> Platform -> Simulate input "Jump"
```

**Recovering from stuck states.**
Scenario: moving platforms occasionally strand a character mid-route.

```
Event: Enemy -> PlatformerNavGraph -> On waypoint stuck
  Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y
  // The stuck trigger cancels the old path; immediately requesting a new one recovers
```

### Portals

The system for connections that normal movement cannot express.

**A locked door.**
Scenario: a door portal exists but should be unusable until the key is found.

```
Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddInstantPortalFromObjects  "Two-way", DoorL, DoorR, 1, "door"
  Set doorId = Enemy.PlatformerNavGraph.LastPortalID
  Action: Enemy -> PlatformerNavGraph -> SetPortalCost  doorId, 9999
  // Cost 9999 means A* will always prefer any other route

Event: On key collected
  Action: Enemy -> PlatformerNavGraph -> SetPortalCost  doorId, 1
```

**Cleaning up a room's portals at once.**
Scenario: leaving a sub-area should remove its four warp pads.

```
Event: On player leaves room A
  Action: Enemy -> PlatformerNavGraph -> RemovePortalsByTag  "room_A"
  // Tags were assigned when the portals were added, e.g. "warp,room_A"
```

**Custom traversal with CompletePortal.**
Scenario: entering a cannon portal should fire the character with your own physics.

```
Event: Enemy -> PlatformerNavGraph -> On portal entry
  Action: Enemy -> PlatformerNavGraph -> PauseAtPortal
  Action: Enemy -> Platform -> Set vector Y  -900   // custom launch

Event: Enemy -> Platform -> On landed
  Condition: Enemy -> PlatformerNavGraph -> Is at portal
  Action: Enemy -> PlatformerNavGraph -> CompletePortal
  // Pathfinding resumes from wherever the custom launch landed
```

### Hazards

The system that biases routes away from danger.

**Temporary area denial.**
Scenario: a bomb explodes and enemies should route around the blast for two seconds.

```
Event: Bomb -> On explosion
  Action: Enemy -> PlatformerNavGraph -> AddCircleHazard  Bomb.X, Bomb.Y, 128, 40
  Set blastId = Enemy.PlatformerNavGraph.HazardCount
  Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y
  Action: Wait 2.0
  Action: Enemy -> PlatformerNavGraph -> ClearAllHazards
```

Note: re-path after adding or clearing hazards so agents pick up the new costs.

**Permanent lava rows.**
Scenario: the bottom row of the level is lava the AI should cross only as a last resort.

```
Event: On start of layout
  Repeat LayoutWidthInTiles times:
    Action: Enemy -> PlatformerNavGraph -> SetTileHazard  LoopIndex, BottomRow, 25
```

### Performance and multi-agent

The system that keeps many agents cheap.

**Budgeting a spawn wave.**
Scenario: thirty enemies spawn at once and all want paths.

```
Event: On start of layout
  Action: AnyGoblin -> PlatformerNavGraph -> SetMaxPathsPerTick  4
  // The wave's requests resolve over about eight ticks instead of one

Event: AnyGoblin spawned
  Action: AnyGoblin -> PlatformerNavGraph -> Find path  Player.X, Player.Y
```

**Spreading a crowd.**
Scenario: agents pile up on the single best route and look robotic.

```
Event: On start of layout
  Action: AnyGoblin -> PlatformerNavGraph -> SetMultiAgentAvoidance  "Enabled"
  // A* now penalizes routes that pass close to other agents
```

---

## 17. Game Use Cases

### 1. Basic chase enemy (zero-event setup)

**Scenario:** A slime that pursues the player across a multi-platform level, set up in one event.

```
// Behavior properties: Auto-Build Graph = Auto, Tile Size = 0
Event: Every 0.5 seconds
  Action: Slime -> PlatformerNavGraph -> Find path  Player.X, Player.Y
```

Auto-control handles all Platform inputs, the graph builds itself on startup, and Nearest mode means the slime always moves as close as it can get. This is the recommended starting point for every project.

### 2. Patrol guard that stays on its platform

**Scenario:** A guard patrols between two markers on a rooftop without wandering off the edge.

```
Event: On start of layout
  Action: Guard -> PlatformerNavGraph -> SetLedgeRestriction  "Enabled"

Event: Guard -> PlatformerNavGraph -> On navigation graph generated
  Action: Guard -> PlatformerNavGraph -> FindPath  PatrolA.X, PatrolA.Y, "Yes", "Reach", "Default"

Event: Guard -> PlatformerNavGraph -> On arrived
  Condition: abs(Guard.X - PatrolA.X) < 32
  Action: Guard -> PlatformerNavGraph -> FindPath  PatrolB.X, PatrolB.Y, "Yes", "Reach", "Default"
  Else
  Action: Guard -> PlatformerNavGraph -> FindPath  PatrolA.X, PatrolA.Y, "Yes", "Reach", "Default"
```

Ledge Restriction guarantees the guard never slides off between markers, even with momentum.

### 3. Escort NPC on the safest route

**Scenario:** A companion follows the player through a dungeon, avoiding jumps when a walk exists.

```
Event: On start of layout
  Action: NPC -> PlatformerNavGraph -> SetPathStrategy  "Safest Route"

Event: Every 0.75 seconds
  Condition: distance(NPC.X, NPC.Y, Player.X, Player.Y) > 64
  Action: NPC -> PlatformerNavGraph -> Find path to object  Player
```

Safest Route makes the NPC walk to stairs and ramps rather than leaping gaps, which reads as careful and natural for a companion.

### 4. Door with an opening animation

**Scenario:** Two rooms connected by a door; AI waits for the door to open before passing through.

```
Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddInstantPortalFromObjects  "Two-way", DoorL, DoorR, 1, "door"
  Set doorPortalId = Enemy.PlatformerNavGraph.LastPortalID

Event: Enemy -> PlatformerNavGraph -> On portal entry
  Condition: Enemy.PlatformerNavGraph.CurrentPortalID = doorPortalId
  Action: Enemy -> PlatformerNavGraph -> PauseAtPortal
  Action: DoorSprite -> PlayAnimation  "Open"

Event: DoorSprite -> On animation "Open" finished
  Action: Enemy -> PlatformerNavGraph -> ResumePortal
  Action: DoorSprite -> PlayAnimation  "Close"
```

### 5. Multi-floor elevator

**Scenario:** A three-floor building served by one elevator shaft.

```
Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift", Floor1Marker, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift", Floor2Marker, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift", Floor3Marker, 80

Event: Every tick
  Condition: Enemy -> PlatformerNavGraph -> Is traversing portal
  Action: ElevatorCar -> Set Y  Enemy.Y

Event: Enemy -> PlatformerNavGraph -> On portal complete
  Action: ElevatorCar -> PlayAnimation  "Arrive"
```

The elevator car sprite simply follows the character during traversal; PortalProgress (0 to 1) can drive cable animations.

### 6. Spike pits and explosion avoidance

**Scenario:** Enemies route around spike pits, and temporarily around explosions.

```
Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  For each SpikeObject:
    Action: Enemy -> PlatformerNavGraph -> AddRectHazard
      SpikeObject.BBoxLeft, SpikeObject.BBoxTop, SpikeObject.Width, SpikeObject.Height, 25

Event: Explosion -> On created
  Action: Enemy -> PlatformerNavGraph -> AddCircleHazard  Explosion.X, Explosion.Y, 128, 50
  Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y
  // Re-path so the new hazard affects the current route
```

### 7. Boss lunge attack

**Scenario:** A boss navigates normally, then leaps at the player when close.

```
Event: Every tick
  Condition: bossState = "chase"
  Condition: distance(Boss.X, Boss.Y, Player.X, Player.Y) <= 200
  Set bossState = "attack"
  Action: Boss -> PlatformerNavGraph -> Stop
  Action: Boss -> PlatformerNavGraph -> JumpTowardPosition  Player.X, Player.Y

Event: Boss -> Platform -> On landed
  Condition: bossState = "attack"
  Set bossState = "chase"
  Action: Boss -> PlatformerNavGraph -> Find path to object  Player
```

### 8. Player-built level with block placement

**Scenario:** A puzzle platformer where placing and removing blocks changes enemy routes.

```
Event: On player places block
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  Block.X, Block.Y, "Solid"
  Action: Enemy -> PlatformerNavGraph -> RegenerateGraph

Event: On player removes block
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  Block.X, Block.Y, "Clear"
  Action: Enemy -> PlatformerNavGraph -> RegenerateGraph

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> Find path  Goal.X, Goal.Y
```

Builds are time-sliced, so even frequent rebuilds do not hitch; the enemy re-paths each time the fresh graph is announced.

### 9. Thirty-goblin wave without frame drops

**Scenario:** A wave spawner drops 30 goblins at once.

```
Event: On start of layout
  Action: AnyGoblin -> PlatformerNavGraph -> SetMaxPathsPerTick  4
  Action: AnyGoblin -> PlatformerNavGraph -> SetMultiAgentAvoidance  "Enabled"

Event: AnyGoblin -> PlatformerNavGraph -> On arrived
  Action: AnyGoblin -> PlatformerNavGraph -> Find path to object  Player
```

One shared graph serves the whole wave; the budget spreads A* over about eight ticks; avoidance fans the goblins across parallel routes.

### 10. Pre-baked navigation for a huge level

**Scenario:** A very large fixed level where scanning at runtime is wasteful.

```
// In a level editor layout:
Event: On "Export nav map" pressed
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> MapSlopeTilesFromTilemap  TilemapWalls, "3", "4", "", ""
  Action: Browser -> LocalStorage.SetItem  "level1", Enemy.PlatformerNavGraph.ObstacleMapJSON

// In the game layout:
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> LoadObstacleMapFromJSON  LocalStorage.GetItem("level1")
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph
```

The JSON carries slopes and tile hazards too, so nothing needs re-registration after loading.

### 11. Custom animation state machine (manual control)

**Scenario:** A character whose animation system must own the Platform inputs.

```
// Property: Auto-Control Movement = Off
Event: Every tick
  Condition: NPC -> PlatformerNavGraph -> Is moving along path
  Local var a = NPC.PlatformerNavGraph.CurrentPathAction(NPC.PlatformerNavGraph.CurrentWaypoint)
  Condition: a = "walk_right"
  Action: NPC -> Platform -> Simulate input "Right"
  Action: NPC -> PlayAnimation  "Run"
  Condition: a = "jump"
  Action: NPC -> Platform -> Simulate input "Jump"
  Action: NPC -> PlayAnimation  "Jump"
```

### 12. Diagnosing a failing path

**Scenario:** On failed to find path keeps firing and you need to know why.

```
Event: Enemy -> PlatformerNavGraph -> On failed to find path
  Action: Browser -> Log  "fail: " & Enemy.PlatformerNavGraph.PathFailReason
  Action: Browser -> Log  "nearest node: " & Enemy.PlatformerNavGraph.NearestGraphNodeX(Enemy.X, Enemy.Y)
    & "," & Enemy.PlatformerNavGraph.NearestGraphNodeY(Enemy.X, Enemy.Y)
  Action: Enemy -> PlatformerNavGraph -> LogGraphStats
```

`no_start_node` means the character is not over walkable ground (use ground correction, or check the spawn position). A node count of 0 in LogGraphStats means the obstacle map never got built.

### 13. Zipline between towers

**Scenario:** A one-way zipline lets enemies descend from the left tower to the right courtyard.

```
Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddGradualPortalFromObjects
    Direction: One-way
    Entry object: ZipTop
    Exit object: ZipBottom
    Cost: 1
    Speed: 260
    Tag: "zipline"

Event: Enemy -> PlatformerNavGraph -> On portal entry
  Condition: Enemy.PlatformerNavGraph.PortalTag(Enemy.PlatformerNavGraph.CurrentPortalID) = "zipline"
  Action: Enemy -> PlayAnimation  "HangGlide"
```

One-way direction matters: A* will use the zipline going down but never try to ride it uphill.

### 14. Fast-travel network with tags

**Scenario:** Warp pads scattered across the level; NPCs use the nearest pad to reach distant goals.

```
Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  For each WarpPad:
    Action: Enemy -> PlatformerNavGraph -> AddInstantPortal
      "Two-way", WarpPad.X, WarpPad.Y, WarpHub.X, WarpHub.Y, 2, "warp"
  // Every pad connects to a central hub, forming a star network

Event: On debug key W pressed
  Action: Browser -> Log  "nearest warp: " & Enemy.PlatformerNavGraph.NearestPortalID(Enemy.X, Enemy.Y, "warp")
```

A* decides on its own whether warping beats walking; you never script the decision.

### 15. Stealth alarm states

**Scenario:** Guards avoid lit zones while patrolling, then rush the player when the alarm trips.

```
Event: On start of layout
  Action: Guard -> PlatformerNavGraph -> SetPathStrategy  "Safest Route"
  For each Lamp:
    Action: Guard -> PlatformerNavGraph -> AddCircleHazard  Lamp.X, Lamp.Y, Lamp.Radius, 12

Event: On alarm triggered
  Action: Guard -> PlatformerNavGraph -> SetPathStrategy  "Shortest Distance"
  Action: Guard -> PlatformerNavGraph -> ClearAllHazards
  Action: Guard -> PlatformerNavGraph -> Find path to object  Player
  // Alarmed guards ignore the light and take the fastest route
```

### 16. Knockback recovery

**Scenario:** Enemies hit by the player's shotgun fly backwards, then resume the chase cleanly.

```
// Property: Re-Path Threshold = 3 (the default)
Event: On enemy hit by blast
  Action: Enemy -> Platform -> Set vector X  BlastDirection * 500
  Action: Enemy -> Platform -> Set vector Y  -200
  // No pathfinding calls needed here

Event: Enemy -> PlatformerNavGraph -> On re-path triggered
  Action: Enemy -> PlayAnimation  "Recover"
```

Automatic re-pathing notices the drift once the enemy lands more than three tiles off route and silently recalculates.

### 17. Locked doors on a metroidvania map

**Scenario:** Door portals exist from the start but open only as the player finds keys.

```
Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddInstantPortalFromObjects  "Two-way", RedDoorL, RedDoorR, 1, "red_door"
  Set redDoorId = Enemy.PlatformerNavGraph.LastPortalID
  Action: Enemy -> PlatformerNavGraph -> SetPortalCost  redDoorId, 9999

Event: On red key collected
  Action: Enemy -> PlatformerNavGraph -> SetPortalCost  redDoorId, 1
  // Companions and enemies can now route through the red door
```

Raising cost instead of removing the portal keeps the ID stable and the toggle trivially reversible.

### 18. Hilly level with slopes

**Scenario:** A countryside level built from 45 degree and gentle slope tiles.

```
// Behavior properties: Auto-Build Graph = Auto
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> MapSlopeTilesFromTilemap
    TilemapGround, "12", "13", "14,15", "16,17"

Event: Every 0.5 seconds
  Action: Enemy -> PlatformerNavGraph -> Find path to object  Player
```

Auto-build scans the tilemap as solid first; the slope registration then converts the slope tiles and triggers a rebuild automatically, so ordering between the two never matters.

### 19. Elite enemy with double jump

**Scenario:** Regular enemies and an elite share a layout, but only the elite's Platform behavior has double jump enabled.

```
// No special events needed. The graph records double-jump connections when built
// by a double-jump-capable instance, and regular enemies automatically skip them.
Event: Every 0.5 seconds
  Action: Elite -> PlatformerNavGraph -> Find path to object  Player
  Action: AnyGrunt -> PlatformerNavGraph -> Find path to object  Player
```

The elite reaches high ledges the grunts route around. Capability filtering is per instance at search time, so one shared graph serves both.

### 20. Boss arena with a burning floor phase

**Scenario:** In phase 2 the arena floor ignites and the boss should keep to the platforms.

```
Event: On phase 2 start
  Repeat ArenaWidthInTiles times:
    Action: Boss -> PlatformerNavGraph -> SetTileHazard  ArenaLeftTile + LoopIndex, FloorRow, 30
  Action: Boss -> PlatformerNavGraph -> Find path to object  Player

Event: On phase 2 end
  Action: Boss -> PlatformerNavGraph -> ClearAllHazardTiles
  Action: Boss -> PlatformerNavGraph -> Find path to object  Player
```

Tile hazards bias rather than block, so the boss will still cross the floor if the player camps an unreachable platform, which prevents the fight from stalling.

### 21. Fleeing enemy that runs from the player

**Scenario:** A wounded enemy turns and runs away from the player, taking real escape routes (jumping gaps, using ramps and platforms) instead of just reversing direction into a wall. There is no built-in flee action; fleeing is ordinary pathfinding toward a point projected away from the threat.

```
Variable: fleeRange = 400    // how far ahead of the enemy the flee target is projected

Event: Every 0.5 seconds
  Condition: Enemy.Health < 25
  Condition: distance(Enemy.X, Enemy.Y, Player.X, Player.Y) < 300
  Local var dir = Enemy.X < Player.X ? -1 : 1
  // Project a target on the far side of the enemy, clamped inside the layout
  Local var targetX = clamp(Enemy.X + dir * fleeRange, 64, LayoutWidth - 64)
  Action: Enemy -> PlatformerNavGraph -> FindPath  targetX, Enemy.Y, "Yes", "Nearest", "Relaxed"
  // Ground correction snaps the projected point onto walkable ground.
  // Nearest mode reaches the best available spot even when the exact point is unreachable.
  // Relaxed positioning trades jump precision for speed, which fits a panicked escape.

Event: Every 0.5 seconds
  Condition: Enemy.Health < 25
  Condition: distance(Enemy.X, Enemy.Y, Player.X, Player.Y) >= 300
  Action: Enemy -> PlatformerNavGraph -> Stop
  Action: Enemy -> PlayAnimation  "Cower"
  // Safe distance reached: stop running until the player closes in again
```

Because the flee target is re-projected every half second, the enemy keeps adjusting as the player pursues, and being cornered resolves itself: when no route continues away from the player, Nearest mode delivers the character to the farthest reachable spot instead of failing.

For smarter fleeing that bends around the player rather than just running opposite, add a temporary circle hazard at the player's position before pathing:

```
Event: Before each flee re-path
  Action: Enemy -> PlatformerNavGraph -> ClearAllHazards
  Action: Enemy -> PlatformerNavGraph -> AddCircleHazard  Player.X, Player.Y, 160, 40
  // A* now penalizes routes that pass near the player, so the escape path
  // naturally curves around them, including on platforms above or below
```

If other systems also use shape hazards, remove only the flee hazard by saved ID instead of calling ClearAllHazards.

**Fleeing to the nearest cover.** Instead of running blindly, the enemy can retreat to designated hiding spots. Place invisible **CoverMarker** sprites at crates, doorways, and alcoves, then pick the best one: the marker closest to the enemy that is also a safe distance from the player, so the enemy never runs past the player to reach it.

```
Variable: coverPicked = 0

Event: Every 0.5 seconds
  Condition: Enemy.Health < 25
  Condition: distance(Enemy.X, Enemy.Y, Player.X, Player.Y) < 300
  Set coverPicked = 0
  // Walk the markers from closest to farthest and take the first safe one
  For each CoverMarker ordered by distance(Enemy.X, Enemy.Y, CoverMarker.X, CoverMarker.Y) ascending
    Condition: coverPicked = 0
    Condition: distance(CoverMarker.X, CoverMarker.Y, Player.X, Player.Y) > 350
    Set coverPicked = 1
    Action: Enemy -> PlatformerNavGraph -> FindPath  CoverMarker.X, CoverMarker.Y, "Yes", "Nearest", "Relaxed"

Event: (same tick, after the loop)
  Condition: coverPicked = 0
  Condition: Enemy.Health < 25
  Condition: distance(Enemy.X, Enemy.Y, Player.X, Player.Y) < 300
  // No safe cover exists: fall back to the projected flee target from above
  Local var dir = Enemy.X < Player.X ? -1 : 1
  Action: Enemy -> PlatformerNavGraph -> FindPath  clamp(Enemy.X + dir * fleeRange, 64, LayoutWidth - 64), Enemy.Y, "Yes", "Nearest", "Relaxed"

Event: Enemy -> PlatformerNavGraph -> On arrived
  Condition: Enemy.Health < 25
  Action: Enemy -> PlayAnimation  "Hide"
  // Arrived at cover: hold position until the player closes in again
```

Ground correction snaps each marker to the nearest walkable node, so markers can sit loosely inside the cover art without tile-perfect placement. The safe-distance check (350 px here) is what stops the enemy from choosing cover on the player's side of the room; combine it with the player-position hazard from above and the route to cover will also curve away from the player on the way there.

### Other game use cases

**Action platformer.** Enemies chase across interconnected platforms and switch stances mid-fight: Balanced pathing to close distance, then JumpTowardPosition for the strike. Player explosions become temporary circle hazards that reroute the rest of the mob.

**Metroidvania.** Doors and fast-travel terminals are portals added to the shared graph as the map opens up. Locked routes are portals with prohibitive cost until the key drops. Companions and roaming enemies inherit every unlock automatically.

**Tower defense.** Dozens of creeps share one graph with per-tick path budgeting and multi-agent avoidance, so waves spawn smoothly and fan out over parallel lanes instead of forming a single conga line.

**Stealth.** Guards patrol with Safest Route and Ledge Restriction, avoid lit hazard zones, and flip to Shortest Distance when the alarm sounds. Light cones become circle hazards that move with the lamps.

**Puzzle platformer.** Every block the player places or removes updates one tile and regenerates the graph, so adversaries visibly react to each solution the player builds.

**Co-op partner AI.** A second-player bot pathfinds with Nearest mode so it never hard-fails, uses Strict Jump Positioning to clear the same pits as the player, and reads NearbyAgentCount to keep out of the player's space.

**Roguelite.** Each generated floor rebuilds the obstacle map from scratch, then exports it to JSON keyed by seed so revisits load instantly. Room-transition portals are placed from the generator's own door list.

**Run-and-gun.** Fast enemies use Shortest Distance and Relaxed jump positioning for aggressive, slightly sloppy pursuit; elites keep Strict positioning so they land trick jumps the fodder cannot.

**Survival horror.** A single stalker enemy uses Nearest mode to relentlessly close in through vents modeled as one-way instant portals, with PauseAtPortal driving crawl-in and crawl-out animations.

**Lemmings-style automation.** Autonomous workers with auto-control walk routes between task markers; Simplest Path keeps their movement predictable enough for the player to plan around.

**Wave defense / horde survival.** Spawners dump mobs on a timer, MaxPathsPerTick keeps A* cost flat, and OnWaypointStuck feeds a cull list for mobs wedged by player-built barricades.

**Boss rush.** Each boss reuses the same arena graph with a different strategy preset and jump override, so movement personality changes per boss with three actions of configuration.

**Dungeon crawler.** Multi-floor towers use elevator groups for the lift shafts and door portals between rooms; enemies chase the player across floors without any floor-management events.

**Escort mission.** The VIP walks Safest Route with Ledge Restriction on, pausing when the player falls behind (distance check gates the Find path calls) and hazards keep them out of turret arcs.

**Speedrun rival ghost.** An AI rival races the player using Shortest Distance, coyote time, and Relaxed positioning, taking risky jump-falls a human speedrunner would attempt.

**Farming and village sims.** Villagers path between homes, fields, and shops on a shared graph; doors are instant portals with entry pauses that play open animations, and the whole town shares one build.

**Zombie survival.** Hordes use avoidance to spread around barricades, fall-through connections to drop through one-way floors, and hazard zones around fire keep them shambling along flanking routes.

**Brawler with arenas.** Enemies keep to platforms with Ledge Restriction while approaching, then disable it and lunge when in range, mixing safe navigation with committed attacks.

**Tactics-lite auto battler.** Units walk to assigned lane markers using Simplest Path so their approach is legible; portals model deployment tubes that drop units into the arena.

**Sandbox physics game.** Player contraptions add and remove solid tiles constantly; time-sliced rebuilds absorb the churn, and creatures re-path from OnGraphGenerated so they always respect the latest contraption.

**Mining and digging game.** Every dug tile is a SetTileState "Clear" plus a periodic RegenerateGraph, letting cave creatures flow into freshly opened tunnels toward the player.

**Metroid-style boss minions.** A boss spawns minions that use the boss's own graph instantly (shared mode), each with a different strategy preset so the pack approaches from multiple angles at once.

---
## 18. C3 Debugger

Run a debug preview (the bug icon, or F5 with debugging) and select your character. The behavior adds five sections to the inspector.

**Navigation Graph**

| Field | What it means |
|---|---|
| `generated` | True once the graph is built. False means Find path will fail. |
| `nodes` | Walkable node count. A very low count usually means a misconfigured obstacle map. |
| `gridSize` | Grid dimensions in tiles, e.g. `40x24`. Should match layout size divided by tile size. |
| `obstacleSource` | Where the map came from: `pathfinding`, `custom`, `collision`, or `none`. |

**Pathfinding**

| Field | What it means |
|---|---|
| `hasPath` | True while following a path. |
| `waypoint` | Current index out of total, e.g. `2/7`. |
| `action` | The current waypoint's action (`walk_right`, `jump`, `fall`, ...). |
| `pathCost` | Cost of the current path; useful for comparing strategies. |
| `failReason` | Why the last path failed. Empty on success. |
| `target` | World position of the current path target. |

**Movement**

| Field | What it means |
|---|---|
| `coyoteTimer` | Non-zero right after leaving a ledge with coyote time set. |
| `velocityX` | Estimated horizontal velocity. |
| `waypointTime` | Seconds on the current waypoint. Climbing toward Max Waypoint Time means the character is stuck. |

**Portals**

| Field | What it means |
|---|---|
| `portalCount` | Portals registered in the graph. |
| `portalState` | `none`, `paused`, or `traversing`. |
| `currentPortalId` | Portal being executed. |
| `traverseProgress` | Gradual traversal progress as a percentage. |
| `elevatorGroups` | Number of named elevator groups. |

**Settings**

| Field | What it means |
|---|---|
| `cellSize` | The tile size the graph was built with (the resolved value when Tile Size is auto). |
| `maxJumpHeight` / `maxJumpDistance` / `maxFallDistance` | The physics limits the graph was built with, in pixels. |
| `debug` | Whether console logging is on. |
| `platformBehavior` | `found` or `not found`. Not found means no movement is possible. |
| `pathfindingBehavior` | `found` or `not found`. Only matters for the Pathfinding map source. |

---

## 19. Scripting (C3 Script / JavaScript)

Every action, condition, and expression is exposed to scripting, so the full API works from C3 Script with no event sheet bridges. Triggers are not callable functions; you subscribe to them with the behavior's `on()` method instead.

### Accessing the behavior

Use `inst.behaviors.YourBehaviorName`, where the name is what the behavior is called in your project's Properties panel (not the addon ID). The default name is `PlatformerNavigationGraph`.

```js
const nav = inst.behaviors.PlatformerNavigationGraph;
// If you renamed it in the editor: const nav = inst.behaviors.Nav;
```

### Calling actions

Method names are **PascalCase**, taken from the ACE names: the Find path action is `FindPathTo()`, the advanced one is `FindPath()`. Calling them from script has exactly the same side effects as the event sheet actions, because the same function is attached to the behavior.

```js
nav.FindPathTo(player.x, player.y);          // simple: ground correction + nearest mode
nav.FindPathToObject(runtime.objects.Player); // takes an object class
nav.FindPath(x, y, 1, 1, 0);                  // advanced: see the combo table below

nav.SetCoyoteTime(0.15);
nav.SetLedgeLeniency(8);
nav.SetMaxPathsPerTick(4);
nav.JumpTowardPosition(player.x, player.y);
nav.RegenerateGraph();
nav.StopPathfinding();
```

**Combo parameters** arrive as 0-based indices (the order shown in the editor dropdown). String keys also work.

| Action | Combo parameter | Index meaning |
|---|---|---|
| `FindPath(x, y, correct, mode, positioning)` | `correct` | 0 = No, 1 = Yes |
| | `mode` | 0 = Reach, 1 = Nearest |
| | `positioning` | 0 = Default, 1 = Strict, 2 = Relaxed |
| `SetAutoControl(enabled)` | `enabled` | 0 = Enabled, 1 = Disabled |
| `SetStrictJumpPositioning(enabled)` | `enabled` | 0 = Enabled, 1 = Disabled |
| `SetLedgeRestriction(enabled)` | `enabled` | 0 = Enabled, 1 = Disabled |
| `SetMultiAgentAvoidance(enabled)` | `enabled` | 0 = Enabled, 1 = Disabled |
| `SetPathStrategy(strategy)` | `strategy` | 0 = balanced, 1 = shortest, 2 = safest, 3 = simplest |
| `UsePathfindingObstacleMap(autoRegen)` | `autoRegen` | 0 = Yes, 1 = No |

String keys: `nav.SetPathStrategy("safest")`, `nav.FindPath(x, y, "yes", "nearest", "default")`.

### Checking conditions

Exposed conditions return booleans:

```js
if (nav.HasPath()) { /* actively following a path */ }
if (nav.IsAtLedge()) { /* standing at a platform edge */ }
if (nav.IsPositionHazardous(inst.x, inst.y)) { /* inside a hazard */ }
if (nav.IsTraversingPortal()) { /* riding a gradual portal */ }
if (nav.IsPathPending()) { /* request queued behind the per-tick budget */ }
```

### Reading values

Exposed expressions become methods returning numbers or strings:

```js
const idx    = nav.CurrentWaypoint();
const action = nav.CurrentPathAction(idx);   // "walk_left", "jump", ...
const cost   = nav.PathCost();
const reason = nav.PathFailReason();

const nodes  = nav.GraphNodeCount();
const source = nav.ObstacleMapSource();       // "pathfinding", "custom", "collision"
const tile   = nav.GridTileSize();            // resolved tile size when auto

const portalId = nav.CurrentPortalID();
const progress = nav.PortalProgress();        // 0 to 1 during gradual traversal
```

### Listening to triggers

Subscribe with the behavior's **`on(tag, callback, options)`** method. The tag is the trigger's internal name (see the table). `off(tag, callback)` removes a listener, and `{ once: true }` auto-removes after the first fire.

```js
nav.on("OnGraphGenerated", () => {
  // Safe to add portals and start pathing
  nav.FindPathTo(player.x, player.y);
});

nav.on("OnPathFailed", () => console.warn("path failed:", nav.PathFailReason()));
nav.on("OnPathComplete", () => nav.FindPathToObject(runtime.objects.Player));
nav.on("OnWaypointStuck", () => nav.FindPathTo(player.x, player.y));

nav.on("OnPortalEntry", () => {
  nav.PauseAtPortal();
  // play a door animation, then:
  setTimeout(() => nav.ResumePortal(), 400);
});
```

| Event tag | Fires when |
|---|---|
| `"OnPathFound"` | A path was calculated |
| `"OnPathFailed"` | No path was found |
| `"OnPathComplete"` | Final destination reached |
| `"OnGraphGenerated"` | Graph built and ready |
| `"OnWaypointReached"` | One waypoint reached |
| `"OnJumpTowardLaunched"` | JumpTowardPosition fired |
| `"OnRePathTriggered"` | Automatic re-path fired |
| `"OnWaypointStuck"` | Waypoint timeout hit |
| `"OnObstacleMapCreated"` / `"OnObstacleMapRemoved"` | Map created / cleared |
| `"OnPathfindingMapReady"` / `"OnPathfindingMapFailed"` / `"OnPathfindingMapTimeout"` | Pathfinding map lifecycle |
| `"OnPortalEntry"` / `"OnPortalComplete"` | Portal lifecycle |

### Looping over waypoints

```js
for (let i = 0, n = nav.WaypointCount(); i < n; i++) {
  console.log(i, nav.CurrentPathAction(i),
    Math.round(nav.WaypointX(i)), Math.round(nav.WaypointY(i)));
}
```

### A complete example

```js
// EnemyAI.js, attached to an Enemy instance
const runtime = this.runtime;
const inst    = this.instance;
const nav     = inst.behaviors.PlatformerNavigationGraph;

nav.SetPathStrategy("safest");
nav.SetRePathThreshold(3);
nav.SetMaxPathsPerTick(4);

const chase = () => nav.FindPathToObject(runtime.objects.Player);

nav.on("OnGraphGenerated", () => {
  const entry = runtime.objects.DoorEntry.getFirstInstance();
  const exit  = runtime.objects.DoorExit.getFirstInstance();
  if (entry && exit) nav.AddInstantPortal(1, entry.x, entry.y, exit.x, exit.y, 1, "door");
  chase();
});

nav.on("OnPathComplete",  chase);
nav.on("OnWaypointStuck", chase);
nav.on("OnPathFailed",    () => setTimeout(chase, 1000));

nav.on("OnWaypointReached", () => {
  const a = nav.CurrentPathAction(nav.CurrentWaypoint());
  if (a === "jump") inst.setAnimation("Jump");
  else if (a.includes("fall")) inst.setAnimation("Fall");
  else if (a.includes("walk")) inst.setAnimation("Run");
});

nav.on("OnPortalEntry", () => {
  nav.PauseAtPortal();
  const door = runtime.objects.DoorSprite.getFirstInstance();
  if (door) {
    door.setAnimation("Open");
    door.addEventListener("animationend", () => nav.ResumePortal(), { once: true });
  } else {
    nav.ResumePortal();
  }
});
```

With Auto-Build Graph set in the editor, no map setup call is needed here; add `nav.UsePathfindingObstacleMap(0)` for the manual flow.

---

## 20. Tips and Common Mistakes

- **Tile Size must match your grid.** The default is 32 px; if your tilemap or Pathfinding Cell Size differs, set Tile Size to match or set it to 0 to auto-detect. A mismatch misaligns the whole graph, and characters walk into walls.

- **Add portals after `On navigation graph generated`.** Portals connect to graph nodes, so they need a graph to connect to. Registered portals survive rebuilds automatically, but adding one before any graph exists logs a warning and does nothing.

- **`PauseAtPortal` only works inside `On portal entry`.** Anywhere else it is intentionally ignored, so a stray call cannot wedge the portal state machine.

- **Slope tiles must be registered.** Unregistered slopes read as solid to walking and as air to the jump arc check, so jumps clip through them. With Debug Logging on, unregistered tile IDs are listed in the console during slope mapping. Registration order does not matter; the graph rebuilds itself when slopes arrive late.

- **Regenerate after tile changes.** `SetTileState` and `SetTileStateWorld` update the map but not the graph (slope states are the one exception). Follow map edits with `RegenerateGraph`.

- **Graph builds are asynchronous by design.** Large maps build across several ticks. Wait for `On navigation graph generated`, or simply call a Find path action, which finishes any in-progress build synchronously before searching.

- **`no_start_node` means the character is not over walkable ground.** Use ground correction (the simple Find path has it on by default), or check that the character did not spawn inside geometry or mid-air over a pit.

- **Ledge Restriction and Coyote Time cancel each other.** Coyote jumps require walking off an edge; ledge restriction prevents exactly that. Enable at most one of the two per character.

- **`ClearAllPortals` also wipes elevator groups.** For selective cleanup prefer `RemovePortal` by ID or `RemovePortalsByTag`, and give portals tags when you add them.

- **Turn off Enable Debug Logging for release builds.** Console output is expensive, particularly on mobile, and the property defaults to on for development convenience.

- **Auto-Build Graph defaults to Auto so the addon works the moment it is added.** Explicit setup actions in On start of layout always take precedence, so event-driven projects keep working unchanged. Set it to Off if your project builds its map later than layout start (for example after multi-frame procedural generation).
