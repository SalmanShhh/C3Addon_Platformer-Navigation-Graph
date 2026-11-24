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

**Everything physical is auto-detected.** Jump height, jump distance, and fall distance are calculated from the attached Platform behavior's physics. Character size comes from the sprite. Tile Size can auto-detect from your solid tilemap. You can override any of these, but the defaults are computed, not guessed.

**Auto-control is optional.** By default the behavior drives the Platform behavior itself: call Find path and the character moves. Turn auto-control off and the behavior still calculates paths and exposes every waypoint through expressions, so you can drive movement from your own state machine.

### Key concepts at a glance

| Term | What it means |
|---|---|
| **Obstacle map** | A grid of tile states (solid, clear, jump-thru, avoid, slope) that the graph builder reads. Comes from a Solid/Jump-thru object scan or manual actions. |
| **Navigation graph** | Every walkable tile position (a **node**) plus every possible movement between nodes (a **connection**). Built from the obstacle map. |
| **Waypoint** | One step in a calculated path. Each waypoint has a world position and an action such as `walk_left`, `jump`, `fall_right`, or `portal_instant`. |
| **Portal** | A shortcut connection the graph cannot express with jump or fall arcs. Instant portals teleport; gradual portals move the character at a set speed (elevators, ziplines). |
| **Hazard** | A marked danger area (an object, a circle or rectangle, or a tile) that characters never touch: they jump over it, route around it, or stop in front of it. Tiles near it cost more, so routes keep their distance. |
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

That is the whole setup; the defaults do the rest. On startup, **Auto-Build Graph** (default Auto) builds the obstacle map automatically by scanning every object that has an enabled **Solid** or **Jump-thru** behavior. **Detect Slopes** (default on) registers slope tiles automatically from their collision shapes. Jump physics are read from the Platform behavior, and the simple `Find path` action snaps start and target to walkable ground and paths as close as possible when the exact target is unreachable, so it never fails outright.

One property to check: **Tile Size** defaults to 32 px. If your level grid uses a different tile size, set it to match, or set it to 0 to auto-detect from your solid tilemap.

