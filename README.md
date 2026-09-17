<img src="./src/icon.svg" width="100" /><br>
# Platformer Navigation Graph
<i>Smart pathfinding for platformer games. Characters automatically jump across gaps, fall between platforms, and find optimal routes through complex levels. Includes instant portals (teleporters, doors) and gradual portals (elevators, ladders, ziplines) with pause/resume support for custom animations. Features hazard avoidance, multiple path strategies, coyote jumps, ledge restriction, and multi-agent support. Works with the built-in Platform behavior — just add the behavior and go.</i> <br>
### Version 0.6.0.0

[<img src="https://placehold.co/200x50/4493f8/FFF?text=Download&font=montserrat" width="200"/>](https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2/releases/download/salmanshh_platformer_navigationgraph-0.6.0.0.c3addon/salmanshh_platformer_navigationgraph-0.6.0.0.c3addon)
<br>
<sub> [See all releases](https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2/releases) </sub> <br>

#### What's New in 0.6.0.0
**Added:**
- Map Tags: instances with the same Map Tag share one navigation map, so one layout can host several shared maps (ghosts, flyers, giants). Empty tag = the default shared map.
- Portals, hazards, cell-size auto-detection, avoidance, and builds all operate per map tag.
- One map copy per map: instances share obstacle/slope/hazard data by reference.
- Map-setup actions run once per picked set; the other instances adopt the result.
- Debug warning when an instance's jump physics differ >20% from the shared graph (suggests a separate Map Tag).
- Debug aids for tag typos: console lists active tags when a new one appears; debugger shows each instance's tag.
- MapTag expression (Obstacles).
- Detect Slopes property: solid scans probe collision shapes and auto-register 45/22.5-degree slopes, no tile ID lists needed.
- AutoDetectSlopeTiles rebuilt on the documented collision API (containsPoint), with flip handling and per-shape caching.
- Hazard changes now apply automatically: costs re-bake lazily once per map per tick, O(nodes + hazard area), so hundreds of hazards stay cheap.
- Tracked hazards (AddTrackedHazard / ClearAllTrackedHazards / TrackedHazardCount): hazards that follow objects with no per-frame events and auto-remove on destroy.
- LastHazardID expression for removing or tracking a just-added hazard.
- Portal move-in-place (SetPortalPosition / SetPortalPositionFromObjects): preserves ID, type, cost, speed, and tags; connections re-wire immediately.
- Enabled property (panel bottom) plus Set enabled action and Is enabled condition; disabling freezes navigation with all state kept.
- PathEndX / PathEndY expressions: the path's actual final position (differs from the target in Nearest mode).
- BREAKING: PathTargetX/Y(type) and PathTargetGridX/Y replaced by parameterless TargetX / TargetY / TargetGridX / TargetGridY.

**Changed:**
- Drop-in defaults: Auto-Build Graph = Auto, Detect Slopes = on, Tile Size = 32 (0 = auto-detect). Working pathfinding from a single Find path event.
- BREAKING: Graph Mode property and Per-Instance mode removed; Map Tags supersede them. Property indices after slot 5 shifted, so re-check properties in older projects.
- ACE categories reorganized to mirror the built-in Pathfinding behavior: Pathfinding, Movement, Obstacles, Hazards, Portals, Debug (IDs unchanged, saves unaffected).
- List names matched to the built-in behavior: On arrived, On failed to find path, Stop, Is moving along path, Is calculating path (IDs unchanged).
- BREAKING: Debug graph ACEs renamed with a Graph prefix (GraphNodeCount, GraphNodeAtIndex*, NearestGraphNode*, Graph node exists...) since the built-in behavior uses node to mean path waypoint. Path steps stay Waypoint*. Scripting names follow.
- Set multi-agent avoidance labels normalized to Enabled/Disabled.
- Guide: new map tags section; reference tables regrouped into the six new categories.

**Fixed:**
- Instances that never ran a map-setup action (late spawns, second object types) had no grid dimensions, silently breaking node lookups; map state is now shared to every subscriber.
- Starting a graph build cancels another instance's in-flight build for the same map instead of both mutating the shared graph.
- Multi-agent avoidance spatial hash is cached per map instead of globally.
- Hazards added or removed mid-game had no effect until a full graph rebuild.
- Hazard IDs now come from a shared counter; per-instance counters could collide in shared maps.
- Undocumented-API audit: layout name replaces layout.uid (read undefined), isJumping replaces the nonexistent isRising, jumpSustain normalized for the seconds-vs-milliseconds ambiguity.

