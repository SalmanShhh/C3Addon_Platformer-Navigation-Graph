import { action, condition, expression } from "../template/aceDefine.js";

// ============================================================================
// PATHFINDING ACTIONS
// ============================================================================

action("Pathfinding", "FindPath", {
  listName: "Find path to position",
  displayText: "Find path to ({0}, {1}) [Ground correction: {2}] [Mode: {3}] [Jump positioning: {4}]",
  description: "Calculate a path from the character's position to the target coordinates. Use this when you want the AI to navigate to a specific point. Requires: Navigation graph must be generated first.",
  params: [
    { id: "x", name: "X", desc: "Target X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Target Y position in pixels", type: "number", initialValue: "0" },
    { id: "correctToGround", name: "Correct to ground", desc: "Snap start/target to nearest walkable ground position", type: "combo", initialValue: "no", items: [{ no: "No" }, { yes: "Yes" }] },
    { id: "mode", name: "Mode", desc: "Path mode: 'reach' finds a complete path or fails. 'nearest' paths as close as possible and never fails. 'jump_at' paths nearby then jumps at the target (for attacks).", type: "combo", initialValue: "reach", items: [{ reach: "Reach (default)" }, { nearest: "Nearest (never fails)" }, { jump_at: "Jump at target (attack)" }] },
    { id: "strict", name: "Jump Positioning", desc: "Control how carefully the character positions itself before jumps and falls on THIS specific path. This only affects jump/fall precision during pathfinding — it does NOT affect edge walking (use Ledge Restriction for that). 'Default' uses whatever the property or SetStrictJumpPositioning action is set to. 'Strict' forces careful positioning — use for dangerous routes over pits or narrow platforms. 'Relaxed' skips positioning checks for maximum speed — use for chase sequences or when the character is fleeing and precision doesn't matter.", type: "combo", initialValue: "default", items: [{ default: "Default (use property)" }, { strict: "Strict" }, { relaxed: "Relaxed" }] }
  ]
}, function(x, y, correctToGround, mode, strict) {
  this.aceFindPath(
    x, y,
    this._combo(correctToGround, ["no", "yes"]) === "yes",
    this._combo(mode, ["reach", "nearest", "jump_at"]),
    this._combo(strict, ["default", "strict", "relaxed"])
  );
});

action("Pathfinding", "StopPathfinding", {
  listName: "Stop pathfinding",
  displayText: "Stop pathfinding",
  description: "Stop the character immediately and clear the current path. Use when you want to cancel AI navigation and regain manual control."
}, function() {
  this.aceStopPathfinding();
});

action("Pathfinding", "JumpTowardPosition", {
  listName: "Jump toward position",
  displayText: "Jump toward ({0}, {1})",
  description: "Immediately jump toward a target position. The character jumps from its current position with full strength, moving horizontally toward the target. No pathfinding is involved — the character simply lunges at the target. Use for: jump attacks, stomps, lunges. Triggers 'On jump toward executed' when the jump starts. The character must be on the floor to jump.",
  params: [
    { id: "x", name: "X", desc: "Target X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Target Y position in pixels", type: "number", initialValue: "0" }
  ]
}, function(x, y) {
  this.aceJumpTowardPosition(x, y);
});

action("Pathfinding", "RegenerateGraph", {
  listName: "Regenerate navigation graph",
  displayText: "Regenerate navigation graph",
  description: "Rebuild the navigation graph from scratch. Use after modifying the level layout, adding/removing obstacles, or changing platform positions."
}, function() {
  this.aceRegenerateGraph();
});

action("Pathfinding", "SetAutoControl", {
  listName: "Set auto-control",
  displayText: "Set auto-control: {0}",
  description: "Toggle auto-movement on/off. When enabled, the behavior automatically controls the Platform behavior to follow paths. When disabled, you control movement yourself using path data expressions.",
  params: [
    { id: "enabled", name: "Enabled", desc: "Enable or disable auto-control", type: "combo", initialValue: "yes", items: [{ yes: "Enabled" }, { no: "Disabled" }] }
  ]
}, function(enabled) {
  this.aceSetAutoControl(this._combo(enabled, ["yes", "no"]) === "yes");
});

action("Pathfinding", "SetCoyoteTime", {
  listName: "Set coyote time",
  displayText: "Set coyote time to {0} seconds",
  description: "Set the coyote time window in seconds. The AI can jump within this window after walking off a ledge. Set to 0 to disable coyote time.",
  params: [
    { id: "seconds", name: "Seconds", desc: "Coyote time window in seconds", type: "number", initialValue: "0.1" }
  ]
}, function(seconds) {
  this.aceSetCoyoteTime(seconds);
});

action("Pathfinding", "SetStrictJumpPositioning", {
  listName: "Set strict jump positioning",
  displayText: "Set strict jump positioning: {0}",
  description: "Toggle whether this AI character slows down and carefully positions itself before jumping or falling during pathfinding. This does NOT affect walking off edges (use 'Set ledge restriction' for that). Use this to change behavior at runtime — for example, disable when a boss enters 'rage mode' for reckless movement, or enable when an NPC needs to carefully cross a narrow bridge. Overrides the property setting for this character.",
  params: [
    { id: "enabled", name: "Enabled", desc: "Enable or disable strict jump positioning", type: "combo", initialValue: "yes", items: [{ yes: "Enabled" }, { no: "Disabled" }] }
  ]
}, function(enabled) {
  this.aceSetStrictJumpPositioning(this._combo(enabled, ["yes", "no"]) === "yes");
});

action("Pathfinding", "SetLedgeRestriction", {
  listName: "Set ledge restriction",
  displayText: "Set ledge restriction: {0}",
  description: "Prevents AI characters from walking off platform edges when they have no reason to leave. Useful for patrol guards that should stay on their platform, or NPCs that shouldn't wander off rooftops. This only stops characters from casually walking off edges — if the AI's path requires a jump or fall to reach its goal, it will still leave the platform. To make those jumps and falls more precise, use 'Set strict jump positioning' instead.",
  params: [
    { id: "enabled", name: "Enabled", desc: "Enable or disable ledge restriction", type: "combo", initialValue: "yes", items: [{ yes: "Enabled" }, { no: "Disabled" }] }
  ]
}, function(enabled) {
  this.aceSetLedgeRestriction(this._combo(enabled, ["yes", "no"]) === "yes");
});

action("Pathfinding", "SetLedgeLeniency", {
  listName: "Set ledge leniency",
  displayText: "Set ledge leniency to {0} pixels",
  description: "Set how many pixels past a platform edge the AI can walk before stopping (0 = strict stop). Increase for more natural-looking patrol movement near edges. Only used when ledge restriction is enabled.",
  params: [
    { id: "pixels", name: "Pixels", desc: "Pixels past ledge edge before stopping", type: "number", initialValue: "0" }
  ]
}, function(pixels) {
  this.aceSetLedgeLeniency(pixels);
});

// ============================================================================
// PATHFINDING CONDITIONS
// ============================================================================

condition("Pathfinding", "HasPath", {
  listName: "Has active path",
  displayText: "Has active path",
  description: "Check if the character currently has an active pathfinding path. Returns true while navigating, false when idle or path is complete.",
  isInvertible: true
}, function() {
  return this.aceHasPath();
});

condition("Pathfinding", "OnPathFound", {
  listName: "On path found",
  displayText: "On path found",
  description: "Triggered when a path has been successfully calculated. Use this to start custom actions when pathfinding succeeds.",
  isTrigger: true
}, function() {
  return true;
});

condition("Pathfinding", "OnPathFailed", {
  listName: "On path failed",
  displayText: "On path failed",
  description: "Triggered when pathfinding fails to find a valid path to the target. Use this to handle unreachable destinations or implement fallback behaviors.",
  isTrigger: true
}, function() {
  return true;
});

condition("Pathfinding", "OnPathComplete", {
  listName: "On path complete",
  displayText: "On path complete",
  description: "Triggered when the AI arrives at the final destination. Use this to trigger arrival animations, next actions, or goal completion logic.",
  isTrigger: true
}, function() {
  return true;
});

