import { action, condition, expression } from "../template/aceDefine.js";

const category = "Aces_In_Single_File";



// ════════════════════════════════════════════════════════════
// PATHFINDING Actions & Conditions
// ════════════════════════════════════════════════════════════
action("Pathfinding", "FindPath", {
  listName: "Find path to position",
  displayText: "Find path to ({0}, {1}) [Ground correction: {2}]",
  description: "Tell the AI to calculate and follow a path from current position to the target coordinates. Character will automatically move if Auto-Control is enabled. Enable 'Correct to ground' to automatically snap start/end positions to the nearest walkable ground.",
  params: [
    { id: "x", name: "X", desc: "Target X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Target Y position in pixels", type: "number", initialValue: "0" },
    {
      id: "correctToGround",
      name: "Correct to ground",
      desc: "Automatically snap start and target positions to the nearest walkable ground position. Useful when positions may be in mid-air.",
      type: "combo",
      initialValue: "no",
      items: [
        { no: "No" },
        { yes: "Yes" }
      ]
    }
  ]
}, function(x, y, correctToGround) {
  this.aceFindPath(x, y, correctToGround === "yes");
});

action("Pathfinding", "StopPathfinding", {
  listName: "Stop pathfinding",
  displayText: "Stop pathfinding",
  description: "Stop the character immediately and clear the current path. Character will stand still until given a new path."
}, function() {
  this.aceStopPathfinding();
});

action("Pathfinding", "RegenerateGraph", {
  listName: "Regenerate navigation graph",
  displayText: "Regenerate navigation graph",
  description: "Rebuild the pathfinding map from scratch. Use this after moving platforms or changing the level layout during gameplay."
}, function() {
  this.aceRegenerateGraph();
});

condition("Pathfinding", "HasPath", {
  listName: "Has path",
  displayText: "Has active path",
  description: "Check if the character is currently following a path to a destination. True while moving, false when stopped or path completed.",
  isInvertible: true,
}, function() {
  return this.aceHasPath();
});

condition("Pathfinding", "OnPathFound", {
  listName: "On path found",
  displayText: "On path found",
  description: "Triggered when a path is successfully calculated to the target. Use this to react when the AI finds a valid route.",
  isTrigger: true,
}, function() {
  return true;
});

condition("Pathfinding", "OnPathFailed", {
  listName: "On path failed",
  displayText: "On path failed",
  description: "Triggered when pathfinding fails to find a valid route to the target. Use this to handle unreachable destinations.",
  isTrigger: true,
}, function() {
  return true;
});

condition("Pathfinding", "OnGraphGenerated", {
  listName: "On navigation graph generated",
  displayText: "On navigation graph generated",
  description: "Triggered when the navigation graph finishes creating all nodes and their connections. Use this to know when pathfinding is ready to use.",
  isTrigger: true,
}, function() {
  return true;
});

condition("Pathfinding", "NodeExistsGrid", {
  listName: "Node exists at grid position",
  displayText: "Node exists at grid ({0}, {1})",
  description: "Check if a navigation node exists at the specified grid coordinates. A node exists where the character can stand (empty cell above a solid cell).",
  isInvertible: true,
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number", initialValue: "0" }
  ]
}, function(gx, gy) {
  return this.getNode(gx, gy) !== null;
});

condition("Pathfinding", "NodeExistsWorld", {
  listName: "Node exists at world position",
  displayText: "Node exists at ({0}, {1})",
  description: "Check if a navigation node exists at the specified world position (pixels). Automatically converts to grid coordinates.",
  isInvertible: true,
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number", initialValue: "0" }
  ]
}, function(x, y) {
  const grid = this.worldToGrid(x, y);
  return this.getNode(grid.gx, grid.gy) !== null;
});

// ════════════════════════════════════════════════════════════
// CUSTOM OBSTACLE MAP Actions & Conditions
// ════════════════════════════════════════════════════════════
action("ObstacleMap", "CreateCustomObstacleMap", {
  listName: "Create custom obstacle map",
  displayText: "Create custom obstacle map {0} × {1} cells",
  description: "Create empty obstacle map with specified dimensions (in grid cells)",
  params: [
    { id: "width", 
      name: "Width (cells)", 
      desc: "Width in grid cells", 
      type: "number", 
      initialValue: "30" 
    },
    { id: "height", 
      name: "Height (cells)", 
      desc: "Height in grid cells", 
      type: "number", 
      initialValue: "20" 
    }
  ]
}, function(width, height) {
  this.aceCreateCustomObstacleMap(width, height);
});

