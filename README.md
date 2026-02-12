<img src="./src/icon.svg" width="100" /><br>
# Platformer Navigation Graph
<i>Smart pathfinding for platformer games. Characters automatically jump across gaps, fall between platforms, and find optimal routes through complex levels. Includes instant portals (teleporters, doors) and gradual portals (elevators, ladders, ziplines) with pause/resume support for custom animations. Features hazard avoidance, multiple path strategies, coyote jumps, ledge restriction, and multi-agent support. Works with the built-in Platform behavior — just add the behavior and go.</i> <br>
### Version 0.3.0.0

[<img src="https://placehold.co/200x50/4493f8/FFF?text=Download&font=montserrat" width="200"/>](https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2/releases/download/salmanshh_platformer_navigationgraph-0.3.0.0.c3addon/salmanshh_platformer_navigationgraph-0.3.0.0.c3addon)
<br>
<sub> [See all releases](https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2/releases) </sub> <br>

#### What's New in 0.3.0.0
**Added:**
- Reverse Pathing, prefers turning fall nodes into jump nodes
- Strict Tile Positioning Before Jumps / Ledge Departures
- Reverse Pathing, prefers turning fall nodes into jump nodes. (to improve jump pathing)
- Path Strategy Preset (Property + ACE) & Fix Climbing via Reverse Pathing…
- Find Path Upgrade (Reach/Jump-Toward/Jump-At-Target)
- more edgecase refinement
- Debugger support
-




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

---
## Properties
| Property Name | Description | Type |
| --- | --- | --- |
| Enable Debug Logging | Show helpful debug messages in browser console (F12) to troubleshoot pathfinding issues. Disable for better performance in final game. | check |
| Tile Size | Size of each grid tile in pixels. MUST match the Cell Size in your Pathfinding behavior! Smaller = more precise paths but slower performance. | integer |
| Max Search Nodes | Maximum pathfinding effort before giving up. Higher = finds paths in larger levels but may cause lag. Lower = faster but may fail on complex paths. | integer |
| Max Fall Distance | Maximum fall distance in pixels. 0 = auto-detect from Platform behavior. -1 = unlimited (any fall). Positive value = custom max in pixels. | integer |
| Auto-Control Movement | When enabled, AI automatically controls the character (moves left/right, jumps). When disabled, you handle movement yourself using the path data. | check |
| Graph Mode | How navigation data is stored. Shared = all characters use same map (efficient). Per-Instance = each character has own map (rare use cases only). | combo |
| Path Strategy | How the AI picks the best route when multiple paths exist. Balanced: weighs distance and difficulty equally, good for most platformers and adventure games. Shortest Distance: always takes the fastest route even with risky jumps, ideal for speedrunner games and time trials. Safest Route: avoids jumps and falls when possible, great for stealth games, escort missions, or fragile NPCs. Simplest Path: fewest waypoints for predictable movement, best for simple enemies and tower defense creeps. | combo |
| Smooth Paths | Remove unnecessary waypoints for more natural movement. AI will take direct routes when possible instead of zigzagging. | check |
| Max Waypoint Time | How long (in seconds) AI tries to reach each waypoint before giving up and recalculating path. Prevents infinite loops when stuck. | float |
| Coyote Time | Seconds after walking off a ledge where a jump can still be executed. Allows AI to walk off edges and jump mid-air for greater reach, making slightly out-of-range platforms reachable. Important: only works when 'Ledge Restriction' is disabled — if Ledge Restriction is enabled, characters won't walk off edges, so coyote jumps can never execute and the connections will go unused. 0 = disabled. | float |
| Strict Jump Positioning | When the AI is following a path and needs to jump or fall to another platform, it will slow down and carefully position itself on the tile before launching. This prevents characters from overshooting edges and missing jumps — like a chase enemy flying off a ledge instead of jumping across, or an escort NPC slipping off a narrow bridge mid-jump. Note: this only affects movement DURING pathfinding (jumps and falls that are part of the path). To stop characters from walking off edges entirely, use 'Ledge Restriction' instead. Recommended ON for most games. | check |
| Ledge Restriction | Prevents AI characters from walking off platform edges when they have no reason to leave. Useful for patrol guards that should stay on their platform, or NPCs that shouldn't wander off rooftops. Note: this only stops characters from casually walking off edges — if the AI's path requires a jump or fall to reach its goal, it will still leave the platform. When enabled, 'Coyote Time' has no effect since characters won't walk off edges to trigger it. When disabled, characters can slide off edges freely, which also enables wall-adjacent jumps (walking to the platform edge to clear a wall before jumping). To make jumps and falls more precise, use 'Strict Jump Positioning' instead. | check |
| Ledge Leniency | How many pixels past a platform edge the AI is allowed to walk before stopping (0 = strict stop at edge). Increase for more natural-looking movement near edges. Only used when Ledge Restriction is enabled. | float |
| Re-Path Threshold | How many tiles the character can deviate from its path before automatically recalculating. Useful when the character gets knocked off course. 0 = disabled. | float |
| Hazard Radius | Tile radius for hazard cost falloff buffer zone. Nearby tiles within this radius of a hazard get cost penalties. 0 = no buffer, only exact hazard tiles affected. | integer |


