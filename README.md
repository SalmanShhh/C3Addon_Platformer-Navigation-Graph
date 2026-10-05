<img src="./src/icon.svg" width="100" /><br>
# Platformer Navigation Graph
<i>Smart pathfinding for platformer games: characters jump gaps, drop between platforms, climb slopes, and take momentum leaps to reach their target. Add it next to the built-in Platform behavior and it works with zero setup events. Includes portals (doors, elevators, ziplines), hazard avoidance, path strategy presets, and crowd handling so groups surround a target instead of stacking.</i> <br>
### Version 0.9.0.0

[<img src="https://placehold.co/200x50/4493f8/FFF?text=Download&font=montserrat" width="200"/>](https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2/releases/download/salmanshh_platformer_navigationgraph-0.9.0.0.c3addon/salmanshh_platformer_navigationgraph-0.9.0.0.c3addon)
<br>
<sub> [See all releases](https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2/releases) </sub> <br>

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
| Tile Size | Size of each grid tile in pixels. MUST match your tilemap's tile size; a mismatch misaligns the graph and characters walk into walls. Set to 0 to auto-detect it (reads the solid tilemap's tile size). Smaller = more precise paths but slower performance. | integer |
| Max Search Nodes | Maximum pathfinding effort before giving up. Higher = finds paths in larger levels but may cause lag. Lower = faster but may fail on complex paths. | integer |
| Max Fall Distance | Maximum fall distance in pixels. 0 = auto-detect from Platform behavior. -1 = unlimited (any fall). Positive value = custom max in pixels. | integer |
| Auto-Control Movement | When enabled, AI automatically controls the character (moves left/right, jumps). When disabled, you handle movement yourself using the path data. | check |
| Path Strategy | How the AI picks the best route when multiple paths exist. Balanced: weighs distance and difficulty equally, good for most platformers and adventure games. Shortest Distance: always takes the fastest route, using long momentum jumps to skip platforms, ideal for speedrunner games and time trials. Safest Route: prefers chains of short hops and drops over long leaps and falls, great for stealth games, escort missions, or fragile NPCs. Ground-Hugging: walks whenever a walking route exists and only jumps or falls when unavoidable, best for patrols, tower defense creeps, and predictable simple enemies. No Falling: never descends by jumping or falling at all, taking slopes and portals down instead, for heavy units and fall-damage games ('Set max traversal drop' raises the allowance). Walk Only: never jumps or falls in any direction, staying on its own platform (slopes and portals excepted) and getting as close to off-platform targets as its ground allows. | combo |
| Smooth Paths | Remove unnecessary waypoints for more natural movement. AI will take direct routes when possible instead of zigzagging. | check |
| Max Waypoint Time | How long (in seconds) AI tries to reach each waypoint before giving up and recalculating path. Prevents infinite loops when stuck. | float |
| Coyote Time | Seconds after walking off a ledge where a jump can still be executed. Allows AI to walk off edges and jump mid-air for greater reach, making slightly out-of-range platforms reachable. Important: only works when 'Ledge Restriction' is disabled: if Ledge Restriction is enabled, characters won't walk off edges, so coyote jumps can never execute and the connections will go unused. 0 = disabled. | float |
| Strict Jump Positioning | When the AI is following a path and needs to jump or fall to another platform, it will slow down and carefully position itself on the tile before launching. This prevents characters from overshooting edges and missing jumps, like a chase enemy flying off a ledge instead of jumping across, or an escort NPC slipping off a narrow bridge mid-jump. Note: this only affects movement DURING pathfinding (jumps and falls that are part of the path). To stop characters from walking off edges entirely, use 'Ledge Restriction' instead. Recommended ON for most games. | check |
| Ledge Restriction | Prevents AI characters from walking off platform edges when they have no reason to leave. Useful for patrol guards that should stay on their platform, or NPCs that shouldn't wander off rooftops. Note: this only stops characters from casually walking off edges: if the AI's path requires a jump or fall to reach its goal, it will still leave the platform. When enabled, 'Coyote Time' has no effect since characters won't walk off edges to trigger it. When disabled, characters can slide off edges freely, which also enables wall-adjacent jumps (walking to the platform edge to clear a wall before jumping). To make jumps and falls more precise, use 'Strict Jump Positioning' instead. | check |
| Ledge Leniency | How many pixels past a platform edge the AI is allowed to walk before stopping (0 = strict stop at edge). Increase for more natural-looking movement near edges. Only used when Ledge Restriction is enabled. | float |
| Re-Path Threshold | How many tiles the character can deviate from its path before automatically recalculating. Useful when the character gets knocked off course. 0 = disabled. | float |
| Hazard Radius | Tile radius for hazard cost falloff buffer zone. Nearby tiles within this radius of a hazard get cost penalties. 0 = no buffer, only exact hazard tiles affected. | integer |
| Auto-Build Graph | Zero-event startup: automatically build the obstacle map and navigation graph on startup, no events needed. Auto (default): scan all objects with Solid and Jump-thru behaviors. Explicit map-setup actions in 'On start of layout' always take precedence. Off: set the map up yourself with actions. | combo |
| Map Tag | Instances with the same map tag on a layout share one navigation map and graph. Leave empty to share with everyone (recommended). Give special characters their own tag (e.g. 'ghost' for wall-phasing enemies, 'flyer' for airborne ones), then set up that tag's obstacle map, portals, and hazards on an instance carrying that tag. Each tag builds and stores its own map, so use few tags. | text |
| Detect Slopes | During solid scanning (including Auto-Build), probe each partially-solid tile's collision shape and automatically register 45° and 22.5° slope surfaces as slopes, with no tile ID lists needed. Tiles whose shape doesn't match a supported slope angle stay solid, so this is safe to leave on. Requires tiles/sprites to have actual sloped collision polygons. Turn off to register slopes yourself with the slope actions only. | check |
| Crowd Arrivals | When several characters path to the same position, spread their arrivals: each claims a landing spot (goal node) so others automatically target neighboring spots instead of stacking on one pixel. Per map tag. Harmless with a single character. | check |
| Idle Separation | Personal space in pixels for characters with no active path: idle characters closer than this to another character on the same map gently push apart. 0 = off. The nudge is ledge-safe (never pushes off an edge or into a wall) and never interferes with path following. A good starting value is the character's width. | float |
| Separation Cooldown | How long (in seconds) characters rest after giving up on idle separation (when the crowd is too dense for the spacing to be satisfied) before trying again. 0 = never rest, keep trying continuously. Only used when Idle Separation is above 0. | float |
| Enabled | Whether the behavior starts active. While disabled, the character stops following paths and Find path actions are ignored; the current path, graph, and settings are kept and everything resumes when re-enabled. Toggle at runtime with the 'Set enabled' action. | check |