<sub>[View full changelog](#changelog)</sub>

---
<b><u>Author:</u></b> SalmanShh <br>
<sub>Made using [CAW](https://marketplace.visualstudio.com/items?itemName=skymen.caw) </sub><br>

## Table of Contents
- [Usage](#usage)
- [Examples Files](#examples-files)
- [Properties](#properties)
- [Actions](#actions)
- [Conditions](#conditions)
- [Expressions](#expressions)
---
## Usage
To build the addon, run the following commands:

```
npm i
npm run build
```

To run the dev server, run

```
npm i
npm run dev
```

## Examples Files
| Description | Download |
| --- | --- |
| Platformer Pathfinding Example | [<img src="https://placehold.co/120x30/4493f8/FFF?text=Download&font=montserrat" width="120"/>](https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2/raw/refs/heads/main/examples/Platformer%20Pathfinding%20Example.c3p) |

---
## Properties
| Property Name | Description | Type |
| --- | --- | --- |
| Enable Debug Logging | Show helpful debug messages in browser console (F12) to troubleshoot pathfinding issues. Disable for better performance in final game. | check |
| Tile Size | Size of each grid tile in pixels. MUST match your tilemap's tile size / Pathfinding behavior's Cell Size — a mismatch misaligns the graph and characters walk into walls. Set to 0 to auto-detect it (reads the Pathfinding behavior's Cell Size, or the solid tilemap's tile size). Smaller = more precise paths but slower performance. | integer |
| Max Search Nodes | Maximum pathfinding effort before giving up. Higher = finds paths in larger levels but may cause lag. Lower = faster but may fail on complex paths. | integer |
| Max Fall Distance | Maximum fall distance in pixels. 0 = auto-detect from Platform behavior. -1 = unlimited (any fall). Positive value = custom max in pixels. | integer |
| Auto-Control Movement | When enabled, AI automatically controls the character (moves left/right, jumps). When disabled, you handle movement yourself using the path data. | check |
| Path Strategy | How the AI picks the best route when multiple paths exist. Balanced: weighs distance and difficulty equally, good for most platformers and adventure games. Shortest Distance: always takes the fastest route even with risky jumps, ideal for speedrunner games and time trials. Safest Route: avoids jumps and falls when possible, great for stealth games, escort missions, or fragile NPCs. Simplest Path: fewest waypoints for predictable movement, best for simple enemies and tower defense creeps. | combo |
| Smooth Paths | Remove unnecessary waypoints for more natural movement. AI will take direct routes when possible instead of zigzagging. | check |
| Max Waypoint Time | How long (in seconds) AI tries to reach each waypoint before giving up and recalculating path. Prevents infinite loops when stuck. | float |
| Coyote Time | Seconds after walking off a ledge where a jump can still be executed. Allows AI to walk off edges and jump mid-air for greater reach, making slightly out-of-range platforms reachable. Important: only works when 'Ledge Restriction' is disabled — if Ledge Restriction is enabled, characters won't walk off edges, so coyote jumps can never execute and the connections will go unused. 0 = disabled. | float |
| Strict Jump Positioning | When the AI is following a path and needs to jump or fall to another platform, it will slow down and carefully position itself on the tile before launching. This prevents characters from overshooting edges and missing jumps — like a chase enemy flying off a ledge instead of jumping across, or an escort NPC slipping off a narrow bridge mid-jump. Note: this only affects movement DURING pathfinding (jumps and falls that are part of the path). To stop characters from walking off edges entirely, use 'Ledge Restriction' instead. Recommended ON for most games. | check |
| Ledge Restriction | Prevents AI characters from walking off platform edges when they have no reason to leave. Useful for patrol guards that should stay on their platform, or NPCs that shouldn't wander off rooftops. Note: this only stops characters from casually walking off edges — if the AI's path requires a jump or fall to reach its goal, it will still leave the platform. When enabled, 'Coyote Time' has no effect since characters won't walk off edges to trigger it. When disabled, characters can slide off edges freely, which also enables wall-adjacent jumps (walking to the platform edge to clear a wall before jumping). To make jumps and falls more precise, use 'Strict Jump Positioning' instead. | check |
| Ledge Leniency | How many pixels past a platform edge the AI is allowed to walk before stopping (0 = strict stop at edge). Increase for more natural-looking movement near edges. Only used when Ledge Restriction is enabled. | float |
| Re-Path Threshold | How many tiles the character can deviate from its path before automatically recalculating. Useful when the character gets knocked off course. 0 = disabled. | float |
| Hazard Radius | Tile radius for hazard cost falloff buffer zone. Nearby tiles within this radius of a hazard get cost penalties. 0 = no buffer, only exact hazard tiles affected. | integer |
| Auto-Build Graph | Zero-event startup: automatically build the obstacle map and navigation graph on startup, no events needed. Auto (default): use the Pathfinding behavior's map if one is attached to this object, otherwise scan all objects with Solid/Jump-thru behaviors. Explicit map-setup actions in 'On start of layout' always take precedence. From Pathfinding: always wait for the Pathfinding behavior's map. From Solids: always scan Solid/Jump-thru objects. Off: set the map up yourself with actions (still picks up an attached Pathfinding behavior's map automatically). | combo |
| Map Tag | Instances with the same map tag on a layout share one navigation map and graph. Leave empty to share with everyone (recommended). Give special characters their own tag (e.g. 'ghost' for wall-phasing enemies, 'flyer' for airborne ones), then set up that tag's obstacle map, portals, and hazards on an instance carrying that tag. Each tag builds and stores its own map, so use few tags. | text |
| Detect Slopes | During solid scanning (including Auto-Build), probe each partially-solid tile's collision shape and automatically register 45° and 22.5° slope surfaces as slopes — no tile ID lists needed. Tiles whose shape doesn't match a supported slope angle stay solid, so this is safe to leave on. Requires tiles/sprites to have actual sloped collision polygons. Turn off to register slopes yourself with the slope actions only. | check |
| Enabled | Whether the behavior starts active. While disabled, the character stops following paths and Find path actions are ignored; the current path, graph, and settings are kept and everything resumes when re-enabled. Toggle at runtime with the 'Set enabled' action. | check |


---
## Actions
| Action | Description | Params
| --- | --- | --- |
| Log graph stats | Print navigation graph statistics to the browser console. Useful for debugging — shows node count, connection count, portal count, etc. |  |
| Add circle hazard | Add a circular hazard area. The AI will avoid this area based on severity. Hazard avoidance is automatically enabled. Returns a hazard ID for later removal. Use for dynamic danger zones like explosions or enemy AOE. | X             *(number)* <br>Y             *(number)* <br>Radius             *(number)* <br>Severity             *(number)* <br> |
| Add rectangle hazard | Add a rectangular hazard area. The AI will avoid this area based on severity. Hazard avoidance is automatically enabled. Returns a hazard ID for later removal. Use for static danger zones like spike pits. | X             *(number)* <br>Y             *(number)* <br>Width             *(number)* <br>Height             *(number)* <br>Severity             *(number)* <br> |
| Add tracked hazard (follows object) | Add a circular hazard that follows an object's position automatically every tick — for moving dangers like patrolling saws, fireballs, or spreading flames. No per-frame events are needed: path costs update only when the object actually moves, and the hazard removes itself when the object is destroyed. Read the new hazard's ID with LastHazardID; RemoveHazard removes it like any other hazard. | Object to follow             *(object)* <br>Radius             *(number)* <br>Severity             *(number)* <br> |
| Clear all hazards | Remove all circular and rectangular hazards. This does NOT clear tile-based hazards. Use when resetting a level or clearing all dynamic dangers. |  |
| Clear all tile hazards | Reset all tile hazard severities to 0. This does NOT remove circle/rect hazards. Use when you want to clear static tile dangers. |  |
| Clear all tracked hazards | Remove every tracked (object-following) hazard. Static circle/rect hazards and tile hazards are untouched. |  |
| Remove hazard | Remove a hazard by its ID. Use this when a danger zone is no longer active. The graph will be regenerated if needed. | ID             *(number)* <br> |
| Set hazard radius | Set the radius in tiles for circular/rectangular hazard influence. Tiles within this radius of a hazard will have their pathfinding cost increased. | Tiles             *(number)* <br> |
| Set tile hazard severity | Set the hazard severity for a specific tile. Higher values make the AI avoid this tile more strongly. 0 = no hazard. Hazard avoidance is automatically enabled when any hazard is added. Use this to mark dangerous areas like spikes or lava. | Grid X             *(number)* <br>Grid Y             *(number)* <br>Severity             *(number)* <br> |
| Jump toward position | Immediately jump toward a target position. The character jumps from its current position with full strength, moving horizontally toward the target. No pathfinding is involved — the character simply lunges at the target. Use for: jump attacks, stomps, lunges. Triggers 'On jump toward executed' when the jump starts. The character must be on the floor to jump. | X             *(number)* <br>Y             *(number)* <br> |
| Set auto-control | Toggle auto-movement on/off. When enabled, the behavior automatically controls the Platform behavior to follow paths. When disabled, you control movement yourself using path data expressions. | Enabled             *(combo)* <br> |
| Set coyote time | Set the coyote time window in seconds. The AI can jump within this window after walking off a ledge. Set to 0 to disable coyote time. | Seconds             *(number)* <br> |
| Set enabled | Enable or disable this behavior. While disabled, the character stops following paths and Find path actions are ignored; the current path, graph, and settings are kept and everything resumes when re-enabled. Map setup actions (scans, tiles, portals, hazards) still work while disabled. | State             *(combo)* <br> |
| Set ledge leniency | Set how many pixels past a platform edge the AI can walk before stopping (0 = strict stop). Increase for more natural-looking patrol movement near edges. Only used when ledge restriction is enabled. | Pixels             *(number)* <br> |
| Set ledge restriction | Prevents AI characters from walking off platform edges when they have no reason to leave. Useful for patrol guards that should stay on their platform, or NPCs that shouldn't wander off rooftops. This only stops characters from casually walking off edges — if the AI's path requires a jump or fall to reach its goal, it will still leave the platform. | Enabled             *(combo)* <br> |
| Set max fall distance | Override the maximum fall distance (in pixels) the AI is allowed to drop when pathfinding. Falls beyond this value will not be considered as valid connections. Calling this locks in the value. | Distance             *(number)* <br> |
| Set max jump distance | Override the maximum horizontal jump distance (in pixels) used to build navigation graph connections. Use this if the auto-detected value from the platform behavior is wrong for your setup. Calling this locks in the value — it won't be overridden by platform behavior properties. | Distance             *(number)* <br> |
| Set max jump height | Override the maximum jump height (in pixels) used to build navigation graph connections. Use this if the auto-detected value from the platform behavior is wrong for your setup. Calling this locks in the value — it won't be overridden by platform behavior properties. | Height             *(number)* <br> |
| Set strict jump positioning | Toggle whether this AI character slows down and carefully positions itself before jumping or falling during pathfinding. This does NOT affect walking off edges (use 'Set ledge restriction' for that). Use this to change behavior at runtime — for example, disable when a boss enters 'rage mode' for reckless movement, or enable when an NPC needs to carefully cross a narrow bridge. | Enabled             *(combo)* <br> |
| Auto-detect slope tiles from tilemap | Scan a Tilemap and automatically register slope tiles by probing their collision shapes: surfaces at 45° become slopes, surfaces at 22.5° become gentle slopes, and flipped tile placements are handled automatically. Uses the documented collision API, so it works wherever collisions work. Requires slope tiles to have sloped collision polygons set in the C3 editor; tiles that don't match a supported angle stay solid. For fully hands-off slope detection during scanning, enable the 'Detect Slopes' property instead. | Tilemap             *(object)* <br> |
| Build obstacle map from layout | Create an empty obstacle map grid from layout pixel dimensions. No Pathfinding behavior required. Follow with ScanSolidObjectsIntoObstacleMap and ScanJumpThruObjectsIntoObstacleMap to fill it. | Layout width (px)             *(number)* <br>Layout height (px)             *(number)* <br> |
| Clear all slope markings | Remove all slope markings from the obstacle map. Slopes will be treated as regular solid tiles. Use this to reset slope data. |  |
| Clear obstacle map | Remove the obstacle map and all associated data. Use this when switching levels or resetting the navigation system. |  |
| Create custom obstacle map | Create a custom obstacle map with the specified dimensions in tiles. All tiles are initialized to 'clear' state. Use this when not using the Pathfinding behavior's obstacle map. | Width             *(number)* <br>Height             *(number)* <br> |
| Generate navigation graph | Generate the navigation graph from the current obstacle map. Call this after setting up all tiles and before pathfinding. This is an expensive operation. |  |
| Load obstacle map from JSON | Load a previously saved obstacle map from JSON string. Use this to restore saved maps or load pre-built level data. | JSON             *(string)* <br> |
| Map slope tiles from tilemap | Scan a Tilemap and mark tiles matching the given tile IDs as slopes. Pass tile IDs as comma-separated strings (e.g. '5,6,7'). Pass empty string to skip a slope type. Requires the obstacle map to be created first. | Tilemap             *(object)* <br>Slope left IDs             *(string)* <br>Slope right IDs             *(string)* <br>Gentle left IDs             *(string)* <br>Gentle right IDs             *(string)* <br> |
| Mark slope region | Mark a diagonal region of tiles as slope. Specify the start and end grid corners. All tiles along the diagonal will be marked as slope with the given direction. | Start X             *(number)* <br>Start Y             *(number)* <br>End X             *(number)* <br>End Y             *(number)* <br>Direction             *(combo)* <br> |
| Regenerate navigation graph | Rebuild the navigation graph from scratch. Use after modifying the level layout, adding/removing obstacles, or changing platform positions. |  |
| Scan jump-thru objects into obstacle map | Scan one-way platform objects into the obstacle map as jump-thru cells. Requires an existing obstacle map (call BuildObstacleMapFromLayout first). Objects must have the Jump-thru behavior enabled. | Jump-thru objects             *(object)* <br> |
| Scan solid objects into obstacle map | Scan solid objects into the obstacle map. Requires an existing obstacle map (call BuildObstacleMapFromLayout first). Tilemaps are scanned cell-by-cell; sprites use bounding box. Objects must have the Solid behavior enabled. | Solid objects             *(object)* <br> |
| Set tile state | Set the state of a tile at the specified grid coordinates. Use this to mark tiles as solid obstacles, clear space, jump-thru platforms, areas to avoid, or slopes. | Grid X             *(number)* <br>Grid Y             *(number)* <br>State             *(combo)* <br> |
| Set tile state at world position | Set the state of a tile at the specified world coordinates. The world position is automatically converted to grid coordinates. | X             *(number)* <br>Y             *(number)* <br>State             *(combo)* <br> |
| Use Pathfinding obstacle map | Use the obstacle map from the Pathfinding behavior instead of a custom map. Enable auto-regenerate to automatically rebuild the graph when the Pathfinding map changes. | Auto-regenerate             *(combo)* <br> |
| Find path to position (advanced) | Calculate a path to the target coordinates with full control over ground correction, path mode, and jump positioning. For the common case, the simpler 'Find path' or 'Find path to object' actions are recommended. | X             *(number)* <br>Y             *(number)* <br>Correct to ground             *(combo)* <br>Mode             *(combo)* <br>Jump Positioning             *(combo)* <br> |
| Find path | Calculate a path to a position using sensible defaults: start and target snap to the nearest walkable ground, and if the exact target is unreachable the character paths as close as possible (never fails outright). This is the recommended action for most games. Use 'Find path to position (advanced)' for full control over ground correction, mode, and jump positioning. | X             *(number)* <br>Y             *(number)* <br> |
| Find path to object | Calculate a path to another object's position (e.g. the player) using sensible defaults: start and target snap to the nearest walkable ground, and if the exact target is unreachable the character paths as close as possible (never fails outright). Uses the first picked instance of the object. | Target object             *(object)* <br> |
| Set max paths per tick | Set how many pathfinding requests can be processed per game tick. Higher values reduce latency but increase CPU cost per frame. Default is 1. | Count             *(number)* <br> |
| Set multi-agent avoidance | Enable or disable path-level multi-agent avoidance. When enabled, agents try to avoid choosing overlapping paths when multiple agents share the same navigation map. | Enabled             *(combo)* <br> |
| Set path strategy | Change how the AI picks the best route when multiple paths exist. Balanced: weighs distance and difficulty equally. Shortest Distance: always takes the fastest route. Safest Route: avoids jumps and falls. Simplest Path: fewest waypoints. | Strategy             *(combo)* <br> |
| Set re-path cooldown | Set the minimum time in seconds between automatic re-path attempts. Lower values = more responsive re-pathing but more CPU usage. Default is 0.5 seconds. | Seconds             *(number)* <br> |
| Set re-path threshold | Set how many tiles the character can drift from the path before automatic re-pathing triggers. Higher values = more tolerance for deviation. | Tiles             *(number)* <br> |
| Stop | Stop the character immediately and clear the current path. Use when you want to cancel AI navigation and regain manual control. |  |
| Add elevator stop | Add a stop to an elevator group. Automatically creates two-way gradual portals between this stop and all other stops in the same group. Cost is auto-calculated from distance and speed. Use a unique group name (e.g. 'elevator_A') for each elevator. Use PortalExitX/PortalExitY in 'On portal entry' to determine which floor the AI is heading to. | Group             *(string)* <br>X             *(number)* <br>Y             *(number)* <br>Speed             *(number)* <br>Tag             *(string)* <br> |
| Add elevator stop from object | Add an elevator stop using an object's position. Same as 'Add elevator stop' but uses the object's current X/Y. The object serves as a floor marker. | Group             *(string)* <br>Object             *(object)* <br>Speed             *(number)* <br>Tag             *(string)* <br> |
| Add gradual portal | Add a portal that gradually moves the AI from entry to exit at the given speed. The character moves in a straight line (any direction — vertical, horizontal, or diagonal). Platform behavior is disabled during movement. Use for: elevators, lifts, moving platforms, ziplines. | Direction             *(combo)* <br>Entry X             *(number)* <br>Entry Y             *(number)* <br>Exit X             *(number)* <br>Exit Y             *(number)* <br>Cost             *(number)* <br>Speed             *(number)* <br>Tag             *(string)* <br> |
| Add gradual portal from objects | Add a gradual portal using two objects. Character moves from entry object to exit object at the given speed. Use for: linking elevator sprites, rope endpoints, etc. | Direction             *(combo)* <br>Entry object             *(object)* <br>Exit object             *(object)* <br>Cost             *(number)* <br>Speed             *(number)* <br>Tag             *(string)* <br> |
| Add instant portal | Add a portal that instantly teleports the AI from the entry to the exit. Use for: teleporters, doors, warp zones, or any portal where the character disappears and reappears at the exit. Use 'On portal entry' with 'Pause at portal' to play animations before the teleport happens. | Direction             *(combo)* <br>Entry X             *(number)* <br>Entry Y             *(number)* <br>Exit X             *(number)* <br>Exit Y             *(number)* <br>Cost             *(number)* <br>Tag             *(string)* <br> |
| Add instant portal from objects | Add an instant portal using two objects as entry and exit positions. The objects' current X/Y positions are used. Use for: linking door sprites, warp pad objects, etc. | Direction             *(combo)* <br>Entry object             *(object)* <br>Exit object             *(object)* <br>Cost             *(number)* <br>Tag             *(string)* <br> |
| Clear all portals | Remove all portals from the navigation graph. Useful when resetting the level or switching layouts. |  |
| Complete portal | Finish a paused portal without executing its built-in movement. Use this when you've already moved the character yourself (e.g., custom animation, physics launch, manual position set). The AI will continue pathfinding from wherever the character is now. Also works mid-traverse to cut a gradual portal short. |  |
| Pause at portal | Call INSIDE 'On portal entry' to pause the AI before the portal executes. The character stops at the entry point and waits. Use this to play animations, open doors, trigger screen transitions, or run any custom events before the portal activates. Call 'Resume portal' to execute the built-in behavior, or 'Complete portal' if you moved the character yourself. |  |
| Remove portal by ID | Remove a portal by its ID. The portal connection is removed from the navigation graph immediately. | Portal ID             *(number)* <br> |
| Remove portal at object | Remove the portal closest to this object. Works with both entry and exit positions — for two-way portals, either endpoint object can be used. | Object             *(object)* <br> |
| Remove portals by tag | Remove every portal whose tag matches the given string. Connections are removed from the navigation graph immediately. Use this to deactivate a group of related portals — for example, removing all 'door' portals when a room is sealed, or clearing 'floor_2' portals when a floor is destroyed. | Tag             *(string)* <br> |
| Resume portal | Continue portal execution after pausing with 'Pause at portal'. For instant portals: teleports the character to the exit. For gradual portals: begins moving the character toward the exit. Use this when you want the portal's built-in movement to handle the transition. |  |
| Set portal cost | Change how 'expensive' a portal is for the AI to use. Lower cost = preferred, higher cost = avoided. | Portal ID             *(number)* <br>Cost             *(number)* <br> |
| Set portal ignore hazards | Set whether a portal ignores nearby hazards when calculating its pathfinding cost. | Portal ID             *(number)* <br>Ignore hazards             *(combo)* <br> |
| Set portal position | Move an existing portal to new entry and exit positions, preserving its ID, type, cost, speed, and tags. Graph connections re-wire immediately (cheap enough to call on a timer for moving teleporters). A character already traversing the portal keeps its original destination; the move never teleports anyone. | Portal ID             *(number)* <br>Entry X             *(number)* <br>Entry Y             *(number)* <br>Exit X             *(number)* <br>Exit Y             *(number)* <br> |
| Set portal position from objects | Move an existing portal to two objects' current positions (first picked instances), preserving its ID, type, cost, speed, and tags. Combine with an Every X seconds event to make a portal follow moving objects, such as a teleporter drone. | Portal ID             *(number)* <br>Entry object             *(object)* <br>Exit object             *(object)* <br> |
| Set portal speed | Change the movement speed of a gradual portal (pixels per second). Has no effect on instant portals. | Portal ID             *(number)* <br>Speed             *(number)* <br> |
| Set portal tag | Assign a string tag to a portal. Tags are used to group portals so they can be removed together with 'Remove portals by tag'. A portal can only have one tag at a time — calling this again replaces the previous tag. | Portal ID             *(number)* <br>Tag             *(string)* <br> |
| Teleport to position | Instantly move the character to the given position. Can be used anywhere — inside portal events, on button press, on collision, etc. Suppresses re-pathing for one tick to prevent the AI from thinking it's lost. Useful with 'Pause at portal' + 'Complete portal' for fully custom portal behavior. | X             *(number)* <br>Y             *(number)* <br> |


---
## Conditions
| Condition | Description | Params
| --- | --- | --- |
| Graph node exists at grid position | Check if a navigation node exists at the specified grid coordinates. Use this to validate positions before pathfinding or placing objects. | Grid X *(number)* <br>Grid Y *(number)* <br> |
| Graph node exists at world position | Check if a navigation node exists at the specified world coordinates. Use this to validate world positions before pathfinding. | X *(number)* <br>Y *(number)* <br> |
| Is graph node a ledge | True if the node at the given grid coordinates is a ledge node (left or right ledge). | Grid X *(number)* <br>Grid Y *(number)* <br> |
| Is position hazardous | Check if a specific world position is within any hazard area (circle, rect, or tile). Returns true if any hazard affects this position. | X *(number)* <br>Y *(number)* <br> |
| Is at island | Check if the character is standing on a single-tile platform (isolated platform). Use this to detect precarious positions or trigger special behaviors. |  |
| Is at ledge | Check if the character is currently standing on a ledge node (edge of a platform). Use this to trigger ledge-specific behaviors or animations. |  |
| Is enabled | True while this behavior is enabled (see the Enabled property and the 'Set enabled' action). |  |
| Is platform enabled | Check if the associated Platform behavior is currently enabled. Returns false if Platform behavior is disabled or not found. |  |
| On jump toward launched | Triggered when the 'Jump toward position' action launches the character. Use this to play attack animations, spawn effects, or apply damage. The target position is available via JumpTowardTargetX/Y expressions. |  |
| On arrived | Triggered when the AI arrives at the final destination. Use this to trigger arrival animations, next actions, or goal completion logic. |  |
| On waypoint reached | Triggered each time the character reaches a waypoint along the path. Use this to play footstep sounds, particle effects, or update animations. |  |
| On waypoint stuck | Triggered when the character has been stuck at a waypoint for too long (exceeds Max Waypoint Time). The path is automatically cancelled. Use this to handle stuck situations or repath. |  |
| Is setting up Pathfinding | Check if the behavior is currently waiting for the Pathfinding obstacle map to initialize. Returns true during async setup. |  |
| On obstacle map created | Triggered when a custom obstacle map is successfully created. Use this to start configuring tiles after map creation. |  |
| On obstacle map removed | Triggered when the obstacle map is cleared or removed. Use this to clean up related data or reset systems. |  |
| On Pathfinding map failed | Triggered when the Pathfinding behavior's obstacle map fails to initialize. Use this to implement fallback error handling. |  |
| On Pathfinding map ready | Triggered when the Pathfinding behavior's obstacle map is ready for use. Use this to start graph generation after Pathfinding initialization. |  |
| On Pathfinding map timeout | Triggered when waiting for the Pathfinding obstacle map times out. Use this to handle slow or stuck initialization. |  |
| Tile has state | Check if a tile at the given grid position has the specified state. Use this to query tile properties before actions. | Grid X *(number)* <br>Grid Y *(number)* <br>State *(combo)* <br> |
| Tile has state at world position | Check if a tile at the given world position has the specified state. World coordinates are automatically converted to grid coordinates. | X *(number)* <br>Y *(number)* <br>State *(combo)* <br> |
| Is moving along path | Check if the character currently has an active pathfinding path. Returns true while navigating, false when idle or path is complete. Matches the built-in Pathfinding behavior's 'Is moving along path'. |  |
| Is multi-agent avoidance enabled | True if multi-agent avoidance is currently active. |  |
| Is calculating path | True when a pathfinding request has been submitted but not yet resolved (queued behind the per-tick path budget). Use to show a 'thinking' state or delay actions until the path arrives. |  |
| On navigation graph generated | Triggered when the navigation graph has been successfully generated. Use this to start pathfinding operations after map setup. |  |
| On failed to find path | Triggered when pathfinding fails to find a valid path to the target. Use this to handle unreachable destinations or implement fallback behaviors. |  |
| On path found | Triggered when a path has been successfully calculated. Use this to start custom actions when pathfinding succeeds. |  |
| On re-path triggered | Triggered when automatic re-pathing occurs due to the character drifting too far from the path. Use this to monitor navigation accuracy. |  |
| Is at portal | True when the AI is paused at a portal entry (after 'Pause at portal' was called but before 'Resume portal' or 'Complete portal'). Use to check if the character is waiting at a portal. |  |
| Is traversing portal | True when the AI is currently moving through a gradual portal (elevator, ladder, etc.). Platform behavior is disabled during traversal. |  |
| On portal complete | Triggered when portal execution finishes — after an instant teleport completes, a gradual movement reaches the exit, or 'Complete portal' is called. Use this for post-portal effects like opening doors at the exit, playing arrival animations, etc. |  |
| On portal entry | Triggered when the AI arrives at a portal entry point, BEFORE the portal executes. Use 'Pause at portal' inside this event to delay execution and run your own events first (animations, sounds, screen effects). If you don't pause, the portal executes immediately. Use CurrentPortalID to identify which portal was reached. |  |


---
## Expressions
| Expression | Description | Return Type | Params
| --- | --- | --- | --- |
| CalculatedJumpDistance | Get the calculated maximum jump distance in pixels. This is the value used to build graph connections. Useful for debugging jump arc detection. | number |  | 
| CalculatedJumpHeight | Get the calculated maximum jump height in pixels. This is the value used to build graph connections. Useful for debugging jump arc detection. | number |  | 
| GraphNodeAtIndexConnectionCount | Get the number of outgoing connections from the node at the given index. | number | Index *(number)* <br> | 
| GraphNodeAtIndexGridX | Get the grid X coordinate of the node at the given index. | number | Index *(number)* <br> | 
| GraphNodeAtIndexGridY | Get the grid Y coordinate of the node at the given index. | number | Index *(number)* <br> | 
| GraphNodeAtIndexIsLeftLedge | Returns 1 if the node at the given index is a left ledge, 0 otherwise. | number | Index *(number)* <br> | 
| GraphNodeAtIndexIsRightLedge | Returns 1 if the node at the given index is a right ledge, 0 otherwise. | number | Index *(number)* <br> | 
| GraphNodeAtIndexIsSlope | Returns 1 if the node at the given index is a slope node, 0 otherwise. | number | Index *(number)* <br> | 
| GraphNodeAtIndexX | Get the world X position of the node at the given index. | number | Index *(number)* <br> | 
| GraphNodeAtIndexY | Get the world Y position of the node at the given index. | number | Index *(number)* <br> | 
| GraphNodeConnectionAction | Get the action string for a connection from the given grid node (e.g. 'walk', 'jump', 'fall', 'portal'). | string | Grid X *(number)* <br>Grid Y *(number)* <br>Index *(number)* <br> | 
| GraphNodeConnectionCost | Get the movement cost for a connection from the given grid node. | number | Grid X *(number)* <br>Grid Y *(number)* <br>Index *(number)* <br> | 
| GraphNodeConnectionCount | Get the number of outgoing connections from the node at the given grid coordinates. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| GraphNodeConnectionTargetX | Get the world X position of the target node for a connection from the given grid node. | number | Grid X *(number)* <br>Grid Y *(number)* <br>Index *(number)* <br> | 
| GraphNodeConnectionTargetY | Get the world Y position of the target node for a connection from the given grid node. | number | Grid X *(number)* <br>Grid Y *(number)* <br>Index *(number)* <br> | 
| GraphNodeCount | Get the total number of navigation nodes in the generated graph. Returns 0 if no graph exists. | number |  | 
| GraphNodeWorldX | Get the world X position of a node at the specified grid coordinates. The node position is centred within the tile. Returns 0 if node doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| GraphNodeWorldY | Get the world Y position of a node at the specified grid coordinates. The node position is centred within the tile. Returns 0 if node doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| IsGraphNodeIsland | Returns 1 if the node at the given grid coordinates is an island node (no horizontal neighbors), 0 otherwise. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| IsGraphNodeLeftLedge | Returns 1 if the node at the given grid coordinates is a left ledge, 0 otherwise. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| IsGraphNodeRightLedge | Returns 1 if the node at the given grid coordinates is a right ledge, 0 otherwise. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| IsTileJumpThru | Returns 1 if the tile at the given grid coordinates is a jump-through tile, 0 otherwise. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| NearestGraphNodeGridX | Get the grid X coordinate of the nearest navigation node to a given world position. | number | X *(number)* <br>Y *(number)* <br> | 
| NearestGraphNodeGridY | Get the grid Y coordinate of the nearest navigation node to a given world position. | number | X *(number)* <br>Y *(number)* <br> | 
| NearestGraphNodeX | Get the world X position of the nearest navigation node to a given world position. | number | X *(number)* <br>Y *(number)* <br> | 
| NearestGraphNodeY | Get the world Y position of the nearest navigation node to a given world position. | number | X *(number)* <br>Y *(number)* <br> | 
| PlatformJumpStrength | Get the platform behavior's jump strength value. Useful for debugging jump parameter detection. | number |  | 
| PlatformMaxSpeed | Get the platform behavior's max speed value. Useful for debugging jump parameter detection. | number |  | 
| HazardCount | Get the total number of active hazards (circles and rectangles). Does not include tile hazards. | number |  | 
| HazardRadius | Get the current hazard radius setting in tiles. This affects how far hazard influence spreads. | number |  | 
| HazardSeverity | Get the total hazard severity at a world position from all sources (circles, rects, tiles). Higher values = more dangerous. | number | X *(number)* <br>Y *(number)* <br> | 
| LastHazardID | The ID of the most recently added hazard (circle or rectangle). Read it right after an Add hazard action and store it in a variable to remove or track that hazard later. Returns 0 if no hazard has been added yet. | number |  | 
| PositionIsHazardous | Check if a world position is hazardous. Returns 1 if hazardous, 0 if safe. | number | X *(number)* <br>Y *(number)* <br> | 
| TileHazardSeverity | Get the hazard severity of a specific tile. Returns 0 if no hazard. Only checks tile-based hazards, not circles/rects. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| TrackedHazardCount | The number of active tracked (object-following) hazards. | number |  | 
| CoyoteTime | Get the current coyote time setting in seconds. This is the window after walking off a ledge where jumps are still allowed. | number |  | 
| CoyoteTimer | Get the current coyote timer value in seconds. This counts down after leaving the ground. Returns 0 when on ground or timer expired. | number |  | 
| EstimatedVelocityX | Get the estimated horizontal velocity needed to follow the current path. Returns 0 if no path is active. | number |  | 
| JumpTowardTargetX | Get the world X position of the jump-at target. Returns 0 if not in jump-at mode. | number |  | 
| JumpTowardTargetY | Get the world Y position of the jump-at target. Returns 0 if not in jump-at mode. | number |  | 
| LedgeLeniency | Get the ledge leniency setting in pixels. This is how far past a ledge edge the AI can walk before stopping. | number |  | 
| LedgeRestriction | Get whether ledge restriction is enabled. Returns 1 if enabled, 0 if disabled. | number |  | 
| StoppingDistance | Get the calculated stopping distance in pixels based on the Platform behavior's current speed. Used for waypoint arrival detection. | number |  | 
| StrictJumpPositioning | Get whether strict jump positioning is currently active for this character. Returns 1 if enabled, 0 if disabled. Useful for conditional logic — e.g. switching between careful and aggressive pathfinding modes. | number |  | 
| GridHeight | Get the height of the obstacle map in tiles. Returns 0 if no map exists. | number |  | 
| GridTileSize | Get the tile size in pixels. Returns 0 if no map exists. | number |  | 
| GridWidth | Get the width of the obstacle map in tiles. Returns 0 if no map exists. | number |  | 
| MapTag | The map tag this instance navigates with (from the Map Tag property). Instances with the same tag on a layout share one navigation map. Returns an empty string for the default shared map. | string |  | 
| ObstacleMapJSON | Get the current obstacle map as a JSON string. Use this to save the map to local storage or export to files. | string |  | 
| ObstacleMapSource | Get the source of the current obstacle map. Returns 'custom', 'pathfinding', or 'none'. | string |  | 
| SlopeDirection | Get the slope direction of a tile at the specified grid coordinates. Returns 'left', 'right', or empty string if not a slope. | string | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| TileState | Get the state of a tile at the specified grid coordinates. Returns 'solid', 'clear', 'jump-thru', 'avoid', 'slope-left', 'slope-right', or empty string if out of bounds. | string | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| WaitTickCount | Get the number of ticks spent waiting for the Pathfinding obstacle map to initialize. Used for debugging timeout issues. | number |  | 
| WorldToGridX | Convert a world X position to grid X coordinate. Returns the grid tile number at the given pixel position. | number | X *(number)* <br> | 
| WorldToGridY | Convert a world Y position to grid Y coordinate. Returns the grid tile number at the given pixel position. | number | Y *(number)* <br> | 
| AngleToWaypoint | Get the angle in degrees from the character to the current waypoint. Returns 0 if no path is active. | number |  | 
| CurrentPathAction | Get the action name for a waypoint by index (e.g., 'walk', 'jump', 'fall', 'portal'). Returns empty string if index is out of bounds. | string | Index *(number)* <br> | 
| CurrentWaypoint | Get the index of the current waypoint the character is moving toward. Returns -1 if no path is active. | number |  | 
| CurrentWaypointX | Get the world X position of the current waypoint. Returns 0 if no path is active. | number |  | 
| CurrentWaypointY | Get the world Y position of the current waypoint. Returns 0 if no path is active. | number |  | 
| DistanceToWaypoint | Get the distance in pixels from the character to the current waypoint. Returns 0 if no path is active. | number |  | 
| MaxPathsPerTick | Get the current maximum paths per tick setting. | number |  | 
| NearbyAgentCount | Get the number of nearby agents sharing the same navigation map. | number |  | 
| PathCost | Get the total calculated cost of the current path. Returns 0 if no path is active. | number |  | 
| PathEndX | The world X of the calculated path's final position — the last waypoint, where the character will actually end up. In Nearest mode this can differ from the requested target (the path stops at the closest reachable spot). Returns 0 if no path has been calculated. | number |  | 
| PathEndY | The world Y of the calculated path's final position — the last waypoint, where the character will actually end up. In Nearest mode this can differ from the requested target (the path stops at the closest reachable spot). Returns 0 if no path has been calculated. | number |  | 
| PathFailReason | Get the reason the last pathfinding attempt failed. Returns: 'no_start_node', 'no_goal_node', 'max_nodes_reached', 'no_path', or empty string if path succeeded. | string |  | 
| PathQueueSize | Get the number of pathfinding requests currently waiting in the queue. | number |  | 
| PathStrategy | Get the current path strategy preset (balanced, shortest, safest, simplest). | string |  | 
| RePathCooldown | Get the current re-path cooldown in seconds. This is the minimum time between automatic re-path attempts. | number |  | 
| RePathThreshold | Get the current re-path threshold in tiles. This is how far the character can drift before automatic re-pathing triggers. | number |  | 
| TargetGridX | The grid X coordinate of the requested path target (after ground correction snaps it to walkable ground). | number |  | 
| TargetGridY | The grid Y coordinate of the requested path target (after ground correction snaps it to walkable ground). | number |  | 
| TargetX | The world X of the requested path target, as passed to the last Find path action. For where the calculated path actually ends, use PathEndX. | number |  | 
| TargetY | The world Y of the requested path target, as passed to the last Find path action. For where the calculated path actually ends, use PathEndY. | number |  | 
| WaypointCount | Get the total number of waypoints in the current path. Returns 0 if no path is active. | number |  | 
| WaypointGridX | Get the grid X coordinate of a waypoint by index. Returns -1 if index is out of bounds. | number | Index *(number)* <br> | 
| WaypointGridY | Get the grid Y coordinate of a waypoint by index. Returns -1 if index is out of bounds. | number | Index *(number)* <br> | 
| WaypointX | Get the world X position of a waypoint by index. The waypoint position is centred within the tile. Returns 0 if index is out of bounds. | number | Index *(number)* <br> | 
| WaypointY | Get the world Y position of a waypoint by index. The waypoint position is centred within the tile. Returns 0 if index is out of bounds. | number | Index *(number)* <br> | 
| CurrentPortalID | Returns the portal ID during OnPortalEntry/OnPortalComplete triggers. Use to identify which portal was reached. | number |  | 
| FurthestPortalID | Returns the ID of the portal whose entry point is furthest from the given (X, Y) position. If Tag is non-empty, only portals with that tag are considered. Returns -1 if no matching portals exist. | number | X *(number)* <br>Y *(number)* <br>Tag *(string)* <br> | 
| LastPortalID | Returns the ID of the most recently added portal. Use right after adding a portal to save the ID for later configuration or removal. | number |  | 
| NearestPortalID | Returns the ID of the portal whose entry point is nearest to the given (X, Y) position. If Tag is non-empty, only portals with that tag are considered. Returns -1 if no matching portals exist. | number | X *(number)* <br>Y *(number)* <br>Tag *(string)* <br> | 
| PortalCount | Get the total number of portals. | number |  | 
| PortalCountByTag | Returns the number of portals that contain the given tag token (checked within each portal's comma-separated tag string). | number | Tag *(string)* <br> | 
| PortalExitX | Get the exit X position of the current portal. Valid inside OnPortalEntry/OnPortalComplete triggers. | number |  | 
| PortalExitY | Get the exit Y position of the current portal. Valid inside OnPortalEntry/OnPortalComplete triggers. | number |  | 
| PortalIDByTag | Returns the portal ID at the given index within the set of portals that contain the given tag. Returns -1 if the index is out of range. Use PortalCountByTag to get the total count. | number | Tag *(string)* <br>Index *(number)* <br> | 
| PortalProgress | Get the 0-1 traversal progress for gradual portals. Returns 0 if not traversing. | number |  | 
| PortalTag | Get the tag of a portal by its ID. Returns an empty string if the portal has no tag or doesn't exist. | string | Portal ID *(number)* <br> | 
| PortalType | Returns 'instant' or 'gradual' for the given portal ID. | string | Portal ID *(number)* <br> | 


---
## Changelog

### Version 0.6.0.0

**Added:**
- Map Tags: instances with the same Map Tag share one navigation map, so one layout can host several shared maps (ghosts, flyers, giants). Empty tag = the default shared map.
- Portals, hazards, cell-size auto-detection, avoidance, and builds all operate per map tag.
- One map copy per map: instances share obstacle/slope/hazard data by reference.
- Map-setup actions run once per picked set; the other instances adopt the result.
- Debug warning when an instance's jump physics differ >20% from the shared graph (suggests a separate Map Tag).
- Debug aids for tag typos: console lists active tags when a new one appears; debugger shows each instance's tag.
- MapTag expression (Obstacles).
- Detect Slopes property: solid scans probe collision shapes and auto-register 45/22.5-degree slopes, no tile ID lists needed.
- AutoDetectSlopeTiles rebuilt on the documented collision API (containsPoint), with flip handling and per-shape caching.
- Hazard changes now apply automatically: costs re-bake lazily once per map per tick, O(nodes + hazard area), so hundreds of hazards stay cheap.
- Tracked hazards (AddTrackedHazard / ClearAllTrackedHazards / TrackedHazardCount): hazards that follow objects with no per-frame events and auto-remove on destroy.
- LastHazardID expression for removing or tracking a just-added hazard.
- Portal move-in-place (SetPortalPosition / SetPortalPositionFromObjects): preserves ID, type, cost, speed, and tags; connections re-wire immediately.
- Enabled property (panel bottom) plus Set enabled action and Is enabled condition; disabling freezes navigation with all state kept.
- PathEndX / PathEndY expressions: the path's actual final position (differs from the target in Nearest mode).
- BREAKING: PathTargetX/Y(type) and PathTargetGridX/Y replaced by parameterless TargetX / TargetY / TargetGridX / TargetGridY.

**Changed:**
- Drop-in defaults: Auto-Build Graph = Auto, Detect Slopes = on, Tile Size = 32 (0 = auto-detect). Working pathfinding from a single Find path event.
- BREAKING: Graph Mode property and Per-Instance mode removed; Map Tags supersede them. Property indices after slot 5 shifted, so re-check properties in older projects.
- ACE categories reorganized to mirror the built-in Pathfinding behavior: Pathfinding, Movement, Obstacles, Hazards, Portals, Debug (IDs unchanged, saves unaffected).
- List names matched to the built-in behavior: On arrived, On failed to find path, Stop, Is moving along path, Is calculating path (IDs unchanged).
- BREAKING: Debug graph ACEs renamed with a Graph prefix (GraphNodeCount, GraphNodeAtIndex*, NearestGraphNode*, Graph node exists...) since the built-in behavior uses node to mean path waypoint. Path steps stay Waypoint*. Scripting names follow.
- Set multi-agent avoidance labels normalized to Enabled/Disabled.
- Guide: new map tags section; reference tables regrouped into the six new categories.

**Fixed:**
- Instances that never ran a map-setup action (late spawns, second object types) had no grid dimensions, silently breaking node lookups; map state is now shared to every subscriber.
- Starting a graph build cancels another instance's in-flight build for the same map instead of both mutating the shared graph.
- Multi-agent avoidance spatial hash is cached per map instead of globally.
- Hazards added or removed mid-game had no effect until a full graph rebuild.
- Hazard IDs now come from a shared counter; per-instance counters could collide in shared maps.
- Undocumented-API audit: layout name replaces layout.uid (read undefined), isJumping replaces the nonexistent isRising, jumpSustain normalized for the seconds-vs-milliseconds ambiguity.
---

### Version 0.5.1.0

**Added:**
- Collision-polygon accurate solids scanning (per the documented containsPoint API): rotated/irregular solid sprites no longer over-fill their bounding box, per-tile collision polygons are honored (disabled-collision tiles scan as clear, partial polys only mark covered cells), instances with collisions disabled are skipped.
- Per-Instance graph mode warns once when used by 9+ instances on a layout (each builds its own graph; Shared is almost always the right choice at scale).

**Changed:**
- Guide: new 'With or without the Pathfinding behavior' comparison section and 'Procedurally generated levels (best practices)' section (direct-write obstacle map pattern, timing rules, cleanup, validation, per-seed caching).
- FUTURE_FEATURES: Graph Groups design (named graph sharing to eventually replace the Shared/Per-Instance mode).

**Fixed:**
- Horizontally flipped solid tiles were skipped by the tilemap scan (negative raw tile IDs failed the presence check).
- Instances spawned after the shared graph was built no longer trigger a full graph rebuild per spawn (late joiners inherit the built graph); wave spawners are now safe at scale.
---

### Version 0.5.0.0

**Added:**
- Auto-Build Graph property (Auto / From Pathfinding / From Solids): zero-event startup — the obstacle map and graph build themselves on layout start.
- Tile Size auto-detect (0 = auto): reads the Pathfinding behavior's Cell Size or the solid tilemap's tile size, and propagates it to all shared-graph instances.
- New simple 'Find path' (X, Y) and 'Find path to object' actions with sensible defaults (ground correction on, Nearest mode).
- Time-sliced graph generation: large maps build across several ticks (~6ms per tick) instead of stalling a frame; any Find path call finishes an in-progress build synchronously first.
- {my} prefix on all action and condition display texts, so event sheet rows show which behavior they belong to.

**Changed:**
- Old FindPath renamed to 'Find path to position (advanced)' — unchanged behavior, full parameter control.
- Runtime split into maintainable modules (obstacle map, graph build, pathfinding, movement, portals, hazards, navigation manager).
- Removed the dead legacy src/aces.js; ACE folder files are the single source of truth.
- Guide.md fully rewritten: scenarios-first structure, complete ACE reference tables, system + game use cases (incl. fleeing and flee-to-cover), corrected scripting docs (on()/off() listener API).

**Fixed:**
- GraphData expressions IsNodeIsland / IsNodeLeftLedge / IsNodeRightLedge / IsTileJumpThru crashed at runtime (called methods that did not exist).
- 'Node exists at grid/world position' conditions always returned false (stale string map key).
---

### Version 0.4.0.1

**Fixed:**
Fix expression param. for Portal Tags
---

### Version 0.4.0.0

**Added:**
- Better support Scripting.
- Add Portal Tags (Remove/Add/Pick Nearest Portal/Pick Furthest Portal)
- Clean up the code.

---

### Version 0.3.0.0

**Added:**
- Reverse Pathing, prefers turning fall nodes into jump nodes
- Strict Tile Positioning Before Jumps / Ledge Departures
- Reverse Pathing, prefers turning fall nodes into jump nodes. (to improve jump pathing)
- Path Strategy Preset (Property + ACE) & Fix Climbing via Reverse Pathing…
- Find Path Upgrade (Reach/Jump-Toward/Jump-At-Target)
- more edgecase refinement
- Debugger support
-



---

### Version 0.2.0.0

**Added:**
improved pathfinding implementation but needs further testing of the featureset.

---

### Version 0.1.0.0

**Added:**
WIP Skeleton of Features.
- Basic Pathfinding.
- Obstacle Maps.
- Hazard System.
- Debugging & Tuning
- Advanced Usage Features.

---

### Version 0.0.1.0

**Added:**
Phase 0:
Create minimal working behavior that loads without errors.

---

### Version 0.0.0.0

**Added:**
Initial release.

---