If your slope tiles do not carry sloped collision polygons (so automatic detection cannot see them), register them manually once at startup instead (see [Slopes](#8-slopes)); the graph rebuilds itself when slopes are registered:

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> MapSlopeTilesFromTilemap  TilemapWalls, "3,4", "5,6", "", ""
```

### Manual setup (full control)

If you prefer explicit control, or you need a custom obstacle map, leave **Auto-Build Graph** on **Off** and build the map from your solid objects in events:

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> ScanJumpThruObjectsIntoObstacleMap  TilemapPlatforms
  // The graph rebuilds by itself after the scans; no Regenerate action needed

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> FindPath  Player.X, Player.Y, "Yes", "Reach", "Default"
```

**A note on Tile Size.** Tile Size (default 32) MUST match your tilemap's tile size. A mismatch misaligns the graph with your geometry, and characters will try to walk through walls. Setting Tile Size to 0 (auto-detect) avoids the problem entirely.

With **Auto-Control Movement** enabled (the default), the character starts moving the moment `On path found` fires.

### Large levels and mobile

Both expensive steps are time-sliced: the obstacle scan and the graph build each run a few milliseconds per frame instead of stalling one frame, so even big levels start and update without a hitch on phones. While a rescan or rebuild runs, characters keep using the current map and graph. `On navigation graph generated` fires when a full build is ready (startup, Regenerate obstacle map), not for the small local updates below, so events that add portals in that trigger never run twice. A Find path that needs the result right away (the very first one, or one in the same event as Regenerate obstacle map / region) finishes the work synchronously first, so the same-tick patterns above always work.

Changes stay local. Tile edits, Regenerate region, and the automatic refresh when obstacles move all rescan only the cells that changed and update only the part of the graph within jump and fall reach of them, instead of rebuilding the whole level. Characters elsewhere keep their paths and queued requests, and characters whose path runs through the changed area re-path straight away. This is what keeps 100+ characters smooth while the level changes around them.

### Pathing from On start of layout

`On start of layout` runs before the behavior's first tick, but pathing actions still work there: Find path (all variants), Start patrol, and Jump toward position initialize the behavior and build the graph on the spot when called early. Portal and hazard actions work there too: they register into the shared map immediately and connect when the graph builds. You never need to wait for `On navigation graph generated` just to issue the first command or set up the level; the trigger remains useful for reacting to rebuilds after level changes.

```
Event: On start of layout
  Action: Guard -> PlatformerNavGraph -> Start patrol  Dwell: 1.5, Edge distance: 0
  // Works immediately: the map scan and graph build run synchronously here
```

---

## 4. Behavior Properties

| Property | Type | Default | Description |
|---|---|---|---|
| **Enable Debug Logging** | Boolean | Off | Logs graph stats, path results, and movement decisions to the browser console (F12). Turn it on while developing or troubleshooting, and off again for release builds. |
| **Tile Size** | Integer (0 to 128) | 32 | Grid resolution in pixels. Must match your tilemap's tile size exactly. Set to 0 to auto-detect it from the solid tilemap. |
| **Max Search Nodes** | Integer (100 to 10000) | 2000 | How many graph nodes A* may visit before giving up. Raise for very large open levels; lower to cap worst-case path cost. |
| **Max Fall Distance** | Integer | 0 | Maximum safe fall in pixels. 0 auto-detects from Platform physics. -1 means unlimited. A positive value is an explicit override. |
| **Auto-Control Movement** | Boolean | On | When on, the behavior drives the Platform behavior automatically. When off, path data is exposed through expressions for manual movement. |
| **Path Strategy** | Combo | Balanced | How the AI picks between valid routes: Balanced, Shortest Distance, Safest Route, Ground-Hugging, No Falling, or Walk Only. See [Movement Control](#7-movement-control). |
| **Smooth Paths** | Boolean | On | Merges straight runs of walking into one waypoint, so characters walk smoothly instead of stopping at every tile center. Jumps, falls and portals are never merged away. |
| **Max Waypoint Time** | Float (1 to 30) | 5.0 | Seconds before the behavior gives up on a waypoint and fires `On waypoint stuck`. |
| **Coyote Time** | Float (0 to 1) | 0 | Seconds after walking off a ledge in which the AI may still jump. Only useful with Ledge Restriction off. 0 disables it. |
| **Strict Jump Positioning** | Boolean | On | The character slows down and centers on the departure tile before each jump or fall. Prevents missed jumps over pits. |
| **Ledge Restriction** | Boolean | Off | The character will not walk off platform edges unless the path specifically requires a jump or fall. Good for patrol guards. |
| **Ledge Leniency** | Float (0 to 64) | 0 | Pixels past a ledge edge the character may walk before stopping. Only applies with Ledge Restriction on. |
| **Re-Path Threshold** | Float (0 to 20) | 3.0 | Tiles of drift from the path before automatic re-pathing fires. 0 disables automatic re-pathing. |
| **Hazard Radius** | Integer (0 to 10) | 2 | Tile radius of cost falloff around each hazard. Tiles inside the radius get a partial penalty even without touching the hazard. |
| **Auto-Build Graph** | Combo | Auto | Zero-event startup. Auto: scan all Solid/Jump-thru objects at startup; explicit setup actions always take precedence. Off: set the map up with actions only. |
| **Map Tag** | Text | (empty) | Instances with the same tag on a layout share one navigation map. Empty = share with everyone. Give special characters (wall-phasing ghosts, flyers) their own tag. Each tag builds its own map, so use few tags. |
| **Detect Slopes** | Boolean | On | During Solid and Jump-thru scanning (including Auto-Build), probe partially-covered tiles' collision shapes and register 45 and 22.5 degree surfaces as slopes automatically. Requires sloped collision polygons on the tiles. Unsupported angles stay solid. |
| **Crowd Arrivals** | Boolean | Off | When several characters path to the same position, each claims a landing spot so the others target neighboring spots instead of stacking. Per map tag. |
| **Idle Separation** | Float (0 to 256) | 0 | Personal space in pixels for characters with no active path: idle characters closer than this gently push apart. 0 = off. Ledge-safe. A good starting value is the character's width. |
| **Separation Cooldown** | Float (0 to 60) | 5.0 | Rest time in seconds after giving up on idle separation (crowd too dense for the spacing) before trying again. 0 = never rest, keep trying continuously. |
| **Enabled** | Boolean | On | Whether the behavior starts active. Disabled freezes navigation (path, graph, and settings are kept; resumes on re-enable). Toggle at runtime with Set enabled. |

---
## 5. Obstacle Maps: Giving the Graph Level Data

The navigation graph needs to know which tiles are solid, which are one-way platforms, and which are slopes. That information is the **obstacle map**, a grid of tile states the graph builder reads. There are three ways to provide one, from most to least automatic.

### Auto-Build Graph (the default)

**Auto-Build Graph** defaults to **Auto**, so the behavior handles everything at startup with no events, straight out of the box: every object type with an enabled Solid or Jump-thru behavior is scanned into a layout-sized grid. Explicit setup actions in `On start of layout` always win over auto-build, because start-of-layout events run before the behavior's first tick. Set the property to Off to disable automatic map building entirely.

```
// No setup events at all. Just find paths:
Event: Every 0.5 seconds
  Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y
```

With **Detect Slopes** on (the default), auto-build also registers slope tiles automatically from their collision shapes. Slope tiles without sloped collision polygons scan as solid until you register them manually (see [Slopes](#8-slopes)), and the graph rebuilds automatically once you do.

The addon does not use Construct's built-in Pathfinding behavior at all; it never needs to be added to the object. The scan reads the same Solid and Jump-thru behaviors your level geometry already uses, it is synchronous (the map is ready in the same call), and it fully represents one-way platforms, which a plain obstacle grid cannot.

### Building the map from solid objects

For explicit control over which objects are scanned, build an empty grid and scan objects into it:

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
  Action: Enemy -> PlatformerNavGraph -> ScanJumpThruObjectsIntoObstacleMap  TilemapPlatforms
```

Build obstacle map from layout always starts from a clean grid (old tiles and slopes are discarded), and the navigation graph rebuilds by itself after the scans. Slope tiles you registered with Map slope tiles from tilemap are remembered and re-applied after every scan, so the order of the actions does not matter.

Scanning is collision-polygon accurate. Sprites mark only the cells their collision polygon actually covers, so rotated or irregular solids do not over-fill their bounding box. Tilemap tiles are refined against their per-tile collision polygons: tiles with collisions disabled scan as clear, and partial polygons (half-height fences, thin floors) only mark the cells they cover. Tilemaps can sit at any position and use any tile size: tiles are read in world space, so a moved tilemap scans exactly where it is. Tiles that do not line up with the grid (an offset of part of a tile, or a tile size different from Tile Size) are rasterized like sprites, cell by cell. Objects must have the Solid or Jump-thru behavior enabled, and instances with collisions disabled are skipped, so temporarily disabled platforms are correctly ignored. Polygon features smaller than about a third of a cell are treated as not blocking.

### Updating the map when obstacles move

When solid objects or tilemaps move, appear, or disappear during play, one action brings everything up to date, just like the built-in Pathfinding behavior:

```
Event: On drawbridge lowered
  Action: Enemy -> PlatformerNavGraph -> Regenerate obstacle map
  // Rescans every Solid and Jump-thru object where it is now, refreshes slopes,
  // and rebuilds the navigation graph (time-sliced, no frame hitch)
```

It works from any frame, needs no other actions, and every character sharing the map picks up the new graph. Characters keep their current path until they re-path; a Find path issued in the same event uses the new graph, because a Find path made during a rebuild finishes the rebuild first. Maps made with Create custom obstacle map or Load obstacle map from JSON have no objects to rescan, so for those the action only rebuilds the graph.

When you know where the change happened, **Regenerate region** (a rectangle) or **Regenerate region by object** (the area under the picked instances) does the same for just that area, which is much cheaper on big levels. Both match the built-in Pathfinding actions of the same names:

```
Event: Bomb -> On destroyed
  Action: Tilemap -> Erase tile range  ...
  Action: Enemy -> PlatformerNavGraph -> Regenerate region  Bomb.X - 64, Bomb.Y - 64, Bomb.X + 64, Bomb.Y + 64
  // Only the cells around the blast are rescanned and re-linked, this tick
```

Almost every change is picked up automatically (see the next section), including tilemap tile edits, so region regeneration is optional. Use it when the update must land in the SAME tick, for example right before a Find path in the same event: automatic detection notices tile edits within a fraction of a second, which is fine for everything else.

Hazards and portals survive the rebuild. Area hazards are re-applied to the new graph, and hazards from objects keep following them. Portals and elevator stops added from objects follow those objects, so they reconnect wherever the objects are now; portals added with co-ordinates reconnect at those co-ordinates.

### Moving platforms (automatic)

Moving platforms need no events. Give the platform the Solid or Jump-thru behavior and move it any way you like: Sine, Tween, Move To, Bullet, Timeline, or events. The behavior keeps an eye on every Solid and Jump-thru object on the map:

- **Objects that keep moving** are left out of the obstacle map, so characters never plan to walk on the spot a platform happened to be in when the map was built.
- **Objects that move once and stop** (a drawbridge lowering, a sliding door, a block pushed into place) are added back where they settled.
- **Objects created or destroyed during play** (placed blocks, crumbling floors) are added or removed.
- **Objects that change without moving** are rescanned: a resize, an animation frame with a different collision polygon (a door opening, a floor crumbling), or Solid, Jump-thru or collisions switched on or off. Frames that keep the same polygon cost nothing, and an object that changes shape constantly is left out of the map like a moving platform until it holds still.
- **Moving obstacles you cannot ride** (crushers, swinging blocks, patrolling spike blocks, rotating saws) get an automatic danger area over the space they sweep through. Characters prefer other routes (they still cross when there is no other way), and patrolling guards turn before it. A character that has to walk through stops at the edge and waits until the obstacle will stay out of its way long enough to get across, like a player timing a crusher. Platforms with a ride link get no danger area.
- **Tilemap tile edits** (Set tile, Erase tile, Erase tile range) on Solid and Jump-thru tilemaps are found by comparing a few rows per frame against a saved copy of the tiles (about 2,000 tiles per frame in total, shared by all tilemaps), and only the changed cells are rescanned. A 500 by 100 tilemap is fully re-checked in under half a second; the copy costs 4 bytes per tile.

Each of these refreshes only the cells that changed and the nearby part of the navigation graph, by itself, a few times per second at most, spread across frames. This works for maps built by Auto-Build, by Regenerate obstacle map, or by Build obstacle map from layout plus the Scan actions (rebuilt with the same object types you scanned). Custom and JSON-loaded maps are left alone.

**Riding.** A platform that travels back and forth between two ledges gets a **ride link** automatically: right away if it moves with the Sine behavior (its range is read from Sine), otherwise once it has made one full trip. Characters path across it like any other route: they walk to the ledge, time their step so they reach the edge as the platform arrives (stopping at the edge if it is not there yet), let the Platform behavior carry them, and step off at the far ledge. The platform's surface is read from its collision shape, so a sprite with empty space above its deck is boarded at the deck, not the image's top edge. A character that can jump does not always wait: when a platform level with the ledge is within jump reach (still coming, already leaving, or paused at its far end) and a jump would land on its deck, it leaps on (Walk Only and Ground-Hugging always wait and walk on). The timing comes from the platform's observed movement, so Sine, Tween, Move To, Timeline and event-driven platforms all work; a platform that snaps between positions (square or sawtooth waves) is boarded only while it holds still. Lifts work the same way when the platform stops level with a ledge at each end. The link appears in the pathfinding cost as the ride time plus the average wait, so a character still walks around when that is quicker.

Ride links are portals tagged `moving_platform`, so the portal events work with them:

```
Event: Enemy -> PlatformerNavGraph -> On portal entry
  Condition: System -> Compare two values  Enemy.PlatformerNavGraph.PortalType(Enemy.PlatformerNavGraph.CurrentPortalID) = "ride"
  Action: Enemy -> PlayAnimation  "LookUp"
  // The character is about to wait for a moving platform
```

Ride links are managed for you: they move when the platform's route changes, and are removed when the platform is destroyed or stops moving. Some limits apply: the platform's ends must line up with a ledge (level with it, within half a tile, and within two tiles beside it), platforms that only rotate or resize cannot be ridden, and a character who falls off re-paths from where it lands.

### Setting individual tiles

For procedural levels or runtime changes:

```
Event: On player places wall block
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  Block.X, Block.Y, "Solid"
  // The graph rebuilds by itself on the next tick (many tile edits in one event = one rebuild)

Event: On lava tile created
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  Lava.X, Lava.Y, "Avoid"
  // "Avoid" tiles are walkable but get a strong pathfinding cost penalty
```

### Procedurally generated levels (best practices)

Procedural stages work reliably when the map build runs after generation finishes. Follow these rules.

**Rule 1: control the timing.** Auto-Build scans on the behavior's first tick, and On start of layout events run before that tick. If your generator finishes inside On start of layout, Auto-Build works as-is. If generation spans multiple frames, set Auto-Build Graph to Off and build explicitly when done. One ordering catch: a Find path or Start patrol action in On start of layout builds the graph immediately, so place it AFTER your generation events (or issue it from On navigation graph generated), or the graph is built from the level as it was before generation.

**Rule 2 (recommended): write the obstacle map directly from generator data.** Your generator already knows which cells are solid, so skip the tilemap scan entirely. This is the fastest and most exact path, and it handles slopes and one-way platforms in the same loop:

```
Event: (generation complete)
  Action: Enemy -> PlatformerNavGraph -> CreateCustomObstacleMap  GridWidth, GridHeight
  // Inside your generation loop, mirror each cell you generate:
  Action: Enemy -> PlatformerNavGraph -> SetTileState  gx, gy, "Solid"
  Action: Enemy -> PlatformerNavGraph -> SetTileState  gx, gy, "Jump-thru"
  Action: Enemy -> PlatformerNavGraph -> SetTileState  gx, gy, "Slope left /"
  // No extra action after the loop: the graph rebuilds once, on the next tick

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  // Spawn or activate enemies here
```

Note: with a custom map, set the Tile Size property explicitly (auto-detection reads tilemaps, and a custom map may not have one).

Alternatively, if your generator paints a tilemap, scan it after painting:

```
Event: (generation complete)
  Action: Enemy -> PlatformerNavGraph -> BuildObstacleMapFromLayout  Layout.Width, Layout.Height
  Action: Enemy -> PlatformerNavGraph -> ScanSolidObjectsIntoObstacleMap  TilemapWalls
```

**Rule 3: clean up between regenerations.** Portals and hazards persist across graph rebuilds by design. When regenerating a level in the same layout, clear them first or stale portals will reconnect at their old coordinates:

```
Event: (before regenerating the level)
  Action: Enemy -> PlatformerNavGraph -> RemovePortalsByTag  ""
  Action: Enemy -> PlatformerNavGraph -> Clear hazards  "Everything"
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

**Rule 7: content outside the layout works with Auto-Build.** A map built by Auto-Build or Regenerate obstacle map covers the layout plus every Solid and Jump-thru object outside it, including negative co-ordinates, and it **grows automatically** when obstacles are created beyond its edge, so chunk-streamed and endless worlds need no setup. Growth keeps everything already built and only scans the new cells. Maps with an explicit size (Build obstacle map from layout, Create custom obstacle map) keep that size, starting at (0, 0); anything outside it has no navigation. Very large spreads are capped at 4 million cells to protect memory.

**Keeping memory flat in endless worlds.** Automatic growth never forgets content, so a map in an endless runner keeps growing. **Set navigation area** pins the map to a window instead, typically around the player. Calling it again moves the window: only the newly covered cells are scanned, cells left behind are dropped, and the graph is updated only along the edges that moved:

```
Event: Every 1 second
  Action: Enemy -> PlatformerNavGraph -> Set navigation area  Player.X - 2000, 0, Player.X + 2000, 1080
```

Characters outside the area cannot find paths, so make the window cover everyone who needs to move. Use the same value for both corners to go back to automatic coverage.

When the map does not start at (0, 0), grid co-ordinates count from its top-left corner: **GridOriginX** / **GridOriginY** give that corner in world pixels, and WorldToGridX / WorldToGridY convert for you. Prefer the world-position actions (Set tile state at world position, Tile has state at world position) in streamed worlds.

For runtime digging and building after the level is live, update tiles with `SetTileState`; the graph updates itself around each edited tile, time-sliced, so tile-by-tile terrain changes do not hitch the frame.

### Saving and loading obstacle maps

For large fixed levels, build the map once, export it as JSON, and reload it at runtime to skip the scan:

```
Event: On "Export map" pressed
  Action: Browser -> LocalStorage.SetItem  "navmap", Enemy.PlatformerNavGraph.ObstacleMapJSON

Event: On start of layout
  Condition: Browser -> LocalStorage.HasItem("navmap")
  Action: Enemy -> PlatformerNavGraph -> LoadObstacleMapFromJSON  LocalStorage.GetItem("navmap")
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
| **Shortest Distance** | Fastest route: counts each landing as lost time and uses long momentum jumps to skip platforms | Speedrunner rivals, aggressive enemies |
| **Safest Route** | Prefers chains of short hops and drops; long leaps and falls cost extra the bigger they are | Stealth NPCs, escorts, fragile characters |
| **Ground-Hugging** | Walks whenever a walking route exists; jumps or falls only when unavoidable | Patrols, tower defense creeps, predictable enemies |
| **No Falling** | Never descends by jumping or falling: routes down go via slopes and portals, or the character stays on the upper level (Nearest behavior) | Heavy units, fall-damage games, wheeled robots |
| **Walk Only** | Never jumps or falls in any direction: the character stays on its own platform (slopes and portals excepted) and gets as close to off-platform targets as its ground allows | Shopkeepers, turrets on legs, bound guardians |

Note for scripting and the PathStrategy expression: Ground-Hugging keeps its original internal key `simplest`, No Falling uses `no_drop`, and Walk Only uses `walk_only`. The last two are guarantees, not preferences: the excluded edges are removed from the search entirely. `Set max traversal drop` raises No Falling's allowance (for example to your fall-damage-safe height) and also works standalone with any other strategy. Walk Only pairs naturally with `Is on same platform as object`, which predicts exactly what it can reach.

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
  Action: Guard -> PlatformerNavGraph -> Set movement setting  "Ledge leniency", 8
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
  Action: Enemy -> PlatformerNavGraph -> Set movement setting  "Coyote time", 0.15
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

Slope detection is built on the documented collision API: it probes the shapes characters actually collide with, so it cannot disagree with the physics.

**The Detect Slopes property** (on by default): slope detection happens during every Solid and Jump-thru scan, including Auto-Build and Regenerate obstacle map. Sloped Jump-thru tiles become walkable slopes that characters can still jump up through from below. Partially-solid tiles are probed at three columns; a straight surface dropping one tile across the cell registers as a 45 degree slope, half a tile as a gentle slope, and anything else (half-blocks, decorations, unsupported angles) stays solid. Combined with Auto-Build Graph, a slope-heavy level needs zero setup events. This also classifies the diagonal edge cells of rotated solid sprites, so a 45 degree sprite ramp becomes walkable automatically.

Results are cached per tile shape, and flipped tile placements classify correctly on their own. Detection requires slope tiles to have actual sloped collision polygons set in the C3 editor. A slope drawn in the art but carrying a square collision polygon probes as flat and stays solid, which matches how the character would actually collide with it. `MapSlopeTilesFromTilemap` with explicit tile IDs remains available as the manual override.

### Unregistered slope tiles

An unregistered slope tile looks like a solid block to walking and like empty air to the jump arc checker, so jumps can clip straight through the slope body. With Debug Logging on, the console lists every unregistered tile ID found during slope mapping, with example cell positions, which makes missing IDs easy to spot.

---

## 9. Portals: Doors, Elevators, and Ziplines

A **portal** is a shortcut connection the graph cannot express with normal movement. There are two types:

- **Instant portals** teleport the character from entry to exit. Doors, warp pads, teleporters.
- **Gradual portals** move the character linearly from entry to exit at a set speed, with the Platform behavior disabled during traversal. Elevators, lifts, ropes, ziplines.

Either way the character's **feet arrive exactly at the exit point** (the exit object's origin, or the exit co-ordinate), whatever the character's own origin, then it carries on along its path. Put the origin of door, warp and elevator-stop sprites at their bottom, standing on the floor. A point inside a floor is lifted onto it.

### Adding portals

Add portals whenever it suits you, including in `On start of layout`. A portal added before the graph exists is stored and connected automatically when the graph finishes building, and every later rebuild reconnects all registered portals too.

Portals belong to the **map**, not to the character whose action added them: every character on the same map (same layout and Map Tag) uses them, and they last until the layout ends, even if every character is destroyed and new ones spawn later. Running an add action on an object type with many instances registers the portal once, and every instance reports the same `LastPortalID`.

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> Add portal from objects
    Direction: One-way
    Type: Instant
    Entry object: DoorEntry
    Exit object: DoorExit
    Cost: 1
    Tag: "door"

  Action: Enemy -> PlatformerNavGraph -> Add portal from objects
    Direction: Two-way
    Type: Gradual
    Entry object: ElevatorBottom
    Exit object: ElevatorTop
    Cost: 1
    Speed: 80
    Tag: "elevator"
  // Save Enemy.PlatformerNavGraph.LastPortalID if you need to modify it later
```

**Portals added from objects follow those objects.** When an entry or exit object moves, the portal moves with it and keeps its ID, cost, speed, and tags, with no events needed. If either object is destroyed, the portal is removed. Portals added with co-ordinates (Add portal) stay exactly where you put them.

### Elevator groups

For elevators with more than two stops, use `AddElevatorStop`. Stops in the same group are connected pairwise with two-way gradual portals, so any floor reaches any floor:

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift_A", Floor1Marker, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift_A", Floor2Marker, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift_A", Floor3Marker, 80
  // Creates portals Floor1-Floor2, Floor1-Floor3, Floor2-Floor3
```

Elevator groups are shared by the whole map, so a stop added through any character links to the floors other characters added. Adding a stop the group already has (the same object, or the same position for co-ordinate stops) is ignored. Stops added from objects follow their objects, like portals. To take a lift out of service and bring it back later, remove its portals by tag and add the stops again; the removed floors are forgotten, so the lift rebuilds cleanly:

```
Event: Power -> On switched off
  Action: Enemy -> PlatformerNavGraph -> RemovePortalsByTag  "lift"

Event: Power -> On switched on
  Sub-event: System -> For each LiftStop
    Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift_A", LiftStop, 80, "lift"
```

### Pausing at portals for custom transitions

`PauseAtPortal` holds the character at the entry point before the portal executes. It only works inside `On portal entry`. A new Find path while held replaces the wait; if the new path uses the same portal, `On portal entry` fires again right away, so chase loops keep working.

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

A portal added from objects follows them automatically: its graph connections re-wire on any frame the objects have moved, so a teleporter drone that drifts around the level needs no events at all.

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> Add portal from objects  "One-way", "Instant", DroneEntry, DroneExit, 1, 0, "drone"
  // The portal tracks DroneEntry and DroneExit from now on; routes adapt on each re-path
```

`SetPortalPositionFromObjects` re-attaches an existing portal to different objects (it then follows those), keeping its ID, type, cost, speed, and tags. `SetPortalPosition` pins a portal to fixed co-ordinates instead, and it stops following any objects.

A character already traversing the portal keeps its original destination, and characters already on a path keep it until they re-path; moving a portal never teleports anyone.

### Modifying and removing portals

```
Action: Enemy -> PlatformerNavGraph -> SetPortalCost  doorPortalId, 999
// Effectively locks the door without removing the portal

Action: Enemy -> PlatformerNavGraph -> RemovePortalAtObject  DoorEntry
// Removes the ONE portal closest to this object (entry or exit side),
// even when several Enemy instances are picked

Action: Enemy -> PlatformerNavGraph -> RemovePortalsByTag  ""
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

**Hazards** are places characters must not touch. A character never stands where its body would touch a hazard: it jumps over the hazard when it can, takes another route, or stops in front of it, clear of it (moving hazards are crossed with timing instead, see Moving hazards). The tiles around a hazard also cost more, so routes keep their distance. Hazard avoidance switches on automatically when the first hazard is added, and the **Hazard Radius** property controls how far the penalty spreads. Like portals, hazards belong to the map: every character on it avoids them, they can be added in `On start of layout`, and they last until the layout ends even if the character that added them is destroyed.

### Hazard objects (the simple way)

Turn objects into hazards with one action. Every instance becomes a hazard matching its collision shape (a triangle spike only marks the tiles it really covers), follows it as it moves, and disappears when it is destroyed:

```
Event: System -> On start of layout
  Action: Enemy -> PlatformerNavGraph -> Add hazard from object  Spikes, 20
  Action: Enemy -> PlatformerNavGraph -> Add hazard from object  Lava, 30

Event: Saw -> On created
  Action: Enemy -> PlatformerNavGraph -> Add hazard from object  Saw, 30
```

No For each, no co-ordinates, no clean-up events. Characters jump over a hazard in their way when they can, even on a flat floor. One that cannot clear it (Walk Only, or a hazard too wide to jump) stops in front of it, clear of it, whatever the path strategy. Calling it again for the same objects only updates their severity, so it is safe to run more than once. To switch an object's hazard off without destroying it (spikes that retract), use **Remove hazard from object**; Add hazard from object brings it back:

```
Event: Spikes -> On animation "Retract" finished
  Action: Enemy -> PlatformerNavGraph -> Remove hazard from object  Spikes

Event: Spikes -> On animation "Extend" finished
  Action: Enemy -> PlatformerNavGraph -> Add hazard from object  Spikes, 20
```

### Area hazards

For danger that is not an object (a blast, an area you calculate), **Add hazard** marks an area centred on a position. Rectangle fills Width x Height; Circle fits inside it (its diameter is the smaller side):

```
Event: On explosion created
  Action: Enemy -> PlatformerNavGraph -> Add hazard  Circle, Explosion.X, Explosion.Y, 192, 192, 30
  Set blastId = Enemy.PlatformerNavGraph.LastHazardID
  // Higher severity means stronger avoidance

Event: On explosion faded
  Action: Enemy -> PlatformerNavGraph -> Remove hazard  blastId
```

### Tile hazards

For permanent static danger such as lava rows, mark tiles directly:

```
Action: Enemy -> PlatformerNavGraph -> SetTileHazard  5, 12, 15
// Tile (5,12) gets severity 15

Action: Enemy -> PlatformerNavGraph -> Clear hazards  "Tiles"
Action: Enemy -> PlatformerNavGraph -> Clear hazards  "Areas"
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

Hazards from **Add hazard from object** handle movement by themselves, the same way moving obstacles do (see Moving platforms):

- **Back and forth** (a patrolling saw, a spike block on Sine): the hazard learns the whole range the object travels and covers all of it, so routes avoid that space instead of chasing the object.
- **Rotating** (a spinning saw, a swinging blade): the hazard covers every angle the object turns through.
- **Up and down across a walkway** (blades rising out of the floor): a character that has to walk through waits at the edge until the blade is out of the way long enough to cross, then goes. If the hazard never leaves the way, the character walks through without waiting, since the route was already its last resort.
- **Stopped**: the hazard shrinks back to the object's exact shape after about a second.

Each hazard removes itself when its object is destroyed. For danger that reaches past the object (a fire's heat), raise **Hazard Radius**, which spreads a fading cost around every hazard tile.

Following is single-flight per map (one update pass per tick regardless of instance count), and path costs re-bake only when a hazard's covered area changes by a quarter tile. A travelling object's area stops changing once its range is known, so hundreds of hazard objects stay cheap. Objects that move one way without returning (projectiles) are followed tile by tile instead, and for those cost-based avoidance is the wrong tool: react in events (a dodge with `JumpTowardPosition`, or `Stop` plus manual evasion) and re-path afterward.

---

## 11. Multi-Agent Support and Performance

### One graph, many agents

Every instance on the layout reads the same navigation graph (per map tag). The build cost is paid once no matter how many enemies you spawn.

Scanning and graph building are **single-flight**: with hundreds of instances carrying the behavior, exactly one instance performs the scan and build per map while the rest wait on the shared result. The map data itself (obstacle, slope, and hazard grids) is also **one copy per map**, shared by reference to every instance. Setup actions are deduplicated too: because event actions run once per picked instance, calling a map-setup action like `BuildObstacleMapFromLayout` on a type with 50 instances would repeat the work 50 times, so the addon runs it once and the other 49 adopt the result. Portal and elevator-stop actions work the same way: one portal is registered, and all 50 instances report the same `LastPortalID`. Instances spawned after the graph is built inherit both the graph and the map data immediately, without triggering a rebuild, so wave spawners are safe.

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
  Action: AnyEnemy -> PlatformerNavGraph -> Set crowd feature  "Multi-agent avoidance", "Enabled"

Expression: AnyEnemy.PlatformerNavGraph.NearbyAgentCount
// Agents within three tiles of this character
```

### Crowd arrivals and idle separation

Avoidance spreads the routes, but every route still ends at the same goal position, so a chasing pack piles onto one pixel. Two independent tools fix the destination side:

- **Crowd Arrivals** (property, or Set crowd feature with "Crowd arrivals"): goal reservation. When a character paths somewhere, it claims the landing spot (goal node). Another character pathing to the same position automatically targets the nearest unclaimed spot instead, so a pack tiles the platform around the target in a natural ring. The claim is kept while the character stands there and is released when it paths elsewhere, stops, is disabled, or is destroyed. `TargetX/Y` still report the requested position; `PathEndX/Y` show the reserved spot.
- **Idle Separation** (property, or Set separation setting with "Distance"): personal space in pixels for characters with no active path. Idle characters closer than this to a same-map neighbor gently push apart. The nudge never pushes into a wall or off a ledge (on a one-tile island it simply does nothing) and never interferes with path following. 0 turns it off; the character's width is a good starting value. Works with or without Crowd Arrivals, and also cleans up knockback and spawn overlap on its own. When the crowd is too dense for the spacing to ever be satisfied (four characters on a three-tile platform), characters give up after the give-up time (1.2 seconds by default, tunable via Set separation setting) and rest for **Separation Cooldown** seconds instead of shuffling forever (0 = never rest). Being teleported, taking a portal, being repositioned by events, or arriving from a path resets that give-up state, so a freshly placed character always gets a fresh separation attempt.

Both are per map tag, cost almost nothing when no conflict exists, and are inert with a single character. For full crowd behavior combine all three: avoidance en route, reservation at the destination, separation while standing around.

```
Event: On start of layout
  Action: AnyEnemy -> PlatformerNavGraph -> Set crowd feature  "Crowd arrivals", "Enabled"
  Action: AnyEnemy -> PlatformerNavGraph -> Set separation setting  "Distance", 32
```

### Multiplayer (host only, automatic)

Construct's Multiplayer object is host-authoritative: the host runs the game and peers receive synced positions. This behavior follows that model with no setup events. On a peer (in a room and not the host) every character pauses itself, exactly like Set enabled "Disabled": no paths, no map scans, no graph builds, and nothing pressing the Platform controls, so synced enemies do not jitter or snap back. The host and offline games run as usual.

```
// Host: give orders as in single player
Event: Multiplayer -> Is host
       Every 0.5 seconds
  Action: Enemy -> PlatformerNavGraph -> Find path to object  Player
```

- **Triggers fire on the host only** (On arrived, portal and patrol triggers). Sync anything peers must see, such as the animation to play, through synced instance variables or messages.
- **Disable the Platform behavior on peer copies** of synced characters, as for any synced platformer object.
- **Local-only characters** that are never synced (a pet only one player sees) can opt out: **Set multiplayer mode** "Run everywhere".
- The Construct debugger shows the state in this behavior's `multiplayer` field.

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
| **Find path to nearest ledge** Direction, Distance | Path to the nearest platform edge on the Left, Right, or Any side, stopping the given distance back from the edge (0 = on the edge). Fires On failed to find path if no ledge exists that way. |
| **Find path to side of object** Target, Side, Distance | Path to a stop position beside the object instead of on top of it, keeping the given distance (0 = flush beside it; both widths are always cleared). Any picks the nearer side and falls back if it has no ground. |
| **Find object on same platform** Target, Which | Search the object's picked instances for the Nearest or Furthest one on the character's walkable platform. Read the result with PlatformObjectUID and pick it with System's Pick by unique ID. |
| **Set max traversal drop** Pixels | Limit how far down this character will descend by air: jumps and falls with a larger net drop are excluded from its paths, so it uses slopes and portals instead. 0 = never descend by air, -1 = no limit. Per character, for heavy units and fall damage. |
| **FindPath (advanced)** X, Y, CorrectToGround, Mode, JumpPositioning | Full-control pathing. CorrectToGround snaps to solid ground; Mode Reach fails when no complete path exists; JumpPositioning overrides precision per path. |
| **Stop** | Immediately stop the character and clear the active path. |
| **SetPathStrategy** Strategy | Switch the route weighting: Balanced, Shortest Distance, Safest Route, Ground-Hugging, No Falling, Walk Only. |
| **SetRePathThreshold** Tiles | Tiles of drift that trigger automatic re-pathing. |
| **SetRePathCooldown** Seconds | Minimum time between automatic re-path attempts. |
| **SetMaxPathsPerTick** Count | Limit A* calculations per tick; extra requests queue. 0 means unlimited. |
| **Set crowd feature** Feature, State | Enable or disable Crowd arrivals (goal reservation, so arrivals tile onto neighboring spots instead of stacking) or Multi-agent avoidance (agents on the same map fan out instead of stacking). |
| **Set separation setting** Setting, Value | Change one idle separation setting: Distance (px, 0 = off), Cooldown (s, 0 = never rest), or Give-up time (s, default 1.2). |

### Movement

| Action | Description |
|---|---|
| **SetEnabled** State | Enable or disable the whole behavior. Disabled freezes navigation with all state kept; Find path is ignored while disabled, map setup actions still work. |
| **Set multiplayer mode** Mode | Host only (automatic, the default): navigation runs on the host and pauses itself on peers. Run everywhere: always runs on this machine, for local-only characters that are never synced. |
| **SetAutoControl** Enabled | Toggle whether the behavior drives the Platform behavior automatically. |
| **Start patrol** Dwell, EdgeDistance | Patrol the current platform: walk to one end, wait the dwell time, turn, repeat. Ends are found automatically from the graph's ledges and walls; Edge distance makes the character turn that many pixels short of each edge (0 = edge to edge; too big for the platform = stand at its middle, never off a ledge). Any Find path call ends the patrol. |
| **Start patrol between objects** Markers, Order, Dwell | Visit the picked marker instances in instance order (Ping-pong or Loop), pathing between them with every move type, and wait the dwell time at each. Starts at the nearest marker; any Find path call ends it. |
| **Stop patrol** | End the current patrol (platform or route); the character stands where it is, and Resume after will not bring it back. |
| **Set patrol setting** Setting, Value | Dwell time (s), Edge distance (px), Dwell variation (s, random +/- on each wait), Speed (% of max speed while patrolling), or Resume after (s idle before a patrol cancelled by Find path restarts; 0 = never). |
| **Set patrol option** Option, State | Enable or disable Turn at characters (turn when another character is in the way) or Turn before danger (turn before stepping somewhere more hazardous). Both start enabled. |
| **JumpTowardPosition** X, Y | Launch the character directly at the target with a full jump. Not pathfinding; used for lunges and attacks. Works mid-air with double jump. |
| **SetStrictJumpPositioning** Enabled | Toggle careful pre-jump centering for this character. |
| **SetLedgeRestriction** Enabled | Toggle whether the character stops at platform edges. |
| **Set movement setting** Setting, Value | Jump height, Jump distance, Fall distance (pixels; overrides the values read from the Platform behavior and locks them in), Coyote time (seconds after leaving a ledge in which a jump still fires, 0 = off), or Ledge leniency (pixels past an edge, with Ledge Restriction on). The graph rebuilds automatically. |

### Obstacles

| Action | Description |
|---|---|
| **Regenerate obstacle map** | Rescan every Solid and Jump-thru object where it is now (slopes included) and rebuild the graph, in one action, spread across frames. Use after moving, adding or removing obstacles. |
| **Regenerate region** X1, Y1, X2, Y2 | Rescan only the obstacles inside a rectangle and update only the nearby part of the graph. Much cheaper for local changes. |
| **Set navigation area** X1, Y1, X2, Y2 | Pin the map to a window (endless and streamed worlds). Calling it again moves the window: new cells are scanned, cells left behind are dropped. Same value for both corners = automatic coverage again. |
| **Regenerate region by object** Object | Same as Regenerate region over the area under the picked instances, for example after switching a door's Solid behavior off. |
| **BuildObstacleMapFromLayout** Width, Height | Create a fresh, empty grid from layout pixel dimensions (previous tiles and slopes are discarded). Call before the scan actions. The graph rebuilds automatically. |
| **ScanSolidObjectsIntoObstacleMap** Objects | Add objects with an enabled Solid behavior to the map at their current positions, by collision polygon. Scans only add cells. The graph rebuilds automatically. |
| **ScanJumpThruObjectsIntoObstacleMap** Objects | Add one-way platforms (enabled Jump-thru behavior) to the map. The graph rebuilds automatically. |
| **CreateCustomObstacleMap** Width, Height | Create an empty map with explicit tile dimensions, for fully manual tile setup. |
| **SetTileState** GridX, GridY, State | Set one tile: Solid, Clear, Jump-thru, Avoid, or a slope type. |
| **SetTileStateWorld** X, Y, State | Same as SetTileState using world pixel coordinates. |
| **MarkSlopeRegion** StartX, StartY, EndX, EndY, Direction | Mark a diagonal run of tiles as a slope type. |
| **MapSlopeTilesFromTilemap** Tilemap, LeftIDs, RightIDs, GentleLeftIDs, GentleRightIDs | Scan a tilemap and mark the given tile IDs as slopes. Comma-separated ID strings; flipped placements auto-mirror. Remembered and re-applied on every map rebuild. |
| **ClearAllSlopes** | Remove every slope marking (and forget remembered slope registrations), then rebuild the graph. |
| **LoadObstacleMapFromJSON** JSON | Restore a map (obstacles, slopes, tile hazards, tile size) saved with the ObstacleMapJSON expression. |
| **ClearObstacleMap** | Remove the obstacle map and all associated data. |

### Portals

| Action | Description |
|---|---|
| **Add portal** Direction, Type, EntryX, EntryY, ExitX, ExitY, Cost, Speed, Tag | Add a portal at world co-ordinates. Type Instant teleports (doors, warp pads); Gradual moves the character in a straight line at Speed (elevators, ziplines). |
| **Add portal from objects** Direction, Type, EntryObj, ExitObj, Cost, Speed, Tag | Same as Add portal between two objects. It follows the objects as they move and is removed if either is destroyed. |
| **AddElevatorStop** GroupID, X, Y, Speed, Tag | Add a stop to an elevator group; auto-creates two-way gradual portals to every existing stop in the group. Groups are shared per map; a stop at an existing stop's position is ignored. |
| **AddElevatorStopFromObject** GroupID, Object, Speed, Tag | Same as AddElevatorStop using an object, which the stop then follows. |
| **RemovePortal** ID | Remove one portal by ID, including its graph connections. |
| **RemovePortalAtObject** Object | Remove the one portal whose entry or exit is closest to the object, even with several instances picked. |
| **RemovePortalsByTag** Tag | Remove every portal whose tag string contains the tag token. An empty tag removes ALL portals and elevator groups. |
| **SetPortalPosition** ID, EntryX, EntryY, ExitX, ExitY | Move a portal in place, preserving ID, type, cost, speed, and tags. Connections re-wire immediately. |
| **SetPortalPositionFromObjects** ID, EntryObj, ExitObj | Re-attach a portal to two objects; it then follows them. |
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
| **Add hazard from object** Object, Severity | Turn objects into hazards: every picked instance gets a hazard matching its collision shape, which follows it (covering the whole space it moves or turns through) and is removed when it is destroyed. The simplest way to add hazards. |
| **Add hazard** Shape, X, Y, Width, Height, Severity | Mark an area centred on X, Y as dangerous. Rectangle fills Width x Height; Circle fits inside it. Good for explosions and calculated areas. |
| **Remove hazard from object** Object | Remove the picked objects' hazards without destroying them (spikes that retract). |
| **Clear hazards** Which | Clear hazards by kind: Areas (every hazard added with an action, object hazards included), Tiles, From objects, or Everything. |
| **RemoveHazard** ID | Remove one hazard by ID (from LastHazardID). |
| **SetTileHazard** GridX, GridY, Severity | Set the danger level of one tile. 0 removes the hazard. |
| **SetHazardRadius** Tiles | How far hazard costs spread around each hazard, in tiles. 0 = hazard tiles only. |

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
| **Is patrolling** | True while a patrol is active (Start patrol or Start patrol between objects). |
| **Is platform enabled** | True if the attached Platform behavior is currently enabled. |
| **Is at ledge** | True when the character stands on a ledge node (platform edge). |
| **Is at island** | True when the character stands on a single-tile isolated platform. |
| **Is on same platform as object** Target | True when the character can walk to the object without jumping or falling: both stand on the same connected stretch of ground, slopes included. |
| **Graph node exists at grid position** GridX, GridY | True if a navigation node exists at these grid coordinates. |
| **Graph node exists at world position** X, Y | True if a navigation node exists at this world position. |
| **Is graph node a ledge** GridX, GridY | True if the node at these coordinates is a left or right ledge. |
| **Is at portal** | True while paused at a portal entry (after PauseAtPortal, before Resume or Complete). |
| **Is traversing portal** | True while moving through a gradual portal. The Platform behavior is disabled during this. |
| **Tile has state** GridX, GridY, State | True if the tile has the given state (including "Slope (any)" and "Gentle slope"). |
| **Tile has state at world position** X, Y, State | Same as Tile has state using world coordinates. |
| **Is position hazardous** X, Y | True if any hazard (circle, rect, or tile) affects the position. |
| **Is crowd feature enabled** Feature | True if Crowd arrivals or Multi-agent avoidance is enabled. |
| **Is crowd arrivals enabled** | True if crowd arrivals (goal reservation and idle separation) is active. |
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
| **PathFailReason** | String | Last failure: `no_start_node`, `no_goal_node`, `no_path`, `search_exhausted`, `no_ledge_found`, or empty on success. |
| **PathCost** | Number | Total cost of the current path. |
| **PathEndX / PathEndY** | Number | The calculated path's final position (the last waypoint), where the character will actually end up. In Nearest mode this can differ from the requested target. |
| **TargetX / TargetY** | Number | The REQUESTED target position, as passed to the last Find path. Use PathEndX/Y for where the path actually ends. |
| **TargetGridX / TargetGridY** | Number | The requested target's grid cell (after ground correction). |
| **AngleToWaypoint** | Number | Angle in degrees from the character to the current waypoint. |
| **DistanceToWaypoint** | Number | Pixel distance to the current waypoint. |
| **PathStrategy** | String | Active strategy: `balanced`, `shortest`, `safest`, `simplest`, `no_drop`, `walk_only`. |
| **RePathThreshold / RePathCooldown** | Number | Current re-path settings. |
| **MaxPathsPerTick** | Number | Current per-tick path budget. 0 means unlimited. |
| **PathQueueSize** | Number | Pending queued path requests. |
| **NearbyAgentCount** | Number | Path-following agents within three tiles (avoidance must be on). |
| **IdleSeparation** | Number | Idle separation distance in pixels (0 = off). |
| **SeparationCooldown** | Number | Rest time in seconds after giving up on idle separation (0 = never rest). |
| **SeparationGiveUpTime** | Number | Trying time in seconds before giving up on idle separation. |
| **NearestLedgeLeftX / NearestLedgeLeftY** | Number | Position of the nearest ledge to the character's left. 0 if none exists. |
| **NearestLedgeRightX / NearestLedgeRightY** | Number | Position of the nearest ledge to the character's right. 0 if none exists. |
| **ReachedObjectSide** | Number | Which side of the target was reached: -1 left, 1 right. Valid after On side of object reached, 0 otherwise. |
| **OnSamePlatform(x, y)** | Number | 1 if the position is on the character's walkable platform (no jumps or falls needed to reach it), else 0. |
| **PlatformObjectUID** | Number | UID of the instance found by Find object on same platform, for System's Pick by unique ID. -1 if none was on the platform. |
| **MaxTraversalDrop** | Number | The maximum downward drop this character will traverse by air, in pixels. -1 means no limit. |

### Movement

| Expression | Returns | Description |
|---|---|---|
| **CoyoteTime / CoyoteTimer** | Number | Coyote setting and live countdown. |
| **StrictJumpPositioning / LedgeRestriction** | Number | 1 when enabled, 0 when not. |
| **LedgeLeniency** | Number | Current leniency in pixels. |
| **JumpTowardTargetX / JumpTowardTargetY** | Number | Target of the active jump-toward. |
| **EstimatedVelocityX** | Number | Estimated horizontal velocity from position deltas. |
| **StoppingDistance** | Number | Braking distance at current Platform speed. |
| **PatrolDirection** | Number | Patrol walk direction: -1 left, 1 right, 0 when dwelling or not patrolling. Handy for mirroring the sprite. |
| **PatrolPointIndex** | Number | During Start patrol between objects: the marker the character is at or heading to, counting from 0. -1 when no route patrol is active. |

### Obstacles

| Expression | Returns | Description |
|---|---|---|
| **ObstacleMapJSON** | String | The full map (obstacles, slopes, tile hazards, tile size) as JSON. |
| **ObstacleMapSource** | String | `collision`, `custom`, or `none`. |
| **GridWidth / GridHeight** | Number | Map dimensions in tiles. |
| **GridTileSize** | Number | Tile size in pixels (the resolved value when Tile Size is auto). |
| **GridOriginX / GridOriginY** | Number | World position of grid tile (0, 0), in pixels. 0 unless the map covers content left of or above the layout. |
| **TileState(gx, gy)** | String | `solid`, `clear`, `jump_thru`, `avoid`, or a slope type name. |
| **SlopeDirection(gx, gy)** | String | `left`, `right`, `gentle_left`, `gentle_right`, or `none`. |
| **WorldToGridX(x) / WorldToGridY(y)** | Number | Convert world pixels to grid coordinates. |
| **MapTag** | String | The map tag this instance navigates with. Empty string is the default shared map. |

### Portals

| Expression | Returns | Description |
|---|---|---|
| **PortalCount** | Number | Total registered portals. |
| **LastPortalID** | Number | ID of the most recently added portal. Read right after adding. Every instance that ran the same add action reports the same ID. |
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
| **LastHazardID** | Number | ID of the most recently added hazard. Read right after adding, store to remove it later. 0 if none. |
| **HazardCount** | Number | Hazards added with actions (areas and objects). Tile hazards and the automatic danger areas over moving obstacles are not counted. |
| **TrackedHazardCount** | Number | Hazards from Add hazard from object. |
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
| **On navigation graph generated** | A full graph build finished (startup and full rebuilds; local updates do not fire it). Portals and hazards are kept across rebuilds, so add them once in On start of layout, not here. |
| **On waypoint reached** | The character arrived at one waypoint. |
| **On jump toward launched** | JumpTowardPosition fired its jump. |
| **On re-path triggered** | Automatic re-pathing fired due to drift. |
| **On waypoint stuck** | Max Waypoint Time was exceeded; the path was cancelled. |
| **On patrol end reached** | A patrolling character reached an end of its patrol and is about to turn. Fires once per end, before the dwell, whether or not there is one. |
| **On patrol dwell started** | The wait at a patrol end began (right after On patrol end reached). Start idle or look-around animations here. Not fired when Dwell is 0. |
| **On patrol dwell finished** | The wait ended and the character turns to walk again. PatrolDirection already reports the new direction inside this trigger. Not fired when Dwell is 0. |
| **On side of object reached** | A Find path to side of object arrival landed with the character genuinely beside the target at the requested distance. Fires after On arrived; a Nearest-mode stop short of the side does not fire it. |
| **On obstacle map created** | A map grid was created (custom or from layout). |
| **On obstacle map removed** | The obstacle map was cleared. |
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

**Restricting how a character may travel.**
Scenario: some characters must never take certain moves, no matter how much shorter the route would be.

```
Event: On start of layout
  Action: Golem -> PlatformerNavGraph -> SetPathStrategy  "No Falling"
  // Never descends by air: ramps, slopes, and portals only

  Action: Turret -> PlatformerNavGraph -> SetPathStrategy  "Walk Only"
  // Never jumps or falls at all: stays on its own platform

  Action: Cat -> PlatformerNavGraph -> Set max traversal drop  96
  // Any strategy: drops deeper than 3 tiles are off the table
```

The first four strategies are preferences (costs that bias the route); No Falling and Walk Only are guarantees (excluded moves are removed from the search entirely). A character restricted this way and asked to reach an unreachable target stops at the closest point it legally can, since the simple Find path actions use Nearest mode.

### Portals

The system for connections that normal movement cannot express.

**A locked door.**
Scenario: a door portal exists but should be unusable until the key is found.

```
Event: System -> On start of layout
  Action: Enemy -> PlatformerNavGraph -> Add portal from objects  "Two-way", "Instant", DoorL, DoorR, 1, 0, "door"
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
  Action: Enemy -> PlatformerNavGraph -> Add hazard  Circle, Bomb.X, Bomb.Y, 256, 256, 40
  Set blastId = Enemy.PlatformerNavGraph.LastHazardID
  Action: Enemy -> PlatformerNavGraph -> Find path  Player.X, Player.Y
  Action: Wait 2.0
  Action: Enemy -> PlatformerNavGraph -> Remove hazard  blastId
  // Removes only the blast; spikes and other hazards stay
```

Note: re-path after adding or clearing hazards so agents pick up the new costs.

**Rising floor blades.**
Scenario: saw blades rise out of the floor and sink back (Sine, vertical), and enemies should pass between them.

```
Event: On start of layout
  Action: Enemy -> PlatformerNavGraph -> Add hazard from object  Blade, 30
  // Routes avoid the space the blades sweep. An enemy that has to walk
  // through waits at the edge while a blade is up, and goes when it sinks.
```

**Permanent lava rows.**
Scenario: the bottom row of the level is lava the AI must never step into: it jumps over stretches it can clear and stops at the edge of wider ones.

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
  Action: AnyGoblin -> PlatformerNavGraph -> Set crowd feature  "Multi-agent avoidance", "Enabled"
  // A* now penalizes routes that pass close to other agents
```

**Spreading arrivals.**
Scenario: routes fan out nicely, but every agent still lands on the same pixel at the destination.

```
Event: On start of layout
  Action: AnyGoblin -> PlatformerNavGraph -> Set crowd feature  "Crowd arrivals", "Enabled"
  // Each agent claims its landing node; the rest target neighboring nodes.
  // No event changes needed: the same Find path calls now tile the arrivals.

Event: Every 0.5 seconds
  Action: AnyGoblin -> PlatformerNavGraph -> Find path to object  Player
```

Note: `TargetX/Y` still return the requested position; `PathEndX/Y` return the spot this agent actually reserved.

**Settling an idle crowd.**
Scenario: agents that finished their paths stand overlapped after knockbacks and spawns.

```
Event: On start of layout
  Action: AnyGoblin -> PlatformerNavGraph -> Set separation setting  "Distance", 32
  // Idle goblins closer than 32 px gently push apart (ledge-safe).
  Action: AnyGoblin -> PlatformerNavGraph -> Set separation setting  "Cooldown", 5
  // If a platform is too small for everyone to fit, they shuffle for about
  // a second, then rest 5 seconds before trying again.
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

**Scenario:** A guard walks its rooftop end to end, pausing at each edge, without wandering off.

```
Event: Guard -> PlatformerNavGraph -> On navigation graph generated
  Action: Guard -> PlatformerNavGraph -> Start patrol  Dwell: 1.5, Edge distance: 0
```

One action. The behavior finds the platform's ends from the graph's ledge and wall data (walkable slopes count as part of the platform), walks between them, and waits 1.5 seconds at each turn. Edge distance 0 patrols edge to edge; set a pixel value to make the guard turn that far short of each edge instead (safer near drops), and a value too big for the platform just parks the guard at its middle, never off a ledge. Use PatrolDirection to mirror the sprite, and the dwell triggers (On patrol dwell started / On patrol dwell finished) to swap between look-around and walk animations.

To chase the player and then return to duty:

```
Event: Guard -> LineOfSight -> Has LOS to Player
  Action: Guard -> PlatformerNavGraph -> Find path to object  Player   // ends the patrol automatically

Event: Guard -> PlatformerNavGraph -> On arrived
  Action: Guard -> PlatformerNavGraph -> Start patrol  Dwell: 1.5, Edge distance: 0
```

Any Find path call cancels the patrol, so alert logic needs no bookkeeping; restarting from On arrived makes the guard patrol wherever the chase left it.

Patrols also look after themselves, with no events (Set patrol option switches each of these on or off per character):

- **Danger:** a guard turns before stepping somewhere more hazardous than where it stands (hazard tiles, area hazards, hazards from objects such as a passing fireball, including their falloff radius), and stands still if both directions are dangerous. Avoid tiles already end the platform.
- **Other characters:** a guard turns when another character stands in its way, so two patrollers meeting head-on both turn around.
- **Level changes:** when blocks are placed or removed, a drawbridge lowers, or a platform is resized, the guard re-measures its platform's ends and patrols the new shape.

**Tuning a patrol.** Set patrol setting changes one value at a time, for both kinds of patrol: Dwell time and Edge distance without restarting, Dwell variation (a random amount added to or taken from each wait, so guards drift out of step), Speed (walking speed while patrolling as a percentage of max speed; chases and jumps stay at full speed), and Resume after (seconds of standing idle after a Find path before the patrol it cancelled starts again; 0 = never). With Resume after set, chase-and-return needs no On arrived events at all:

```
Event: On start of layout
  Action: Guard -> PlatformerNavGraph -> Start patrol  Dwell: 1.5, Edge distance: 0
  Action: Guard -> PlatformerNavGraph -> Set patrol setting  "Resume after", 3

Event: Guard -> LineOfSight -> Has LOS to Player
  Action: Guard -> PlatformerNavGraph -> Find path to object  Player
```

Stop patrol forgets the cancelled patrol, so a guard you stop on purpose stays stopped.

**Routes across several platforms.** To patrol between posts on different platforms, drop marker sprites where the guard should stop and use **Start patrol between objects**. The guard visits the markers in their instance order (the order you created them), pathing between them with jumps, falls, portals and moving platforms, and waits at each:

```
Event: On start of layout
  Action: Guard -> PlatformerNavGraph -> Start patrol between objects  GuardPost, "Ping-pong", 2
  // Ping-pong: 1, 2, 3, 2, 1 ... Loop: 1, 2, 3, 1, 2, 3 ...

Event: Guard -> PlatformerNavGraph -> On patrol dwell started
  Condition: System -> Compare two values  Guard.PlatformerNavGraph.PatrolPointIndex = 2
  Action: Guard -> Set animation  "Smoke"
  // A different idle at the third post
```

It starts at the nearest marker. Markers can move (the guard heads to where they are now), destroyed markers are skipped, and a marker that cannot be reached is retried once and then skipped. The same triggers, Stop patrol, Is patrolling and PatrolDirection work for both kinds of patrol. To give several guards their own routes, use a separate marker object per guard, or pick the guard's markers with a condition before the action (only picked instances are used).

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
Event: System -> On start of layout
  Action: Enemy -> PlatformerNavGraph -> Add portal from objects  "Two-way", "Instant", DoorL, DoorR, 1, 0, "door"
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
Event: System -> On start of layout
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift", Floor1Marker, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift", Floor2Marker, 80
  Action: Enemy -> PlatformerNavGraph -> AddElevatorStopFromObject  "lift", Floor3Marker, 80

Event: Every tick
  Condition: Enemy -> PlatformerNavGraph -> Is traversing portal
  Action: ElevatorCar -> Set Y  Enemy.BBoxBottom

Event: Enemy -> PlatformerNavGraph -> On portal complete
  Action: ElevatorCar -> Set Y  Enemy.BBoxBottom
  Action: ElevatorCar -> PlayAnimation  "Arrive"
```

The character's feet arrive exactly at each floor marker's origin, so give the markers their origin at the bottom, standing on the floor. The elevator car sprite (origin at its top, no Solid or Jump-thru behavior) simply follows the character's feet during traversal and snaps into place on arrival; PortalProgress (0 to 1) can drive cable animations.

### 6. Spike pits and explosion avoidance

**Scenario:** Enemies route around spike pits, and temporarily around explosions.

```
Event: System -> On start of layout
  Action: Enemy -> PlatformerNavGraph -> Add hazard from object  SpikeObject, 25

Event: Explosion -> On created
  Action: Enemy -> PlatformerNavGraph -> Add hazard  Circle, Explosion.X, Explosion.Y, 256, 256, 50
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

Event: On player removes block
  Action: Enemy -> PlatformerNavGraph -> SetTileStateWorld  Block.X, Block.Y, "Clear"

Event: Enemy -> PlatformerNavGraph -> On navigation graph generated
  Action: Enemy -> PlatformerNavGraph -> Find path  Goal.X, Goal.Y
```

Builds are time-sliced, so even frequent rebuilds do not hitch; the enemy re-paths each time the fresh graph is announced.

### 9. Thirty-goblin wave without frame drops

**Scenario:** A wave spawner drops 30 goblins at once.

```
Event: On start of layout
  Action: AnyGoblin -> PlatformerNavGraph -> SetMaxPathsPerTick  4
  Action: AnyGoblin -> PlatformerNavGraph -> Set crowd feature  "Multi-agent avoidance", "Enabled"

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
Event: System -> On start of layout
  Action: Enemy -> PlatformerNavGraph -> Add portal from objects
    Direction: One-way
    Type: Gradual
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
Event: System -> On start of layout
  For each WarpPad:
    Action: Enemy -> PlatformerNavGraph -> Add portal
      "Two-way", "Instant", WarpPad.X, WarpPad.Y, WarpHub.X, WarpHub.Y, 2, 0, "warp"
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
    Action: Guard -> PlatformerNavGraph -> Add hazard  Circle, Lamp.X, Lamp.Y, Lamp.Radius * 2, Lamp.Radius * 2, 12

Event: On alarm triggered
  Action: Guard -> PlatformerNavGraph -> SetPathStrategy  "Shortest Distance"
  Action: Guard -> PlatformerNavGraph -> Clear hazards  "Areas"
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
Event: System -> On start of layout
  Action: Enemy -> PlatformerNavGraph -> Add portal from objects  "Two-way", "Instant", RedDoorL, RedDoorR, 1, 0, "red_door"
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

### Momentum (run-up) jumps

Some gaps are too wide for a jump from a standing start but makeable with a running start, the way a player backs up on a small stone, sprints, and leaps from its edge. The graph detects these automatically: when a jump fails validation from a standstill, it is re-checked with a run-up launch, and if the arc works it becomes a momentum connection (up to roughly 45 percent more horizontal range). No events or properties are needed. When the AI executes one, it visibly backs up across the launch tile, sprints, and leaps from the edge, so a short stutter-step before a long jump is expected behavior. In debug path logs these connections are tagged [mom]. Momentum jumps cost slightly more than regular jumps, so the AI prefers ordinary hops when both work; Shortest Distance uses them eagerly to skip intermediate platforms.

### 20. Boss arena with a burning floor phase

**Scenario:** In phase 2 the arena floor ignites and the boss should keep to the platforms.

```
Event: On phase 2 start
  Repeat ArenaWidthInTiles times:
    Action: Boss -> PlatformerNavGraph -> SetTileHazard  ArenaLeftTile + LoopIndex, FloorRow, 30
  Action: Boss -> PlatformerNavGraph -> Find path to object  Player

Event: On phase 2 end
  Action: Boss -> PlatformerNavGraph -> Clear hazards  "Tiles"
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
  Action: Enemy -> PlatformerNavGraph -> Clear hazards  "Areas"
  Action: Enemy -> PlatformerNavGraph -> Add hazard  Circle, Player.X, Player.Y, 320, 320, 40
  // A* now penalizes routes that pass near the player, so the escape path
  // naturally curves around them, including on platforms above or below
```

If other systems also use shape hazards, remove only the flee hazard by saved ID instead of clearing all shapes.

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

### 22. Zombie horde that surrounds the player

**Scenario:** twenty zombies chase the player. Without crowd features they form a single-file conga line and merge into one writhing pixel on arrival. With them they spread across routes, encircle the player, and hold a loose ring.

```
Event: On start of layout
  Action: AnyZombie -> PlatformerNavGraph -> Set crowd feature  "Multi-agent avoidance", "Enabled"
  Action: AnyZombie -> PlatformerNavGraph -> Set crowd feature  "Crowd arrivals", "Enabled"
  Action: AnyZombie -> PlatformerNavGraph -> Set separation setting  "Distance", 28
  Action: AnyZombie -> PlatformerNavGraph -> SetMaxPathsPerTick  4

Event: Every 0.6 seconds
  Condition: distance(AnyZombie.X, AnyZombie.Y, Player.X, Player.Y) > 60
  Action: AnyZombie -> PlatformerNavGraph -> Find path to object  Player

Event: AnyZombie -> PlatformerNavGraph -> On arrived
  Condition: distance(AnyZombie.X, AnyZombie.Y, Player.X, Player.Y) < 90
  Action: AnyZombie -> PlayAnimation  "Attack"
```

Each system covers one phase: avoidance fans the horde across parallel routes on the way in, goal reservation tiles their landing spots around the player (the first zombie to path claims the closest node, the next ones ring outward), and idle separation keeps the ring loose while they attack. The 60 px distance condition stops zombies already in the ring from re-pathing onto the player's exact pixel.

### 23. Squad rally point with formation markers

**Scenario:** the player plants a flag and the squad gathers on it, each soldier visibly taking their own spot instead of stacking.

```
Event: Player plants Flag
  Action: AnySoldier -> PlatformerNavGraph -> Set crowd feature  "Crowd arrivals", "Enabled"
  Action: AnySoldier -> PlatformerNavGraph -> Find path  Flag.X, Flag.Y

Event: AnySoldier -> PlatformerNavGraph -> On path found
  // PathEndX/Y is the spot THIS soldier reserved, not the flag position.
  Action: Create SpotMarker at (AnySoldier.PlatformerNavGraph.PathEndX,
                                AnySoldier.PlatformerNavGraph.PathEndY)
  Action: SpotMarker -> Set opacity  40

Event: AnySoldier -> PlatformerNavGraph -> On arrived
  Action: AnySoldier -> PlayAnimation  "AtEase"
```

The markers make the reservation system visible: one soldier's marker sits on the flag node, the rest on the neighboring nodes the reservations pushed them to. Because claims are released when a soldier paths elsewhere or is destroyed, re-planting the flag reshuffles the formation cleanly.

### 24. Guard post and rat nest (tuning the settle feel)

**Scenario:** two enemy types share the crowd systems but should feel opposite. Guards at a post stand firm the moment they are placed; rats in a nest never stop squirming.

```
// Guards: settle almost instantly, rest for a long time
Event: On start of layout
  Action: AnyGuard -> PlatformerNavGraph -> Set separation setting  "Distance", 36
  Action: AnyGuard -> PlatformerNavGraph -> Set separation setting  "Give-up time", 0.2
  Action: AnyGuard -> PlatformerNavGraph -> Set separation setting  "Cooldown", 30

// Rats: never rest, permanent squirming pile
Event: On start of layout
  Action: AnyRat -> PlatformerNavGraph -> Set separation setting  "Distance", 16
  Action: AnyRat -> PlatformerNavGraph -> Set separation setting  "Cooldown", 0
```

The guards take one brief step apart when crowded and then hold their ground for half a minute, which reads as discipline. The rats keep nudging forever (cooldown 0 disables the rest entirely), which reads as vermin. Same system, two personalities from two numbers. Teleporting either type into a pile resets the give-up state automatically, so a freshly warped guard still takes its one composing step.

### 25. Sentry that takes an overwatch spot

**Scenario:** A sniper spawns anywhere in the level, walks to the nearest platform edge, and holds it, scanning left and right.

```
Event: Sniper -> PlatformerNavGraph -> On navigation graph generated
  Action: Sniper -> PlatformerNavGraph -> Find path to nearest ledge  "Any", 16

Event: Sniper -> PlatformerNavGraph -> On arrived
  Action: Sniper -> PlatformerNavGraph -> Start patrol  Dwell: 3, Edge distance: 0

Event: Sniper -> PlatformerNavGraph -> On patrol end reached
  Action: Sniper -> Set animation  "Scan"
```

Find path to nearest ledge sends the sniper to a vantage point with no marker objects in the layout; the 16-pixel distance parks it half a tile back from the drop, so recoil or a shove cannot tip it off. The patrol then paces the vantage platform edge to edge, and the 3-second dwell with a scan animation at each end sells the overwatch. If the sniper spawns on a plain with no edges, On failed to find path fires (PathFailReason returns `no_ledge_found`) and you can fall back to a plain patrol.

### 26. Melee attacker that flanks instead of stacking

**Scenario:** Sword enemies should stand beside the player to swing, never inside the player's sprite, and split to both sides.

```
Event: Every 0.5 seconds
  Condition: Enemy -> Is boolean instance variable set  "Aggro"
  Action: Enemy -> PlatformerNavGraph -> Find path to side of object  Player, "Any", 8

Event: Enemy -> PlatformerNavGraph -> On side of object reached
  Action: Enemy -> Set animation  "Attack"
  Action: Enemy -> Set Mirrored  (Enemy.PlatformerNavGraph.ReachedObjectSide = 1 ? Mirrored : Not mirrored)
```

On side of object reached fires only when the enemy genuinely stands beside the player at striking distance; if the way was blocked and the enemy could only get partway (On arrived still fires there), the attack never triggers from across the room. ReachedObjectSide (-1 or 1) faces the sprite toward the target. The stop position clears half the player's width plus half the enemy's width plus the 8-pixel distance, so the swing connects from outside the player's body. "Any" sends each enemy to its nearer side, which naturally splits a group into a pincer; with Crowd Arrivals on, multiple attackers on the same side tile outward instead of stacking.

### 27. Fleeing to a cliff for a scripted dive

**Scenario:** A stunt NPC runs to the cliff edge on its right and leaps off in a cutscene.

```
Event: On "StartStunt"
  Condition: NPC -> PlatformerNavGraph -> Is patrolling
  Action: NPC -> PlatformerNavGraph -> Stop patrol
  Action: NPC -> PlatformerNavGraph -> Find path to nearest ledge  "Right", 0

Event: NPC -> PlatformerNavGraph -> On arrived
  Action: NPC -> PlatformerNavGraph -> JumpTowardPosition  NPC.X + 200, NPC.Y - 50
```

NearestLedgeRightX/Y report the ledge the action paths to, useful for aiming a camera at the landing zone before the NPC arrives. Distance 0 puts the NPC right on the lip for the dive; a nervous character edging up to a drop would use a distance instead, stopping a few tiles short of the same ledge.

### 28. Rampart guard that keeps back from the drops

**Scenario:** A guard paces a rampart whose two ends are open drops onto spikes. It should never stand teetering on the lip, and it should face the way it walks.

```
Event: Guard -> PlatformerNavGraph -> On navigation graph generated
  Action: Guard -> PlatformerNavGraph -> Start patrol  Dwell: 2, Edge distance: 96

Event: Every tick
  Condition: Guard -> PlatformerNavGraph -> PatrolDirection ≠ 0
  Action: Guard -> Set Mirrored  (PatrolDirection = -1 ? Mirrored : Not mirrored)

Event: Guard -> PlatformerNavGraph -> On patrol dwell started
  Action: Guard -> Set animation  "IdleLookout"

Event: Guard -> PlatformerNavGraph -> On patrol dwell finished
  Action: Guard -> Set animation  "Walk"
```

Edge distance 96 makes the guard turn 96 pixels (three tiles) short of each end, so its dwell never happens on the lip where a knockback would send it onto the spikes; the margin also reads as caution. On a platform too short for the margins the guard walks to its middle and stands, like on an island, so an oversized distance can never walk it off a drop. The dwell triggers bracket the wait: dwell started swaps to the lookout idle, dwell finished swaps back to the walk (with PatrolDirection already flipped for the every-tick mirror event).

### 29. Archer that keeps its firing distance

**Scenario:** An archer should stand a screen-quarter away from the player, on whichever side it is already on, and never path through the player to the other side.

```
Event: Every 0.75 seconds
  Condition: Archer.X < Player.X
  Action: Archer -> PlatformerNavGraph -> Find path to side of object  Player, "Left", 140

Event: Every 0.75 seconds
  Condition: Archer.X ≥ Player.X
  Action: Archer -> PlatformerNavGraph -> Find path to side of object  Player, "Right", 140

Event: Archer -> PlatformerNavGraph -> On side of object reached
  Action: Archer -> Set animation  "Draw"
```

Picking the side from the archer's current position keeps it on its own flank; the 140-pixel distance is the firing range on top of the automatic width clearance. Re-issuing the call every 0.75 seconds makes the archer sidestep to hold range as the player advances, and backpedal when charged.

### 30. Worker that stands beside levers before using them

**Scenario:** A factory worker walks between two levers, stopping flush beside each one (never on top of it) to play a pull animation.

```
Event: On start of layout
  Action: Worker -> PlatformerNavGraph -> Find path to side of object  LeverA, "Any", 0

Event: Worker -> PlatformerNavGraph -> On arrived
  Condition: distance(Worker.X, Worker.Y, LeverA.X, LeverA.Y) < distance(Worker.X, Worker.Y, LeverB.X, LeverB.Y)
  Action: Worker -> Set animation  "Pull"
  Action: Wait 1.5 seconds
  Action: Worker -> PlatformerNavGraph -> Find path to side of object  LeverB, "Any", 0
  Else
  Action: Worker -> Set animation  "Pull"
  Action: Wait 1.5 seconds
  Action: Worker -> PlatformerNavGraph -> Find path to side of object  LeverA, "Any", 0
```

Distance 0 means "standing flush beside it": the stop position still clears half the lever's width plus half the worker's width, so the pull animation lines up with the handle instead of the worker's sprite overlapping it. The same pattern fits doors, buttons, forges, and market stalls.

### 31. Wolf pack pincer

**Scenario:** A pack of wolves should split deliberately, half circling to the player's left and half to the right, then close from both flanks at once.

```
Event: On "PackAttack"
  Condition: Wolf -> Pick by evaluate  Wolf.UID % 2 = 0
  Action: Wolf -> PlatformerNavGraph -> Find path to side of object  Player, "Left", 24

Event: On "PackAttack"
  Condition: Wolf -> Pick by evaluate  Wolf.UID % 2 = 1
  Action: Wolf -> PlatformerNavGraph -> Find path to side of object  Player, "Right", 24
```

Unlike "Any" (which sends each wolf to its nearer side), forcing the split guarantees both flanks are covered even when the whole pack spawns on one side. With Crowd Arrivals on, the wolves within each flank tile outward along the ground, so six wolves form two staggered ranks instead of two stacks. Two events, full surround.

### 32. Charge-up attack from standoff distance

**Scenario:** A battering-ram minotaur should walk to a spot well back from a barricade, snort and paw the ground while a charge meter fills, then thunder forward into it.

```
Event: On "Aggro"
  Action: Minotaur -> PlatformerNavGraph -> Find path to side of object  Barricade, "Any", 160

Event: Minotaur -> PlatformerNavGraph -> On side of object reached
  Action: Minotaur -> Set animation  "ChargeUp"
  Action: Minotaur -> Start timer  "Charge" for 1.2 seconds

Event: Minotaur -> On timer "Charge"
  Action: Minotaur -> PlatformerNavGraph -> JumpTowardPosition  Barricade.X, Barricade.Y
```

The 160-pixel distance is the run-up room: the minotaur stops far enough back that the charge has time to reach full speed and read as a telegraphed attack the player can dodge. Because the distance rides on top of the automatic width clearance, swapping in a wider barricade or a bigger minotaur never changes the run-up length. The same shape powers bull rushes at the player (path to a side of the player at distance, then dash), grapple hooks that need line-up room, and shield-breaker wind-ups.

### 33. Looting the nearest chest on the same platform

**Scenario:** A scavenger should grab whichever chest it can reach by just walking, ignoring richer chests that would need jumps, and only leap for one when nothing walkable is left.

```
Event: On "Scavenge"
  Action: Rat -> PlatformerNavGraph -> Find object on same platform  Chest, "Nearest"

  Sub-event: System -> Pick Chest by unique ID  Rat.PlatformerNavGraph.PlatformObjectUID
    Action: Rat -> PlatformerNavGraph -> Find path to object  Chest

  Sub-event: System -> Compare  Rat.PlatformerNavGraph.PlatformObjectUID = -1
    Action: Rat -> PlatformerNavGraph -> Find path to object  Chest  // nearest overall, jumps allowed
```

Find object on same platform searches the picked chests for the closest one on the rat's own stretch of ground; Pick by unique ID then narrows Chest to exactly that instance for the path call (a UID of -1 picks nothing, so the branch simply does not run). Walk-only targets keep scavengers looking grounded and quick, and the fallback still uses full pathfinding when the platform is bare. "Furthest" turns the same event into retreat logic: run to the far end's loot while danger blocks the near end. Because the action reads the object's picked instances, a filter condition above it (unopened chests only, for example) narrows the search for free. For a one-off yes/no on a single known target, use the Is on same platform as object condition; for positions instead of objects, OnSamePlatform(x, y).

### 34. Shift change after six patrol laps

**Scenario:** A guard patrols its wall for three full round trips, then walks off to the barracks while a fresh guard takes over. The dwell triggers drive the schedule, not just animations.

```
Event: Guard -> PlatformerNavGraph -> On patrol dwell finished
  Action: Guard -> Add 1 to instance variable  "Turns"

Event: Guard -> PlatformerNavGraph -> On patrol dwell finished
  Condition: Guard -> Compare instance variable  Turns >= 6
  Action: Guard -> PlatformerNavGraph -> Find path to object  Barracks
  // Any Find path ends the patrol, so no Stop patrol call is needed

Event: Guard -> PlatformerNavGraph -> On arrived
  Condition: Guard -> Compare instance variable  Turns >= 6
  Action: System -> Create object  Guard on layer "Game" at (Barracks.X, Barracks.Y)
  Action: Guard -> Destroy
```

Each completed dwell is one turn, so six of them make three full laps: the counter needs no distance math or timers. Because a Find path call ends the patrol automatically, the walk to the barracks starts cleanly from wherever the sixth turn happened. For the replacement, On navigation graph generated will not re-fire (the graph is already built), but Start patrol works from the spawn event directly, the same way it works in On start of layout, so call it right in Guard's On created and the post never sits empty. The same counting pattern drives torch-lighting rounds, singing miners who finish a verse per lap, and bosses that enrage after pacing their arena a set number of times.

### 35. Fall-damage knight on the long road down

**Scenario:** In a game where falls past one tile deal damage, an armored knight chases the player without ever hurting itself, while a scout on the same map dives off every ledge.

```
Event: On start of layout
  Action: Knight -> PlatformerNavGraph -> SetPathStrategy  "No Falling"
  Action: Knight -> PlatformerNavGraph -> Set max traversal drop  32
  // 32 px = one tile: harmless hops stay allowed, anything deeper is banned

Event: Every 0.5 seconds
  Action: Knight -> PlatformerNavGraph -> Find path to object  Player
  Action: Scout -> PlatformerNavGraph -> Find path to object  Player
```

The knight and scout share one graph but search it differently: the scout (Balanced) drops three floors in one hop while the knight marches to the ramp, rides the elevator, and arrives late but unhurt. No Falling alone bans every airborne descent; the Set max traversal drop of 32 raises the allowance so single-tile hops (which deal no damage in this game) stay in the knight's repertoire. When the player stands somewhere with no ramp or portal down, the knight stops at the upper level's closest edge (Nearest behavior) and waits for its moment, which reads as patience rather than brokenness.

### 36. Shopkeeper bound to the counter

**Scenario:** A shopkeeper walks along the counter to meet the approaching player but never jumps down into the shop floor, and greets differently depending on whether the player can be reached at all.

```
Event: On start of layout
  Action: Shopkeeper -> PlatformerNavGraph -> SetPathStrategy  "Walk Only"

Event: Every 0.5 seconds
  Condition: distance(Shopkeeper.X, Shopkeeper.Y, Player.X, Player.Y) < 300
  Action: Shopkeeper -> PlatformerNavGraph -> Find path to object  Player

Event: Shopkeeper -> PlatformerNavGraph -> On arrived
  Condition: Shopkeeper -> PlatformerNavGraph -> Is on same platform as object  Player
  Action: Shopkeeper -> Set animation  "Greet"

Event: Shopkeeper -> PlatformerNavGraph -> On arrived
  Condition: [invert] Shopkeeper -> PlatformerNavGraph -> Is on same platform as object  Player
  Action: Shopkeeper -> Say  "Come up to the counter!"
```

Walk Only removes every jump and fall from the shopkeeper's searches, so a Find path to the player on the shop floor parks it at the counter's near edge, leaning as close as its platform allows. Is on same platform as object then tells the arrival events apart: same platform means the walk actually reached the player (greet), different platform means the shopkeeper is at its edge calling out. Slopes behind the counter still work (walk edges), and an elevator portal would too, so a stockroom lift stays usable without any strategy change.

### 37. Guard dog on a leash

**Scenario:** A guard dog defends its rooftop fiercely but never leaves it while chained. When the player cuts the chain, the dog pursues anywhere.

```
Event: On start of layout
  Action: Dog -> PlatformerNavGraph -> SetPathStrategy  "Walk Only"
  Action: Dog -> PlatformerNavGraph -> Start patrol  Dwell: 1, Edge distance: 16

Event: Every 0.5 seconds
  Condition: distance(Dog.X, Dog.Y, Player.X, Player.Y) < 250
  Action: Dog -> PlatformerNavGraph -> Find path to object  Player

Event: Dog -> PlatformerNavGraph -> On arrived
  Condition: [invert] Dog -> PlatformerNavGraph -> Is on same platform as object  Player
  Action: Dog -> Set animation  "Bark"
  Action: Dog -> PlatformerNavGraph -> Start patrol  Dwell: 1, Edge distance: 16

Event: Player -> On collision with Chain
  Action: Chain -> Destroy
  Action: Dog -> PlatformerNavGraph -> SetPathStrategy  "Shortest Distance"
```

While chained, Walk Only turns every chase into "run to the rooftop edge nearest the player, bark, resume the patrol"; the dog lunges right up to the drop but can never follow down. Changing the strategy is all it takes to release it: the next Find path (half a second later) leaps off the roof after the player. Strategy is a per-character setting read at every search, so the switch needs no graph rebuild and affects only this dog.

### 38. Cat that lands on its feet (but not from anywhere)

**Scenario:** A stray cat takes the fastest route everywhere, hopping down ledges freely, but refuses drops taller than about three tiles.

```
Event: On start of layout
  Action: Cat -> PlatformerNavGraph -> SetPathStrategy  "Shortest Distance"
  Action: Cat -> PlatformerNavGraph -> Set max traversal drop  96

Event: Player -> On clicked
  Action: Cat -> PlatformerNavGraph -> FindPath  Mouse.X, Mouse.Y, "Yes", "Reach", "Default"
  // Reach mode: fail rather than settle for a partial route

Event: Cat -> PlatformerNavGraph -> On failed to find path
  Action: Cat -> Set animation  "Meow"
```

Set max traversal drop works with any strategy, not only No Falling. Here Shortest Distance still picks aggressive routes, momentum jumps included, but every jump or fall that would land more than 96 pixels lower is removed from the cat's options, so it takes the stairs down a tall building and hops the short ledges. Climbing is never limited: the check is on the downward drop only. If the only way down is a tall drop, Reach mode fails the path and the cat meows from the rooftop instead of attempting it; with the simple Find path actions (Nearest mode) it would walk to the edge and wait there instead.

### 39. Crossing a pit on a moving platform

**Scenario:** A Sine-driven platform shuttles over a spike pit between two ledges, and the enemy chasing the player rides it across.

```
// Platform: Sprite with Solid + Sine (Horizontal). No navigation events for it at all.

Event: Every 0.5 seconds
  Action: Enemy -> PlatformerNavGraph -> Find path to object  Player
```

The platform is left out of the obstacle map automatically and gets a ride link as soon as it moves (Sine), or after one full trip for other movements. The enemy walks to the ledge, times its step so it meets the platform at the edge, rides, and steps off. The chase loop keeps calling Find path the whole time: requests made while the enemy is on the platform are held and run the moment it steps off, so it never plans a route from mid-air.

### 40. Tower lift on a Tween

**Scenario:** A lift platform tweens between the ground floor and a balcony, pausing at each end.

```
// Lift: Sprite with Solid + Tween, moved up and down by your own events.

Event: Archer -> PlatformerNavGraph -> On portal entry
  Condition: System -> Compare two values  Archer.PlatformerNavGraph.PortalType(Archer.PlatformerNavGraph.CurrentPortalID) = "ride"
  Action: Archer -> Set animation  "Wait"
```

A vertical mover works exactly like a horizontal one, as long as the lift stops level with a ledge at each end. The ride link's cost includes the average wait, so the archer takes the stairs instead when that is quicker. `PortalType = "ride"` lets you play a waiting animation while it stands at the lift.

### 41. Drawbridge that lowers

**Scenario:** A lever lowers a drawbridge over the moat, and guards on the far side start using it as soon as it lands.

```
Event: Lever -> On pulled
  Action: Bridge -> Tween angle  0, 1.5 seconds
```

No navigation events. While the bridge rotates it is left out of the map; once it has been still for a moment it is added back where it landed, and only the area around it is updated. Guards patrolling the castle wall re-measure their platform's ends and walk out across the bridge on their next lap.

### 42. Crumbling floor

**Scenario:** Floor tiles crumble a second after the player steps on them, and enemies stop trying to cross.

```
Event: Player -> On landed
  Condition: Player -> Is overlapping CrumbleTile (offset 0, 4)
  Action: CrumbleTile -> Set animation  "Crumble"

Event: CrumbleTile -> On animation "Crumble" finished
  Action: CrumbleTile -> Destroy
```

Each crumble frame has a smaller collision polygon. The behavior compares each frame's collision footprint and updates the map as the floor breaks apart, then removes it when the tile is destroyed. Frames that keep the same polygon (a looping idle sparkle) cost nothing.

### 43. Portcullis that opens and closes

**Scenario:** A portcullis blocks a corridor until a switch raises it.

```
Event: Switch -> On activated
  Action: Portcullis -> Set animation  "Open"
  Action: Portcullis -> Solid -> Set enabled  "Disabled"
```

Switching Solid off (or collisions off) is detected by itself: the corridor opens in the navigation graph, and characters whose path ran into the gate re-path through it right away.

### 44. Bomb crater in a tilemap

**Scenario:** A bomb blows a hole in a solid tilemap floor, and an enemy should path around (or through) the crater in the same frame.

```
Event: Bomb -> On destroyed
  Action: Ground -> Erase tile range  Ground.PositionToTileX(Bomb.X) - 2, Ground.PositionToTileY(Bomb.Y) - 2, 5, 5
  Action: Enemy -> PlatformerNavGraph -> Regenerate region  Bomb.X - 64, Bomb.Y - 64, Bomb.X + 64, Bomb.Y + 64
  Action: Enemy -> PlatformerNavGraph -> Find path to object  Player
```

Tile edits are detected automatically within a fraction of a second. Regenerate region is only here because the Find path right after it must see the crater in the same frame.

### 45. Endless runner chaser

**Scenario:** Level chunks spawn ahead of the player and are destroyed behind them, far past the layout's edge, while a monster chases.

```
Event: Player.X > NextChunkX - 1200
  Action: System -> Create object  ChunkFloor at (NextChunkX, 600)
  Action: System -> Add 640 to NextChunkX

Event: ChunkFloor.X < Player.X - 2000
  Action: ChunkFloor -> Destroy

Event: Every 0.5 seconds
  Action: Monster -> PlatformerNavGraph -> Find path to object  Player

Event: Every 1 second
  Action: Monster -> PlatformerNavGraph -> Set navigation area  Player.X - 2400, 0, Player.X + 2400, 1080
```

With Auto-Build, the navigation map grows by itself when obstacles appear beyond its edge, keeping everything already built and only scanning the new cells. Destroyed chunks are cleared from the map the same way, and content at negative co-ordinates works too. The navigation area keeps memory and update cost flat however long the run lasts: the map slides along with the player, scanning the chunks ahead and dropping the ones behind.

### 46. Castle patrol route across three floors

**Scenario:** A night watchman walks a fixed round: gatehouse, then up the lift to the battlements, then the tower, and back.

```
Event: On start of layout
  Action: Watchman -> PlatformerNavGraph -> Start patrol between objects  WatchPost, "Ping-pong", 2

Event: Watchman -> PlatformerNavGraph -> On patrol dwell started
  Condition: System -> Compare two values  Watchman.PlatformerNavGraph.PatrolPointIndex = 1
  Action: Watchman -> Set animation  "LookOut"
```

Place the WatchPost markers in the order of the round (the instance order). The watchman paths between them with every move he knows, riding the lift on the way, and PatrolPointIndex lets each post play its own idle.

### 47. Guards that feel alive

**Scenario:** A row of guards paces a courtyard without moving in lockstep, walks slowly while on duty, chases at full speed, and goes back to pacing on its own.

```
Event: On start of layout
  Action: Guard -> PlatformerNavGraph -> Start patrol  Dwell: 2, Edge distance: 32
  Action: Guard -> PlatformerNavGraph -> Set patrol setting  "Dwell variation", 1
  Action: Guard -> PlatformerNavGraph -> Set patrol setting  "Speed", 45
  Action: Guard -> PlatformerNavGraph -> Set patrol setting  "Resume after", 3

Event: Guard -> LineOfSight -> Has LOS to Player
  Action: Guard -> PlatformerNavGraph -> Find path to object  Player
```

Each wait lasts 1 to 3 seconds, so the guards drift out of step. The chase runs at full speed, and 3 seconds after a guard stops chasing it patrols whatever platform it ended up on. No On arrived bookkeeping.

### 48. Fire imp that strolls through lava

**Scenario:** Ordinary guards turn back before a lava pool; a fire imp walks straight through it.

```
Event: On start of layout
  Action: AnyGuard -> PlatformerNavGraph -> Add hazard from object  LavaPool, 10
  Action: AnyGuard -> PlatformerNavGraph -> Start patrol  Dwell: 1, Edge distance: 0
  Action: FireImp -> PlatformerNavGraph -> Set patrol option  "Turn before danger", "Disabled"
```

Patrollers turn before stepping somewhere more dangerous than where they stand, including hazards from objects such as a passing fireball. Set patrol option switches that off per character. The other option, Turn at characters, makes two patrollers meeting head-on both turn around; switch it off where guards should brush past each other.

### 49. Crusher corridor

**Scenario:** Stone crushers slam up and down along a corridor; enemies should prefer the upper walkway, and guards should turn back before a crusher instead of walking under it.

```
// Crusher: Sprite with Solid + Sine (Vertical). No navigation events.

Event: Every 0.5 seconds
  Action: Enemy -> PlatformerNavGraph -> Find path to object  Player
```

A moving Solid object that cannot be ridden gets an automatic danger area over the space it sweeps through. Routes through the corridor become expensive, so enemies take the walkway when there is one and only run the gauntlet when there is no other way. When they do, they wait beside each crusher and dash under it once it has risen far enough to let them through. Patrolling guards in the corridor turn before stepping under a crusher.

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

**Lemmings-style automation.** Autonomous workers with auto-control walk routes between task markers; Ground-Hugging keeps their movement predictable enough for the player to plan around.

**Wave defense / horde survival.** Spawners dump mobs on a timer, MaxPathsPerTick keeps A* cost flat, and OnWaypointStuck feeds a cull list for mobs wedged by player-built barricades.

**Boss rush.** Each boss reuses the same arena graph with a different strategy preset and jump override, so movement personality changes per boss with three actions of configuration.

**Dungeon crawler.** Multi-floor towers use elevator groups for the lift shafts and door portals between rooms; enemies chase the player across floors without any floor-management events.

**Escort mission.** The VIP walks Safest Route with Ledge Restriction on, pausing when the player falls behind (distance check gates the Find path calls) and hazards keep them out of turret arcs.

**Speedrun rival ghost.** An AI rival races the player using Shortest Distance, coyote time, and Relaxed positioning, taking risky jump-falls a human speedrunner would attempt.

**Barricade siege.** The horde piles against a player-built wall: Crowd Arrivals tiles attackers along the barricade line instead of merging them into one pixel, and Separation Cooldown 0 keeps the pile visibly squirming while they claw at it. When the wall breaks (tile cleared, graph regenerated), every claim re-resolves and the horde pours through in a spread wave.

**Fireteam squad.** Soldiers gather on the player's rally flag with Crowd Arrivals, each taking its own spot; a marker sprite at each soldier's PathEndX/Y shows the player exactly where everyone will stand before they arrive. Idle Separation holds their spacing when combat knocks them around.

**Pet collection.** A dozen pets trail the player with Nearest-mode Find path calls. Crowd Arrivals assigns each pet its own spot at heel instead of a single writhing stack, Idle Separation keeps them from merging when the player stops, and the separation give-up means they settle calmly on narrow ledges instead of pacing forever.

**Arena lineup.** Fighters teleport onto the starting platforms between rounds. Teleporting automatically resets the separation give-up state, so each fighter takes one composing step to its mark and then holds; a short give-up time with a long Separation Cooldown makes the lineup snap into place and stand at attention.

**Town crowds.** Ambient NPCs wander between market stalls with Ground-Hugging so nobody hops onto rooftops. Idle Separation with a generous value and a long Separation Cooldown produces natural-looking clusters: people drift apart when a spot gets crowded, then settle and chat instead of endlessly shuffling.

**Farming and village sims.** Villagers path between homes, fields, and shops on a shared graph; doors are instant portals with entry pauses that play open animations, and the whole town shares one build.

**Zombie survival.** Hordes use avoidance to spread around barricades, fall-through connections to drop through one-way floors, and hazard zones around fire keep them shambling along flanking routes.

**Brawler with arenas.** Enemies keep to platforms with Ledge Restriction while approaching, then disable it and lunge when in range, mixing safe navigation with committed attacks.

**Tactics-lite auto battler.** Units walk to assigned lane markers using Ground-Hugging so their approach is legible; portals model deployment tubes that drop units into the arena.

**Sandbox physics game.** Player contraptions add and remove solid tiles constantly; time-sliced rebuilds absorb the churn, and creatures re-path from OnGraphGenerated so they always respect the latest contraption.

**Mining and digging game.** Every dug tile is a SetTileState "Clear", and the graph rebuilds itself, letting cave creatures flow into freshly opened tunnels toward the player.

**Metroid-style boss minions.** A boss spawns minions that use the boss's own graph instantly (shared mode), each with a different strategy preset so the pack approaches from multiple angles at once.

**Castle garrison.** Every guard in the keep runs Start patrol from On navigation graph generated: one action per guard, no marker objects, and each patrols whatever rampart it spawned on. Alerts are just Find path to object (which ends the patrol) and On arrived restarts it wherever the chase ended.

**Duel-based fighter.** Challengers approach with Find path to side of object so they square up at sword's length instead of clipping into the player, with the Distance parameter setting each weapon's reach: daggers close in tight, spears stop well back.

**King-of-the-hill arena.** Bots race for high ground using Find path to nearest ledge toward the hill, then hold the summit with a patrol; NearestLedgeLeftX/Y and NearestLedgeRightX/Y let a coaching UI draw arrows to the contested edges.

**Fishing village ambience.** Dock workers patrol their piers with long dwells and slow speeds, turning at the water's edge automatically because pier ends are ledges; On patrol end reached triggers idle chatter bubbles at each turn.

**Beat 'em up lane fights.** Fodder enemies queue on both flanks with Find path to side of object at staggered distances (24, 56, 88), forming the classic "two swing while the rest circle" ring; the front slot on each side attacks, and when it dies the next re-issues the call and slides into the gap.

**Ambush predator.** A ceiling stalker patrols the ledge above a corridor, and when the player passes underneath (compare X against the ledge span) it stops the patrol and JumpTowardPosition dives straight down; missed pounces recover with Find path to nearest ledge back to a perch.

**Base builder work crews.** Builders path to a side of the construction site with a distance matching their tool's reach (hammer 8, crane 96), so scaffolding sprites never overlap the blueprint; while a site queue is empty they Start patrol along the compound wall as ambient activity.

**Escort convoy scouts.** Outriders hold formation with Find path to side of object on the wagon (Left for the rear guard, Right for the vanguard, distance by rank) re-issued on a timer, so the convoy keeps its shape over jumps and slopes; at camp stops they switch to slow patrols with long dwells.

**Bodyguard detail.** A VIP's guards flank with Find path to side of object (one Left, one Right, distance 40) whenever the VIP stops, and On patrol end reached is unused because they never patrol: the pair simply re-flanks after every VIP move, reading NearestLedgeLeftX/Y to tighten up when the VIP stands near a drop.

**Cliffside nesting birds.** Flightless birds scatter to Find path to nearest ledge "Any" when startled, each claiming a different edge thanks to Crowd Arrivals, then hold their spots with patrols on their narrow outcrops that read as nervous hopping.

**Noir stakeout.** Two detectives pace opposite ends of a rooftop; On patrol dwell started pops a speech bubble from a rotating line list and On patrol dwell finished hides it, so the banter naturally syncs to the pacing without a single timer.

**Bolt-hole rats.** When the cat lands on their platform, rats run Find object on same platform with "Furthest" against the burrow objects and flee to the bolt-hole farthest from where they stand, which usually means past the cat's flanks; rats whose platform has no burrow (UID -1) scatter to Find path to nearest ledge instead.

**Taunting decoy.** A decoy NPC only plays its taunt when Is on same platform as object confirms the enemy could actually walk over; enemies a jump away get ignored, so the taunt reads as street smarts rather than suicidal bravado, and the same check gates which enemies take the bait.

**Armored knight escort.** The knight uses the No Falling strategy: it never hops off ledges, marching the long way down every ramp and riding the elevators, while the scout escorting it (Balanced) skips ahead over the drops. Same map, same graph, two silhouettes of movement from one property. A fall-damage game adds Set max traversal drop with its safe-fall height so short hops stay allowed.

**Tower defense with ground crawlers.** Crawler enemies use Walk Only and fliers use Balanced on a shared map: crawlers can only reach the base by the ramps the player has not blocked, so every placed barricade genuinely reroutes them, while the fliers ignore the maze entirely. The contrast forces players to defend two ways.

**Hauling heavy loot.** A thief switches to No Falling the moment it picks up a heavy sack (and back to Shortest Distance when it drops it), so carrying the loot visibly slows its escape down the ramps, giving the player a window to chase.

**Children in a playground.** Toddlers use Walk Only so they wander their own platform and stop at the edge nearest a called parent, older kids use Set max traversal drop 64 to hop down the low steps but take the slide from the high tower, and teenagers use Shortest Distance to leap off everything.

**Endless runner.** A pursuer chases the player through procedurally spawned chunks far beyond the layout; the navigation map grows as chunks appear and forgets the ones destroyed behind, with no setup events.

**Destructible sandbox.** Bombs erase tilemap tiles, walls crumble frame by frame, and doors switch their Solid behavior off. Every change updates only the nearby part of the graph, so a hundred enemies keep their paths while the level falls apart around them.

**Tower climb with lifts.** Sine and Tween platforms ferry characters between floors; enemies time their step onto the platform like a player would, and chase loops keep working through every ride.

**Night watch stealth.** Watchmen walk fixed rounds between posts on several floors with Start patrol between objects, pace slowly with random pauses, sprint when they spot the player, and return to their rounds on their own with Resume after.

**Castle siege.** Battering rams knock down wall segments and drawbridges lower mid-battle; attackers re-route the moment a breach opens and patrolling defenders re-measure the shrinking battlements.

**Industrial gauntlet.** Pistons, crushers and spinning saws move on Sine and Timeline behaviors; enemies route around their swept areas automatically, and when no other path exists they wait for an opening and time their crossing.

**Volcano level.** Lava pools are tile hazards that patrolling guards turn back from, while fire imps (Turn before danger disabled) wander straight through them.

---
## 18. C3 Debugger

Run a debug preview (the bug icon, or F5 with debugging) and select your character. The behavior adds five sections to the inspector.

**Navigation Graph**

| Field | What it means |
|---|---|
| `generated` | True once the graph is built. False means Find path will fail. |
| `nodes` | Walkable node count. A very low count usually means a misconfigured obstacle map. |
| `gridSize` | Grid dimensions in tiles, e.g. `40x24`. Usually the layout size divided by the tile size; larger when obstacles sit outside the layout, and the window size when Set navigation area is used. |
| `obstacleSource` | Where the map came from: `collision`, `custom`, or `none`. |
| `mapTag` | The Map Tag this character shares its map with, or `(default)`. Characters only share a map (and avoid each other) when this matches. |

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
| `navEnabled` | The Enabled property / Set enabled switch. False means navigation is frozen. |
| `multiplayer` | `host only` (default), `paused (peer)` while this machine is a multiplayer peer, or `runs everywhere` after Set multiplayer mode. |
| `cellSize` | The tile size the graph was built with (the resolved value when Tile Size is auto). |
| `maxJumpHeight` / `maxJumpDistance` / `maxFallDistance` | The physics limits the graph was built with, in pixels. |
| `debug` | Whether console logging is on. |
| `platformBehavior` | `found` or `not found`. Not found means no movement is possible. |

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

nav.SetMovementLimit("coyote_time", 0.15);   // "Set movement setting" (keeps its original ID)
nav.SetMovementLimit("ledge_leniency", 8);
nav.SetMaxPathsPerTick(4);
nav.JumpTowardPosition(player.x, player.y);
nav.RegenerateObstacleMap();
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
| `SetCrowdFeature(feature, state)` | `feature` | 0 = Crowd arrivals, 1 = Multi-agent avoidance |
| | `state` | 0 = Enabled, 1 = Disabled |
| `SetMovementLimit(setting, value)` | `setting` | 0 = Jump height, 1 = Jump distance, 2 = Fall distance, 3 = Coyote time, 4 = Ledge leniency |
| `SetPathStrategy(strategy)` | `strategy` | 0 = balanced, 1 = shortest, 2 = safest, 3 = simplest (Ground-Hugging) |

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
  if (entry && exit) nav.AddPortal(1, 0, entry.x, entry.y, exit.x, exit.y, 1, 0, "door"); // two-way, instant
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

With Auto-Build Graph set in the editor, no map setup call is needed here; use `nav.BuildObstacleMapFromLayout(...)` and the scan actions for the manual flow.

---

## 20. Tips and Common Mistakes

- **Tile Size must match your grid.** The default is 32 px; if your tilemap's tile size differs, set Tile Size to match or set it to 0 to auto-detect. A mismatch misaligns the whole graph, and characters walk into walls.

- **Place portal ends where a character can stand.** Each end connects to the nearest walkable tile when the graph builds, so an entry floating mid-air or buried in a wall connects somewhere unexpected (the console warns when both ends resolve to the same tile). Portals can be added at any time, including `On start of layout`, and survive rebuilds automatically.

- **`PauseAtPortal` only works inside `On portal entry`.** Anywhere else it is intentionally ignored, so a stray call cannot wedge the portal state machine.

- **Slope tiles must be registered.** Unregistered slopes read as solid to walking and as air to the jump arc check, so jumps clip through them. With Debug Logging on, unregistered tile IDs are listed in the console during slope mapping. Registration order does not matter; the graph rebuilds itself when slopes arrive late.

- **Tile changes rebuild the graph automatically.** `SetTileState` and `SetTileStateWorld` mark the graph for a rebuild on the next tick, so many edits in one event cost a single, time-sliced rebuild.

- **Graph builds are asynchronous by design.** Large maps build across several ticks. Wait for `On navigation graph generated`, or simply call a Find path action, which finishes any in-progress build synchronously before searching.

- **`no_start_node` means the character is not over walkable ground.** Use ground correction (the simple Find path has it on by default), or check that the character did not spawn inside geometry or mid-air over a pit.

- **Ledge Restriction and Coyote Time cancel each other.** Coyote jumps require walking off an edge; ledge restriction prevents exactly that. Enable at most one of the two per character.

- **Removing all portals (RemovePortalsByTag with an empty tag) also wipes elevator groups.** For selective cleanup prefer `RemovePortal` by ID or a specific tag, and give portals tags when you add them.

- **Keep Enable Debug Logging off in release builds.** Console output is expensive, particularly on mobile. The property defaults to off; turn it on while developing or troubleshooting.

- **Auto-Build Graph defaults to Auto so the addon works the moment it is added.** Explicit setup actions in On start of layout always take precedence, so event-driven projects keep working unchanged. Set it to Off if your project builds its map later than layout start (for example after multi-frame procedural generation).