condition("Pathfinding", "OnGraphGenerated", {
  listName: "On navigation graph generated",
  displayText: "On navigation graph generated",
  description: "Triggered when the navigation graph has been successfully generated. Use this to start pathfinding operations after map setup.",
  isTrigger: true
}, function() {
  return true;
});

condition("Pathfinding", "OnWaypointReached", {
  listName: "On waypoint reached",
  displayText: "On waypoint reached",
  description: "Triggered each time the character reaches a waypoint along the path. Use this to play footstep sounds, particle effects, or update animations.",
  isTrigger: true
}, function() {
  return true;
});

condition("Pathfinding", "OnJumpTowardExecuted", {
  listName: "On jump toward executed",
  displayText: "On jump toward executed",
  description: "Triggered when the 'jump at target' mode executes the final jump toward the target. Use this to handle jump attacks or stomps.",
  isTrigger: true
}, function() {
  return true;
});

condition("Pathfinding", "OnJumpTowardLaunched", {
  listName: "On jump toward launched",
  displayText: "On jump toward launched",
  description: "Triggered when the 'Jump toward position' action launches the character. Use this to play attack animations, spawn effects, or apply damage. The target position is available via JumpTowardTargetX/Y expressions.",
  isTrigger: true
}, function() {
  return true;
});

condition("Pathfinding", "OnRePathTriggered", {
  listName: "On re-path triggered",
  displayText: "On re-path triggered",
  description: "Triggered when automatic re-pathing occurs due to the character drifting too far from the path. Use this to monitor navigation accuracy.",
  isTrigger: true
}, function() {
  return true;
});

condition("Pathfinding", "OnWaypointStuck", {
  listName: "On waypoint stuck",
  displayText: "On waypoint stuck",
  description: "Triggered when the character has been stuck at a waypoint for too long (exceeds Max Waypoint Time). The path is automatically cancelled. Use this to handle stuck situations or repath.",
  isTrigger: true
}, function() {
  return true;
});

condition("Pathfinding", "IsPlatformEnabled", {
  listName: "Is platform enabled",
  displayText: "Platform behavior is enabled",
  description: "Check if the associated Platform behavior is currently enabled. Returns false if Platform behavior is disabled or not found.",
  isInvertible: true
}, function() {
  return this.aceIsPlatformEnabled();
});

condition("Pathfinding", "IsAtLedge", {
  listName: "Is at ledge",
  displayText: "Is at ledge",
  description: "Check if the character is currently standing on a ledge node (edge of a platform). Use this to trigger ledge-specific behaviors or animations.",
  isInvertible: true
}, function() {
  return this.aceIsAtLedge();
});

condition("Pathfinding", "IsAtIsland", {
  listName: "Is at island",
  displayText: "Is at island",
  description: "Check if the character is standing on a single-tile platform (isolated platform). Use this to detect precarious positions or trigger special behaviors.",
  isInvertible: true
}, function() {
  return this.aceIsAtIsland();
});

condition("Pathfinding", "NodeExistsGrid", {
  listName: "Node exists at grid position",
  displayText: "Node exists at grid ({0}, {1})",
  description: "Check if a navigation node exists at the specified grid coordinates. Use this to validate positions before pathfinding or placing objects.",
  isInvertible: true,
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate (tile number)", type: "number", initialValue: "0" }
  ]
}, function(gx, gy) {
  return this.aceNodeExistsGrid(gx, gy);
});

condition("Pathfinding", "NodeExistsWorld", {
  listName: "Node exists at world position",
  displayText: "Node exists at world ({0}, {1})",
  description: "Check if a navigation node exists at the specified world coordinates. Use this to validate world positions before pathfinding.",
  isInvertible: true,
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number", initialValue: "0" }
  ]
}, function(x, y) {
  return this.aceNodeExistsWorld(x, y);
});

// ============================================================================
// PATHFINDING EXPRESSIONS
// ============================================================================

expression("Pathfinding", "WaypointCount", {
  returnType: "number",
  description: "Get the total number of waypoints in the current path. Returns 0 if no path is active."
}, function() {
  return this.aceGetWaypointCount();
});

expression("Pathfinding", "CurrentWaypoint", {
  returnType: "number",
  description: "Get the index of the current waypoint the character is moving toward. Returns -1 if no path is active."
}, function() {
  return this.aceGetCurrentWaypoint();
});

expression("Pathfinding", "NodeCount", {
  returnType: "number",
  description: "Get the total number of navigation nodes in the generated graph. Returns 0 if no graph exists."
}, function() {
  return this.aceGetNodeCount();
});

expression("Pathfinding", "CurrentWaypointX", {
  returnType: "number",
  description: "Get the world X position of the current waypoint. Returns 0 if no path is active."
}, function() {
  return this.aceGetCurrentWaypointX();
});

expression("Pathfinding", "CurrentWaypointY", {
  returnType: "number",
  description: "Get the world Y position of the current waypoint. Returns 0 if no path is active."
}, function() {
  return this.aceGetCurrentWaypointY();
});

expression("Pathfinding", "WaypointGridX", {
  returnType: "number",
  description: "Get the grid X coordinate of a waypoint by index. Returns -1 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Waypoint index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetWaypointGridX(index);
});

expression("Pathfinding", "WaypointGridY", {
  returnType: "number",
  description: "Get the grid Y coordinate of a waypoint by index. Returns -1 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Waypoint index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetWaypointGridY(index);
});

expression("Pathfinding", "WaypointX", {
  returnType: "number",
  description: "Get the world X position of a waypoint by index. the waypoint position is centred within the tile. Returns 0 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Waypoint index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetWaypointX(index);
});

expression("Pathfinding", "WaypointY", {
  returnType: "number",
  description: "Get the world Y position of a waypoint by index. the waypoint position is centred within the tile. Returns 0 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Waypoint index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetWaypointY(index);
});

expression("Pathfinding", "NodeWorldX", {
  returnType: "number",
  description: "Get the world X position of a node at the specified grid coordinates. the node position is centred within the tile. Returns 0 if node doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceGetNodeWorldX(gx, gy);
});

expression("Pathfinding", "NodeWorldY", {
  returnType: "number",
  description: "Get the world Y position of a node at the specified grid coordinates. the node position is centred within the tile. Returns 0 if node doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceGetNodeWorldY(gx, gy);
});

expression("Pathfinding", "PathFailReason", {
  returnType: "string",
  description: "Get the reason the last pathfinding attempt failed. Returns: 'no_start_node', 'no_goal_node', 'max_nodes_reached', 'no_path', or empty string if path succeeded."
}, function() {
  return this.aceGetPathFailReason();
});

expression("Pathfinding", "PathCost", {
  returnType: "number",
  description: "Get the total calculated cost of the current path. Returns 0 if no path is active."
}, function() {
  return this.aceGetPathCost();
});

expression("Pathfinding", "PathTargetX", {
  returnType: "number",
  description: "Get the world X position of the path target. Pass 'original' for raw input or 'corrected' for ground-snapped position.",
  params: [
    { id: "type", name: "Type", desc: "'original' or 'corrected'", type: "string" }
  ]
}, function(type) {
  return this.aceGetPathTargetX(type);
});

expression("Pathfinding", "PathTargetY", {
  returnType: "number",
  description: "Get the world Y position of the path target. Pass 'original' for raw input or 'corrected' for ground-snapped position.",
  params: [
    { id: "type", name: "Type", desc: "'original' or 'corrected'", type: "string" }
  ]
}, function(type) {
  return this.aceGetPathTargetY(type);
});

expression("Pathfinding", "PathTargetGridX", {
  returnType: "number",
  description: "Get the grid X coordinate of the path target. Returns -1 if no path is active."
}, function() {
  return this.aceGetPathTargetGridX();
});

expression("Pathfinding", "PathTargetGridY", {
  returnType: "number",
  description: "Get the grid Y coordinate of the path target. Returns -1 if no path is active."
}, function() {
  return this.aceGetPathTargetGridY();
});

