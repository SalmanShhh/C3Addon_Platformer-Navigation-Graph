<img src="./src/icon.svg" width="100" /><br>
# Platformer Navigation Graph
<i>AI pathfinding for platformer games with jumping and falling</i> <br>
### Version 0.1.0.0

[<img src="https://placehold.co/200x50/4493f8/FFF?text=Download&font=montserrat" width="200"/>](https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2/releases/download/salmanshh_platformer_navigationgraph-0.1.0.0.c3addon/salmanshh_platformer_navigationgraph-0.1.0.0.c3addon)
<br>
<sub> [See all releases](https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2/releases) </sub> <br>

#### What's New in 0.1.0.0
**Added:**
WIP Skeleton of Features.
- Basic Pathfinding.
- Obstacle Maps.
- Hazard System.
- Debugging & Tuning
- Advanced Usage Features.


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
| Cell Size | Size of each grid square in pixels. MUST match the Cell Size in your Pathfinding behavior! Smaller = more precise paths but slower performance. | integer |
| Character Height | Height of your character in pixels. Used to check if character can fit under platforms when jumping or moving. Should match your sprite's collision box height. | integer |
| Max Search Nodes | Maximum pathfinding effort before giving up. Higher = finds paths in larger levels but may cause lag. Lower = faster but may fail on complex paths. | integer |
| Max Jump Height | Highest platform your character can jump to reach (in pixels). Should match your Platform behavior's jump strength. AI will only attempt jumps within this limit. | integer |
| Max Jump Distance | Farthest gap your character can jump across (in pixels). Should match your character's movement speed and jump duration. AI won't attempt longer jumps. | integer |
| Max Fall Distance | Maximum height your character can safely fall from (in pixels). AI will avoid longer drops that might cause damage or death in your game. | integer |
| Auto-Control Movement | When enabled, AI automatically controls the character (moves left/right, jumps). When disabled, you handle movement yourself using the path data. | check |
| Graph Mode | How navigation data is stored. Shared = all characters use same map (efficient). Per-Instance = each character has own map (rare use cases only). | combo |
| Enable Portals | Allow AI to use special connections like teleporters, ladders, elevators, or doors. Disable if your game doesn't have these features. | check |
| Smooth Paths | Remove unnecessary waypoints for more natural movement. AI will take direct routes when possible instead of zigzagging. | check |
| Max Waypoint Time | How long (in seconds) AI tries to reach each waypoint before giving up and recalculating path. Prevents infinite loops when stuck. | float |
| Setup Preset | Pre-configured jump/fall settings. Auto: detects from Platform behavior. Beginner: short jumps, safe falls. Intermediate: moderate mobility. Advanced: maximum jump/fall distances for complex levels. | combo |
| Enable Hazard Avoidance | AI will try to avoid dangerous areas like spikes, fire, or enemy patrol zones. Makes pathfinding slower but smarter. | check |


