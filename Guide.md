# Platformer Navigation Graph

Smart pathfinding for platformer games. Add this behavior to any character and it automatically builds a navigation graph from your level geometry, calculates routes that involve jumping across gaps, falling between platforms, and walking up slopes, then drives the Platform behavior to follow those routes. You get full AI navigation — including portals (teleporters, elevators, ziplines), hazard avoidance, multi-agent support, and four path strategies — without writing a single movement formula yourself. Just add the behavior, point it at a target, and the character moves.

---

## Table of Contents

1. [Core Concepts](#1-core-concepts)
2. [Project Setup](#2-project-setup)
3. [Behavior Properties](#3-behavior-properties)
4. [Obstacle Maps — Giving the Graph Level Data](#4-obstacle-maps--giving-the-graph-level-data)
5. [Finding Paths and Reacting to Results](#5-finding-paths-and-reacting-to-results)
6. [Movement Control](#6-movement-control)
7. [Slopes](#7-slopes)
8. [Portals — Doors, Elevators, and Ziplines](#8-portals--doors-elevators-and-ziplines)
9. [Hazards — Danger Zone Avoidance](#9-hazards--danger-zone-avoidance)
10. [Multi-Agent Support](#10-multi-agent-support)
11. [Performance Tuning](#11-performance-tuning)
12. [Actions Reference](#12-actions-reference)
13. [Conditions Reference](#13-conditions-reference)
14. [Expressions Reference](#14-expressions-reference)
15. [Triggers Reference](#15-triggers-reference)
16. [Game Use Cases](#16-game-use-cases)
17. [C3 Debugger](#17-c3-debugger)
18. [Tips and Common Mistakes](#18-tips-and-common-mistakes)

---

## 1. Core Concepts

### The problem this addon solves

Making an AI character navigate a platformer level is hard. The character needs to know which tiles are solid, where the edges of platforms are, which gaps can be jumped, which drops are safe, and how to chain all of those movements into a coherent route. Doing that by hand means writing jump arc math, ledge detection, path smoothing, and re-pathing logic — all before you can even start on game content.

Platformer Navigation Graph automates all of that. On startup it scans your level geometry, builds a graph of every walkable position and every possible connection between them (walk, jump, fall, coyote jump, slope walk, portal), and uses A* to find optimal routes through that graph. Every frame it reads the current waypoint action and pushes the right inputs to the Platform behavior so the character actually follows the path.

### Key design decisions

**The behavior attaches to characters, not the level.** Add it to every sprite that needs AI movement. Each instance manages its own current path and movement state. The underlying navigation graph — the expensive part — is shared across all instances on the same layout, so building it once serves all your enemies, NPCs, and companions.

**The graph is built once and reused.** Graph generation is intentionally a one-time explicit action (`Generate navigation graph` or `Use Pathfinding obstacle map`). The addon does not continuously re-scan the level. If you modify the level at runtime, call `Regenerate navigation graph` to rebuild.

**Auto-control vs. manual control.** By default (`Auto-Control Movement = On`) the behavior drives the Platform behavior directly — you just call `Find path` and the character moves. When disabled, the behavior still calculates paths and exposes waypoint data via expressions, but you write the movement code yourself. This is useful for custom animation state machines or when you want fine-grained control over physics.

**Jump parameters are auto-detected.** On the first tick the behavior reads `maxSpeed`, `jumpStrength`, and `gravity` from the attached Platform behavior and calculates `maxJumpHeight`, `maxJumpDistance`, and `maxFallDistance` automatically. You can override these with the Configuration actions if your character has unusual physics.

### Key concepts at a glance

| Term | What it means |
|---|---|
| **Navigation graph** | A map of every walkable tile position (node) and every movement a character can make between them (connection). Built once from the obstacle map. |
| **Obstacle map** | A grid of tile states (solid, clear, jump-thru, slope, avoid) that the graph builder reads. Can come from the Pathfinding behavior or be built manually. |
| **Node** | A single walkable position in the graph, located one tile above a solid or jump-thru surface. |
| **Waypoint** | One step in a calculated path. Each waypoint has a world position and an action (`walk_left`, `jump`, `fall`, `portal_instant`, etc.). |
| **Portal** | A shortcut connection in the graph. Instant portals teleport; gradual portals move the character at a set speed (elevators, ziplines). |
| **Hazard** | A marked danger area (circle, rect, or tile) that increases the pathfinding cost of nearby tiles so the AI avoids them when possible. |

### Scenarios where this addon excels

- **Chase enemies** — A goblin that chases the player up staircases, jumps across gaps, and falls through one-way platforms to cut them off. No manual movement code needed.
- **Escort NPCs** — A companion who follows the player through a multi-level dungeon, taking the same route without getting stuck on ledges or in corners.
- **Patrol guards** — Guards that walk a route between marked points, respecting ledge restrictions so they never accidentally walk off a rooftop.
- **Stealth game AI** — Guards that avoid marked hazard zones (lit areas, laser tripwires) and take the safest route around danger using the Safest Route strategy.
- **Tower defense creeps** — Waves of enemies that all share the same navigation graph and find their way to the exit through a complex multi-tiered map.
- **Boss movement** — A boss that navigates toward the player and uses `JumpTowardPosition` for lunge attacks independently of pathfinding.
- **Elevators and doors** — Any multi-floor level where characters need to use elevators, warp pads, or locked doors as part of their route, set up with portal connections.

---

## 2. Project Setup

### Step 1 — Add the behavior

Select your character sprite (or enemy object). In the Properties panel, click **Add behavior** and choose **Platformer Navigation Graph**. The character also needs the built-in **Platform** behavior. The addon finds Platform automatically — it searches the attached behaviors by type name.

### Step 2 — Set Tile Size

In the behavior properties, set **Tile Size** to match the **Cell Size** in your Pathfinding behavior (or the tile size of your tilemap). This is critical. If these values do not match, the graph will be misaligned with your level geometry and characters will try to walk through walls.

### Step 3 — Give the graph level data

The simplest approach uses the built-in Pathfinding behavior as the obstacle map source. This requires a Pathfinding behavior on any object in your layout.

```
Event: On start of layout
  Action: [Character] PlatformerNavGraph -> UsePathfindingObstacleMap "Yes (auto-regenerate)"
  // Waits for Pathfinding to finish building its map, then generates the nav graph automatically

Event: [Character] PlatformerNavGraph -> On navigation graph generated
  Action: [Character] PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Reach", "Default"
  // Graph is ready — start pathfinding immediately
```

Alternatively, if you do not use the Pathfinding behavior, build the obstacle map from your solid objects:

```
Event: On start of layout
  Action: [Character] PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: [Character] PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapSolid
  Action: [Character] PlatformerNavGraph -> ScanJumpThruObjectsIntoObstacleMap  TilemapPlatforms
  Action: [Character] PlatformerNavGraph -> GenerateNavigationGraph
  // Graph is built synchronously — can pathfind immediately after

Event: [Character] PlatformerNavGraph -> On navigation graph generated
  Action: [Character] PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Reach", "Default"
```

### Step 4 — Find a path

Once the graph is generated, call `Find path` whenever the target moves significantly or the character needs a new destination.

```
Event: Every 0.5 seconds
  Condition: [Character] PlatformerNavGraph -> Has active path  (inverted: NO active path)
  Action: [Character] PlatformerNavGraph -> FindPath  Player.X, Player.Y, "No", "Nearest", "Default"
  // Re-path toward the player every half second when idle
```

That is the full basic setup. With **Auto-Control** enabled (the default), the character starts moving immediately after `On path found` fires.

---

## 3. Behavior Properties

| Property | Type | Default | Description |
|---|---|---|---|
| **Enable Debug Logging** | Boolean | On | Logs graph stats, path results, and movement decisions to the browser console (F12). Disable in final builds for better performance. |
| **Tile Size** | Integer (8–128) | 32 | Grid resolution in pixels. Must match the Cell Size of your Pathfinding behavior or tilemap tile size. |
| **Max Search Nodes** | Integer (100–10000) | 2000 | How many graph nodes A* is allowed to visit before giving up. Increase for large open levels; decrease for performance on simple maps. |
| **Max Fall Distance** | Integer | 0 | Maximum safe fall in pixels. `0` = auto-detect from Platform behavior physics. `-1` = unlimited. Positive value = explicit override in pixels. |
| **Auto-Control Movement** | Boolean | On | When on, the behavior drives the Platform behavior automatically. When off, path data is exposed via expressions for manual movement. |
| **Graph Mode** | Combo | Shared | `Shared` = all instances on the layout use one graph (recommended). `Per-Instance` = each character has its own graph (rare). |
| **Path Strategy** | Combo | Balanced | How the AI picks between multiple valid routes. See [Movement Control](#6-movement-control) for details. |
| **Smooth Paths** | Boolean | On | Removes redundant waypoints so characters take direct routes instead of zigzagging between tile centres. |
| **Max Waypoint Time** | Float (1–30) | 5.0 | Seconds before the behavior gives up on a waypoint and fires `On waypoint stuck`. Prevents infinite loops when geometry changes. |
| **Coyote Time** | Float (0–1) | 0 | Seconds after walking off a ledge where the AI can still jump. Only effective when Ledge Restriction is disabled. |
| **Strict Jump Positioning** | Boolean | On | When on, the character slows down and precisely positions itself before each jump or fall departure. Prevents missed jumps over pits. |
| **Ledge Restriction** | Boolean | Off | When on, the character will not walk off platform edges unless the path specifically requires it. Good for patrol guards. |
| **Ledge Leniency** | Float (0–64) | 0 | Pixels past a ledge edge the character can walk before stopping. Only applies when Ledge Restriction is on. |
| **Re-Path Threshold** | Float (0–20) | 3.0 | Tiles of drift from the path before automatic re-pathing fires. `0` = disabled. |
| **Hazard Radius** | Integer (0–10) | 2 | Tile radius of cost falloff around each hazard. Tiles within this radius receive increased pathfinding cost even if not directly overlapping the hazard. |

---

## 4. Obstacle Maps — Giving the Graph Level Data

The navigation graph needs to know which tiles are solid, which are one-way platforms, and which are slopes. This information comes from an **obstacle map** — a grid of tile states the addon reads before building the graph. There are two ways to provide one.

### Using the Pathfinding behavior (easiest)

If your layout already uses Construct's built-in Pathfinding behavior, use `UsePathfindingObstacleMap`. The addon waits for Pathfinding to finish its async map build, then copies the data.

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> UsePathfindingObstacleMap  "Yes (auto-regenerate)"
  // With auto-regenerate enabled, the graph rebuilds whenever the Pathfinding map changes
```

Triggers related to this flow:

- **On Pathfinding map ready** — Pathfinding finished; graph generation is about to start.
- **On Pathfinding map timeout** — Pathfinding took too long; useful for error handling.
- **On navigation graph generated** — Graph is built and ready for `FindPath`.

### Building the map from solid objects (no Pathfinding behavior)

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> ScanJumpThruObjectsIntoObstacleMap  TilemapPlatforms
  Action: Enemy -> PlatformerNavGraph -> MapSlopeTilesFromTilemap  TilemapWalls, "3,4", "5,6", "", ""
  // Tile IDs 3 and 4 are 45° left slopes; 5 and 6 are 45° right slopes
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph
```

Tilemaps are scanned cell-by-cell for accurate geometry. Sprites are rasterized by bounding box. Objects must have the Solid or Jump-thru behavior enabled — the addon checks `isEnabled` so temporarily disabled platforms are correctly ignored.

### Setting individual tiles

For procedurally generated levels or runtime tile changes:

```
Event: On button pressed (toggle wall)
  Action: Enemy -> PlatformerNavGraph -> SetTileState  WallTile.GridX, WallTile.GridY, "Solid"
  Action: Enemy -> PlatformerNavGraph -> RegenerateGraph
  // Always regenerate after changing the obstacle map

Event: On lava tile created
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  Lava.X, Lava.Y, "Avoid"
  // "Avoid" tiles are walkable but get a high pathfinding cost penalty
```

### Saving and loading obstacle maps

For large levels with fixed geometry, build the map at design time, export it, and reload it at runtime to skip the scan:

```
Event: On button "Export map" pressed
  Action: Browser -> LocalStorage.SetItem("navmap", Enemy.PlatformerNavGraph.ObstacleMapJSON)

Event: On start of layout
  Condition: Browser -> LocalStorage.HasItem("navmap")
  Action: Enemy -> PlatformerNavGraph -> LoadObstacleMapFromJSON  LocalStorage.GetItem("navmap")
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph
```

---

## 5. Finding Paths and Reacting to Results

### FindPath

`FindPath` is the main action. It calculates a path from the character's current position to the target and, when auto-control is on, immediately starts following it.

```
Action: Enemy -> PlatformerNavGraph -> FindPath
  X: Player.X
  Y: Player.Y
  Correct to ground: Yes       // snaps target to nearest walkable tile
  Mode: Reach                  // "Reach" fails if no path; "Nearest" always succeeds
  Jump positioning: Default    // uses the property setting
```

**Correct to ground** is useful when the player might be mid-jump. It snaps the target Y down to the nearest solid tile below, so the path ends at a reachable standing position.

**Nearest mode** never fires `On path failed`. Instead it finds the closest reachable node and paths to it. Use this for follow behavior where "get as close as possible" is always acceptable.

**Jump positioning override** lets you change precision per-path without touching the property. Use `Strict` for paths crossing narrow bridges or pits; use `Relaxed` for chase sequences where speed matters more than precision.

### Reacting to path results

```
Event: Enemy -> PlatformerNavGraph -> On path found
  Action: Enemy -> PlayAnimation -> "Run"
  // Path was calculated; character is now moving (auto-control) or path data is ready (manual)

Event: Enemy -> PlatformerNavGraph -> On path failed
  Action: Enemy -> PlayAnimation -> "Idle"
  Action: Enemy -> PlatformerNavGraph -> SetVariable "lastFailReason" -> Enemy.PlatformerNavGraph.PathFailReason
  // Common fail reasons: "no_start_node", "no_goal_node", "max_nodes_reached", "no_path"

Event: Enemy -> PlatformerNavGraph -> On path complete
  Action: Enemy -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"
  // Arrived at destination — immediately re-path to keep chasing
```

### Monitoring waypoints

```
Event: Enemy -> PlatformerNavGraph -> On waypoint reached
  Condition: Enemy.PlatformerNavGraph.CurrentPathAction(Enemy.PlatformerNavGraph.CurrentWaypoint) = "jump"
  Action: Enemy -> PlayAnimation -> "Jump"
  // Trigger jump animation specifically when a jump waypoint is reached

Event: Enemy -> PlatformerNavGraph -> On waypoint stuck
  Action: Enemy -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"
  // Character timed out on a waypoint — repath
```

The action string for each waypoint is one of: `walk_left`, `walk_right`, `jump`, `fall`, `fall_left`, `fall_right`, `coyote_jump`, `fall_through`, `portal_instant`, `portal_gradual`.

### Jump toward position (lunge attacks)

`JumpTowardPosition` is independent of pathfinding — it makes the character immediately jump toward a target regardless of the nav graph.

```
Event: Enemy is overlapping AttackRange
  Condition: Enemy -> PlatformerNavGraph -> Platform behavior is enabled
  Action: Enemy -> PlatformerNavGraph -> JumpTowardPosition  Player.X, Player.Y

Event: Enemy -> PlatformerNavGraph -> On jump toward launched
  Action: Enemy -> PlayAnimation -> "Attack"
  // Use JumpTowardTargetX/Y expressions for damage check
```

---

## 6. Movement Control

### Auto-control vs. manual control

When **Auto-Control Movement** is on, the behavior reads the current waypoint every frame, decides whether to walk left/right, jump, or fall, and sets Platform behavior inputs accordingly. You only need to call `FindPath` and respond to triggers.

When auto-control is off, you manage movement yourself. Use the path data expressions to drive your own state machine:

```
Event: Every tick
  Condition: Enemy -> PlatformerNavGraph -> Has active path
  Local variable currentAction = Enemy.PlatformerNavGraph.CurrentPathAction(Enemy.PlatformerNavGraph.CurrentWaypoint)
  Condition: currentAction = "walk_right"
  Action: Enemy -> Platform -> Simulate input "Right"
```

Toggle auto-control at runtime to switch between AI and manual control:

```
Event: On player collision with enemy
  Action: Enemy -> PlatformerNavGraph -> SetAutoControl  "Disabled"
  Action: Enemy -> Platform -> SetVectorX  -300   // knockback
  // Restore auto-control after knockback resolves
```

### Path strategies

The **Path Strategy** property controls how the A* search weighs movement costs. Change it per-character or switch it at runtime with `SetPathStrategy`.

| Strategy | Behaviour | Best for |
|---|---|---|
| **Balanced** | Weighs distance and movement difficulty equally | Most games — the sensible default |
| **Shortest Distance** | Minimises total path length, including risky jumps | Speedrunners, time trials, aggressive enemies |
| **Safest Route** | Strongly prefers walking over jumping or falling | Stealth NPCs, escort targets, fragile characters |
| **Simplest Path** | Minimises waypoint count for predictable movement | Tower defense creeps, simple patrol enemies |

```
Event: Boss enters phase 2
  Action: Boss -> PlatformerNavGraph -> SetPathStrategy  "Shortest Distance"
  // Boss becomes more aggressive — takes fastest route regardless of risk
```

### Ledge restriction and leniency

**Ledge Restriction** prevents casual wandering off platform edges. Use it for patrol guards that should stay on their platform.

```
Event: On start of layout
  Action: Guard -> PlatformerNavGraph -> SetLedgeRestriction  "Enabled"
  Action: Guard -> PlatformerNavGraph -> SetLedgeLeniency  8
  // Guard stops 8 px past the ledge edge, giving slightly natural-looking movement
```

Note: Ledge Restriction does not prevent path-required falls. If the path needs the character to fall to reach a goal, it will still fall. It only stops aimless edge-walking.

When Ledge Restriction is **disabled**, the AI can walk to the very edge of a platform — which also enables **wall-adjacent jumps**, where the character walks flush to a wall before jumping to clear it. Coyote Time is only useful with Ledge Restriction off.

### Strict jump positioning

**Strict Jump Positioning** makes the character slow down and precisely centre on the departure tile before each jump or fall. This prevents missed jumps caused by the character being slightly off-position when the jump fires.

```
Event: Enemy reaches patrol point near pit
  Action: Enemy -> PlatformerNavGraph -> SetStrictJumpPositioning  "Enabled"

Event: Boss enters rage mode
  Action: Boss -> PlatformerNavGraph -> SetStrictJumpPositioning  "Disabled"
  // In rage mode, boss takes risks — may overshoot ledges but moves faster
```

You can also override this per-path in `FindPath`'s Jump Positioning parameter without changing the global setting.

### Coyote time

Coyote time allows the AI to jump for a short window after walking off a ledge, making slightly out-of-reach platforms accessible. Set it only when Ledge Restriction is disabled.

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> SetCoyoteTime  0.15
  // 150ms coyote window — AI can walk to the edge of a platform before jumping
```

### Re-pathing

The behavior monitors the character's distance from its current path. If it drifts beyond the **Re-Path Threshold**, it automatically recalculates. This handles knockback, physics interactions, and other disturbances.

```
Event: PlatformerNavGraph -> On re-path triggered
  Action: Enemy -> PlayAnimation -> "Confused"
  // Optional feedback when automatic re-path fires
```

Set the threshold to `0` to disable automatic re-pathing entirely (useful when you want full control over when re-paths happen).

---

## 7. Slopes

The navigation graph understands 45° slopes (`/` and `\`) and 22.5° gentle slopes. Slope nodes are connected with walk-type actions at Euclidean distance cost, so A* naturally prefers walking a slope over jumping if the slope is cheaper.

### Registering slopes

Slopes must be declared to the obstacle map. The easiest way is `MapSlopeTilesFromTilemap`, which scans the tilemap and marks matching tile IDs as slopes:

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> MapSlopeTilesFromTilemap
    Tilemap: TilemapWalls
    Slope left IDs:       "3"       // tile 3 is a 45° / slope
    Slope right IDs:      "4"       // tile 4 is a 45° \ slope
    Gentle left IDs:      "5,6"     // tiles 5 and 6 are 22.5° gentle left slopes
    Gentle right IDs:     "7,8"     // tiles 7 and 8 are 22.5° gentle right slopes
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph
```

Tile IDs are the same IDs you use in the Tilemap object editor. Pass empty string `""` for any slope type you do not have.

You can also mark individual tiles or rectangular regions:

```
Action: Enemy -> PlatformerNavGraph -> SetTileState  5, 3, "Slope left /"
Action: Enemy -> PlatformerNavGraph -> MarkSlopeRegion  2, 8, 6, 4, "Slope right \"
```

### What happens if slope tiles are not registered

Unregistered slope tiles appear as `obstacleMap=0` (clear) to the arc checker, so jumps can pass straight through the solid slope body. Enable Debug Logging — the console will list all unregistered tile IDs encountered during graph generation with example cell positions.

---

## 8. Portals — Doors, Elevators, and Ziplines

A **portal** is a shortcut connection in the navigation graph that moves a character from an entry point to an exit point in a way the graph cannot describe with normal jump/fall arcs. There are two types:

- **Instant portals** — The character teleports immediately from entry to exit. Use for doors, warp pads, teleporters.
- **Gradual portals** — The character moves linearly from entry to exit at a set speed. Platform behavior is disabled during traversal. Use for elevators, lifts, ropes, ziplines.

### Adding portals

Always add portals after the graph is generated. Portals inject connections directly into the node graph.

```
Event: PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddInstantPortalFromObjects
    Direction: One-way
    Entry object: DoorEntry
    Exit object: DoorExit
    Cost: 1

  Action: Enemy -> PlatformerNavGraph -> AddGradualPortalFromObjects
    Direction: Two-way
    Entry object: ElevatorBottom
    Exit object: ElevatorTop
    Cost: 1
    Speed: 80
  // Save the portal ID: Enemy.PlatformerNavGraph.LastPortalID
```

The `LastPortalID` expression returns the ID of the most recently added portal. Save it to a variable if you need to modify or remove it later.

### Elevator groups

For multi-floor elevators (more than two stops), use `AddElevatorStop`. Stops within the same group are automatically connected pairwise with two-way gradual portals:

```
Event: PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift_A", FloorMarker1, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift_A", FloorMarker2, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift_A", FloorMarker3, 80
  // Creates 3 pairwise portals: Floor1↔Floor2, Floor1↔Floor3, Floor2↔Floor3
```

Use `PortalExitX` / `PortalExitY` inside `On portal entry` to know which floor the character is heading to:

```
Event: Enemy -> PlatformerNavGraph -> On portal entry
  Condition: Enemy.PlatformerNavGraph.PortalExitY < 300
  Action: Enemy -> PlayAnimation -> "LiftUp"
  Else
  Action: Enemy -> PlayAnimation -> "LiftDown"
```

### Pausing at portals for custom transitions

`PauseAtPortal` stops the character at the entry point before the portal executes. Use this to play animations, open doors, trigger screen transitions, or run any events that need to happen before movement.

```
Event: Enemy -> PlatformerNavGraph -> On portal entry
  Action: Enemy -> PlatformerNavGraph -> PauseAtPortal
  // Character waits here
  Action: DoorSprite -> PlayAnimation -> "Open"

Event: DoorSprite -> On animation "Open" complete
  Action: Enemy -> PlatformerNavGraph -> ResumePortal
  // NOW the built-in portal movement executes (teleport or gradual move)
```

`PauseAtPortal` must be called from inside `On portal entry` — it has no effect elsewhere.

After pausing, you have two options:

- **`ResumePortal`** — Execute the portal's built-in behavior (teleport or gradual move to exit).
- **`CompletePortal`** — Mark the portal as finished without built-in movement. Use when you've already moved the character yourself (custom physics launch, animation-driven movement, etc.).

```
Event: Enemy -> PlatformerNavGraph -> On portal entry
  Action: Enemy -> PlatformerNavGraph -> PauseAtPortal
  Action: Enemy -> PlatformerNavGraph -> TeleportToPosition  PortalExit.X, PortalExit.Y
  Action: Enemy -> PlayAnimation -> "Teleport"
  // After animation, call CompletePortal to resume navigation

Event: Enemy -> On animation "Teleport" complete
  Action: Enemy -> PlatformerNavGraph -> CompletePortal
```

### Tracking gradual portal traversal

```
Event: Every tick
  Condition: Enemy -> PlatformerNavGraph -> Is traversing portal
  Action: ElevatorCar -> Set Y -> Enemy.Y
  // Move elevator sprite to match character during lift traversal
  // Enemy.PlatformerNavGraph.PortalProgress returns 0-1

Event: Enemy -> PlatformerNavGraph -> On portal complete
  Action: ElevatorCar -> PlayAnimation -> "Arrive"
```

### Modifying and removing portals

```
Action: Enemy -> PlatformerNavGraph -> SetPortalCost  myPortalId, 999
// Make a portal effectively unusable without removing it

Action: Enemy -> PlatformerNavGraph -> RemovePortalAtObject  DoorEntry
// Remove portal closest to this object — works for both entry and exit objects

Action: Enemy -> PlatformerNavGraph -> ClearAllPortals
// Remove everything when switching layout
```

---

## 9. Hazards — Danger Zone Avoidance

**Hazards** raise the pathfinding cost of tiles so the AI prefers routes that avoid them. The AI will still path through hazards if there is no safer route — hazards bias the path, they do not hard-block it.

Hazard avoidance is automatically enabled when the first hazard is added. The **Hazard Radius** property controls how far the cost penalty spreads around each hazard.

### Adding hazards

```
Event: On spike trap activated
  Action: Enemy -> PlatformerNavGraph -> AddRectHazard
    X: SpikeTrap.X,  Y: SpikeTrap.Y
    Width: SpikeTrap.Width,  Height: SpikeTrap.Height
    Severity: 20
  Set variable spikeHazardId = Enemy.PlatformerNavGraph.LastPortalID
  // ↑ actually use HazardCount — hazard IDs are returned via a different mechanism

Event: On explosion
  Action: Enemy -> PlatformerNavGraph -> AddCircleHazard
    X: Explosion.X,  Y: Explosion.Y,  Radius: 96,  Severity: 30
  // High severity = AI strongly avoids this area

Event: On spike trap deactivated
  Action: Enemy -> PlatformerNavGraph -> ClearAllHazards
  // Or RemoveHazard with the saved ID
```

### Tile-based hazards

For static permanent danger (lava pits, poison gas), mark tiles directly in the obstacle map:

```
Action: Enemy -> PlatformerNavGraph -> SetTileHazard  5, 12, 15
// Tile (5,12) has severity 15 — AI will route around it when possible
```

Clear tile hazards separately from shape hazards:

```
Action: Enemy -> PlatformerNavGraph -> ClearAllHazardTiles   // clears tile-based hazards only
Action: Enemy -> PlatformerNavGraph -> ClearAllHazards        // clears circle/rect hazards only
```

### Querying hazard state

```
Condition: Enemy.PlatformerNavGraph.IsPositionHazardous(Target.X, Target.Y)
// True if target is inside any hazard area — use to warn player or pick alternative target

Expression: Enemy.PlatformerNavGraph.HazardSeverity(x, y)
// Total severity at a position from all sources — use to drive visual effects
```

---

## 10. Multi-Agent Support

When **Graph Mode** is `Shared` (the default), all character instances on the same layout read from the same navigation graph. Building the graph once serves all agents, so you can have 50+ enemies with no per-agent graph cost.

### Path calculation scheduling

When many agents all need paths on the same tick, use `SetMaxPathsPerTick` to spread the work across frames:

```
Event: On start of layout
  Action: AnyEnemy -> PlatformerNavGraph -> SetMaxPathsPerTick  5
  // Only 5 path calculations per tick — rest are queued and processed in following ticks

Condition: AnyEnemy -> PlatformerNavGraph -> Path is pending
// True while an agent is waiting in the queue
// Use to display a "calculating..." state or delay AI decision-making
```

### Multi-agent avoidance

When enabled, agents share their positions through a spatial hash so they can factor in paths already taken by other agents.

```
Event: On start of layout
  Action: AnyEnemy -> PlatformerNavGraph -> SetMultiAgentAvoidance  "Enabled"

Expression: AnyEnemy.PlatformerNavGraph.NearbyAgentCount
// Number of agents near this character — use to spread them out or trigger crowd logic
```

Multi-agent avoidance requires **Graph Mode = Shared**.

---

## 11. Performance Tuning

### Graph generation cost

Graph generation is the most expensive operation. It happens once per layout (in Shared mode) and its cost scales with the number of tiles in your level.

- Keep **Tile Size** as large as your art style allows. A 64px tile size produces a graph 4× smaller than 32px.
- Set **Max Search Nodes** no higher than necessary. For small levels, 500–1000 is sufficient.
- Build obstacle maps from saved JSON (`LoadObstacleMapFromJSON`) rather than scanning at runtime for large fixed levels.

### Per-tick path budget

```
Event: On start of layout
  Action: AnyEnemy -> PlatformerNavGraph -> SetMaxPathsPerTick  3
  // For 20 enemies, paths are spread over ~7 ticks maximum
```

### Monitoring the queue

```
Expression: AnyEnemy.PlatformerNavGraph.PathQueueSize
// Current number of pending path requests — useful for a debug HUD
```

---

## 12. Actions Reference

### Pathfinding

| Action | Description |
|---|---|
| **FindPath** X, Y, CorrectToGround, Mode, JumpPositioning | Calculate a path to the target position. CorrectToGround snaps the target to solid ground below. Mode "Nearest" never fails. |
| **StopPathfinding** | Immediately stop the character and clear the active path. |
| **JumpTowardPosition** X, Y | Launch the character directly toward the target with a full jump. Not pathfinding — used for lunges and attacks. |
| **RegenerateGraph** | Rebuild the entire navigation graph from the current obstacle map. Use after level changes. |
| **SetAutoControl** Enabled | Toggle whether the behavior drives the Platform behavior automatically. |
| **SetCoyoteTime** Seconds | Set the jump window in seconds after walking off a ledge. |
| **SetStrictJumpPositioning** Enabled | Toggle careful pre-jump positioning for this character. |
| **SetLedgeRestriction** Enabled | Toggle whether the character stops at platform edges. |
| **SetLedgeLeniency** Pixels | Set how far past the ledge edge the character can walk (requires Ledge Restriction on). |
| **SetRePathCooldown** Seconds | Set minimum time between automatic re-path attempts. |
| **SetPathStrategy** Strategy | Change the path weighting: Balanced, Shortest Distance, Safest Route, Simplest Path. |

### ObstacleMap

| Action | Description |
|---|---|
| **BuildObstacleMapFromLayout** Width, Height | Create an empty grid from layout pixel dimensions. Call before scanning objects. |
| **ScanSolidObjectsIntoObstacleMap** Objects | Mark solid objects (tilemaps or sprites with Solid behavior) into the obstacle map. |
| **ScanJumpThruObjectsIntoObstacleMap** Objects | Mark one-way platforms (Jump-thru behavior) into the obstacle map. |
| **SetTileState** GridX, GridY, State | Set a single tile's state: Solid, Clear, Jump-thru, Avoid, or a slope type. |
| **SetTileStateWorld** X, Y, State | Same as above using world pixel coordinates. |
| **MarkSlopeRegion** StartX, StartY, EndX, EndY, Direction | Mark a diagonal region of tiles as a specific slope type. |
| **MapSlopeTilesFromTilemap** Tilemap, LeftIDs, RightIDs, GentleLeftIDs, GentleRightIDs | Scan a tilemap and mark matching tile IDs as slopes. Pass comma-separated ID strings. |
| **SetTileHazard** GridX, GridY, Severity | Set the danger level of a specific tile. 0 = no hazard. |
| **ClearObstacleMap** | Remove the obstacle map and all associated data. |
| **LoadObstacleMapFromJSON** JSON | Restore a previously saved obstacle map from a JSON string. |
| **GenerateNodesFromCustomMap** | Build the navigation graph from the current obstacle map. Call this after setup. |
| **UsePathfindingObstacleMap** AutoRegen | Copy the obstacle map from the Pathfinding behavior. Auto-regen rebuilds the graph when the Pathfinding map changes. |
| **ClearAllSlopes** | Remove all slope markings from the obstacle map. |
| **SetRePathThreshold** Tiles | Set how many tiles of drift trigger automatic re-pathing. |
| **SetHazardRadius** Tiles | Set the cost falloff radius around each hazard. |
| **CreateCustomObstacleMap** Width, Height | Create an empty obstacle map with explicit tile dimensions. |

### Hazards

| Action | Description |
|---|---|
| **AddRectHazard** X, Y, Width, Height, Severity | Mark a rectangular area as dangerous. AI avoids it proportional to severity. |
| **AddCircleHazard** X, Y, Radius, Severity | Mark a circular area as dangerous. Use for explosions, AOE effects. |
| **RemoveHazard** ID | Remove a specific shape hazard by its ID. |
| **ClearAllHazards** | Remove all circle and rectangle hazards. Does not clear tile hazards. |
| **ClearAllHazardTiles** | Reset all tile hazard severities. Does not remove circle/rect hazards. |

### Portals

| Action | Description |
|---|---|
| **AddInstantPortal** Direction, EntryX, EntryY, ExitX, ExitY, Cost | Add a teleportation portal using world coordinates. |
| **AddInstantPortalFromObjects** Direction, EntryObj, ExitObj, Cost | Add a teleportation portal using object positions. |
| **AddGradualPortal** Direction, EntryX, EntryY, ExitX, ExitY, Cost, Speed | Add a linear-movement portal using world coordinates. |
| **AddGradualPortalFromObjects** Direction, EntryObj, ExitObj, Cost, Speed | Add a linear-movement portal using object positions. |
| **RemovePortal** ID | Remove a portal by its ID. |
| **RemovePortalAtObject** Object | Remove the portal whose entry or exit is closest to this object. |
| **SetPortalCost** ID, Cost | Change a portal's pathfinding cost. Lower = preferred. |
| **SetPortalSpeed** ID, Speed | Change a gradual portal's traversal speed in pixels per second. |
| **SetPortalIgnoreHazards** ID, Ignore | Set whether this portal ignores nearby hazards when costing its connection. |
| **PauseAtPortal** | Pause before portal execution (call inside On portal entry only). |
| **ResumePortal** | Execute the portal's built-in movement after pausing. |
| **CompletePortal** | Finish a portal without built-in movement (you've moved the character yourself). |
| **TeleportToPosition** X, Y | Instantly move the character to a position. Suppresses re-pathing for one tick. |
| **AddElevatorStop** GroupID, X, Y, Speed | Add a stop to an elevator group; auto-creates pairwise portals with existing stops. |
| **AddElevatorStopFromObject** GroupID, Object, Speed | Same as AddElevatorStop using an object's position. |
| **ClearAllPortals** | Remove all portals from the navigation graph. |

### Configuration

| Action | Description |
|---|---|
| **SetMaxJumpHeight** Pixels | Override the auto-detected maximum jump height. Regenerate graph after. |
| **SetMaxJumpDistance** Pixels | Override the auto-detected maximum horizontal jump distance. Regenerate graph after. |
| **SetMaxFallDistance** Pixels | Override the auto-detected maximum fall distance. Regenerate graph after. |

### Performance

| Action | Description |
|---|---|
| **SetMaxPathsPerTick** Count | Limit path calculations per tick. 0 = unlimited. Use with many agents to prevent frame drops. |

### GraphData

| Action | Description |
|---|---|
| **LogGraphStats** | Print detailed graph statistics to the browser console. |

### SharedNavigation

| Action | Description |
|---|---|
| **SetMultiAgentAvoidance** Enabled | Enable or disable multi-agent path avoidance. Shared graph mode only. |

---

## 13. Conditions Reference

| Condition | Description |
|---|---|
| **Has active path** | True while the character is following a path. |
| **Is platform enabled** | True if the attached Platform behavior is currently active. |
| **Is at ledge** | True when the character is standing on a ledge node (platform edge). |
| **Is at island** | True when the character is on a single-tile isolated platform. |
| **Node exists at grid position** GridX, GridY | True if a navigation node exists at these grid coordinates. |
| **Node exists at world position** X, Y | True if a navigation node exists at this world position. |
| **Is at portal** | True when paused at a portal entry (after PauseAtPortal, before Resume/Complete). |
| **Is traversing portal** | True while moving through a gradual portal. Platform behavior is disabled. |
| **Tile has state** GridX, GridY, State | True if the tile at grid coordinates has the specified state. |
| **Tile has state at world position** X, Y, State | Same as above using world coordinates. |
| **Is setting up Pathfinding** | True while waiting for the Pathfinding behavior to finish its async map build. |
| **Is position hazardous** X, Y | True if any hazard (circle, rect, or tile) affects this world position. |
| **Is node at ledge** GridX, GridY | True if the node at these grid coordinates is a left or right ledge. |
| **Is multi-agent avoidance enabled** | True if multi-agent avoidance is active. |
| **Path is pending** | True when a path request is queued (time-slicing budget was reached). |

---

## 14. Expressions Reference

### Pathfinding

| Expression | Returns | Description |
|---|---|---|
| **WaypointCount** | Number | Total waypoints in the current path. 0 if no path. |
| **CurrentWaypoint** | Number | Index of the waypoint currently being approached. -1 if no path. |
| **NodeCount** | Number | Total navigation nodes in the generated graph. |
| **CurrentWaypointX** | Number | World X of the current waypoint. |
| **CurrentWaypointY** | Number | World Y of the current waypoint. |
| **WaypointX(index)** | Number | World X of a waypoint by index. Centred within tile. |
| **WaypointY(index)** | Number | World Y of a waypoint by index. Centred within tile. |
| **WaypointGridX(index)** | Number | Grid X of a waypoint by index. |
| **WaypointGridY(index)** | Number | Grid Y of a waypoint by index. |
| **NodeWorldX(gx, gy)** | Number | World X of the node at grid coordinates. |
| **NodeWorldY(gx, gy)** | Number | World Y of the node at grid coordinates. |
| **PathFailReason** | String | Last failure reason: `no_start_node`, `no_goal_node`, `max_nodes_reached`, `no_path`, or empty. |
| **PathCost** | Number | Total calculated cost of the current path. |
| **PathTargetX(type)** | Number | Path target X. Pass `"original"` or `"corrected"`. |
| **PathTargetY(type)** | Number | Path target Y. Pass `"original"` or `"corrected"`. |
| **PathTargetGridX** | Number | Path target grid X. |
| **PathTargetGridY** | Number | Path target grid Y. |
| **AngleToWaypoint** | Number | Angle in degrees from the character to the current waypoint. |
| **DistanceToWaypoint** | Number | Pixel distance to the current waypoint. |
| **CurrentPathAction(index)** | String | Action name for a waypoint by index (`walk_left`, `jump`, `fall`, `portal_instant`, etc.). |
| **EstimatedVelocityX** | Number | Estimated horizontal velocity needed to follow the current path. |
| **StoppingDistance** | Number | Calculated stopping distance based on current Platform speed. |
| **CoyoteTime** | Number | Current coyote time setting in seconds. |
| **CoyoteTimer** | Number | Current coyote timer countdown value. |
| **StrictJumpPositioning** | Number | 1 if strict positioning is active; 0 if not. |
| **LedgeRestriction** | Number | 1 if ledge restriction is enabled; 0 if not. |
| **LedgeLeniency** | Number | Current ledge leniency in pixels. |
| **JumpTowardTargetX** | Number | X position of the jump-toward target. Valid during jump-toward mode. |
| **JumpTowardTargetY** | Number | Y position of the jump-toward target. |
| **PathStrategy** | String | Current path strategy name (`balanced`, `shortest`, `safest`, `simplest`). |

### ObstacleMap

| Expression | Returns | Description |
|---|---|---|
| **ObstacleMapJSON** | String | The current obstacle map as a JSON string. |
| **ObstacleMapSource** | String | Source of the current map: `custom`, `pathfinding`, or `none`. |
| **GridWidth** | Number | Obstacle map width in tiles. |
| **GridHeight** | Number | Obstacle map height in tiles. |
| **GridTileSize** | Number | Tile size in pixels. |
| **TileState(gx, gy)** | String | State of a tile: `solid`, `clear`, `jump-thru`, `avoid`, `slope-left`, `slope-right`, or empty. |
| **SlopeDirection(gx, gy)** | String | Slope direction of a tile: `left`, `right`, or empty. |
| **WorldToGridX(x)** | Number | Convert world X to grid X. |
| **WorldToGridY(y)** | Number | Convert world Y to grid Y. |
| **WaitTickCount** | Number | Ticks spent waiting for Pathfinding map init. Debug use. |
| **HazardRadius** | Number | Current hazard radius in tiles. |
| **RePathThreshold** | Number | Current re-path threshold in tiles. |
| **RePathCooldown** | Number | Current re-path cooldown in seconds. |

### Hazards

| Expression | Returns | Description |
|---|---|---|
| **HazardCount** | Number | Total active shape hazards (circles and rects). |
| **PositionIsHazardous(x, y)** | Number | 1 if position is hazardous, 0 if safe. |
| **HazardSeverity(x, y)** | Number | Total severity at a world position from all sources. |
| **TileHazardSeverity(gx, gy)** | Number | Tile-only hazard severity at grid coordinates. |

### Portals

| Expression | Returns | Description |
|---|---|---|
| **PortalCount** | Number | Total portals in the navigation graph. |
| **LastPortalID** | Number | ID of the most recently added portal. Read immediately after adding. |
| **CurrentPortalID** | Number | ID of the portal currently being processed (valid inside portal triggers). |
| **PortalProgress** | Number | Gradual portal traversal progress (0–1). 0 when not traversing. |
| **PortalExitX** | Number | Exit X of the current portal. Valid inside portal triggers. |
| **PortalExitY** | Number | Exit Y of the current portal. Valid inside portal triggers. |
| **PortalType(portalId)** | String | Returns `instant` or `gradual` for the given portal ID. |

### GraphData

| Expression | Returns | Description |
|---|---|---|
| **NodeAtIndexX(i)** | Number | World X of the i-th node in the graph array. |
| **NodeAtIndexY(i)** | Number | World Y of the i-th node. |
| **NodeAtIndexGridX(i)** | Number | Grid X of the i-th node. |
| **NodeAtIndexGridY(i)** | Number | Grid Y of the i-th node. |
| **NodeAtIndexIsLeftLedge(i)** | Number | 1 if the i-th node is a left ledge. |
| **NodeAtIndexIsRightLedge(i)** | Number | 1 if the i-th node is a right ledge. |
| **NodeAtIndexIsSlope(i)** | Number | 1 if the i-th node is on a slope. |
| **NodeAtIndexConnectionCount(i)** | Number | Number of connections from the i-th node. |
| **NodeConnectionCount(gx, gy)** | Number | Connections from the node at grid coordinates. |
| **NodeConnectionTargetX(gx, gy, i)** | Number | World X of the i-th connection's target. |
| **NodeConnectionTargetY(gx, gy, i)** | Number | World Y of the i-th connection's target. |
| **NodeConnectionAction(gx, gy, i)** | String | Action name of the i-th connection (`walk`, `jump`, `fall`, etc.). |
| **NodeConnectionCost(gx, gy, i)** | Number | Pathfinding cost of the i-th connection. |
| **NearestNodeX(x, y)** | Number | World X of the nearest node to a world position. |
| **NearestNodeY(x, y)** | Number | World Y of the nearest node to a world position. |
| **NearestNodeGridX(x, y)** | Number | Grid X of the nearest node. |
| **NearestNodeGridY(x, y)** | Number | Grid Y of the nearest node. |
| **IsNodeLeftLedge(gx, gy)** | Number | 1 if the node is a left ledge. |
| **IsNodeRightLedge(gx, gy)** | Number | 1 if the node is a right ledge. |
| **IsNodeIsland(gx, gy)** | Number | 1 if the node is an island (single-tile platform). |
| **IsTileJumpThru(gx, gy)** | Number | 1 if the tile is a jump-thru platform. |

### SharedNavigation

| Expression | Returns | Description |
|---|---|---|
| **NearbyAgentCount** | Number | Agents within detection range (multi-agent avoidance must be enabled). |

### Performance

| Expression | Returns | Description |
|---|---|---|
| **MaxPathsPerTick** | Number | Current per-tick path budget. 0 = unlimited. |
| **PathQueueSize** | Number | Pending path requests in the queue. |

### Debug

| Expression | Returns | Description |
|---|---|---|
| **PlatformMaxSpeed** | Number | Max speed read from the Platform behavior. |
| **PlatformJumpStrength** | Number | Jump strength read from the Platform behavior. |
| **CalculatedJumpHeight** | Number | Auto-calculated maximum jump height in pixels. |
| **CalculatedJumpDistance** | Number | Auto-calculated maximum horizontal jump distance in pixels. |

---

## 15. Triggers Reference

| Trigger | When it fires |
|---|---|
| **On path found** | A path was successfully calculated. Character starts moving (auto-control on). |
| **On path failed** | No path could be found. Check `PathFailReason` to diagnose. |
| **On path complete** | Character reached the final destination. |
| **On navigation graph generated** | Graph build finished. Safe to call `FindPath` or add portals. |
| **On waypoint reached** | Character arrived at one waypoint along the path. |
| **On jump toward launched** | The `JumpTowardPosition` action fired. |
| **On re-path triggered** | Automatic re-pathing fired because the character drifted too far. |
| **On waypoint stuck** | Character exceeded `Max Waypoint Time` at a waypoint. Path is cancelled. |
| **On obstacle map created** | A custom obstacle map was successfully created. |
| **On obstacle map removed** | The obstacle map was cleared or removed. |
| **On Pathfinding map ready** | The Pathfinding behavior finished its async map build. |
| **On Pathfinding map failed** | Pathfinding map initialisation failed. |
| **On Pathfinding map timeout** | Waiting for Pathfinding map timed out. |
| **On portal entry** | Character arrived at a portal entry. Call `PauseAtPortal` here if needed. |
| **On portal complete** | Portal execution finished (teleport completed, gradual traversal reached exit, or `CompletePortal` called). |

---

## 16. Game Use Cases

### 1. Basic enemy that chases the player

**Scenario:** A slime enemy that continuously navigates toward the player across a multi-platform level.

```
Event: On start of layout
  Action: Slime -> PlatformerNavGraph -> UsePathfindingObstacleMap  "Yes"

Event: Slime -> PlatformerNavGraph -> On navigation graph generated
  Action: Slime -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"

Event: Slime -> PlatformerNavGraph -> On path complete
  Action: Slime -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"

Event: Slime -> PlatformerNavGraph -> On path failed
  Action: Wait  1.0
  Action: Slime -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"
```

No movement code needed. Auto-control handles all Platform inputs. The `On path complete` loop keeps the slime chasing even if the player is stationary.

---

### 2. Patrol guard that stays on its platform

**Scenario:** A guard patrols between two points on a rooftop without wandering off the edge.

```
Event: On start of layout
  Action: Guard -> PlatformerNavGraph -> UsePathfindingObstacleMap  "Yes"
  Action: Guard -> PlatformerNavGraph -> SetLedgeRestriction  "Enabled"

Event: Guard -> PlatformerNavGraph -> On navigation graph generated
  Action: Guard -> PlatformerNavGraph -> FindPath  PatrolPoint1.X, PatrolPoint1.Y, "Yes", "Reach", "Default"

Event: Guard -> PlatformerNavGraph -> On path complete
  Condition: Guard.PathTargetX("original") = PatrolPoint1.X  (approximately)
  Action: Guard -> PlatformerNavGraph -> FindPath  PatrolPoint2.X, PatrolPoint2.Y, "Yes", "Reach", "Default"
  Else
  Action: Guard -> PlatformerNavGraph -> FindPath  PatrolPoint1.X, PatrolPoint1.Y, "Yes", "Reach", "Default"
```

Ledge Restriction ensures the guard never slides off the platform between patrol points.

---

### 3. Escort NPC on Safest Route

**Scenario:** An NPC companion follows the player through a dungeon and tries to avoid jumping when possible.

```
Event: On start of layout
  Action: NPC -> PlatformerNavGraph -> UsePathfindingObstacleMap  "Yes"
  Action: NPC -> PlatformerNavGraph -> SetPathStrategy  "Safest Route"

Event: Every 0.75 seconds
  Condition: Distance(NPC.X, NPC.Y, Player.X, Player.Y) > 64
  Action: NPC -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"
```

Safest Route means the NPC prefers to walk to stairs or elevators rather than jumping across gaps — more natural for a companion character.

---

### 4. Level with a door portal

**Scenario:** Two rooms connected by a door. AI characters navigate between rooms using the door.

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddInstantPortalFromObjects  "Two-way", DoorLeft, DoorRight, 1
  Local var doorPortalId = Enemy.PlatformerNavGraph.LastPortalID
  Action: Enemy -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Reach", "Default"

// Play door animation before teleporting
Event: Enemy -> PlatformerNavGraph -> On portal entry
  Condition: Enemy.PlatformerNavGraph.CurrentPortalID = doorPortalId
  Action: Enemy -> PlatformerNavGraph -> PauseAtPortal
  Action: DoorSprite -> PlayAnimation  "Open"

Event: DoorSprite -> On animation "Open" complete
  Action: Enemy -> PlatformerNavGraph -> ResumePortal
  Action: DoorSprite -> PlayAnimation  "Close"
```

---

### 5. Multi-floor elevator

**Scenario:** A building with three floors connected by a single elevator shaft.

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> UsePathfindingObstacleMap  "Yes"

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "main_lift", Floor1Marker, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "main_lift", Floor2Marker, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "main_lift", Floor3Marker, 80
  // Automatically creates 3 pairwise portals between all floors
  Action: Enemy -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"

Event: Enemy -> PlatformerNavGraph -> On portal entry
  Action: ElevatorSprite -> SetY  Enemy.Y
  Action: ElevatorSprite -> SetVisible  true

Event: Every tick
  Condition: Enemy -> PlatformerNavGraph -> Is traversing portal
  Action: ElevatorSprite -> Set Y  Enemy.Y
  // Elevator car follows the character

Event: Enemy -> PlatformerNavGraph -> On portal complete
  Action: ElevatorSprite -> SetVisible  false
```

---

### 6. Hazard avoidance — spikes and explosions

**Scenario:** Enemies avoid spike pits in the floor and flee from explosion zones.

```
Event: On start of layout
  // Mark spike rows as hazards after graph is generated
  Action: Enemy -> PlatformerNavGraph -> UsePathfindingObstacleMap  "Yes"

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  // Mark all SpikeObject instances as hazards
  For each SpikeObject:
    Action: Enemy -> PlatformerNavGraph -> AddRectHazard
      SpikeObject.X, SpikeObject.Y, SpikeObject.Width, SpikeObject.Height, 25
  Action: Enemy -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"

Event: Explosion -> On created
  Action: Enemy -> PlatformerNavGraph -> AddCircleHazard  Explosion.X, Explosion.Y, 128, 50
  Set explosionHazardId = Enemy.PlatformerNavGraph.HazardCount  // approximate tracking
  Action: Enemy -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"
  // Re-path to avoid the new explosion zone

Event: Explosion -> On destroyed
  Action: Enemy -> PlatformerNavGraph -> ClearAllHazards
  // Rebuild hazard state — simpler than tracking IDs for dynamic explosions
  // Re-add static spike hazards, then re-path
```

---

### 7. Boss lunge attack with JumpTowardPosition

**Scenario:** A boss that navigates to the player normally, then launches a jump attack when close.

```
Variable: bossState = "chase"

Event: Every tick
  Condition: bossState = "chase"
  Condition: Distance(Boss.X, Boss.Y, Player.X, Player.Y) <= 200
  Action: Set bossState = "attack"
  Action: Boss -> PlatformerNavGraph -> StopPathfinding
  Action: Boss -> PlatformerNavGraph -> JumpTowardPosition  Player.X, Player.Y

Event: Boss -> PlatformerNavGraph -> On jump toward launched
  Action: Boss -> PlayAnimation  "LungeAttack"

Event: Boss -> Platform -> On landed
  Condition: bossState = "attack"
  Action: Set bossState = "chase"
  Action: Boss -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"
```

---

### 8. Procedural level — runtime obstacle changes

**Scenario:** A puzzle platformer where the player can place/remove solid blocks. Enemies must re-navigate after each change.

```
Event: On player places block
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  PlacedBlock.X, PlacedBlock.Y, "Solid"
  Action: Enemy -> PlatformerNavGraph -> RegenerateGraph

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> FindPath  GoalMarker.X, GoalMarker.Y, "Yes", "Reach", "Default"
  // Re-path after each rebuild to use the updated graph

Event: On player removes block
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  RemovedBlock.X, RemovedBlock.Y, "Clear"
  Action: Enemy -> PlatformerNavGraph -> RegenerateGraph
```

Tip: Regenerating the graph is synchronous in Shared mode — all agents get the new graph on the same tick.

---

### 9. 20+ enemies with time-sliced pathfinding

**Scenario:** A wave of 30 goblins spawning simultaneously without dropping frames.

```
Event: On start of layout
  Action: AnyGoblin -> PlatformerNavGraph -> UsePathfindingObstacleMap  "Yes"
  Action: AnyGoblin -> PlatformerNavGraph -> SetMaxPathsPerTick  4
  // Max 4 A* calculations per tick — 30 goblins resolved over ~8 ticks

Event: AnyGoblin -> PlatformerNavGraph -> On navigation graph generated
  // All goblins share the same graph — generated once for the group
  For each GoblinObject:
    Action: GoblinObject -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"

Event: AnyGoblin -> PlatformerNavGraph -> On path complete
  Action: AnyGoblin -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Nearest", "Default"
```

Enable multi-agent avoidance to prevent all 30 from stacking on the same path:

```
Event: On start of layout
  Action: AnyGoblin -> PlatformerNavGraph -> SetMultiAgentAvoidance  "Enabled"
```

---

### 10. Saving and loading the obstacle map

**Scenario:** A large fixed level where scanning takes too long. Pre-scan, save, and reload.

```
// In your Level Editor layout:
Event: On "Export nav map" button pressed
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> ScanJumpThruObjectsIntoObstacleMap  TilemapPlatforms
  Action: Browser -> LocalStorage.SetItem  "level1_navmap", Enemy.PlatformerNavGraph.ObstacleMapJSON

// In the game layout at runtime:
Event: On start of layout
  Condition: Browser -> LocalStorage.HasItem("level1_navmap")
  Action: Enemy -> PlatformerNavGraph -> LoadObstacleMapFromJSON  LocalStorage.GetItem("level1_navmap")
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph
  Else
  // Fallback: build from scratch
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> GenerateNavigationGraph
```

---

### 11. Custom movement with auto-control off

**Scenario:** A character with a custom animation state machine where you want nav graph routes but manual Platform inputs.

```
Event: On start of layout
  Action: NPC -> PlatformerNavGraph -> SetAutoControl  "Disabled"
  Action: NPC -> PlatformerNavGraph -> UsePathfindingObstacleMap  "Yes"

Event: NPC -> PlatformerNavGraph -> On navigation graph generated
  Action: NPC -> PlatformerNavGraph -> FindPath  Target.X, Target.Y, "Yes", "Reach", "Default"

Variable: npcAction = ""

Event: NPC -> PlatformerNavGraph -> On path found
  Set npcAction = NPC.PlatformerNavGraph.CurrentPathAction(NPC.PlatformerNavGraph.CurrentWaypoint)

Event: Every tick
  Condition: npcAction = "walk_right"
  Action: NPC -> Platform -> Simulate input "Right"
  Condition: npcAction = "jump"
  Action: NPC -> Platform -> Simulate input "Jump"
  Action: NPC -> PlayAnimation  "Jump"
```

---

### 12. Debugging a path that fails unexpectedly

**Scenario:** `On path failed` fires and `PathFailReason = "no_start_node"`. The enemy is stuck.

```
Event: Enemy -> PlatformerNavGraph -> On path failed
  Action: Browser -> Log  "Path fail: " & Enemy.PlatformerNavGraph.PathFailReason
  Action: Browser -> Log  "Enemy pos: " & Enemy.X & "," & Enemy.Y
  Action: Browser -> Log  "Nearest node: " & Enemy.PlatformerNavGraph.NearestNodeX(Enemy.X, Enemy.Y)
    & "," & Enemy.PlatformerNavGraph.NearestNodeY(Enemy.X, Enemy.Y)
  // If nearest node is far away, enemy is in a gap — use ground correction in FindPath
  Action: Enemy -> PlatformerNavGraph -> FindPath  Enemy.X, Enemy.Y+32, "Yes", "Nearest", "Default"
  // Try with ground correction enabled
```

Also call `LogGraphStats` to see how many nodes and connections were generated — a node count of 0 means the obstacle map was empty or never built.

---

## 17. C3 Debugger

Press **F12** during a preview to open the Construct 3 Debugger. Select the character object and find the PlatformerNavGraph sections in the properties panel.

### Sections and fields

**Navigation Graph**

| Field | What it means |
|---|---|
| `generated` | True if the graph has been built. False means `FindPath` will always fail. |
| `nodes` | Number of walkable nodes. Low count (< 10) usually means the obstacle map is misconfigured. |
| `gridSize` | Grid dimensions in tiles (e.g. `40x24`). Should match layout / tile size. |
| `obstacleSource` | Where the obstacle map came from: `pathfinding`, `custom`, `collision`, or `none`. |

**Pathfinding**

| Field | What it means |
|---|---|
| `hasPath` | True while actively following a path. |
| `waypoint` | Current waypoint index out of total (e.g. `2/7`). |
| `action` | The action for the current waypoint (`walk_right`, `jump`, `fall`, etc.). |
| `pathCost` | A* cost of the current path — useful for comparing route strategies. |
| `failReason` | Reason the last path failed. Empty if the last path succeeded. |
| `target` | World position of the path target. |

**Movement**

| Field | What it means |
|---|---|
| `coyoteTimer` | Active countdown in seconds. Non-zero means the character just left a ledge. |
| `velocityX` | Estimated horizontal velocity the behavior is targeting. |
| `waypointTime` | Seconds spent on the current waypoint. Approaching `Max Waypoint Time` means stuck. |

**Portals**

| Field | What it means |
|---|---|
| `portalCount` | Total portals in the graph. Zero when no portals added. |
| `portalState` | Current portal execution state: `none`, `paused`, or `traversing`. |
| `currentPortalId` | ID of the portal being processed. |
| `traverseProgress` | Percentage progress through a gradual portal (0%–100%). |
| `elevatorGroups` | Number of named elevator groups. |

**Settings**

| Field | What it means |
|---|---|
| `cellSize` | Tile size the graph was built with. |
| `maxJumpHeight` | Jump height the graph was built with in pixels. |
| `maxJumpDistance` | Jump distance the graph was built with in pixels. |
| `maxFallDistance` | Fall distance the graph was built with in pixels. |
| `debug` | Whether console debug logging is active. |
| `platformBehavior` | `found` or `not found`. If `not found`, no movement is possible. |
| `pathfindingBehavior` | `found` or `not found`. Only relevant when using `UsePathfindingObstacleMap`. |

---

## 18. Tips and Common Mistakes

- **Tile Size must match your Pathfinding Cell Size.** This is the single most common setup error. If the grid is misaligned, characters will try to walk through walls or jump into ceilings. Set both to the same value (usually the tilemap tile size).

- **Add portals after the graph is generated.** Portals inject connections into the node graph. If you add them before `On navigation graph generated`, the graph rebuild will erase them. Always add portals inside or after the `On navigation graph generated` trigger.

- **Call `PauseAtPortal` only inside `On portal entry`.** It has no effect if called anywhere else. If you want to delay a portal, you must be responding to that trigger.

- **`UsePathfindingObstacleMap` is asynchronous.** The Pathfinding behavior builds its map in the background over several ticks. Use `On navigation graph generated` to know when it is ready — do not call `FindPath` immediately after `UsePathfindingObstacleMap` on the same tick.

- **Regenerate the graph after changing tiles.** `SetTileState` and `SetTileStateWorld` modify the obstacle map but do not rebuild the graph. Always follow tile changes with `RegenerateGraph`, then wait for `On navigation graph generated` before pathing.

- **Slope tiles must be registered.** Slope tiles have `obstacleMap=0` (clear) internally. If you do not register them with `MapSlopeTilesFromTilemap` or `SetTileState`, the arc checker treats them as empty air and jumps will pass straight through the slope body. Check the console with Debug Logging on — unregistered tile IDs are reported.

- **`Max Fall Distance = 0` auto-detects from the Platform behavior.** The auto value is calculated from jump strength and gravity physics and is usually correct. If characters refuse to fall off tall drops, increase `Max Fall Distance` (set `0` for auto or a large explicit value).

- **`PathFailReason = "no_start_node"` means the character is not standing on a walkable tile.** Use `Correct to ground = Yes` in `FindPath`, or check that the character is above a solid tile. If they spawned mid-air or in a gap, the behavior cannot find a starting node.

- **Ledge Restriction and Coyote Time are mutually exclusive.** Coyote time requires the character to walk off an edge to fire. With Ledge Restriction on, the character never walks off edges, so coyote connections are never used.

- **`ClearAllPortals` also clears elevator groups.** If you clear portals mid-level (e.g. when unlocking a door), you will need to re-add all portals including elevators. Consider removing only the specific portal by ID instead.