---
## Actions
| Action | Description | Params
| --- | --- | --- |
| Set max fall distance | Override the auto-calculated maximum fall distance. The navigation graph must be regenerated after changing this for the new value to take effect. | Distance (px)             *(number)* <br> |
| Set max jump distance | Override the auto-calculated maximum horizontal jump distance. The navigation graph must be regenerated after changing this for the new value to take effect. | Distance (px)             *(number)* <br> |
| Set max jump height | Override the auto-calculated maximum jump height. The navigation graph must be regenerated after changing this for the new value to take effect. | Height (px)             *(number)* <br> |
| Log graph stats to console | Output detailed navigation graph statistics to the browser console. Use for debugging graph generation and connectivity issues. |  |
| Add circle hazard | Add a circular hazard area. The AI will avoid this area based on severity. Hazard avoidance is automatically enabled. Returns a hazard ID for later removal. Use for dynamic danger zones like explosions or enemy AOE. | X             *(number)* <br>Y             *(number)* <br>Radius             *(number)* <br>Severity             *(number)* <br> |
| Add rectangle hazard | Add a rectangular hazard area. The AI will avoid this area based on severity. Hazard avoidance is automatically enabled. Returns a hazard ID for later removal. Use for static danger zones like spike pits. | X             *(number)* <br>Y             *(number)* <br>Width             *(number)* <br>Height             *(number)* <br>Severity             *(number)* <br> |
| Clear all hazards | Remove all circular and rectangular hazards. This does NOT clear tile-based hazards. Use when resetting a level or clearing all dynamic dangers. |  |
| Clear all tile hazards | Reset all tile hazard severities to 0. This does NOT remove circle/rect hazards. Use when you want to clear static tile dangers. |  |
| Remove hazard | Remove a hazard by its ID. Use this when a danger zone is no longer active. The graph will be regenerated if needed. | ID             *(number)* <br> |
| Set multi-agent avoidance | Enable or disable multi-agent collision avoidance. When enabled, AI agents will attempt to avoid colliding with each other during pathfinding. Note: This feature may not be fully implemented yet. | Enabled             *(combo)* <br> |
| Clear all slope markings | Remove all slope markings from the obstacle map. Slopes will be treated as regular solid tiles. Use this to reset slope data. |  |
| Clear obstacle map | Remove the obstacle map and all associated data. Use this when switching levels or resetting the navigation system. |  |
| Create custom obstacle map | Create a custom obstacle map with the specified dimensions in tiles. All tiles are initialized to 'clear' state. Use this when not using the Pathfinding behavior's obstacle map. | Width             *(number)* <br>Height             *(number)* <br> |
| Generate navigation graph | Generate the navigation graph from the current obstacle map. Call this after setting up all tiles and before pathfinding. This is an expensive operation. |  |
| Load obstacle map from JSON | Load a previously saved obstacle map from JSON string. Use this to restore saved maps or load pre-built level data. | JSON             *(string)* <br> |
| Set hazard radius | Set the radius in tiles for circular/rectangular hazard influence. Tiles within this radius of a hazard will have their pathfinding cost increased. | Tiles             *(number)* <br> |
| Set re-path threshold | Set how many tiles the character can drift from the path before automatic re-pathing triggers. Higher values = more tolerance for deviation. | Tiles             *(number)* <br> |
| Set tile hazard severity | Set the hazard severity for a specific tile. Higher values make the AI avoid this tile more strongly. 0 = no hazard. Hazard avoidance is automatically enabled when any hazard is added. Use this to mark dangerous areas like spikes or lava. | Grid X             *(number)* <br>Grid Y             *(number)* <br>Severity             *(number)* <br> |
| Set tile state | Set the state of a tile at the specified grid coordinates. Use this to mark tiles as solid obstacles, clear space, jump-thru platforms, areas to avoid, or slopes. | Grid X             *(number)* <br>Grid Y             *(number)* <br>State             *(combo)* <br> |
| Set tile state at world position | Set the state of a tile at the specified world coordinates. The world position is automatically converted to grid coordinates. | X             *(number)* <br>Y             *(number)* <br>State             *(combo)* <br> |
| Use Pathfinding obstacle map | Use the obstacle map from the Pathfinding behavior instead of a custom map. Enable auto-regenerate to automatically rebuild the graph when the Pathfinding map changes. | Auto-regenerate             *(combo)* <br> |
| Find path to position | Calculate a path from the character's position to the target coordinates. Use this when you want the AI to navigate to a specific point. Requires: Navigation graph must be generated first. | X             *(number)* <br>Y             *(number)* <br>Correct to ground             *(combo)* <br>Mode             *(combo)* <br>Jump Positioning             *(combo)* <br> |
| Regenerate navigation graph | Rebuild the navigation graph from scratch. Use after modifying the level layout, adding/removing obstacles, or changing platform positions. |  |
| Set auto-control | Toggle auto-movement on/off. When enabled, the behavior automatically controls the Platform behavior to follow paths. When disabled, you control movement yourself using path data expressions. | Enabled             *(combo)* <br> |
| Set coyote time | Set the coyote time window in seconds. The AI can jump within this window after walking off a ledge. Set to 0 to disable coyote time. | Seconds             *(number)* <br> |
| Set ledge leniency | Set how many pixels past a platform edge the AI can walk before stopping (0 = strict stop). Increase for more natural-looking patrol movement near edges. Only used when ledge restriction is enabled. | Pixels             *(number)* <br> |
| Set ledge restriction | Prevents AI characters from walking off platform edges when they have no reason to leave. Useful for patrol guards that should stay on their platform, or NPCs that shouldn't wander off rooftops. This only stops characters from casually walking off edges — if the AI's path requires a jump or fall to reach its goal, it will still leave the platform. To make those jumps and falls more precise, use 'Set strict jump positioning' instead. | Enabled             *(combo)* <br> |
| Set path strategy | Change how the AI picks the best route when multiple paths exist. Balanced: weighs distance and difficulty equally. Shortest Distance: always takes the fastest route. Safest Route: avoids jumps and falls. Simplest Path: fewest waypoints. | Strategy             *(combo)* <br> |
| Set re-path cooldown | Set the minimum time in seconds between automatic re-path attempts. Lower values = more responsive re-pathing but more CPU usage. Default is 0.5 seconds. | Seconds             *(number)* <br> |
| Set strict jump positioning | Toggle whether this AI character slows down and carefully positions itself before jumping or falling during pathfinding. This does NOT affect walking off edges (use 'Set ledge restriction' for that). Use this to change behavior at runtime — for example, disable when a boss enters 'rage mode' for reckless movement, or enable when an NPC needs to carefully cross a narrow bridge. Overrides the property setting for this character. | Enabled             *(combo)* <br> |
| Stop pathfinding | Stop the character immediately and clear the current path. Use when you want to cancel AI navigation and regain manual control. |  |
| Add elevator stop | Add a stop to an elevator group. Automatically creates two-way gradual portals between this stop and all other stops in the same group. Cost is auto-calculated from distance and speed. Use a unique group name (e.g. 'elevator_A') for each elevator. Example: 3 calls with the same group creates 3 pairwise portals (Floor1-Floor2, Floor1-Floor3, Floor2-Floor3). Use PortalExitX/PortalExitY in 'On portal entry' to determine which floor the AI is heading to. | Group             *(string)* <br>X             *(number)* <br>Y             *(number)* <br>Speed             *(number)* <br> |
| Add elevator stop from object | Add an elevator stop using an object's position. Same as 'Add elevator stop' but uses the object's current X/Y. The object serves as a floor marker. | Group             *(string)* <br>Object             *(object)* <br>Speed             *(number)* <br> |
| Add gradual portal | Add a portal that gradually moves the AI from entry to exit at the given speed. The character moves in a straight line (any direction — vertical, horizontal, or diagonal). Platform behavior is disabled during movement. Use for: elevators, lifts, moving platforms, ziplines. For vertical-only movement (ladders/ropes), align entry and exit X positions, or use 'Pause at portal' to implement your own custom movement via events. | Direction             *(combo)* <br>Entry X             *(number)* <br>Entry Y             *(number)* <br>Exit X             *(number)* <br>Exit Y             *(number)* <br>Cost             *(number)* <br>Speed             *(number)* <br> |
| Add gradual portal from objects | Add a gradual portal using two objects. Character moves from entry object to exit object at the given speed. Use for: linking elevator sprites, rope endpoints, etc. | Direction             *(combo)* <br>Entry object             *(object)* <br>Exit object             *(object)* <br>Cost             *(number)* <br>Speed             *(number)* <br> |
| Add instant portal | Add a portal that instantly teleports the AI from the entry to the exit. Use for: teleporters, doors, warp zones, or any portal where the character disappears and reappears at the exit. Use 'On portal entry' with 'Pause at portal' to play animations before the teleport happens. | Direction             *(combo)* <br>Entry X             *(number)* <br>Entry Y             *(number)* <br>Exit X             *(number)* <br>Exit Y             *(number)* <br>Cost             *(number)* <br> |
| Add instant portal from objects | Add an instant portal using two objects as entry and exit positions. The objects' current X/Y positions are used. Use for: linking door sprites, warp pad objects, etc. | Direction             *(combo)* <br>Entry object             *(object)* <br>Exit object             *(object)* <br>Cost             *(number)* <br> |
| Clear all portals | Remove all portals from the navigation graph. Useful when resetting the level or switching layouts. |  |
| Complete portal | Finish a paused portal without executing its built-in movement. Use this when you've already moved the character yourself (e.g., custom animation, physics launch, manual position set). The AI will continue pathfinding from wherever the character is now. Also works mid-traverse to cut a gradual portal short. |  |
| Pause at portal | Call INSIDE 'On portal entry' to pause the AI before the portal executes. The character stops at the entry point and waits. Use this to play animations, open doors, trigger screen transitions, or run any custom events before the portal activates. Call 'Resume portal' to execute the built-in behavior, or 'Complete portal' if you moved the character yourself. |  |
| Remove portal by ID | Remove a portal by its ID. The portal connection is removed from the navigation graph immediately. | Portal ID             *(number)* <br> |
| Remove portal at object | Remove the portal closest to this object. Works with both entry and exit positions — for two-way portals, either endpoint object can be used. | Object             *(object)* <br> |
| Resume portal | Continue portal execution after pausing with 'Pause at portal'. For instant portals: teleports the character to the exit. For gradual portals: begins moving the character toward the exit. Use this when you want the portal's built-in movement to handle the transition. |  |
| Set portal cost | Change how 'expensive' a portal is for the AI to use. Lower cost = preferred, higher cost = avoided. | Portal ID             *(number)* <br>Cost             *(number)* <br> |
| Set portal ignore hazards | Set whether a portal ignores nearby hazards when calculating its pathfinding cost. | Portal ID             *(number)* <br>Ignore hazards             *(combo)* <br> |
| Set portal speed | Change the movement speed of a gradual portal (pixels per second). Has no effect on instant portals. | Portal ID             *(number)* <br>Speed             *(number)* <br> |
| Teleport to position | Instantly move the character to the given position. Can be used anywhere — inside portal events, on button press, on collision, etc. Suppresses re-pathing for one tick to prevent the AI from thinking it's lost. Useful with 'Pause at portal' + 'Complete portal' for fully custom portal behavior. | X             *(number)* <br>Y             *(number)* <br> |