action("ObstacleMap", "SetObstacleCell", {
  listName: "Set obstacle cell",
  displayText: "Set cell ({0}, {1}) Solid: {2}",
  description: "Set whether a specific grid cell is Solid/blocked.",
  params: [
    { id: "gx", name: "Grid X", desc: "X coordinate in grid cells", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Y coordinate in grid cells", type: "number", initialValue: "0" },
    { id: "solid", name: "Solid", desc: "Is the cell blocked/solid?", type: "combo", initialValue: "yes",
      items: [ { yes: "Yes (blocked)" }, { no: "No (clear)" } ]
    }
  ]
}, function(gx, gy, solid) {
  this.aceSetObstacleCell(gx, gy, solid === "yes");
});

action("ObstacleMap", "SetObstacleCellXY", {
  listName: "Set obstacle cell at world position",
  displayText: "Set cell at ({0}, {1}) Solid: {2}",
  description: "Set whether cell at world position is solid",
  params: [
    { id: "x", name: "X", desc: "X coordinate in world pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Y coordinate in world pixels",type: "number", initialValue: "0" },
    { id: "solid",name: "Solid", desc: "Is the cell blocked/solid?", type: "combo", initialValue: "yes",
      items: [
        { yes: "Yes (blocked)" },
        { no: "No (clear)" }
      ]
    }
  ]
}, function(x, y, solid) {
  const grid = this.worldToGrid(x, y);
  this.aceSetObstacleCell(grid.gx, grid.gy, solid === "yes");
});

action("ObstacleMap", "ClearObstacleMap", {
  listName: "Clear obstacle map",
  displayText: "Clear obstacle map",
  description: "Remove the obstacle map and navigation graph"
}, function() {
  this.aceClearObstacleMap();
});

action("ObstacleMap", "LoadObstacleMapFromJSON", {
  listName: "Load obstacle map from JSON",
  displayText: "Load obstacle map from JSON: {0}",
  description: "Load obstacle map data from JSON string",
  params: [
    { id: "json", 
      name: "JSON Data", 
      desc: "JSON string containing obstacle map data",
      type: "string", 
      initialValue: "" }
  ]
}, function(jsonData) {
  this.aceLoadObstacleMapFromJSON(jsonData);
});

action("ObstacleMap", "GenerateNodesFromCustomMap", {
  listName: "Generate Navigation Graph",
  displayText: "Generate navigation graph from obstacle map",
  description: "Build the navigation graph from the current obstacle map. Works with any obstacle map source (custom or from Pathfinding behavior). Call this after modifying the obstacle map manually."
}, function() {
  this.aceGenerateNodesFromCustomMap();
});

action("ObstacleMap", "UsePathfindingObstacleMap", {
  listName: "Use Pathfinding obstacle map",
  displayText: "Use Pathfinding obstacle map (auto-regenerate: {0})",
  description: "Get the obstacle map from the Pathfinding behavior. This is the easiest way to set up platformer pathfinding! Just call this once at 'On start of layout'. If the map is already ready, it copies immediately. If not, it waits automatically. Triggers 'On Pathfinding map ready' when done.",
  params: [
    {
      id: "autoRegen",
      name: "Auto-Regenerate Navigation Graph",
      desc: "Automatically build navigation graph after copying (recommended: Yes)",
      type: "combo",
      initialValue: "yes",
      items: [
        { yes: "Yes (recommended)" },
        { no: "No (manual)" }
      ]
    }
  ]
}, function(autoRegen) {
  this.aceUsePathfindingObstacleMap(autoRegen === "yes");
});


condition("ObstacleMap", "OnObstacleMapCreated", {
  listName: "On obstacle map created",
  displayText: "On obstacle map created",
  description: "Triggered when obstacle map is created or regenerated",
  isTrigger: true
}, function() {
  return true;
});

condition("ObstacleMap", "OnObstacleMapRemoved", {
  listName: "On obstacle map removed",
  displayText: "On obstacle map removed",
  description: "Triggered when obstacle map is cleared",
  isTrigger: true
}, function() {
  return true;
});

condition("ObstacleMap", "OnPathfindingMapReady", {
  listName: "On Pathfinding map ready",
  displayText: "On Pathfinding map ready",
  description: "Triggered when 'Wait for Pathfinding obstacle map' succeeds. This means the obstacle map is copied and ready - you can now use 'Find path to position'!",
  isTrigger: true
}, function() {
  return true;
});

condition("ObstacleMap", "OnPathfindingMapFailed", {
  listName: "On Pathfinding map failed",
  displayText: "On Pathfinding map failed",
  description: "Triggered if getting the Pathfinding map fails. Usually means no Pathfinding behavior exists on this object.",
  isTrigger: true
}, function() {
  return true;
});

condition("ObstacleMap", "OnPathfindingMapTimeout", {
  listName: "On Pathfinding map timeout",
  displayText: "On Pathfinding map timeout",
  description: "Triggered if waiting for Pathfinding map takes too long (~10 seconds). Make sure Pathfinding behavior exists and has obstacles to detect.",
  isTrigger: true
}, function() {
  return true;
});

condition("ObstacleMap", "IsSettingUpPathfinding", {
  listName: "Is setting up Pathfinding map",
  displayText: "Is setting up Pathfinding map",
  description: "True if currently waiting for the Pathfinding behavior's obstacle map to become ready.",
  isInvertible: true
}, function() {
  return this.isWaitingForPathfindingMap;
});

condition("ObstacleMap", "IsCellSolidGrid", {
  listName: "Is cell solid (grid)",
  displayText: "Cell at grid ({0}, {1}) is solid",
  description: "Check if a specific grid cell is blocked/solid. Use grid coordinates (cell numbers, not pixels).",
  isInvertible: true,
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate (cell number)", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate (cell number)", type: "number", initialValue: "0" }
  ]
}, function(gx, gy) {
  return this.isCellBlocked(gx, gy);
});