expression("Pathfinding", "AngleToWaypoint", {
  returnType: "number",
  description: "Get the angle in degrees from the character to the current waypoint. Returns 0 if no path is active."
}, function() {
  return this.aceGetAngleToWaypoint();
});

expression("Pathfinding", "DistanceToWaypoint", {
  returnType: "number",
  description: "Get the distance in pixels from the character to the current waypoint. Returns 0 if no path is active."
}, function() {
  return this.aceGetDistanceToWaypoint();
});

expression("Pathfinding", "CurrentPathAction", {
  returnType: "string",
  description: "Get the action name for a waypoint by index (e.g., 'walk', 'jump', 'fall', 'portal'). Returns empty string if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Waypoint index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetCurrentPathAction(index);
});

expression("Pathfinding", "EstimatedVelocityX", {
  returnType: "number",
  description: "Get the estimated horizontal velocity needed to follow the current path. Returns 0 if no path is active."
}, function() {
  return this.aceGetEstimatedVelocityX();
});

expression("Pathfinding", "StoppingDistance", {
  returnType: "number",
  description: "Get the calculated stopping distance in pixels based on the Platform behavior's current speed. Used for waypoint arrival detection."
}, function() {
  return this.aceGetStoppingDistance();
});

expression("Pathfinding", "CoyoteTime", {
  returnType: "number",
  description: "Get the current coyote time setting in seconds. This is the window after walking off a ledge where jumps are still allowed."
}, function() {
  return this.aceGetCoyoteTime();
});

expression("Pathfinding", "CoyoteTimer", {
  returnType: "number",
  description: "Get the current coyote timer value in seconds. This counts down after leaving the ground. Returns 0 when on ground or timer expired."
}, function() {
  return this.aceGetCoyoteTimer();
});

expression("Pathfinding", "StrictJumpPositioning", {
  returnType: "number",
  description: "Get whether strict jump positioning is currently active for this character. Returns 1 if enabled, 0 if disabled. Useful for conditional logic — e.g. switching between careful and aggressive pathfinding modes."
}, function() {
  return this.aceGetStrictJumpPositioning();
});

expression("Pathfinding", "LedgeRestriction", {
  returnType: "number",
  description: "Get whether ledge restriction is enabled. Returns 1 if enabled, 0 if disabled."
}, function() {
  return this.aceGetLedgeRestriction();
});

expression("Pathfinding", "LedgeLeniency", {
  returnType: "number",
  description: "Get the ledge leniency setting in pixels. This is how far past a ledge edge the AI can walk before stopping."
}, function() {
  return this.aceGetLedgeLeniency();
});

expression("Pathfinding", "JumpTowardTargetX", {
  returnType: "number",
  description: "Get the world X position of the jump-at target. Returns 0 if not in jump-at mode."
}, function() {
  return this.aceGetJumpTowardTargetX();
});

expression("Pathfinding", "JumpTowardTargetY", {
  returnType: "number",
  description: "Get the world Y position of the jump-at target. Returns 0 if not in jump-at mode."
}, function() {
  return this.aceGetJumpTowardTargetY();
});

expression("Pathfinding", "PathStrategy", {
  returnType: "string",
  description: "Get the current path strategy preset (balanced, shortest, safest, simplest)."
}, function() {
  return this.aceGetPathStrategy();
});

// ============================================================================
// OBSTACLE MAP ACTIONS
// ============================================================================

action("ObstacleMap", "CreateCustomObstacleMap", {
  listName: "Create custom obstacle map",
  displayText: "Create custom obstacle map [Width: {0} tiles] [Height: {1} tiles]",
  description: "Create a custom obstacle map with the specified dimensions in tiles. All tiles are initialized to 'clear' state. Use this when not using the Pathfinding behavior's obstacle map.",
  params: [
    { id: "width", name: "Width", desc: "Width in tiles", type: "number", initialValue: "32" },
    { id: "height", name: "Height", desc: "Height in tiles", type: "number", initialValue: "24" }
  ]
}, function(width, height) {
  this.aceCreateCustomObstacleMap(width, height);
});

action("ObstacleMap", "SetTileState", {
  listName: "Set tile state",
  displayText: "Set tile at ({0}, {1}) to {2}",
  description: "Set the state of a tile at the specified grid coordinates. Use this to mark tiles as solid obstacles, clear space, jump-thru platforms, areas to avoid, or slopes.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "state", name: "State", desc: "Tile state to set", type: "combo", initialValue: "solid",
      items: [
        { solid: "Solid" },
        { clear: "Clear" },
        { jump_thru: "Jump-thru" },
        { avoid: "Avoid" },
        { slope_left: "Slope left" },
        { slope_right: "Slope right" }
      ]
    }
  ]
}, function(gx, gy, state) {
  this.aceSetTileState(gx, gy, this._combo(state, ["solid", "clear", "jump_thru", "avoid", "slope_left", "slope_right"]));
});

action("ObstacleMap", "SetTileStateWorld", {
  listName: "Set tile state at world position",
  displayText: "Set tile at world ({0}, {1}) to {2}",
  description: "Set the state of a tile at the specified world coordinates. The world position is automatically converted to grid coordinates.",
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number", initialValue: "0" },
    { id: "state", name: "State", desc: "Tile state to set", type: "combo", initialValue: "solid",
      items: [
        { solid: "Solid" },
        { clear: "Clear" },
        { jump_thru: "Jump-thru" },
        { avoid: "Avoid" },
        { slope_left: "Slope left" },
        { slope_right: "Slope right" }
      ]
    }
  ]
}, function(x, y, state) {
  this.aceSetTileStateWorld(x, y, this._combo(state, ["solid", "clear", "jump_thru", "avoid", "slope_left", "slope_right"]));
});

action("ObstacleMap", "SetTileHazard", {
  listName: "Set tile hazard severity",
  displayText: "Set tile hazard at ({0}, {1}) to {2}",
  description: "Set the hazard severity for a specific tile. Higher values make the AI avoid this tile more strongly. 0 = no hazard. Hazard avoidance is automatically enabled when any hazard is added. Use this to mark dangerous areas like spikes or lava.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "severity", name: "Severity", desc: "Hazard severity (0 = none, higher = more dangerous)", type: "number", initialValue: "0" }
  ]
}, function(gx, gy, severity) {
  this.aceSetTileHazard(gx, gy, severity);
});

action("ObstacleMap", "ClearObstacleMap", {
  listName: "Clear obstacle map",
  displayText: "Clear obstacle map",
  description: "Remove the obstacle map and all associated data. Use this when switching levels or resetting the navigation system."
}, function() {
  this.aceClearObstacleMap();
});

action("ObstacleMap", "LoadObstacleMapFromJSON", {
  listName: "Load obstacle map from JSON",
  displayText: "Load obstacle map from JSON: {0}",
  description: "Load a previously saved obstacle map from JSON string. Use this to restore saved maps or load pre-built level data.",
  params: [
    { id: "json", name: "JSON", desc: "JSON string containing obstacle map data", type: "string", initialValue: "\"\"" }
  ]
}, function(json) {
  this.aceLoadObstacleMapFromJSON(json);
});

action("ObstacleMap", "GenerateNodesFromCustomMap", {
  listName: "Generate navigation graph",
  displayText: "Generate navigation graph from obstacle map",
  description: "Generate the navigation graph from the current obstacle map. Call this after setting up all tiles and before pathfinding. This is an expensive operation."
}, function() {
  this.aceGenerateNodesFromCustomMap();
});

action("ObstacleMap", "UsePathfindingObstacleMap", {
  listName: "Use Pathfinding obstacle map",
  displayText: "Use Pathfinding obstacle map [Auto-regenerate: {0}]",
  description: "Use the obstacle map from the Pathfinding behavior instead of a custom map. Enable auto-regenerate to automatically rebuild the graph when the Pathfinding map changes.",
  params: [
    { id: "autoRegen", name: "Auto-regenerate", desc: "Automatically regenerate graph when Pathfinding map changes", type: "combo", initialValue: "yes",
      items: [{ yes: "Yes" }, { no: "No" }]
    }
  ]
}, function(autoRegen) {
  this.aceUsePathfindingObstacleMap(this._combo(autoRegen, ["yes", "no"]) === "yes");
});