---
## Actions
| Action | Description | Params
| --- | --- | --- |
| Log graph stats | Print navigation graph statistics to the browser console. Useful for debugging: shows node count, connection count, portal count, etc. |  |
| Add circle hazard | Add a circular hazard area. The AI will avoid this area based on severity. Hazard avoidance is automatically enabled. Returns a hazard ID for later removal. Use for dynamic danger zones like explosions or enemy AOE. | X             *(number)* <br>Y             *(number)* <br>Radius             *(number)* <br>Severity             *(number)* <br> |
| Add rectangle hazard | Add a rectangular hazard area. The AI will avoid this area based on severity. Hazard avoidance is automatically enabled. Returns a hazard ID for later removal. Use for static danger zones like spike pits. | X             *(number)* <br>Y             *(number)* <br>Width             *(number)* <br>Height             *(number)* <br>Severity             *(number)* <br> |
| Add tracked hazard (follows object) | Add a circular hazard that follows an object automatically, with no per-frame events. It removes itself when the object is destroyed. Read the new hazard's ID with LastHazardID. | Object to follow             *(object)* <br>Radius             *(number)* <br>Severity             *(number)* <br> |
| Clear hazards | Clear hazards by kind: Shapes (circles and rects, tracked included), Tiles, Tracked only, or Everything. | Which             *(combo)* <br> |
| Remove hazard | Remove a hazard by its ID. Use this when a danger zone is no longer active. The graph will be regenerated if needed. | ID             *(number)* <br> |
| Set hazard radius | Set the radius in tiles for circular/rectangular hazard influence. Tiles within this radius of a hazard will have their pathfinding cost increased. | Tiles             *(number)* <br> |
| Set tile hazard severity | Set the hazard severity for a specific tile. Higher values make the AI avoid this tile more strongly. 0 = no hazard. Hazard avoidance is automatically enabled when any hazard is added. Use this to mark dangerous areas like spikes or lava. | Grid X             *(number)* <br>Grid Y             *(number)* <br>Severity             *(number)* <br> |
| Jump toward position | Jump directly toward a position with full strength, no pathfinding. Works from the floor, or mid-air when double jump is enabled. Triggers 'On jump toward launched' when the jump starts. | X             *(number)* <br>Y             *(number)* <br> |
| Set auto-control | Toggle auto-movement on/off. When enabled, the behavior automatically controls the Platform behavior to follow paths. When disabled, you control movement yourself using path data expressions. | Enabled             *(combo)* <br> |
| Set coyote time | Set the coyote time window in seconds. The AI can jump within this window after walking off a ledge. Set to 0 to disable coyote time. | Seconds             *(number)* <br> |
| Set enabled | Enable or disable this behavior. Disabled freezes navigation with all state kept for a seamless resume; Find path is ignored, map setup actions still work. | State             *(combo)* <br> |
| Set ledge leniency | Set how many pixels past a platform edge the AI can walk before stopping (0 = strict stop). Increase for more natural-looking patrol movement near edges. Only used when ledge restriction is enabled. | Pixels             *(number)* <br> |
| Set ledge restriction | Toggle whether the character stops at platform edges instead of casually walking off. Paths that require a jump or fall still leave the platform. | Enabled             *(combo)* <br> |
| Set movement limit | Override an auto-detected movement limit used to build graph connections. The value locks in and is no longer read from the Platform behavior; regenerate the graph afterwards. | Limit             *(combo)* <br>Value             *(number)* <br> |
| Set strict jump positioning | Toggle whether the character slows down and centers itself before jumps and falls. Does not affect walking off edges (use 'Set ledge restriction' for that). | Enabled             *(combo)* <br> |
| Start patrol | Patrol the current platform: walk to one end, wait for the dwell time, turn, and repeat. The ends are found automatically from the graph's ledges and walls, slopes included. Any Find path call ends the patrol. | Dwell time             *(number)* <br>Edge distance             *(number)* <br> |
| Stop patrol | End the current patrol. The character simply stands where it is. |  |
| Auto-detect slope tiles from tilemap | Scan a Tilemap and register slope tiles by probing their collision shapes: 45° surfaces become slopes, 22.5° surfaces become gentle slopes, flipped placements are handled. Tiles need sloped collision polygons; unsupported angles stay solid. | Tilemap             *(object)* <br> |
| Build obstacle map from layout | Create an empty obstacle map grid from layout pixel dimensions. Follow with ScanSolidObjectsIntoObstacleMap and ScanJumpThruObjectsIntoObstacleMap to fill it. | Layout width (px)             *(number)* <br>Layout height (px)             *(number)* <br> |
| Clear all slope markings | Remove all slope markings from the obstacle map. Slopes will be treated as regular solid tiles. Use this to reset slope data. |  |
| Clear obstacle map | Remove the obstacle map and all associated data. Use this when switching levels or resetting the navigation system. |  |
| Create custom obstacle map | Create a custom obstacle map with the specified dimensions in tiles. All tiles are initialized to 'clear' state. Use this for fully manual tile setup. | Width             *(number)* <br>Height             *(number)* <br> |
| Load obstacle map from JSON | Load a previously saved obstacle map from JSON string. Use this to restore saved maps or load pre-built level data. | JSON             *(string)* <br> |
| Map slope tiles from tilemap | Scan a Tilemap and mark tiles matching the given tile IDs as slopes. Pass tile IDs as comma-separated strings (e.g. '5,6,7'). Pass empty string to skip a slope type. Requires the obstacle map to be created first. | Tilemap             *(object)* <br>Slope left IDs             *(string)* <br>Slope right IDs             *(string)* <br>Gentle left IDs             *(string)* <br>Gentle right IDs             *(string)* <br> |
| Mark slope region | Mark a diagonal region of tiles as slope. Specify the start and end grid corners. All tiles along the diagonal will be marked as slope with the given direction. | Start X             *(number)* <br>Start Y             *(number)* <br>End X             *(number)* <br>End Y             *(number)* <br>Direction             *(combo)* <br> |
| Regenerate navigation graph | Build or rebuild the navigation graph from the current obstacle map. Call after setting up tiles manually, and after modifying the level layout, adding/removing obstacles, or changing platform positions. Fires 'On navigation graph generated' when done. |  |
| Scan jump-thru objects into obstacle map | Scan one-way platform objects into the obstacle map as jump-thru cells. Requires an existing obstacle map (call BuildObstacleMapFromLayout first). Objects must have the Jump-thru behavior enabled. | Jump-thru objects             *(object)* <br> |
| Scan solid objects into obstacle map | Scan solid objects into the obstacle map. Requires an existing obstacle map (call BuildObstacleMapFromLayout first). Tilemaps are scanned cell-by-cell; sprites use bounding box. Objects must have the Solid behavior enabled. | Solid objects             *(object)* <br> |
| Set tile state | Set the state of a tile at the specified grid coordinates. Use this to mark tiles as solid obstacles, clear space, jump-thru platforms, areas to avoid, or slopes. | Grid X             *(number)* <br>Grid Y             *(number)* <br>State             *(combo)* <br> |
| Set tile state at world position | Set the state of a tile at the specified world coordinates. The world position is automatically converted to grid coordinates. | X             *(number)* <br>Y             *(number)* <br>State             *(combo)* <br> |
| Find object on same platform | Search the object's picked instances for the nearest or furthest one reachable by walking alone, no jumps or falls. Read the result with PlatformObjectUID and pick it with the System 'Pick by unique ID' condition (-1 = none). | Target object             *(object)* <br>Which             *(combo)* <br> |
| Find path to position (advanced) | Calculate a path to the target coordinates with full control over ground correction, path mode, and jump positioning. For the common case, the simpler 'Find path' or 'Find path to object' actions are recommended. | X             *(number)* <br>Y             *(number)* <br>Correct to ground             *(combo)* <br>Mode             *(combo)* <br>Jump Positioning             *(combo)* <br> |
| Find path | Calculate a path to a position with sensible defaults: positions snap to walkable ground, and an unreachable target paths as close as possible. Use 'Find path to position (advanced)' for full control. | X             *(number)* <br>Y             *(number)* <br> |
| Find path to nearest ledge | Calculate a path to the nearest platform edge in the given direction, stopping the given distance back from it. Triggers 'On failed to find path' if no ledge exists that way. | Direction             *(combo)* <br>Distance             *(number)* <br> |
| Find path to object | Calculate a path to another object's position with sensible defaults: positions snap to walkable ground, and an unreachable target paths as close as possible. Uses the first picked instance. | Target object             *(object)* <br> |
| Find path to side of object | Calculate a path to a position beside another object instead of on top of it, keeping the given distance (both widths are always cleared). 'Any' picks the nearer side, falling back if it has no ground. Uses the first picked instance. | Target object             *(object)* <br>Side             *(combo)* <br>Distance             *(number)* <br> |
| Set crowd arrivals | Enable or disable crowd arrivals: characters pathing to the same position each claim a landing spot, so later arrivals target neighboring spots instead of stacking. Per map tag. | Enabled             *(combo)* <br> |
| Set max paths per tick | Set how many pathfinding requests can be processed per game tick. Higher values reduce latency but increase CPU cost per frame. Default is 1. | Count             *(number)* <br> |
| Set max traversal drop | Limit how far down this character will ever descend by air: jumps and falls with a larger net drop are excluded from its paths, so it descends via slopes and portals instead. For heavy units and fall damage. | Drop             *(number)* <br> |
| Set multi-agent avoidance | Enable or disable path-level multi-agent avoidance. When enabled, agents try to avoid choosing overlapping paths when multiple agents share the same navigation map. | Enabled             *(combo)* <br> |
| Set path strategy | Change how routes are picked. Balanced: distance and difficulty weighed equally. Shortest Distance: fastest route, momentum jumps included. Safest Route: short hops and drops over long leaps. Ground-Hugging: walk whenever possible. No Falling: never descend by air; slopes and portals only. Walk Only: never jump or fall at all; stay on the platform. | Strategy             *(combo)* <br> |
| Set re-path cooldown | Set the minimum time in seconds between automatic re-path attempts. Lower values = more responsive re-pathing but more CPU usage. Default is 0.5 seconds. | Seconds             *(number)* <br> |
| Set re-path threshold | Set how many tiles the character can drift from the path before automatic re-pathing triggers. Higher values = more tolerance for deviation. | Tiles             *(number)* <br> |
| Set separation setting | Change an idle separation setting: Distance (personal space in pixels, 0 = off), Cooldown (rest after giving up, in seconds, 0 = never rest), or Give-up time (trying time before resting, in seconds). | Setting             *(combo)* <br>Value             *(number)* <br> |
| Stop | Stop the character immediately and clear the current path. Use when you want to cancel AI navigation and regain manual control. |  |
| Add elevator stop | Add a stop to an elevator group: two-way gradual portals to every other stop in the group are created automatically, with cost from distance and speed. Use a unique group name per elevator. | Group             *(string)* <br>X             *(number)* <br>Y             *(number)* <br>Speed             *(number)* <br>Tag             *(string)* <br> |
| Add elevator stop from object | Add an elevator stop using an object's position. Same as 'Add elevator stop' but uses the object's current X/Y. The object serves as a floor marker. | Group             *(string)* <br>Object             *(object)* <br>Speed             *(number)* <br>Tag             *(string)* <br> |
| Add gradual portal | Add a portal that gradually moves the AI from entry to exit at the given speed. The character moves in a straight line (any direction: vertical, horizontal, or diagonal). Platform behavior is disabled during movement. Use for: elevators, lifts, moving platforms, ziplines. | Direction             *(combo)* <br>Entry X             *(number)* <br>Entry Y             *(number)* <br>Exit X             *(number)* <br>Exit Y             *(number)* <br>Cost             *(number)* <br>Speed             *(number)* <br>Tag             *(string)* <br> |
| Add gradual portal from objects | Add a gradual portal using two objects. Character moves from entry object to exit object at the given speed. Use for: linking elevator sprites, rope endpoints, etc. | Direction             *(combo)* <br>Entry object             *(object)* <br>Exit object             *(object)* <br>Cost             *(number)* <br>Speed             *(number)* <br>Tag             *(string)* <br> |
| Add instant portal | Add a portal that instantly teleports the character from entry to exit. Use 'On portal entry' with 'Pause at portal' to play animations before the teleport. | Direction             *(combo)* <br>Entry X             *(number)* <br>Entry Y             *(number)* <br>Exit X             *(number)* <br>Exit Y             *(number)* <br>Cost             *(number)* <br>Tag             *(string)* <br> |
| Add instant portal from objects | Add an instant portal using two objects as entry and exit positions. The objects' current X/Y positions are used. Use for: linking door sprites, warp pad objects, etc. | Direction             *(combo)* <br>Entry object             *(object)* <br>Exit object             *(object)* <br>Cost             *(number)* <br>Tag             *(string)* <br> |
| Complete portal | Finish a paused portal without its built-in movement, when your events moved the character themselves. Also works mid-traverse to cut a gradual portal short. |  |
| Pause at portal | Hold the character at the portal entry. Only valid inside 'On portal entry'. Call 'Resume portal' to run the built-in movement, or 'Complete portal' if your events moved the character. |  |
| Remove portal by ID | Remove a portal by its ID. The portal connection is removed from the navigation graph immediately. | Portal ID             *(number)* <br> |
| Remove portal at object | Remove the portal closest to this object. Works with both entry and exit positions; for two-way portals, either endpoint object can be used. | Object             *(object)* <br> |
| Remove portals by tag | Remove every portal whose tag matches the given string, or ALL portals when the tag is empty. Graph connections are removed immediately. | Tag             *(string)* <br> |
| Resume portal | Continue portal execution after pausing with 'Pause at portal'. For instant portals: teleports the character to the exit. For gradual portals: begins moving the character toward the exit. Use this when you want the portal's built-in movement to handle the transition. |  |
| Set portal cost | Change how 'expensive' a portal is for the AI to use. Lower cost = preferred, higher cost = avoided. | Portal ID             *(number)* <br>Cost             *(number)* <br> |
| Set portal ignore hazards | Set whether a portal ignores nearby hazards when calculating its pathfinding cost. | Portal ID             *(number)* <br>Ignore hazards             *(combo)* <br> |
| Set portal position | Move a portal's entry and exit in place, keeping its ID, type, cost, speed, and tags; graph connections re-wire immediately. A character mid-traversal keeps its original destination. | Portal ID             *(number)* <br>Entry X             *(number)* <br>Entry Y             *(number)* <br>Exit X             *(number)* <br>Exit Y             *(number)* <br> |
| Set portal position from objects | Move an existing portal to two objects' current positions (first picked instances), preserving its ID, type, cost, speed, and tags. Combine with an Every X seconds event to make a portal follow moving objects, such as a teleporter drone. | Portal ID             *(number)* <br>Entry object             *(object)* <br>Exit object             *(object)* <br> |
| Set portal speed | Change the movement speed of a gradual portal (pixels per second). Has no effect on instant portals. | Portal ID             *(number)* <br>Speed             *(number)* <br> |
| Set portal tag | Assign a string tag to a portal. Tags are used to group portals so they can be removed together with 'Remove portals by tag'. A portal can only have one tag at a time; calling this again replaces the previous tag. | Portal ID             *(number)* <br>Tag             *(string)* <br> |
| Teleport to position | Instantly move the character to the given position. Suppresses drift re-pathing for one tick so the current path is not abandoned. | X             *(number)* <br>Y             *(number)* <br> |


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
| Is patrolling | True while a ledge-to-ledge patrol is active. |  |
| Is platform enabled | Check if the associated Platform behavior is currently enabled. Returns false if Platform behavior is disabled or not found. |  |
| On jump toward launched | Triggered when the 'Jump toward position' action launches the character. Use this to play attack animations, spawn effects, or apply damage. The target position is available via JumpTowardTargetX/Y expressions. |  |
| On arrived | Triggered when the AI arrives at the final destination. Use this to trigger arrival animations, next actions, or goal completion logic. |  |
| On patrol dwell finished | Triggered when a patrolling character finishes its wait at a patrol end and turns to walk again. PatrolDirection already reports the new walk direction inside this trigger. Not fired when the dwell time is 0; use 'On patrol end reached' there. |  |
| On patrol dwell started | Triggered when a patrolling character begins its wait at a patrol end, right after 'On patrol end reached'. Use it to start idle or look-around animations. Not fired when the dwell time is 0. |  |
| On patrol end reached | Triggered each time a patrolling character reaches an end of its patrol and is about to turn. Use it for look-around animations during the dwell. |  |
| On waypoint reached | Triggered each time the character reaches a waypoint along the path. Use this to play footstep sounds, particle effects, or update animations. |  |
| On waypoint stuck | Triggered when the character has been stuck at a waypoint for too long (exceeds Max Waypoint Time). The path is automatically cancelled. Use this to handle stuck situations or repath. |  |
| On obstacle map created | Triggered when a custom obstacle map is successfully created. Use this to start configuring tiles after map creation. |  |
| On obstacle map removed | Triggered when the obstacle map is cleared or removed. Use this to clean up related data or reset systems. |  |
| Tile has state | Check if a tile at the given grid position has the specified state. Use this to query tile properties before actions. | Grid X *(number)* <br>Grid Y *(number)* <br>State *(combo)* <br> |
| Tile has state at world position | Check if a tile at the given world position has the specified state. World coordinates are automatically converted to grid coordinates. | X *(number)* <br>Y *(number)* <br>State *(combo)* <br> |
| Is moving along path | Check if the character currently has an active pathfinding path. Returns true while navigating, false when idle or path is complete. Matches the built-in Pathfinding behavior's 'Is moving along path'. |  |
| Is crowd arrivals enabled | True if crowd arrivals (goal reservation) is currently active. |  |
| Is multi-agent avoidance enabled | True if multi-agent avoidance is currently active. |  |
| Is on same platform as object | True when the character can walk to the object without jumping or falling: both stand on the same connected stretch of ground, slopes included. Useful for picking a target to path to, or choosing between walking and lunging. Uses the first picked instance of the object. | Target object *(object)* <br> |
| Is calculating path | True when a pathfinding request has been submitted but not yet resolved (queued behind the per-tick path budget). Use to show a 'thinking' state or delay actions until the path arrives. |  |
| On navigation graph generated | Triggered when the navigation graph has been successfully generated. Use this to start pathfinding operations after map setup. |  |
| On side of object reached | Triggered when a 'Find path to side of object' arrival lands with the character beside the target at the requested distance. A stopped-short arrival fires only 'On arrived'. Read the side with ReachedObjectSide. |  |
| On failed to find path | Triggered when pathfinding fails to find a valid path to the target. Use this to handle unreachable destinations or implement fallback behaviors. |  |
| On path found | Triggered when a path has been successfully calculated. Use this to start custom actions when pathfinding succeeds. |  |
| On re-path triggered | Triggered when automatic re-pathing occurs due to the character drifting too far from the path. Use this to monitor navigation accuracy. |  |
| Is at portal | True when the AI is paused at a portal entry (after 'Pause at portal' was called but before 'Resume portal' or 'Complete portal'). Use to check if the character is waiting at a portal. |  |
| Is traversing portal | True when the AI is currently moving through a gradual portal (elevator, ladder, etc.). Platform behavior is disabled during traversal. |  |
| On portal complete | Triggered when portal execution finishes: after an instant teleport completes, a gradual movement reaches the exit, or 'Complete portal' is called. Use this for post-portal effects like opening doors at the exit, playing arrival animations, etc. |  |
| On portal entry | Triggered when the character arrives at a portal entry, before the portal executes. Call 'Pause at portal' here to run your own events first. CurrentPortalID identifies the portal. |  |


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
| PatrolDirection | The patrol walk direction: -1 walking left, 1 walking right, 0 when not patrolling or dwelling at an end. Useful for mirroring the sprite. | number |  | 
| StoppingDistance | Get the calculated stopping distance in pixels based on the Platform behavior's current speed. Used for waypoint arrival detection. | number |  | 
| StrictJumpPositioning | Get whether strict jump positioning is currently active for this character. Returns 1 if enabled, 0 if disabled. Useful for conditional logic, e.g. switching between careful and aggressive pathfinding modes. | number |  | 
| GridHeight | Get the height of the obstacle map in tiles. Returns 0 if no map exists. | number |  | 
| GridTileSize | Get the tile size in pixels. Returns 0 if no map exists. | number |  | 
| GridWidth | Get the width of the obstacle map in tiles. Returns 0 if no map exists. | number |  | 
| MapTag | The map tag this instance navigates with (from the Map Tag property). Instances with the same tag on a layout share one navigation map. Returns an empty string for the default shared map. | string |  | 
| ObstacleMapJSON | Get the current obstacle map as a JSON string. Use this to save the map to local storage or export to files. | string |  | 
| ObstacleMapSource | Get the source of the current obstacle map. Returns 'collision', 'custom', or 'none'. | string |  | 
| SlopeDirection | Get the slope direction of a tile at the specified grid coordinates. Returns 'left', 'right', or empty string if not a slope. | string | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| TileState | Get the state of a tile at the specified grid coordinates. Returns 'solid', 'clear', 'jump-thru', 'avoid', 'slope-left', 'slope-right', or empty string if out of bounds. | string | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| WorldToGridX | Convert a world X position to grid X coordinate. Returns the grid tile number at the given pixel position. | number | X *(number)* <br> | 
| WorldToGridY | Convert a world Y position to grid Y coordinate. Returns the grid tile number at the given pixel position. | number | Y *(number)* <br> | 
| AngleToWaypoint | Get the angle in degrees from the character to the current waypoint. Returns 0 if no path is active. | number |  | 
| CurrentPathAction | Get the action name for a waypoint by index (e.g., 'walk', 'jump', 'fall', 'portal'). Returns empty string if index is out of bounds. | string | Index *(number)* <br> | 
| CurrentWaypoint | Get the index of the current waypoint the character is moving toward. Returns -1 if no path is active. | number |  | 
| CurrentWaypointX | Get the world X position of the current waypoint. Returns 0 if no path is active. | number |  | 
| CurrentWaypointY | Get the world Y position of the current waypoint. Returns 0 if no path is active. | number |  | 
| DistanceToWaypoint | Get the distance in pixels from the character to the current waypoint. Returns 0 if no path is active. | number |  | 
| IdleSeparation | The idle separation distance in pixels (0 = off). | number |  | 
| MaxPathsPerTick | Get the current maximum paths per tick setting. | number |  | 
| MaxTraversalDrop | The maximum downward drop this character will traverse by air, in pixels. -1 means no limit. | number |  | 
| NearbyAgentCount | Get the number of nearby agents sharing the same navigation map. | number |  | 
| NearestLedgeLeftX | The X co-ordinate of the nearest ledge to the left of the character, in pixels. Returns 0 if none exists. | number |  | 
| NearestLedgeLeftY | The Y co-ordinate of the nearest ledge to the left of the character, in pixels. Returns 0 if none exists. | number |  | 
| NearestLedgeRightX | The X co-ordinate of the nearest ledge to the right of the character, in pixels. Returns 0 if none exists. | number |  | 
| NearestLedgeRightY | The Y co-ordinate of the nearest ledge to the right of the character, in pixels. Returns 0 if none exists. | number |  | 
| OnSamePlatform | 1 if the position is on the same walkable platform as the character (reachable by walking only, no jumps or falls), else 0. | number | X *(number)* <br>Y *(number)* <br> | 
| PathCost | Get the total calculated cost of the current path. Returns 0 if no path is active. | number |  | 
| PathEndX | The world X of the calculated path's final position: the last waypoint, where the character will actually end up. In Nearest mode this can differ from the requested target (the path stops at the closest reachable spot). Returns 0 if no path has been calculated. | number |  | 
| PathEndY | The world Y of the calculated path's final position: the last waypoint, where the character will actually end up. In Nearest mode this can differ from the requested target (the path stops at the closest reachable spot). Returns 0 if no path has been calculated. | number |  | 
| PathFailReason | Get the reason the last pathfinding attempt failed. Returns: 'no_start_node', 'no_goal_node', 'max_nodes_reached', 'no_path', or empty string if path succeeded. | string |  | 
| PathQueueSize | Get the number of pathfinding requests currently waiting in the queue. | number |  | 
| PathStrategy | Get the current path strategy preset (balanced, shortest, safest, simplest, no_drop, walk_only). Note: 'simplest' is the Ground-Hugging strategy and 'no_drop' is No Falling; keys keep their internal names for save compatibility. | string |  | 
| PlatformObjectUID | The UID of the instance found by 'Find object on same platform', for the System 'Pick by unique ID' condition. -1 if none was on the platform. | number |  | 
| ReachedObjectSide | Which side of the target the character reached: -1 left, 1 right. Valid after 'On side of object reached' fires, 0 otherwise. | number |  | 
| RePathCooldown | Get the current re-path cooldown in seconds. This is the minimum time between automatic re-path attempts. | number |  | 
| RePathThreshold | Get the current re-path threshold in tiles. This is how far the character can drift before automatic re-pathing triggers. | number |  | 
| SeparationCooldown | The separation cooldown in seconds (rest time after giving up on idle separation; 0 = never rest). | number |  | 
| SeparationGiveUpTime | How long a character keeps trying to separate before giving up and resting, in seconds. | number |  | 
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