---
## Actions
| Action | Description | Params
| --- | --- | --- |
| Add circle hazard | Mark a circular area as dangerous. AI will avoid this region when pathfinding. Good for explosions, magic zones, or round enemy patrol areas. | X             *(number)* <br>Y             *(number)* <br>Radius             *(number)* <br>Severity             *(number)* <br> |
| Add rectangle hazard | Mark a rectangular area as dangerous. AI will avoid this region when pathfinding. Use for spikes, fire, enemy zones, etc. | X             *(number)* <br>Y             *(number)* <br>Width             *(number)* <br>Height             *(number)* <br>Severity             *(number)* <br> |
| Add rectangle hazard (grid) | Mark rectangular region as hazardous using grid coordinates | Grid X             *(number)* <br>Grid Y             *(number)* <br>Grid Width             *(number)* <br>Grid Height             *(number)* <br>Severity             *(number)* <br> |
| Clear all hazards | Remove all hazardous regions at once. Use this to reset the hazard map when changing levels or game states. |  |
| Remove hazard | Remove a specific hazard by its unique ID number. Get the ID when adding hazards or use expressions to check. | Hazard ID             *(number)* <br> |
| Clear obstacle map | Remove the obstacle map and navigation graph |  |
| Create custom obstacle map | Create empty obstacle map with specified dimensions (in grid cells) | Width (cells)             *(number)* <br>Height (cells)             *(number)* <br> |
| Generate nodes from custom map | Build navigation graph from custom obstacle map |  |
| Load obstacle map from JSON | Load obstacle map data from JSON string | JSON Data             *(string)* <br> |
| Set obstacle cell | Set whether a specific grid cell is blocked | Grid X             *(number)* <br>Grid Y             *(number)* <br>Solid             *(combo)* <br> |
| Set obstacle cell at world position | Set whether cell at world position is solid | X             *(number)* <br>Y             *(number)* <br>Solid             *(combo)* <br> |
| Find path to position | Tell the AI to calculate and follow a path from current position to the target coordinates. Character will automatically move if Auto-Control is enabled. | X             *(number)* <br>Y             *(number)* <br> |
| Regenerate navigation graph | Rebuild the pathfinding map from scratch. Use this after moving platforms or changing the level layout during gameplay. |  |
| Stop pathfinding | Stop the character immediately and clear the current path. Character will stand still until given a new path. |  |
| Add portal | Create a special connection between two points (teleporter, ladder, elevator, door). AI can use this to instantly travel between locations. | Type             *(combo)* <br>Entry X             *(number)* <br>Entry Y             *(number)* <br>Exit X             *(number)* <br>Exit Y             *(number)* <br>Cost             *(number)* <br> |


---
## Conditions
| Condition | Description | Params
| --- | --- | --- |
| Is position hazardous | Check if a specific coordinate is inside any hazardous area. Returns true if position is dangerous, false if safe. | X *(number)* <br>Y *(number)* <br> |
| On obstacle map created | Triggered when obstacle map is created or regenerated |  |
| On obstacle map removed | Triggered when obstacle map is cleared |  |
| Has path | Check if the character is currently following a path to a destination. True while moving, false when stopped or path completed. |  |


---
## Expressions
| Expression | Description | Return Type | Params
| --- | --- | --- | --- |
| CalculatedJumpDistance | Get the maximum horizontal distance the AI thinks your character can jump (in pixels). Compare with actual performance for tuning. | number |  | 
| CalculatedJumpHeight | Get the maximum jump height the AI thinks your character can reach (in pixels). Compare with your actual jump height for tuning. | number |  | 
| PlatformJumpStrength | Get the jump strength value from the Platform behavior. Used for debugging jump height calculations. | number |  | 
| PlatformMaxSpeed | Platform behavior max speed | number |  | 
| HazardCount | Get the total number of hazardous regions currently active. Useful for debugging or UI display. | number |  | 
| HazardSeverity | Get the hazard severity at a position. Returns 1.0 for safe areas, higher values for more dangerous areas. | number | X *(number)* <br>Y *(number)* <br> | 
| IsPositionHazardous | Check if a position is inside any hazardous area. Returns 1 if dangerous, 0 if safe. | number | X *(number)* <br>Y *(number)* <br> | 
| GridHeight | Get the height of the navigation grid in cells (not pixels). Multiply by cell size to get pixel height. | number |  | 
| GridWidth | Get the width of the navigation grid in cells (not pixels). Multiply by cell size to get pixel width. | number |  | 
| IsCellSolid | Check if a specific grid cell is blocked by an obstacle. Returns 1 if blocked/solid, 0 if clear/walkable. | number | Grid X *(number)* <br>Grid Y *(number)* <br> | 
| ObstacleMapJSON | Get the obstacle map as a JSON text string. Use this to save level layouts to Local Storage or send to server. | string |  | 
| ObstacleMapSource | Get how the obstacle map was created. Returns 'pathfinding' (from Pathfinding behavior), 'custom' (manually set), or 'none' (not generated yet). | string |  | 
| WorldToGridX | Convert a world X coordinate (in pixels) to grid X coordinate. Use this to check which cell a position is in. | number | X *(number)* <br> | 
| WorldToGridY | Convert world Y to grid Y | number | Y *(number)* <br> | 
| CurrentWaypoint | Current waypoint index (0-based) | number |  | 
| NodeCount | Total number of navigation nodes | number |  | 
| PathLength | Number of waypoints in current path | number |  | 
| PortalCount | Total number of portals | number |  | 


---
## Changelog

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