action("ObstacleMap", "ClearAllSlopes", {
  listName: "Clear all slope markings",
  displayText: "Clear all slope markings",
  description: "Remove all slope markings from the obstacle map. Slopes will be treated as regular solid tiles. Use this to reset slope data."
}, function() {
  this.aceClearAllSlopes();
});

action("ObstacleMap", "SetRePathThreshold", {
  listName: "Set re-path threshold",
  displayText: "Set re-path threshold to {0} tiles",
  description: "Set how many tiles the character can drift from the path before automatic re-pathing triggers. Higher values = more tolerance for deviation.",
  params: [
    { id: "tiles", name: "Tiles", desc: "Threshold in tiles", type: "number", initialValue: "2" }
  ]
}, function(tiles) {
  this.aceSetRePathThreshold(tiles);
});

action("Pathfinding", "SetRePathCooldown", {
  listName: "Set re-path cooldown",
  displayText: "Set re-path cooldown to {0} seconds",
  description: "Set the minimum time in seconds between automatic re-path attempts. Lower values = more responsive re-pathing but more CPU usage. Default is 0.5 seconds.",
  params: [
    { id: "seconds", name: "Seconds", desc: "Cooldown in seconds", type: "number", initialValue: "0.5" }
  ]
}, function(seconds) {
  this.aceSetRePathCooldown(seconds);
});

action("Pathfinding", "SetPathStrategy", {
  listName: "Set path strategy",
  displayText: "Set path strategy to {0}",
  description: "Change how the AI picks the best route when multiple paths exist. Balanced: weighs distance and difficulty equally. Shortest Distance: always takes the fastest route. Safest Route: avoids jumps and falls. Simplest Path: fewest waypoints.",
  params: [
    {
      id: "strategy",
      name: "Strategy",
      desc: "The path selection strategy preset",
      type: "combo",
      initialValue: "balanced",
      items: [
        { balanced: "Balanced" },
        { shortest: "Shortest Distance" },
        { safest: "Safest Route" },
        { simplest: "Simplest Path" }
      ]
    }
  ]
}, function(strategy) {
  this.aceSetPathStrategy(this._combo(strategy, ["balanced", "shortest", "safest", "simplest"]));
});

action("ObstacleMap", "SetHazardRadius", {
  listName: "Set hazard radius",
  displayText: "Set hazard radius to {0} tiles",
  description: "Set the radius in tiles for circular/rectangular hazard influence. Tiles within this radius of a hazard will have their pathfinding cost increased.",
  params: [
    { id: "tiles", name: "Tiles", desc: "Radius in tiles", type: "number", initialValue: "1" }
  ]
}, function(tiles) {
  this.aceSetHazardRadius(tiles);
});

// ============================================================================
// OBSTACLE MAP CONDITIONS
// ============================================================================

condition("ObstacleMap", "OnObstacleMapCreated", {
  listName: "On obstacle map created",
  displayText: "On obstacle map created",
  description: "Triggered when a custom obstacle map is successfully created. Use this to start configuring tiles after map creation.",
  isTrigger: true
}, function() {
  return true;
});

condition("ObstacleMap", "OnObstacleMapRemoved", {
  listName: "On obstacle map removed",
  displayText: "On obstacle map removed",
  description: "Triggered when the obstacle map is cleared or removed. Use this to clean up related data or reset systems.",
  isTrigger: true
}, function() {
  return true;
});

condition("ObstacleMap", "OnPathfindingMapReady", {
  listName: "On Pathfinding map ready",
  displayText: "On Pathfinding map ready",
  description: "Triggered when the Pathfinding behavior's obstacle map is ready for use. Use this to start graph generation after Pathfinding initialization.",
  isTrigger: true
}, function() {
  return true;
});

condition("ObstacleMap", "OnPathfindingMapFailed", {
  listName: "On Pathfinding map failed",
  displayText: "On Pathfinding map failed",
  description: "Triggered when the Pathfinding behavior's obstacle map fails to initialize. Use this to implement fallback error handling.",
  isTrigger: true
}, function() {
  return true;
});

condition("ObstacleMap", "OnPathfindingMapTimeout", {
  listName: "On Pathfinding map timeout",
  displayText: "On Pathfinding map timeout",
  description: "Triggered when waiting for the Pathfinding obstacle map times out. Use this to handle slow or stuck initialization.",
  isTrigger: true
}, function() {
  return true;
});

condition("ObstacleMap", "IsSettingUpPathfinding", {
  listName: "Is setting up Pathfinding",
  displayText: "Is setting up Pathfinding map",
  description: "Check if the behavior is currently waiting for the Pathfinding obstacle map to initialize. Returns true during async setup.",
  isInvertible: true
}, function() {
  return this.aceIsSettingUpPathfinding();
});

condition("ObstacleMap", "TileHasState", {
  listName: "Tile has state",
  displayText: "Tile at ({0}, {1}) has state {2}",
  description: "Check if a tile at the given grid position has the specified state. Use this to query tile properties before actions.",
  isInvertible: true,
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "state", name: "State", desc: "Tile state to check for", type: "combo", initialValue: "solid",
      items: [
        { solid: "Solid" },
        { clear: "Clear" },
        { jump_thru: "Jump-thru" },
        { avoid: "Avoid" },
        { slope: "Slope (any direction)" }
      ]
    }
  ]
}, function(gx, gy, state) {
  const s = this._combo(state, ["solid", "clear", "jump_thru", "avoid", "slope"]);
  const tileState = this.aceGetTileState(gx, gy);
  if (s === "slope") {
    return tileState === "slope";
  }
  return tileState === s;
});

condition("ObstacleMap", "TileHasStateWorld", {
  listName: "Tile has state at world position",
  displayText: "Tile at world ({0}, {1}) has state {2}",
  description: "Check if a tile at the given world position has the specified state. World coordinates are automatically converted to grid coordinates.",
  isInvertible: true,
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number", initialValue: "0" },
    { id: "state", name: "State", desc: "Tile state to check for", type: "combo", initialValue: "solid",
      items: [
        { solid: "Solid" },
        { clear: "Clear" },
        { jump_thru: "Jump-thru" },
        { avoid: "Avoid" },
        { slope: "Slope (any direction)" }
      ]
    }
  ]
}, function(x, y, state) {
  const s = this._combo(state, ["solid", "clear", "jump_thru", "avoid", "slope"]);
  const tileState = this.aceGetTileStateWorld(x, y);
  if (s === "slope") {
    return tileState === "slope";
  }
  return tileState === s;
});

// ============================================================================
// OBSTACLE MAP EXPRESSIONS
// ============================================================================

expression("ObstacleMap", "ObstacleMapJSON", {
  returnType: "string",
  description: "Get the current obstacle map as a JSON string. Use this to save the map to local storage or export to files."
}, function() {
  return this.aceGetObstacleMapJSON();
});

expression("ObstacleMap", "ObstacleMapSource", {
  returnType: "string",
  description: "Get the source of the current obstacle map. Returns 'custom', 'pathfinding', or 'none'."
}, function() {
  return this.aceGetObstacleMapSource();
});

expression("ObstacleMap", "GridWidth", {
  returnType: "number",
  description: "Get the width of the obstacle map in tiles. Returns 0 if no map exists."
}, function() {
  return this.aceGetGridWidth();
});

expression("ObstacleMap", "GridHeight", {
  returnType: "number",
  description: "Get the height of the obstacle map in tiles. Returns 0 if no map exists."
}, function() {
  return this.aceGetGridHeight();
});

expression("ObstacleMap", "GridTileSize", {
  returnType: "number",
  description: "Get the tile size in pixels. Returns 0 if no map exists."
}, function() {
  return this.aceGetGridTileSize();
});

expression("ObstacleMap", "TileState", {
  returnType: "string",
  description: "Get the state of a tile at the specified grid coordinates. Returns 'solid', 'clear', 'jump-thru', 'avoid', 'slope-left', 'slope-right', or empty string if out of bounds.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceGetTileState(gx, gy);
});