condition("ObstacleMap", "IsCellSolidWorld", {
  listName: "Is cell solid (world)",
  displayText: "Cell at ({0}, {1}) is solid",
  description: "Check if a grid cell at a world position (in pixels) is blocked/solid. Automatically converts pixel coordinates to grid cell.",
  isInvertible: true,
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number", initialValue: "0" }
  ]
}, function(x, y) {
  const grid = this.worldToGrid(x, y);
  return this.isCellBlocked(grid.gx, grid.gy);
});

// ════════════════════════════════════════
// HAZARD AVOIDANCE ACTIONS & CONDITIONS
// ════════════════════════════════════════

action("Hazards", "AddRectHazard", {
  listName: "Add rectangle hazard",
  displayText: "Add rectangle hazard at ({0},{1}) size ({2}×{3}) severity {4}",
  description: "Mark a rectangular area as dangerous. AI will avoid this region when pathfinding. Use for spikes, fire, enemy zones, etc.",
  params: [
    { id: "x", name: "X", desc: "Left edge X coordinate in pixels, preferably use bounding box of hazard object", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Top edge Y coordinate in pixels, preferably use bounding box of hazard object", type: "number", initialValue: "0" },
    { id: "width", name: "Width", desc: "Width of hazardous area in pixels, preferably use bounding box of hazard object", type: "number", initialValue: "128" },
    { id: "height", name: "Height", desc: "Height of hazardous area in pixels, preferably use bounding box of hazard object", type: "number", initialValue: "128" },
    { id: "severity", name: "Severity", desc: "How much AI avoids this area (1.0 = slight avoidance, 10.0 = strong avoidance)", type: "number", initialValue: "3.0" }
  ]
}, function(x, y, width, height, severity) {
  this.aceAddRectHazard(x, y, width, height, severity);
});

action("Hazards", "AddRectHazardGrid", {
  listName: "Add rectangle hazard (grid)",
  displayText: "Add rectangle hazard at grid ({0},{1}) size ({2}×{3}) severity {4}",
  description: "Mark rectangular region as hazardous using grid coordinates",
  params: [
    { id: "gx", name: "Grid X" , desc: "Grid X coordinate of the hazard", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate of the hazard", type: "number", initialValue: "0" },
    { id: "gw", name: "Grid Width", desc: "Grid width of the hazard", type: "number", initialValue: "4" },
    { id: "gh", name: "Grid Height", desc: "Grid height of the hazard", type: "number", initialValue: "4" },
    { id: "severity", name: "Severity", desc: "Severity of the hazard", type: "number", initialValue: "3.0" }
  ]
}, function(gx, gy, gw, gh, severity) {
  const worldPos = this.gridToWorld(gx, gy);
  const width = gw * this.cellSize;
  const height = gh * this.cellSize;
  this.aceAddRectHazard(worldPos.x, worldPos.y, width, height, severity);
});

action("Hazards", "AddCircleHazard", {
  listName: "Add circle hazard",
  displayText: "Add circle hazard at ({0},{1}) radius {2} severity {3}",
  description: "Mark a circular area as dangerous. AI will avoid this region when pathfinding. Good for explosions, magic zones, or round enemy patrol areas.",
  params: [
    { id: "x", name: "X", desc: "Center X coordinate in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Center Y coordinate in pixels", type: "number", initialValue: "0" },
    { id: "radius", name: "Radius", desc: "Size of hazardous area in pixels from centre", type: "number", initialValue: "64" },
    { id: "severity", name: "Severity", desc: "How much AI avoids this area (1.0 = slight avoidance, 10.0 = strong avoidance)", type: "number", initialValue: "3.0" }
  ]
}, function(x, y, radius, severity) {
  this.aceAddCircleHazard(x, y, radius, severity);
});

action("Hazards", "RemoveHazard", {
  listName: "Remove hazard",
  displayText: "Remove hazard ID {0}",
  description: "Remove a specific hazard by its unique ID number. Get the ID when adding hazards or use expressions to check.",
  params: [
    { id: "hazard_id", name: "Hazard ID", desc: "Unique ID number of the hazard to remove", type: "number", initialValue: "1" }
  ]
}, function(hazardId) {
  this.aceRemoveHazard(hazardId);
});

action("Hazards", "ClearAllHazards", {
  listName: "Clear all hazards",
  displayText: "Clear all hazards",
  description: "Remove all hazardous regions at once. Use this to reset the hazard map when changing levels or game states."
}, function() {
  this.aceClearAllHazards();
});

condition("Hazards", "Is_Position_Hazardous", {
  listName: "Is position hazardous",
  displayText: "Is position ({0},{1}) hazardous",
  description: "Check if a specific coordinate is inside any hazardous area. Returns true if position is dangerous, false if safe.",
  params: [
    { id: "x", name: "X", desc: "X coordinate in pixels to check", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Y coordinate in pixels to check", type: "number", initialValue: "0" }
  ]
}, function(x, y) {
  return this._isPositionHazardous(x, y);
});

// ════════════════════════════════════════════════════════════
// PORTAL Actions & Conditions
// ════════════════════════════════════════════════════════════
action("Portals", "AddPortal", {
  listName: "Add portal",
  displayText: "Add {0} portal from ({1},{2}) to ({3},{4}) cost {5}",
  description: "Create a special connection between two points (teleporter, ladder, elevator, door). AI can use this to instantly travel between locations.",
  params: [
    {
      id: "type",
      name: "Type",
      desc: "What kind of portal connection this represents",
      type: "combo",
      initialValue: "teleport",
      items: [
        { teleport: "Teleporter" },
        { ladder: "Ladder" },
        { elevator: "Elevator" },
        { zipline: "Zipline" }
      ]
    },
    { id: "entry_x", name: "Entry X", desc: "Entry X coordinate", type: "number", initialValue: "0" },
    { id: "entry_y", name: "Entry Y", desc: "Entry Y coordinate", type: "number", initialValue: "0" },
    { id: "exit_x", name: "Exit X", desc: "Exit X coordinate", type: "number", initialValue: "0" },
    { id: "exit_y", name: "Exit Y", desc: "Exit Y coordinate", type: "number", initialValue: "0" },
    { id: "cost", name: "Cost", desc: "Cost to use the portal", type: "number", initialValue: "50" }
  ]
}, function(type, entryX, entryY, exitX, exitY, cost) {
  this.aceAddPortal(entryX, entryY, exitX, exitY, type, cost);
});

// ════════════════════════════════════════════════════════════
// EXPRESSIONS - PATHFINDING
// ════════════════════════════════════════════════════════════

expression("Pathfinding", "PathLength", {
  returnType: "number",
  description: "Number of waypoints in current path"
}, function() {
  return this.aceGetPathLength();
});

expression("Pathfinding", "CurrentWaypoint", {
  returnType: "number",
  description: "Current waypoint index (0-based)"
}, function() {
  return this.aceGetCurrentWaypoint();
});

expression("Pathfinding", "NodeCount", {
  returnType: "number",
  description: "Total number of navigation nodes"
}, function() {
  return this.aceGetNodeCount();
});

expression("Pathfinding", "PortalCount", {
  returnType: "number",
  description: "Total number of portals"
}, function() {
  return this.aceGetPortalCount();
});

expression("Pathfinding", "CurrentWaypointX", {
  returnType: "number",
  description: "Get the X position of the current waypoint in pixels. Returns -1 if no active path."
}, function() {
  return this.aceGetCurrentWaypointX();
});

expression("Pathfinding", "CurrentWaypointY", {
  returnType: "number",
  description: "Get the Y position of the current waypoint in pixels. Returns -1 if no active path."
}, function() {
  return this.aceGetCurrentWaypointY();
});

expression("Pathfinding", "WaypointGridX", {
  returnType: "number",
  description: "Get the grid X coordinate of the waypoint at the specified index. Returns -1 if index is invalid.",
  params: [
    { id: "index", name: "Index", desc: "Waypoint index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetWaypointGridX(index);
});

expression("Pathfinding", "WaypointGridY", {
  returnType: "number",
  description: "Get the grid Y coordinate of the waypoint at the specified index. Returns -1 if index is invalid.",
  params: [
    { id: "index", name: "Index", desc: "Waypoint index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetWaypointGridY(index);
});

expression("Pathfinding", "WaypointX", {
  returnType: "number",
  description: "Get the world X position (pixels) of the waypoint at the specified index. Returns -1 if index is invalid.",
  params: [
    { id: "index", name: "Index", desc: "Waypoint index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetWaypointX(index);
});

expression("Pathfinding", "WaypointY", {
  returnType: "number",
  description: "Get the world Y position (pixels) of the waypoint at the specified index. Returns -1 if index is invalid.",
  params: [
    { id: "index", name: "Index", desc: "Waypoint index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetWaypointY(index);
});

expression("Pathfinding", "NodeWorldX", {
  returnType: "number",
  description: "Get the pixel X position of a node at grid coordinates. Returns -1 if no node exists at that position.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceGetNodeWorldX(gx, gy);
});

expression("Pathfinding", "NodeWorldY", {
  returnType: "number",
  description: "Get the pixel Y position of a node at grid coordinates. Returns -1 if no node exists at that position.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceGetNodeWorldY(gx, gy);
});


// ════════════════════════════════════════════════════════════
// EXPRESSIONS - OBSTACLE MAP
// ════════════════════════════════════════════════════════════

expression("ObstacleMap", "ObstacleMapJSON", {
  returnType: "string",
  description: "Get the obstacle map as a JSON text string. Use this to save level layouts to Local Storage or send to server."
}, function() {
  return this.aceSaveObstacleMapToJSON();
});

expression("ObstacleMap", "ObstacleMapSource", {
  returnType: "string",
  description: "Get how the obstacle map was created. Returns 'pathfinding' (from Pathfinding behavior), 'custom' (manually set), or 'none' (not generated yet)."
}, function() {
  return this.aceGetObstacleMapSource();
});

expression("ObstacleMap", "GridWidth", {
  returnType: "number",
  description: "Get the width of the navigation grid in cells (not pixels). Multiply by cell size to get pixel width."
}, function() {
  return this.aceGetGridWidth();
});

expression("ObstacleMap", "GridCellSize", {
  returnType: "number",
  description: "Get the grid cell size in pixels."
}, function() {
  return this.cellSize;
});

expression("ObstacleMap", "GridHeight", {
  returnType: "number",
  description: "Get the height of the navigation grid in cells (not pixels). Multiply by cell size to get pixel height."
}, function() {
  return this.aceGetGridHeight();
});

expression("ObstacleMap", "IsCellSolid", {
  returnType: "number",
  description: "Check if a specific grid cell is blocked by an obstacle. Returns 1 if blocked/solid, 0 if clear/walkable.",
  params: [
    { id: "gx", desc: "Grid X coordinate (not pixel position)", name: "Grid X", type: "number" },
    { id: "gy", desc: "Grid Y coordinate (not pixel position)", name: "Grid Y", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceIsCellBlocked(gx, gy);
});

expression("ObstacleMap", "WorldToGridX", {
  returnType: "number",
  description: "Convert a world X coordinate (in pixels) to grid X coordinate. Use this to check which cell a position is in.",
  params: [
    { id: "x", desc: "World X position in pixels to convert", name: "X", type: "number" }
  ]
}, function(x) {
  const y = this.instance.y;
  const grid = this.worldToGrid(x, y);
  return grid.gx;
});

expression("ObstacleMap", "WorldToGridY", {
  returnType: "number",
  description: "Convert world Y to grid Y",
  params: [
    { id: "y", desc: "Y Position to convert to grid Y position", name: "Y", type: "number" }
  ]
}, function(y) {
  const x = this.instance.x;
  const grid = this.worldToGrid(x, y);
  return grid.gy;
});

expression("ObstacleMap", "WaitTickCount", {
  returnType: "number",
  description: "Get how many ticks spent waiting for Pathfinding map. Useful for debugging if it's taking too long."
}, function() {
  return this.waitTickCount || 0;
});

// ════════════════════════════════════════════════════════════
// EXPRESSIONS - PLATFORM PROPERTIES (DEBUG)
// ════════════════════════════════════════════════════════════

expression("Debug", "PlatformMaxSpeed", {
  returnType: "number",
  description: "Platform behavior max speed"
}, function() {
  return this.aceGetPlatformMaxSpeed();
});

expression("Debug", "PlatformJumpStrength", {
  returnType: "number",
  description: "Get the jump strength value from the Platform behavior. Used for debugging jump height calculations."
}, function() {
  return this.aceGetPlatformJumpStrength();
});

expression("Debug", "CalculatedJumpHeight", {
  returnType: "number",
  description: "Get the maximum jump height the AI thinks your character can reach (in pixels). Compare with your actual jump height for tuning."
}, function() {
  return this.aceGetCalculatedJumpHeight();
});

expression("Debug", "CalculatedJumpDistance", {
  returnType: "number",
  description: "Get the maximum horizontal distance the AI thinks your character can jump (in pixels). Compare with actual performance for tuning."
}, function() {
  return this.aceGetCalculatedJumpDistance();
});

// ════════════════════════════════════════
// HAZARD EXPRESSIONS
// ════════════════════════════════════════

expression("Hazards", "HazardCount", {
  returnType: "number",
  description: "Get the total number of hazardous regions currently active. Useful for debugging or UI display."
}, function() {
  return this.aceGetHazardCount();
});

expression("Hazards", "IsPositionHazardous", {
  returnType: "number",
  description: "Check if a position is inside any hazardous area. Returns 1 if dangerous, 0 if safe.",
  params: [
    { id: "x", name: "X", desc: "X position in pixels to check", type: "number" },
    { id: "y", name: "Y", desc: "Y position in pixels to check", type: "number" }
  ]
}, function(x, y) {
  return this.aceIsPositionHazardous(x, y);
});

expression("Hazards", "HazardSeverity", {
  returnType: "number",
  description: "Get the hazard severity at a position. Returns 1.0 for safe areas, higher values for more dangerous areas.",
  params: [
    { id: "x", name: "X", desc: "X position in pixels to check", type: "number" },
    { id: "y", name: "Y", desc: "Y position in pixels to check", type: "number" }
  ]
}, function(x, y) {
  return this._getHazardSeverity(x, y);
});