---
## Conditions
| Condition | Description | Params
| --- | --- | --- |
| Is node at ledge | Check if a specific node is marked as a ledge (platform edge). Returns true if the node is a left or right ledge. | Grid X *(number)* <br>Grid Y *(number)* <br> |
| Is position hazardous | Check if a specific world position is within any hazard area (circle, rect, or tile). Returns true if any hazard affects this position. | X *(number)* <br>Y *(number)* <br> |
| Is multi-agent avoidance enabled | Check if multi-agent collision avoidance is currently enabled. Returns true if enabled, false otherwise. |  |
| Is setting up Pathfinding | Check if the behavior is currently waiting for the Pathfinding obstacle map to initialize. Returns true during async setup. |  |
| On obstacle map created | Triggered when a custom obstacle map is successfully created. Use this to start configuring tiles after map creation. |  |
| On obstacle map removed | Triggered when the obstacle map is cleared or removed. Use this to clean up related data or reset systems. |  |
| On Pathfinding map failed | Triggered when the Pathfinding behavior's obstacle map fails to initialize. Use this to implement fallback error handling. |  |
| On Pathfinding map ready | Triggered when the Pathfinding behavior's obstacle map is ready for use. Use this to start graph generation after Pathfinding initialization. |  |
| On Pathfinding map timeout | Triggered when waiting for the Pathfinding obstacle map times out. Use this to handle slow or stuck initialization. |  |
| Tile has state | Check if a tile at the given grid position has the specified state. Use this to query tile properties before actions. | Grid X *(number)* <br>Grid Y *(number)* <br>State *(combo)* <br> |
| Tile has state at world position | Check if a tile at the given world position has the specified state. World coordinates are automatically converted to grid coordinates. | X *(number)* <br>Y *(number)* <br>State *(combo)* <br> |
| Has active path | Check if the character currently has an active pathfinding path. Returns true while navigating, false when idle or path is complete. |  |
| Is at island | Check if the character is standing on a single-tile platform (isolated platform). Use this to detect precarious positions or trigger special behaviors. |  |
| Is at ledge | Check if the character is currently standing on a ledge node (edge of a platform). Use this to trigger ledge-specific behaviors or animations. |  |
| Is platform enabled | Check if the associated Platform behavior is currently enabled. Returns false if Platform behavior is disabled or not found. |  |
| Node exists at grid position | Check if a navigation node exists at the specified grid coordinates. Use this to validate positions before pathfinding or placing objects. | Grid X *(number)* <br>Grid Y *(number)* <br> |
| Node exists at world position | Check if a navigation node exists at the specified world coordinates. Use this to validate world positions before pathfinding. | X *(number)* <br>Y *(number)* <br> |
| On navigation graph generated | Triggered when the navigation graph has been successfully generated. Use this to start pathfinding operations after map setup. |  |
| On jump toward executed | Triggered when the 'jump at target' mode executes the final jump toward the target. Use this to handle jump attacks or stomps. |  |
| On path complete | Triggered when the AI arrives at the final destination. Use this to trigger arrival animations, next actions, or goal completion logic. |  |
| On path failed | Triggered when pathfinding fails to find a valid path to the target. Use this to handle unreachable destinations or implement fallback behaviors. |  |
| On path found | Triggered when a path has been successfully calculated. Use this to start custom actions when pathfinding succeeds. |  |
| On re-path triggered | Triggered when automatic re-pathing occurs due to the character drifting too far from the path. Use this to monitor navigation accuracy. |  |
| On waypoint reached | Triggered each time the character reaches a waypoint along the path. Use this to play footstep sounds, particle effects, or update animations. |  |
| On waypoint stuck | Triggered when the character has been stuck at a waypoint for too long (exceeds Max Waypoint Time). The path is automatically cancelled. Use this to handle stuck situations or repath. |  |
| Is at portal | True when the AI is paused at a portal entry (after 'Pause at portal' was called but before 'Resume portal' or 'Complete portal'). Use to check if the character is waiting at a portal. |  |
| Is traversing portal | True when the AI is currently moving through a gradual portal (elevator, ladder, etc.). Platform behavior is disabled during traversal. |  |
| On portal complete | Triggered when portal execution finishes — after an instant teleport completes, a gradual movement reaches the exit, or 'Complete portal' is called. Use this for post-portal effects like opening doors at the exit, playing arrival animations, etc. |  |
| On portal entry | Triggered when the AI arrives at a portal entry point, BEFORE the portal executes. Use 'Pause at portal' inside this event to delay execution and run your own events first (animations, sounds, screen effects). If you don't pause, the portal executes immediately. Use CurrentPortalID to identify which portal was reached. |  |