expression("ObstacleMap", "SlopeDirection", {
  returnType: "string",
  description: "Get the slope direction of a tile at the specified grid coordinates. Returns 'left', 'right', or empty string if not a slope.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceGetSlopeDirection(gx, gy);
});

expression("ObstacleMap", "WorldToGridX", {
  returnType: "number",
  description: "Convert a world X position to grid X coordinate. Returns the grid tile number at the given pixel position.",
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number" }
  ]
}, function(x) {
  return this.aceWorldToGridX(x);
});

expression("ObstacleMap", "WorldToGridY", {
  returnType: "number",
  description: "Convert a world Y position to grid Y coordinate. Returns the grid tile number at the given pixel position.",
  params: [
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number" }
  ]
}, function(y) {
  return this.aceWorldToGridY(y);
});

expression("ObstacleMap", "WaitTickCount", {
  returnType: "number",
  description: "Get the number of ticks spent waiting for the Pathfinding obstacle map to initialize. Used for debugging timeout issues."
}, function() {
  return this.aceGetWaitTickCount();
});

expression("ObstacleMap", "HazardRadius", {
  returnType: "number",
  description: "Get the current hazard radius setting in tiles. This affects how far hazard influence spreads."
}, function() {
  return this.aceGetHazardRadius();
});

expression("ObstacleMap", "RePathThreshold", {
  returnType: "number",
  description: "Get the current re-path threshold in tiles. This is how far the character can drift before automatic re-pathing triggers."
}, function() {
  return this.aceGetRePathThreshold();
});

expression("ObstacleMap", "RePathCooldown", {
  returnType: "number",
  description: "Get the current re-path cooldown in seconds. This is the minimum time between automatic re-path attempts."
}, function() {
  return this.aceGetRePathCooldown();
});

// ============================================================================
// HAZARD ACTIONS
// ============================================================================

action("Hazards", "AddRectHazard", {
  listName: "Add rectangle hazard",
  displayText: "Add rectangle hazard at ({0}, {1}) [Size: {2} x {3}] [Severity: {4}]",
  description: "Add a rectangular hazard area. The AI will avoid this area based on severity. Hazard avoidance is automatically enabled. Returns a hazard ID for later removal. Use for static danger zones like spike pits.",
  params: [
    { id: "x", name: "X", desc: "World X position (center)", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position (center)", type: "number", initialValue: "0" },
    { id: "width", name: "Width", desc: "Width in pixels", type: "number", initialValue: "32" },
    { id: "height", name: "Height", desc: "Height in pixels", type: "number", initialValue: "32" },
    { id: "severity", name: "Severity", desc: "Hazard severity (higher = more dangerous)", type: "number", initialValue: "10" }
  ]
}, function(x, y, width, height, severity) {
  this.aceAddRectHazard(x, y, width, height, severity);
});

action("Hazards", "AddCircleHazard", {
  listName: "Add circle hazard",
  displayText: "Add circle hazard at ({0}, {1}) [Radius: {2}] [Severity: {3}]",
  description: "Add a circular hazard area. The AI will avoid this area based on severity. Hazard avoidance is automatically enabled. Returns a hazard ID for later removal. Use for dynamic danger zones like explosions or enemy AOE.",
  params: [
    { id: "x", name: "X", desc: "World X position (center)", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position (center)", type: "number", initialValue: "0" },
    { id: "radius", name: "Radius", desc: "Radius in pixels", type: "number", initialValue: "32" },
    { id: "severity", name: "Severity", desc: "Hazard severity (higher = more dangerous)", type: "number", initialValue: "10" }
  ]
}, function(x, y, radius, severity) {
  this.aceAddCircleHazard(x, y, radius, severity);
});

action("Hazards", "RemoveHazard", {
  listName: "Remove hazard",
  displayText: "Remove hazard {0}",
  description: "Remove a hazard by its ID. Use this when a danger zone is no longer active. The graph will be regenerated if needed.",
  params: [
    { id: "id", name: "ID", desc: "Hazard ID to remove", type: "number", initialValue: "0" }
  ]
}, function(id) {
  this.aceRemoveHazard(id);
});

action("Hazards", "ClearAllHazards", {
  listName: "Clear all hazards",
  displayText: "Clear all circle and rectangle hazards",
  description: "Remove all circular and rectangular hazards. This does NOT clear tile-based hazards. Use when resetting a level or clearing all dynamic dangers."
}, function() {
  this.aceClearAllHazards();
});

action("Hazards", "ClearAllHazardTiles", {
  listName: "Clear all tile hazards",
  displayText: "Clear all tile hazards",
  description: "Reset all tile hazard severities to 0. This does NOT remove circle/rect hazards. Use when you want to clear static tile dangers."
}, function() {
  this.aceClearAllHazardTiles();
});

// ============================================================================
// HAZARD CONDITIONS
// ============================================================================

condition("Hazards", "IsPositionHazardous", {
  listName: "Is position hazardous",
  displayText: "Is position ({0}, {1}) hazardous",
  description: "Check if a specific world position is within any hazard area (circle, rect, or tile). Returns true if any hazard affects this position.",
  isInvertible: true,
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number", initialValue: "0" }
  ]
}, function(x, y) {
  return this.aceIsPositionHazardous(x, y);
});

// ============================================================================
// HAZARD EXPRESSIONS
// ============================================================================

expression("Hazards", "HazardCount", {
  returnType: "number",
  description: "Get the total number of active hazards (circles and rectangles). Does not include tile hazards."
}, function() {
  return this.aceGetHazardCount();
});

expression("Hazards", "PositionIsHazardous", {
  returnType: "number",
  description: "Check if a world position is hazardous. Returns 1 if hazardous, 0 if safe.",
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number" }
  ]
}, function(x, y) {
  return this.aceIsPositionHazardous(x, y) ? 1 : 0;
});

expression("Hazards", "HazardSeverity", {
  returnType: "number",
  description: "Get the total hazard severity at a world position from all sources (circles, rects, tiles). Higher values = more dangerous.",
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number" }
  ]
}, function(x, y) {
  return this.aceGetHazardSeverity(x, y);
});

expression("Hazards", "TileHazardSeverity", {
  returnType: "number",
  description: "Get the hazard severity of a specific tile. Returns 0 if no hazard. Only checks tile-based hazards, not circles/rects.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceGetTileHazardSeverity(gx, gy);
});

// ============================================================================
// PORTAL ACTIONS
// ============================================================================

action("Portals", "AddInstantPortal", {
  listName: "Add instant portal",
  displayText: "Add {0} instant portal from ({1}, {2}) to ({3}, {4}) [Cost: {5}]",
  description: "Add a portal that instantly teleports the AI from the entry to the exit. Use for: teleporters, doors, warp zones, or any portal where the character disappears and reappears at the exit. Use 'On portal entry' with 'Pause at portal' to play animations before the teleport happens.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "one_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "entryX", name: "Entry X", desc: "Entry world X position in pixels", type: "number", initialValue: "0" },
    { id: "entryY", name: "Entry Y", desc: "Entry world Y position in pixels", type: "number", initialValue: "0" },
    { id: "exitX", name: "Exit X", desc: "Exit world X position in pixels", type: "number", initialValue: "0" },
    { id: "exitY", name: "Exit Y", desc: "Exit world Y position in pixels", type: "number", initialValue: "0" },
    { id: "cost", name: "Cost", desc: "How much the AI 'pays' to use this portal. Default 1 = same as walking one tile. Lower = preferred, higher = avoided.", type: "number", initialValue: "1" }
  ]
}, function(direction, entryX, entryY, exitX, exitY, cost) {
  this.aceAddInstantPortal(this._combo(direction, ["one_way", "two_way"]), entryX, entryY, exitX, exitY, cost);
});

action("Portals", "AddInstantPortalFromObjects", {
  listName: "Add instant portal from objects",
  displayText: "Add {0} instant portal from {1} to {2} [Cost: {3}]",
  description: "Add an instant portal using two objects as entry and exit positions. The objects' current X/Y positions are used. Use for: linking door sprites, warp pad objects, etc.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "one_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "entryObject", name: "Entry object", desc: "The object to use as the portal entry point", type: "object" },
    { id: "exitObject", name: "Exit object", desc: "The object to use as the portal exit point", type: "object" },
    { id: "cost", name: "Cost", desc: "Movement cost (lower = preferred, default is 1)", type: "number", initialValue: "1" }
  ]
}, function(direction, entryObject, exitObject, cost) {
  this.aceAddInstantPortalFromObjects(this._combo(direction, ["one_way", "two_way"]), entryObject, exitObject, cost);
});

action("Portals", "AddGradualPortal", {
  listName: "Add gradual portal",
  displayText: "Add {0} gradual portal from ({1}, {2}) to ({3}, {4}) [Cost: {5}] [Speed: {6}]",
  description: "Add a portal that gradually moves the AI from entry to exit at the given speed. The character moves in a straight line (any direction — vertical, horizontal, or diagonal). Platform behavior is disabled during movement. Use for: elevators, lifts, moving platforms, ziplines. For vertical-only movement (ladders/ropes), align entry and exit X positions, or use 'Pause at portal' to implement your own custom movement via events.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "two_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "entryX", name: "Entry X", desc: "Entry world X position in pixels", type: "number", initialValue: "0" },
    { id: "entryY", name: "Entry Y", desc: "Entry world Y position in pixels", type: "number", initialValue: "0" },
    { id: "exitX", name: "Exit X", desc: "Exit world X position in pixels", type: "number", initialValue: "0" },
    { id: "exitY", name: "Exit Y", desc: "Exit world Y position in pixels", type: "number", initialValue: "0" },
    { id: "cost", name: "Cost", desc: "Movement cost. Default 1 = auto-calculated from distance and speed. Set higher to make AI avoid this portal.", type: "number", initialValue: "1" },
    { id: "speed", name: "Speed", desc: "Movement speed in pixels per second", type: "number", initialValue: "100" }
  ]
}, function(direction, entryX, entryY, exitX, exitY, cost, speed) {
  this.aceAddGradualPortal(this._combo(direction, ["one_way", "two_way"]), entryX, entryY, exitX, exitY, cost, speed);
});

action("Portals", "AddGradualPortalFromObjects", {
  listName: "Add gradual portal from objects",
  displayText: "Add {0} gradual portal from {1} to {2} [Cost: {3}] [Speed: {4}]",
  description: "Add a gradual portal using two objects. Character moves from entry object to exit object at the given speed. Use for: linking elevator sprites, rope endpoints, etc.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "two_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "entryObject", name: "Entry object", desc: "The object to use as the portal entry point", type: "object" },
    { id: "exitObject", name: "Exit object", desc: "The object to use as the portal exit point", type: "object" },
    { id: "cost", name: "Cost", desc: "Movement cost (default 1 = auto-calculated)", type: "number", initialValue: "1" },
    { id: "speed", name: "Speed", desc: "Movement speed in pixels per second", type: "number", initialValue: "100" }
  ]
}, function(direction, entryObject, exitObject, cost, speed) {
  this.aceAddGradualPortalFromObjects(this._combo(direction, ["one_way", "two_way"]), entryObject, exitObject, cost, speed);
});

action("Portals", "RemovePortal", {
  listName: "Remove portal by ID",
  displayText: "Remove portal with ID {0}",
  description: "Remove a portal by its ID. The portal connection is removed from the navigation graph immediately.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to remove", type: "number", initialValue: "0" }
  ]
}, function(portalId) {
  this.aceRemovePortal(portalId);
});

action("Portals", "RemovePortalAtObject", {
  listName: "Remove portal at object",
  displayText: "Remove portal at {0}",
  description: "Remove the portal closest to this object. Works with both entry and exit positions — for two-way portals, either endpoint object can be used.",
  params: [
    { id: "object", name: "Object", desc: "The object whose position to match against portal positions", type: "object" }
  ]
}, function(object) {
  this.aceRemovePortalAtObject(object);
});

action("Portals", "SetPortalCost", {
  listName: "Set portal cost",
  displayText: "Set portal {0} cost to {1}",
  description: "Change how 'expensive' a portal is for the AI to use. Lower cost = preferred, higher cost = avoided.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to configure", type: "number", initialValue: "0" },
    { id: "cost", name: "Cost", desc: "Movement cost (lower = preferred, default is 1)", type: "number", initialValue: "1" }
  ]
}, function(portalId, cost) {
  this.aceSetPortalCost(portalId, cost);
});

action("Portals", "SetPortalSpeed", {
  listName: "Set portal speed",
  displayText: "Set portal {0} speed to {1}",
  description: "Change the movement speed of a gradual portal (pixels per second). Has no effect on instant portals.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to configure", type: "number", initialValue: "0" },
    { id: "speed", name: "Speed", desc: "Movement speed in pixels per second", type: "number", initialValue: "100" }
  ]
}, function(portalId, speed) {
  this.aceSetPortalSpeed(portalId, speed);
});

action("Portals", "SetPortalIgnoreHazards", {
  listName: "Set portal ignore hazards",
  displayText: "Set portal {0} ignore hazards: {1}",
  description: "Set whether a portal ignores nearby hazards when calculating its pathfinding cost.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to configure", type: "number", initialValue: "0" },
    { id: "ignoreHazards", name: "Ignore hazards", desc: "Whether this portal should ignore hazards", type: "combo", initialValue: "no",
      items: [{ yes: "Yes" }, { no: "No" }]
    }
  ]
}, function(portalId, ignoreHazards) {
  this.aceSetPortalIgnoreHazards(portalId, this._combo(ignoreHazards, ["yes", "no"]) === "yes");
});

action("Portals", "PauseAtPortal", {
  listName: "Pause at portal",
  displayText: "Pause at portal",
  description: "Call INSIDE 'On portal entry' to pause the AI before the portal executes. The character stops at the entry point and waits. Use this to play animations, open doors, trigger screen transitions, or run any custom events before the portal activates. Call 'Resume portal' to execute the built-in behavior, or 'Complete portal' if you moved the character yourself."
}, function() {
  this.acePauseAtPortal();
});

action("Portals", "ResumePortal", {
  listName: "Resume portal",
  displayText: "Resume portal",
  description: "Continue portal execution after pausing with 'Pause at portal'. For instant portals: teleports the character to the exit. For gradual portals: begins moving the character toward the exit. Use this when you want the portal's built-in movement to handle the transition."
}, function() {
  this.aceResumePortal();
});

action("Portals", "CompletePortal", {
  listName: "Complete portal",
  displayText: "Complete portal",
  description: "Finish a paused portal without executing its built-in movement. Use this when you've already moved the character yourself (e.g., custom animation, physics launch, manual position set). The AI will continue pathfinding from wherever the character is now. Also works mid-traverse to cut a gradual portal short."
}, function() {
  this.aceCompletePortal();
});

action("Portals", "TeleportToPosition", {
  listName: "Teleport to position",
  displayText: "Teleport to ({0}, {1})",
  description: "Instantly move the character to the given position. Can be used anywhere — inside portal events, on button press, on collision, etc. Suppresses re-pathing for one tick to prevent the AI from thinking it's lost. Useful with 'Pause at portal' + 'Complete portal' for fully custom portal behavior.",
  params: [
    { id: "x", name: "X", desc: "Target world X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Target world Y position in pixels", type: "number", initialValue: "0" }
  ]
}, function(x, y) {
  this.aceTeleportToPosition(x, y);
});