---
## Expressions
| Expression | Description | Return Type | Params
| --- | --- | --- | --- |
| CalculatedJumpDistance | Get the calculated maximum horizontal jump distance in pixels based on Platform behavior settings. Used for determining reachable positions. | number |  | 
| CalculatedJumpHeight | Get the calculated maximum jump height in pixels based on Platform behavior settings. Used for determining reachable positions. | number |  | 
| PlatformJumpStrength | Get the jump strength from the Platform behavior. Used for internal pathfinding calculations. Returns 0 if Platform behavior not found. | number |  | 
| PlatformMaxSpeed | Get the max speed from the Platform behavior. Used for internal pathfinding calculations. Returns 0 if Platform behavior not found. | number |  | 
| IsNodeIsland | Check if a node at grid coordinates is an island (single-tile platform). Returns 1 if true, 0 if false or node doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| IsNodeLeftLedge | Check if a node at grid coordinates is a left ledge. Returns 1 if true, 0 if false or node doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| IsNodeRightLedge | Check if a node at grid coordinates is a right ledge. Returns 1 if true, 0 if false or node doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| IsTileJumpThru | Check if a tile at grid coordinates is a jump-thru platform. Returns 1 if true, 0 if false or tile doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| NearestNodeGridX | Get the grid X coordinate of the nearest navigation node to a world position. Returns -1 if no nodes exist. | number | X *(number)* <br>Y *(number)* <br> | 
| NearestNodeGridY | Get the grid Y coordinate of the nearest navigation node to a world position. Returns -1 if no nodes exist. | number | X *(number)* <br>Y *(number)* <br> | 
| NearestNodeX | Get the world X position of the nearest navigation node to a world position. Returns 0 if no nodes exist. | number | X *(number)* <br>Y *(number)* <br> | 
| NearestNodeY | Get the world Y position of the nearest navigation node to a world position. Returns 0 if no nodes exist. | number | X *(number)* <br>Y *(number)* <br> | 
| NodeAtIndexConnectionCount | Get the number of connections (edges) from a node by its index. Returns 0 if index is out of bounds. | number | Index *(number)* <br> | 
| NodeAtIndexGridX | Get the grid X coordinate of a node by its index in the node array. Returns -1 if index is out of bounds. | number | Index *(number)* <br> | 
| NodeAtIndexGridY | Get the grid Y coordinate of a node by its index in the node array. Returns -1 if index is out of bounds. | number | Index *(number)* <br> | 
| NodeAtIndexIsLeftLedge | Check if a node is a left ledge by its index. Returns 1 if true, 0 if false or index is out of bounds. | number | Index *(number)* <br> | 
| NodeAtIndexIsRightLedge | Check if a node is a right ledge by its index. Returns 1 if true, 0 if false or index is out of bounds. | number | Index *(number)* <br> | 
| NodeAtIndexIsSlope | Check if a node is on a slope by its index. Returns 1 if true, 0 if false or index is out of bounds. | number | Index *(number)* <br> | 
| NodeAtIndexX | Get the world X position of a node by its index in the node array. Returns 0 if index is out of bounds. | number | Index *(number)* <br> | 
| NodeAtIndexY | Get the world Y position of a node by its index in the node array. Returns 0 if index is out of bounds. | number | Index *(number)* <br> | 
| NodeConnectionAction | Get the action name for a connection (e.g., 'walk', 'jump', 'fall'). Returns empty string if node/connection doesn't exist. | string | Grid X *(number)* <br>Grid Y *(number)* <br>Connection index *(number)* <br> | 
| NodeConnectionCost | Get the movement cost for a connection. Returns 0 if node/connection doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br>Connection index *(number)* <br> | 
| NodeConnectionCount | Get the number of connections (edges) from a node at grid coordinates. Returns 0 if node doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| NodeConnectionTargetX | Get the world X position of a connection's target node. Returns 0 if node/connection doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br>Connection index *(number)* <br> | 
| NodeConnectionTargetY | Get the world Y position of a connection's target node. Returns 0 if node/connection doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br>Connection index *(number)* <br> | 
| HazardCount | Get the total number of active hazards (circles and rectangles). Does not include tile hazards. | number |  | 
| HazardSeverity | Get the total hazard severity at a world position from all sources (circles, rects, tiles). Higher values = more dangerous. | number | X *(number)* <br>Y *(number)* <br> | 
| PositionIsHazardous | Check if a world position is hazardous. Returns 1 if hazardous, 0 if safe. | number | X *(number)* <br>Y *(number)* <br> | 
| TileHazardSeverity | Get the hazard severity of a specific tile. Returns 0 if no hazard. Only checks tile-based hazards, not circles/rects. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| NearbyAgentCount | Get the number of nearby AI agents within detection range. Used for multi-agent avoidance calculations. Returns 0 if multi-agent avoidance is disabled. | number |  | 
| GridHeight | Get the height of the obstacle map in tiles. Returns 0 if no map exists. | number |  | 
| GridTileSize | Get the tile size in pixels. Returns 0 if no map exists. | number |  | 
| GridWidth | Get the width of the obstacle map in tiles. Returns 0 if no map exists. | number |  | 
| HazardRadius | Get the current hazard radius setting in tiles. This affects how far hazard influence spreads. | number |  | 
| ObstacleMapJSON | Get the current obstacle map as a JSON string. Use this to save the map to local storage or export to files. | string |  | 
| ObstacleMapSource | Get the source of the current obstacle map. Returns 'custom', 'pathfinding', or 'none'. | string |  | 
| RePathCooldown | Get the current re-path cooldown in seconds. This is the minimum time between automatic re-path attempts. | number |  | 
| RePathThreshold | Get the current re-path threshold in tiles. This is how far the character can drift before automatic re-pathing triggers. | number |  | 
| SlopeDirection | Get the slope direction of a tile at the specified grid coordinates. Returns 'left', 'right', or empty string if not a slope. | string | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| TileState | Get the state of a tile at the specified grid coordinates. Returns 'solid', 'clear', 'jump-thru', 'avoid', 'slope-left', 'slope-right', or empty string if out of bounds. | string | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| WaitTickCount | Get the number of ticks spent waiting for the Pathfinding obstacle map to initialize. Used for debugging timeout issues. | number |  | 
| WorldToGridX | Convert a world X position to grid X coordinate. Returns the grid tile number at the given pixel position. | number | X *(number)* <br> | 
| WorldToGridY | Convert a world Y position to grid Y coordinate. Returns the grid tile number at the given pixel position. | number | Y *(number)* <br> | 
| AngleToWaypoint | Get the angle in degrees from the character to the current waypoint. Returns 0 if no path is active. | number |  | 
| CoyoteTime | Get the current coyote time setting in seconds. This is the window after walking off a ledge where jumps are still allowed. | number |  | 
| CoyoteTimer | Get the current coyote timer value in seconds. This counts down after leaving the ground. Returns 0 when on ground or timer expired. | number |  | 
| CurrentPathAction | Get the action name for a waypoint by index (e.g., 'walk', 'jump', 'fall', 'portal'). Returns empty string if index is out of bounds. | string | Index *(number)* <br> | 
| CurrentWaypoint | Get the index of the current waypoint the character is moving toward. Returns -1 if no path is active. | number |  | 
| CurrentWaypointX | Get the world X position of the current waypoint. Returns 0 if no path is active. | number |  | 
| CurrentWaypointY | Get the world Y position of the current waypoint. Returns 0 if no path is active. | number |  | 
| DistanceToWaypoint | Get the distance in pixels from the character to the current waypoint. Returns 0 if no path is active. | number |  | 
| EstimatedVelocityX | Get the estimated horizontal velocity needed to follow the current path. Returns 0 if no path is active. | number |  | 
| JumpTowardTargetX | Get the world X position of the jump-at target. Returns 0 if not in jump-at mode. | number |  | 
| JumpTowardTargetY | Get the world Y position of the jump-at target. Returns 0 if not in jump-at mode. | number |  | 
| LedgeLeniency | Get the ledge leniency setting in pixels. This is how far past a ledge edge the AI can walk before stopping. | number |  | 
| LedgeRestriction | Get whether ledge restriction is enabled. Returns 1 if enabled, 0 if disabled. | number |  | 
| NodeCount | Get the total number of navigation nodes in the generated graph. Returns 0 if no graph exists. | number |  | 
| NodeWorldX | Get the world X position of a node at the specified grid coordinates. the node position is centred within the tile. Returns 0 if node doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| NodeWorldY | Get the world Y position of a node at the specified grid coordinates. the node position is centred within the tile. Returns 0 if node doesn't exist. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| PathCost | Get the total calculated cost of the current path. Returns 0 if no path is active. | number |  | 
| PathFailReason | Get the reason the last pathfinding attempt failed. Returns: 'no_start_node', 'no_goal_node', 'max_nodes_reached', 'no_path', or empty string if path succeeded. | string |  | 
| PathStrategy | Get the current path strategy preset (balanced, shortest, safest, simplest). | string |  | 
| PathTargetGridX | Get the grid X coordinate of the path target. Returns -1 if no path is active. | number |  | 
| PathTargetGridY | Get the grid Y coordinate of the path target. Returns -1 if no path is active. | number |  | 
| PathTargetX | Get the world X position of the path target. Pass 'original' for raw input or 'corrected' for ground-snapped position. | number | Type *(string)* <br> | 
| PathTargetY | Get the world Y position of the path target. Pass 'original' for raw input or 'corrected' for ground-snapped position. | number | Type *(string)* <br> | 
| StoppingDistance | Get the calculated stopping distance in pixels based on the Platform behavior's current speed. Used for waypoint arrival detection. | number |  | 
| StrictJumpPositioning | Get whether strict jump positioning is currently active for this character. Returns 1 if enabled, 0 if disabled. Useful for conditional logic — e.g. switching between careful and aggressive pathfinding modes. | number |  | 
| WaypointCount | Get the total number of waypoints in the current path. Returns 0 if no path is active. | number |  | 
| WaypointGridX | Get the grid X coordinate of a waypoint by index. Returns -1 if index is out of bounds. | number | Index *(number)* <br> | 
| WaypointGridY | Get the grid Y coordinate of a waypoint by index. Returns -1 if index is out of bounds. | number | Index *(number)* <br> | 
| WaypointX | Get the world X position of a waypoint by index. the waypoint position is centred within the tile. Returns 0 if index is out of bounds. | number | Index *(number)* <br> | 
| WaypointY | Get the world Y position of a waypoint by index. the waypoint position is centred within the tile. Returns 0 if index is out of bounds. | number | Index *(number)* <br> | 
| CurrentPortalID | Returns the portal ID during OnPortalEntry/OnPortalComplete triggers. Use to identify which portal was reached. | number |  | 
| LastPortalID | Returns the ID of the most recently added portal. Use right after adding a portal to save the ID for later configuration or removal. | number |  | 
| PortalCount | Get the total number of portals. | number |  | 
| PortalExitX | Get the exit X position of the current portal. Valid inside OnPortalEntry/OnPortalComplete triggers. | number |  | 
| PortalExitY | Get the exit Y position of the current portal. Valid inside OnPortalEntry/OnPortalComplete triggers. | number |  | 
| PortalProgress | Get the 0-1 traversal progress for gradual portals. Returns 0 if not traversing. | number |  | 
| PortalType | Returns 'instant' or 'gradual' for the given portal ID. | string | Portal ID *(number)* <br> | 


---
## Changelog

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