action("Portals", "AddElevatorStop", {
  listName: "Add elevator stop",
  displayText: "Add elevator stop to group {0} at ({1}, {2}) [Speed: {3}]",
  description: "Add a stop to an elevator group. Automatically creates two-way gradual portals between this stop and all other stops in the same group. Cost is auto-calculated from distance and speed. Use a unique group name (e.g. 'elevator_A') for each elevator. Example: 3 calls with the same group creates 3 pairwise portals (Floor1-Floor2, Floor1-Floor3, Floor2-Floor3). Use PortalExitX/PortalExitY in 'On portal entry' to determine which floor the AI is heading to.",
  params: [
    { id: "groupId", name: "Group", desc: "Unique group name for this elevator (e.g. 'elevator_A')", type: "string", initialValue: "\"elevator_A\"" },
    { id: "x", name: "X", desc: "World X position of this stop", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position of this stop", type: "number", initialValue: "0" },
    { id: "speed", name: "Speed", desc: "Movement speed in pixels per second", type: "number", initialValue: "100" }
  ]
}, function(groupId, x, y, speed) {
  this.aceAddElevatorStop(groupId, x, y, speed);
});

action("Portals", "AddElevatorStopFromObject", {
  listName: "Add elevator stop from object",
  displayText: "Add elevator stop to group {0} at {1} [Speed: {2}]",
  description: "Add an elevator stop using an object's position. Same as 'Add elevator stop' but uses the object's current X/Y. The object serves as a floor marker.",
  params: [
    { id: "groupId", name: "Group", desc: "Unique group name for this elevator", type: "string", initialValue: "\"elevator_A\"" },
    { id: "object", name: "Object", desc: "The object to use as the elevator stop position", type: "object" },
    { id: "speed", name: "Speed", desc: "Movement speed in pixels per second", type: "number", initialValue: "100" }
  ]
}, function(groupId, object, speed) {
  this.aceAddElevatorStopFromObject(groupId, object, speed);
});

action("Portals", "ClearAllPortals", {
  listName: "Clear all portals",
  displayText: "Clear all portals",
  description: "Remove all portals from the navigation graph. Useful when resetting the level or switching layouts."
}, function() {
  this.aceClearAllPortals();
});

// ============================================================================
// PORTAL CONDITIONS
// ============================================================================

condition("Portals", "OnPortalEntry", {
  listName: "On portal entry",
  displayText: "On portal entry",
  description: "Triggered when the AI arrives at a portal entry point, BEFORE the portal executes. Use 'Pause at portal' inside this event to delay execution and run your own events first (animations, sounds, screen effects). If you don't pause, the portal executes immediately. Use CurrentPortalID to identify which portal was reached.",
  isTrigger: true
}, function() {
  return true;
});

condition("Portals", "OnPortalComplete", {
  listName: "On portal complete",
  displayText: "On portal complete",
  description: "Triggered when portal execution finishes — after an instant teleport completes, a gradual movement reaches the exit, or 'Complete portal' is called. Use this for post-portal effects like opening doors at the exit, playing arrival animations, etc.",
  isTrigger: true
}, function() {
  return true;
});

condition("Portals", "IsAtPortal", {
  listName: "Is at portal",
  displayText: "Is at portal",
  description: "True when the AI is paused at a portal entry (after 'Pause at portal' was called but before 'Resume portal' or 'Complete portal'). Use to check if the character is waiting at a portal.",
  isInvertible: true
}, function() {
  return this.aceIsAtPortal();
});

condition("Portals", "IsTraversingPortal", {
  listName: "Is traversing portal",
  displayText: "Is traversing portal",
  description: "True when the AI is currently moving through a gradual portal (elevator, ladder, etc.). Platform behavior is disabled during traversal.",
  isInvertible: true
}, function() {
  return this.aceIsTraversingPortal();
});

// ============================================================================
// PORTAL EXPRESSIONS
// ============================================================================

expression("Portals", "PortalCount", {
  returnType: "number",
  description: "Get the total number of portals."
}, function() {
  return this.aceGetPortalCount();
});

expression("Portals", "LastPortalID", {
  returnType: "number",
  description: "Returns the ID of the most recently added portal. Use right after adding a portal to save the ID for later configuration or removal."
}, function() {
  return this.aceGetLastPortalID();
});

expression("Portals", "CurrentPortalID", {
  returnType: "number",
  description: "Returns the portal ID during OnPortalEntry/OnPortalComplete triggers. Use to identify which portal was reached."
}, function() {
  return this.aceGetCurrentPortalID();
});

expression("Portals", "PortalProgress", {
  returnType: "number",
  description: "Get the 0-1 traversal progress for gradual portals. Returns 0 if not traversing."
}, function() {
  return this.aceGetPortalProgress();
});

expression("Portals", "PortalExitX", {
  returnType: "number",
  description: "Get the exit X position of the current portal. Valid inside OnPortalEntry/OnPortalComplete triggers."
}, function() {
  return this.aceGetPortalExitX();
});

expression("Portals", "PortalExitY", {
  returnType: "number",
  description: "Get the exit Y position of the current portal. Valid inside OnPortalEntry/OnPortalComplete triggers."
}, function() {
  return this.aceGetPortalExitY();
});

expression("Portals", "PortalType", {
  returnType: "string",
  description: "Returns 'instant' or 'gradual' for the given portal ID.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The portal ID to check", type: "number" }
  ]
}, function(portalId) {
  return this.aceGetPortalType(portalId);
});

// ============================================================================
// GRAPH DATA ACTIONS
// ============================================================================

action("GraphData", "LogGraphStats", {
  listName: "Log graph stats to console",
  displayText: "Log navigation graph statistics to console",
  description: "Output detailed navigation graph statistics to the browser console. Use for debugging graph generation and connectivity issues."
}, function() {
  this.aceLogGraphStats();
});

// ============================================================================
// GRAPH DATA CONDITIONS
// ============================================================================

condition("GraphData", "IsNodeLedge", {
  listName: "Is node at ledge",
  displayText: "Is node at ({0}, {1}) a ledge",
  description: "Check if a specific node is marked as a ledge (platform edge). Returns true if the node is a left or right ledge.",
  isInvertible: true,
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate (tile number)", type: "number", initialValue: "0" }
  ]
}, function(gx, gy) {
  return this.aceIsNodeLedge(gx, gy);
});

// ============================================================================
// GRAPH DATA EXPRESSIONS
// ============================================================================

expression("GraphData", "NodeAtIndexX", {
  returnType: "number",
  description: "Get the world X position of a node by its index in the node array. Returns 0 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Node index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetNodeAtIndexX(index);
});

expression("GraphData", "NodeAtIndexY", {
  returnType: "number",
  description: "Get the world Y position of a node by its index in the node array. Returns 0 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Node index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetNodeAtIndexY(index);
});

expression("GraphData", "NodeAtIndexGridX", {
  returnType: "number",
  description: "Get the grid X coordinate of a node by its index in the node array. Returns -1 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Node index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetNodeAtIndexGridX(index);
});

expression("GraphData", "NodeAtIndexGridY", {
  returnType: "number",
  description: "Get the grid Y coordinate of a node by its index in the node array. Returns -1 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Node index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetNodeAtIndexGridY(index);
});

expression("GraphData", "NodeAtIndexIsLeftLedge", {
  returnType: "number",
  description: "Check if a node is a left ledge by its index. Returns 1 if true, 0 if false or index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Node index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetNodeAtIndexIsLeftLedge(index);
});

expression("GraphData", "NodeAtIndexIsRightLedge", {
  returnType: "number",
  description: "Check if a node is a right ledge by its index. Returns 1 if true, 0 if false or index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Node index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetNodeAtIndexIsRightLedge(index);
});

expression("GraphData", "NodeAtIndexIsSlope", {
  returnType: "number",
  description: "Check if a node is on a slope by its index. Returns 1 if true, 0 if false or index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Node index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetNodeAtIndexIsSlope(index);
});

expression("GraphData", "NodeAtIndexConnectionCount", {
  returnType: "number",
  description: "Get the number of connections (edges) from a node by its index. Returns 0 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Node index (0-based)", type: "number" }
  ]
}, function(index) {
  return this.aceGetNodeAtIndexConnectionCount(index);
});

expression("GraphData", "NodeConnectionCount", {
  returnType: "number",
  description: "Get the number of connections (edges) from a node at grid coordinates. Returns 0 if node doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceGetNodeConnectionCount(gx, gy);
});

expression("GraphData", "NodeConnectionTargetX", {
  returnType: "number",
  description: "Get the world X position of a connection's target node. Returns 0 if node/connection doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Source node grid X", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Source node grid Y", type: "number" },
    { id: "index", name: "Connection index", desc: "Connection index (0-based)", type: "number" }
  ]
}, function(gx, gy, index) {
  return this.aceGetNodeConnectionTargetX(gx, gy, index);
});

expression("GraphData", "NodeConnectionTargetY", {
  returnType: "number",
  description: "Get the world Y position of a connection's target node. Returns 0 if node/connection doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Source node grid X", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Source node grid Y", type: "number" },
    { id: "index", name: "Connection index", desc: "Connection index (0-based)", type: "number" }
  ]
}, function(gx, gy, index) {
  return this.aceGetNodeConnectionTargetY(gx, gy, index);
});

expression("GraphData", "NodeConnectionAction", {
  returnType: "string",
  description: "Get the action name for a connection (e.g., 'walk', 'jump', 'fall'). Returns empty string if node/connection doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Source node grid X", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Source node grid Y", type: "number" },
    { id: "index", name: "Connection index", desc: "Connection index (0-based)", type: "number" }
  ]
}, function(gx, gy, index) {
  return this.aceGetNodeConnectionAction(gx, gy, index);
});

expression("GraphData", "NodeConnectionCost", {
  returnType: "number",
  description: "Get the movement cost for a connection. Returns 0 if node/connection doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Source node grid X", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Source node grid Y", type: "number" },
    { id: "index", name: "Connection index", desc: "Connection index (0-based)", type: "number" }
  ]
}, function(gx, gy, index) {
  return this.aceGetNodeConnectionCost(gx, gy, index);
});

expression("GraphData", "NearestNodeX", {
  returnType: "number",
  description: "Get the world X position of the nearest navigation node to a world position. Returns 0 if no nodes exist.",
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number" }
  ]
}, function(x, y) {
  return this.aceGetNearestNodeX(x, y);
});

expression("GraphData", "NearestNodeY", {
  returnType: "number",
  description: "Get the world Y position of the nearest navigation node to a world position. Returns 0 if no nodes exist.",
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number" }
  ]
}, function(x, y) {
  return this.aceGetNearestNodeY(x, y);
});

expression("GraphData", "NearestNodeGridX", {
  returnType: "number",
  description: "Get the grid X coordinate of the nearest navigation node to a world position. Returns -1 if no nodes exist.",
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number" }
  ]
}, function(x, y) {
  return this.aceGetNearestNodeGridX(x, y);
});

expression("GraphData", "NearestNodeGridY", {
  returnType: "number",
  description: "Get the grid Y coordinate of the nearest navigation node to a world position. Returns -1 if no nodes exist.",
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number" }
  ]
}, function(x, y) {
  return this.aceGetNearestNodeGridY(x, y);
});

expression("GraphData", "IsNodeLeftLedge", {
  returnType: "number",
  description: "Check if a node at grid coordinates is a left ledge. Returns 1 if true, 0 if false or node doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceIsNodeLeftLedge(gx, gy);
});

expression("GraphData", "IsNodeRightLedge", {
  returnType: "number",
  description: "Check if a node at grid coordinates is a right ledge. Returns 1 if true, 0 if false or node doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceIsNodeRightLedge(gx, gy);
});

expression("GraphData", "IsNodeIsland", {
  returnType: "number",
  description: "Check if a node at grid coordinates is an island (single-tile platform). Returns 1 if true, 0 if false or node doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceIsNodeIsland(gx, gy);
});

expression("GraphData", "IsTileJumpThru", {
  returnType: "number",
  description: "Check if a tile at grid coordinates is a jump-thru platform. Returns 1 if true, 0 if false or tile doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
}, function(gx, gy) {
  return this.aceIsTileJumpThru(gx, gy);
});

// ============================================================================
// MULTI-AGENT ACTIONS
// ============================================================================

action("MultiAgent", "SetMultiAgentAvoidance", {
  listName: "Set multi-agent avoidance",
  displayText: "Set multi-agent avoidance: {0}",
  description: "Enable or disable multi-agent collision avoidance. When enabled, AI agents will attempt to avoid colliding with each other during pathfinding. Note: This feature may not be fully implemented yet.",
  params: [
    { id: "enabled", name: "Enabled", desc: "Enable or disable multi-agent avoidance", type: "combo", initialValue: "yes",
      items: [{ yes: "Enabled" }, { no: "Disabled" }]
    }
  ]
}, function(enabled) {
  this.aceSetMultiAgentAvoidance(this._combo(enabled, ["yes", "no"]) === "yes");
});

// ============================================================================
// MULTI-AGENT CONDITIONS
// ============================================================================

condition("MultiAgent", "IsMultiAgentAvoidanceEnabled", {
  listName: "Is multi-agent avoidance enabled",
  displayText: "Multi-agent avoidance is enabled",
  description: "Check if multi-agent collision avoidance is currently enabled. Returns true if enabled, false otherwise.",
  isInvertible: true
}, function() {
  return this.aceIsMultiAgentAvoidanceEnabled();
});

// ============================================================================
// MULTI-AGENT EXPRESSIONS
// ============================================================================

expression("MultiAgent", "NearbyAgentCount", {
  returnType: "number",
  description: "Get the number of nearby AI agents within detection range. Used for multi-agent avoidance calculations. Returns 0 if multi-agent avoidance is disabled."
}, function() {
  return this.aceGetNearbyAgentCount();
});

// ============================================================================
// DEBUG EXPRESSIONS
// ============================================================================

expression("Debug", "PlatformMaxSpeed", {
  returnType: "number",
  description: "Get the max speed from the Platform behavior. Used for internal pathfinding calculations. Returns 0 if Platform behavior not found."
}, function() {
  return this.aceGetPlatformMaxSpeed();
});

expression("Debug", "PlatformJumpStrength", {
  returnType: "number",
  description: "Get the jump strength from the Platform behavior. Used for internal pathfinding calculations. Returns 0 if Platform behavior not found."
}, function() {
  return this.aceGetPlatformJumpStrength();
});

expression("Debug", "CalculatedJumpHeight", {
  returnType: "number",
  description: "Get the calculated maximum jump height in pixels based on Platform behavior settings. Used for determining reachable positions."
}, function() {
  return this.aceGetCalculatedJumpHeight();
});

expression("Debug", "CalculatedJumpDistance", {
  returnType: "number",
  description: "Get the calculated maximum horizontal jump distance in pixels based on Platform behavior settings. Used for determining reachable positions."
}, function() {
  return this.aceGetCalculatedJumpDistance();
});

// ============================================================================
// CONFIGURATION ACTIONS
// ============================================================================

action("Configuration", "SetMaxJumpHeight", {
  listName: "Set max jump height",
  displayText: "Set max jump height to {0} px",
  description: "Override the auto-calculated maximum jump height. The navigation graph must be regenerated after changing this for the new value to take effect.",
  params: [
    { id: "value", name: "Height (px)", desc: "Maximum jump height in pixels", type: "number", initialValue: "128" }
  ]
}, function(value) {
  this.maxJumpHeight = value;
});

action("Configuration", "SetMaxJumpDistance", {
  listName: "Set max jump distance",
  displayText: "Set max jump distance to {0} px",
  description: "Override the auto-calculated maximum horizontal jump distance. The navigation graph must be regenerated after changing this for the new value to take effect.",
  params: [
    { id: "value", name: "Distance (px)", desc: "Maximum jump distance in pixels", type: "number", initialValue: "192" }
  ]
}, function(value) {
  this.maxJumpDistance = value;
});

action("Configuration", "SetMaxFallDistance", {
  listName: "Set max fall distance",
  displayText: "Set max fall distance to {0} px",
  description: "Override the auto-calculated maximum fall distance. The navigation graph must be regenerated after changing this for the new value to take effect.",
  params: [
    { id: "value", name: "Distance (px)", desc: "Maximum fall distance in pixels", type: "number", initialValue: "256" }
  ]
}, function(value) {
  this.maxFallDistance = value;
});

