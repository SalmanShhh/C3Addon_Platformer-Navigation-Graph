# Platformer Navigation Graph - Testing Examples & C3 Events

This guide provides step-by-step examples to test every feature of the Platformer Navigation Graph addon.

## Basic Setup & Requirements

### Required Objects:
1. **Player** sprite with **Platform** behavior
2. **AI Enemy** sprite with **Platform** behavior + **Platformer Navigation Graph** behavior
3. **Solid** platforms (sprites with Solid behavior)
4. Optional: **Pathfinding** behavior object for obstacle map copying

### Recommended Layout Setup:
- Simple platformer level with platforms at different heights
- Some gaps that require jumping
- Some drops that require falling
- Clear start and target positions

---

## 1. BASIC PATHFINDING TESTS

### Test 1.1: Simple Path Following
**Purpose:** Test basic AI movement from point A to point B

**Events:**
```
System: On start of layout
├─ AI Enemy: Regenerate navigation graph

AI Enemy: On navigation graph generated
└─ AI Enemy: Find path to (Player.X, Player.Y)

// Visual feedback
AI Enemy: On path found
└─ Action: Set text to "AI is moving to target"

AI Enemy: On path complete
└─ Action: Set text to "AI reached target"

AI Enemy: On path failed
└─ Action: Set text to "No path found: " & AI Enemy.PathFailReason
```

### Test 1.2: Click-to-Move
**Purpose:** Test interactive pathfinding

**Events:**
```
Mouse: On left button clicked
└─ AI Enemy: Find path to (Mouse.X, Mouse.Y) [Ground correction: yes] [Mode: reach]

Touch: On tap gesture
└─ AI Enemy: Find path to (Touch.X, Touch.Y) [Ground correction: yes] [Mode: reach]
```

### Test 1.3: Following Player
**Purpose:** Test continuous pathfinding with re-pathing

**Events:**
```
System: Every 2 seconds
├─ Condition: distance(AI Enemy.X, AI Enemy.Y, Player.X, Player.Y) > 100
└─ AI Enemy: Find path to (Player.X, Player.Y) [Ground correction: yes] [Mode: reach]

AI Enemy: On re-path triggered
└─ Action: Set text to "Re-pathing..."
```

### Test 1.4: FindPath Modes
**Purpose:** Test the two pathfinding modes (reach, nearest)

**Events:**
```
// Reach mode: AI walks all the way to the target
Keyboard: On 1 pressed
└─ AI Enemy: Find path to (Player.X, Player.Y) [Ground correction: yes] [Mode: reach]

// Nearest mode: AI gets as close as possible (useful when target is unreachable)
Keyboard: On 2 pressed
└─ AI Enemy: Find path to (Player.X, Player.Y) [Ground correction: yes] [Mode: nearest]
```

### Test 1.5: Stop Pathfinding
**Purpose:** Test path cancellation

**Events:**
```
Keyboard: On Escape pressed
└─ AI Enemy: Stop pathfinding

// Verify path is cleared
System: Every tick
├─ Condition: AI Enemy: Has active path
├─ Action: Set text to "Moving | Waypoint " & AI Enemy.CurrentWaypoint & "/" & AI Enemy.WaypointCount
```

---

## 2. OBSTACLE MAP TESTS

### Test 2.1: Copy from Pathfinding Behavior
**Purpose:** Test automatic obstacle detection from C3's built-in Pathfinding behavior

**Setup:** Add Pathfinding behavior to a dummy object (e.g. the AI or a separate sprite)

**Events:**
```
System: On start of layout
└─ AI Enemy: Use Pathfinding obstacle map [Auto-regenerate: yes]

AI Enemy: On Pathfinding map ready
└─ Action: Set text to "Map ready! Source: " & AI Enemy.ObstacleMapSource

AI Enemy: On Pathfinding map failed
└─ Action: Set text to "Map setup failed"

AI Enemy: On Pathfinding map timeout
└─ Action: Set text to "Map setup timed out"
```

### Test 2.2: Manual Obstacle Map
**Purpose:** Test custom obstacle map creation

**Events:**
```
System: On start of layout
├─ AI Enemy: Create custom obstacle map [Width: 20 tiles] [Height: 15 tiles]
├─ AI Enemy: Set tile at (5, 5) to solid
├─ AI Enemy: Set tile at (6, 5) to solid
├─ AI Enemy: Set tile at (7, 5) to solid
├─ AI Enemy: Set tile at (5, 10) to jump-thru
└─ AI Enemy: Generate navigation graph from obstacle map

// Save/load obstacle map
Keyboard: On S pressed
└─ LocalStorage: Set item "navmap" to AI Enemy.ObstacleMapJSON

Keyboard: On L pressed
├─ AI Enemy: Load obstacle map from JSON LocalStorage.ItemValue("navmap")
└─ AI Enemy: Generate navigation graph from obstacle map
```

### Test 2.3: Dynamic Obstacle Changes
**Purpose:** Test runtime obstacle modification

**Events:**
```
// Add solid obstacle where clicked
Mouse: On left button clicked
├─ AI Enemy: Set tile at world (Mouse.X, Mouse.Y) to solid
└─ AI Enemy: Regenerate navigation graph

// Remove obstacle on right click
Mouse: On right button clicked
├─ AI Enemy: Set tile at world (Mouse.X, Mouse.Y) to clear
└─ AI Enemy: Regenerate navigation graph

// Check tile state
Keyboard: On T pressed
└─ Action: Set text to "Tile state: " & AI Enemy.TileState(AI Enemy.WorldToGridX(Mouse.X), AI Enemy.WorldToGridY(Mouse.Y))
```

### Test 2.4: Tile State Types
**Purpose:** Test all tile state types

**Events:**
```
// Set different tile types
Keyboard: On 1 pressed
└─ AI Enemy: Set tile at world (Mouse.X, Mouse.Y) to solid

Keyboard: On 2 pressed
└─ AI Enemy: Set tile at world (Mouse.X, Mouse.Y) to jump-thru

Keyboard: On 3 pressed
└─ AI Enemy: Set tile at world (Mouse.X, Mouse.Y) to avoid

Keyboard: On 4 pressed
└─ AI Enemy: Set tile at world (Mouse.X, Mouse.Y) to slope-left

Keyboard: On 5 pressed
└─ AI Enemy: Set tile at world (Mouse.X, Mouse.Y) to slope-right

Keyboard: On 0 pressed
└─ AI Enemy: Set tile at world (Mouse.X, Mouse.Y) to clear

// Check state with conditions
System: Every tick
├─ Condition: AI Enemy: Tile at world (Mouse.X, Mouse.Y) has state solid
└─ Action: Set text to "Hovering over: SOLID"
```

---

## 3. HAZARD SYSTEM TESTS

### Test 3.1: Rectangle Hazards
**Purpose:** Test rectangular danger zones

**Setup:** Create red rectangle sprites to visualize hazards

**Events:**
```
System: On start of layout
├─ For each HazardZone:
│   └─ AI Enemy: Add rectangle hazard at (HazardZone.X, HazardZone.Y)
│                 size (HazardZone.Width, HazardZone.Height) severity 5.0

// Check hazard at position
Mouse: On left button clicked
├─ Condition: AI Enemy: Is position (Mouse.X, Mouse.Y) hazardous
├─ Action: Set text to "HAZARDOUS! Severity: " & AI Enemy.HazardSeverity(Mouse.X, Mouse.Y)

Mouse: On left button clicked
├─ Condition: NOT AI Enemy: Is position (Mouse.X, Mouse.Y) hazardous
└─ Action: Set text to "Safe"
```

### Test 3.2: Circle Hazards
**Purpose:** Test circular danger zones

**Events:**
```
System: On start of layout
├─ For each CircleHazard:
│   └─ AI Enemy: Add circle hazard at (CircleHazard.X, CircleHazard.Y)
│                radius CircleHazard.Width/2 severity 3.0

// Dynamic hazard creation on keypress
Keyboard: On H pressed
└─ AI Enemy: Add circle hazard at (Mouse.X, Mouse.Y) radius 64 severity 4.0

// Clear all hazards
Keyboard: On C pressed
└─ AI Enemy: Clear all circle and rectangle hazards
```

### Test 3.3: Tile-based Hazards
**Purpose:** Test per-tile hazard severity

**Events:**
```
// Mark tiles as hazardous
Mouse: On left button clicked
└─ AI Enemy: Set tile hazard at (AI Enemy.WorldToGridX(Mouse.X), AI Enemy.WorldToGridY(Mouse.Y)) to 5.0

// Clear tile hazards
Keyboard: On C pressed
└─ AI Enemy: Clear all tile hazards

// Check tile hazard severity
System: Every tick
└─ Action: Set text to "Tile hazard: " & AI Enemy.TileHazardSeverity(AI Enemy.WorldToGridX(Mouse.X), AI Enemy.WorldToGridY(Mouse.Y))
```

### Test 3.4: Hazard Radius
**Purpose:** Test how hazard radius affects pathfinding avoidance distance

**Events:**
```
// Increase hazard avoidance radius
Keyboard: On + pressed
└─ AI Enemy: Set hazard radius to AI Enemy.HazardRadius + 1

// Decrease hazard avoidance radius
Keyboard: On - pressed
└─ AI Enemy: Set hazard radius to max(0, AI Enemy.HazardRadius - 1)

System: Every tick
└─ Action: Set text to "Hazard radius: " & AI Enemy.HazardRadius & " tiles"
```

---

## 4. PORTAL SYSTEM TESTS

### Test 4.1: Instant Portal (One-Way, Coordinates)
**Purpose:** Test basic instant teleportation

**Events:**
```
System: On start of layout
├─ AI Enemy: Add one-way instant portal from (100, 200) to (500, 100) [Cost: 1]
└─ Action: Set variable PortalID to AI Enemy.LastPortalID

// AI can path from entry to exit, but NOT from exit back to entry
Mouse: On left button clicked
└─ AI Enemy: Find path to (Mouse.X, Mouse.Y) [Ground correction: yes] [Mode: reach]

System: Every tick
└─ Action: Set text to "Portal count: " & AI Enemy.PortalCount & " | Last ID: " & AI Enemy.LastPortalID
```

### Test 4.2: Two-Way Instant Portal (From Objects)
**Purpose:** Test bidirectional instant teleportation using object positions

**Setup:** Place TeleportEntry and TeleportExit sprites in the layout

**Events:**
```
System: On start of layout
├─ AI Enemy: Add two-way instant portal from TeleportEntry to TeleportExit [Cost: 1]
└─ Action: Set variable PortalID to AI Enemy.LastPortalID

// AI can path in BOTH directions through this portal
Mouse: On left button clicked
└─ AI Enemy: Find path to (Mouse.X, Mouse.Y) [Ground correction: yes] [Mode: reach]

// Remove portal using object reference (works with entry OR exit object)
Keyboard: On R pressed
└─ AI Enemy: Remove portal at TeleportEntry
```

### Test 4.3: Gradual Portal (Ladder/Elevator Replacement)
**Purpose:** Test gradual movement portals for vertical traversal

**Setup:** Place LadderBottom and LadderTop sprites at the bottom and top of a vertical connection

**Events:**
```
System: On start of layout
├─ // Two-way gradual portal acts like a ladder — character moves linearly at given speed
├─ AI Enemy: Add two-way gradual portal from (LadderBottom.X, LadderBottom.Y) to (LadderTop.X, LadderTop.Y) [Cost: 1] [Speed: 150]

Mouse: On left button clicked
└─ AI Enemy: Find path to (Mouse.X, Mouse.Y) [Ground correction: yes] [Mode: reach]

// Monitor traversal progress
System: Every tick
├─ Condition: AI Enemy: Is traversing portal
└─ Action: Set text to "Traversing... Progress: " & round(AI Enemy.PortalProgress * 100) & "%"
```

### Test 4.4: Pause/Resume Flow (Animated Teleporter)
**Purpose:** Test pausing at portal entry to play custom animations before executing

**Events:**
```
System: On start of layout
├─ AI Enemy: Add one-way instant portal from (100, 200) to (500, 100) [Cost: 1]

AI Enemy: On portal entry
├─ AI Enemy: Pause at portal
├─ Action: Set AI Enemy animation to "Teleport"
├─ Action: Wait 0.5 seconds
└─ AI Enemy: Resume portal
// Built-in instant teleport executes after resume

AI Enemy: On portal complete
└─ Action: Set AI Enemy animation to "Idle"
```

### Test 4.5: Pause/Complete Flow (Custom Movement)
**Purpose:** Test fully custom portal behavior where the user handles movement

**Events:**
```
System: On start of layout
├─ AI Enemy: Add one-way instant portal from (100, 200) to (500, 100) [Cost: 1]

AI Enemy: On portal entry
├─ AI Enemy: Pause at portal
├─ // User handles movement manually (e.g. physics launch, cutscene, rope swing)
├─ Action: Play "WarpEffect" animation
├─ Action: Wait 1.0 seconds
├─ AI Enemy: Teleport to position (AI Enemy.PortalExitX, AI Enemy.PortalExitY)
└─ AI Enemy: Complete portal
// Built-in behavior is skipped, path continues from current position

AI Enemy: On portal complete
└─ Action: Set text to "Custom portal complete!"
```

### Test 4.6: Elevator Group Helper
**Purpose:** Test multi-floor elevator setup with automatic pairwise portal creation

**Setup:** Place Floor1Marker, Floor2Marker, Floor3Marker sprites at each elevator floor

**Events:**
```
System: On start of layout
├─ AI Enemy: Add elevator stop to group "elevator_A" at Floor1Marker [Speed: 200]
├─ AI Enemy: Add elevator stop to group "elevator_A" at Floor2Marker [Speed: 200]
├─ AI Enemy: Add elevator stop to group "elevator_A" at Floor3Marker [Speed: 200]
// Creates 3 pairwise two-way gradual portals: Floor1↔Floor2, Floor1↔Floor3, Floor2↔Floor3

AI Enemy: On portal entry
├─ // Determine which floor the AI is heading to
├─ Condition: AI Enemy.PortalExitY = Floor1Marker.Y
│   └─ Action: Set text to "Heading to Floor 1"
├─ Condition: AI Enemy.PortalExitY = Floor2Marker.Y
│   └─ Action: Set text to "Heading to Floor 2"
├─ Condition: AI Enemy.PortalExitY = Floor3Marker.Y
│   └─ Action: Set text to "Heading to Floor 3"

// Optional: pause to close doors before moving
AI Enemy: On portal entry
├─ AI Enemy: Pause at portal
├─ Action: Play "DoorClose" animation
├─ Action: Wait 0.5 seconds
└─ AI Enemy: Resume portal
// Gradual movement begins

AI Enemy: On portal complete
└─ Action: Play "DoorOpen" animation
```

### Test 4.7: Portal Configuration
**Purpose:** Test portal cost, speed, and hazard settings

**Events:**
```
System: On start of layout
├─ AI Enemy: Add one-way instant portal from (100, 200) to (500, 100) [Cost: 1]
├─ Action: Set variable MyPortalID to AI Enemy.LastPortalID

// Make portal expensive (AI avoids it unless necessary)
Keyboard: On 1 pressed
└─ AI Enemy: Set portal MyPortalID cost to 50

// Make portal cheap (AI prefers it)
Keyboard: On 2 pressed
└─ AI Enemy: Set portal MyPortalID cost to 0.5

// Toggle hazard ignoring
Keyboard: On 3 pressed
└─ AI Enemy: Set portal MyPortalID ignore hazards: yes

// Change speed (only affects gradual portals)
Keyboard: On 4 pressed
└─ AI Enemy: Set portal MyPortalID speed to 200

// Check portal type
System: Every tick
└─ Action: Set text to "Portal type: " & AI Enemy.PortalType(MyPortalID)
```

### Test 4.8: Portal Management
**Purpose:** Test adding and removing portals

**Events:**
```
// Add portal at mouse position
Keyboard: On P pressed
├─ AI Enemy: Add one-way instant portal from (Mouse.X, Mouse.Y) to (Mouse.X + 300, Mouse.Y) [Cost: 1]
└─ Action: Set text to "Portal added, ID: " & AI Enemy.LastPortalID

// Remove specific portal
Keyboard: On R pressed
└─ AI Enemy: Remove portal with ID MyPortalID

// Remove portal at object (works with entry OR exit position)
Keyboard: On O pressed
└─ AI Enemy: Remove portal at TeleportEntry

// Clear all portals
Keyboard: On X pressed
└─ AI Enemy: Clear all portals
```

### Test 4.9: Portal State Conditions
**Purpose:** Test portal state checking conditions and expressions

**Events:**
```
System: Every tick
├─ Condition: AI Enemy: Is at portal
│   └─ Action: Set text to "Paused at portal " & AI Enemy.CurrentPortalID & " — waiting for Resume/Complete"
├─ Condition: AI Enemy: Is traversing portal
│   └─ Action: Set text to "Traversing portal... " & round(AI Enemy.PortalProgress * 100) & "% | Exit: (" & AI Enemy.PortalExitX & ", " & AI Enemy.PortalExitY & ")"
```

### Test 4.10: Teleport to Position (Standalone Utility)
**Purpose:** Test the standalone teleport action (usable anywhere, not just portals)

**Events:**
```
// Teleport on keypress
Keyboard: On T pressed
└─ AI Enemy: Teleport to position (Mouse.X, Mouse.Y)
// Suppresses re-pathing for one tick to prevent AI from thinking it's lost

// Use inside portal events for custom portal behavior
AI Enemy: On portal entry
├─ AI Enemy: Pause at portal
├─ Action: Wait 0.3 seconds
├─ AI Enemy: Teleport to position (AI Enemy.PortalExitX, AI Enemy.PortalExitY)
└─ AI Enemy: Complete portal
```

---

## 5. PATH STRATEGY TESTS

### Test 5.1: Compare Path Strategies
**Purpose:** Test how different strategies affect path choice

**Events:**
```
// Balanced: good mix of speed and safety
Keyboard: On 1 pressed
├─ AI Enemy: Set path strategy to balanced
└─ AI Enemy: Find path to (Player.X, Player.Y)

// Shortest: fewest nodes, most direct route
Keyboard: On 2 pressed
├─ AI Enemy: Set path strategy to shortest
└─ AI Enemy: Find path to (Player.X, Player.Y)

// Safest: avoids hazards and risky jumps
Keyboard: On 3 pressed
├─ AI Enemy: Set path strategy to safest
└─ AI Enemy: Find path to (Player.X, Player.Y)

// Simplest: prefers walking, fewer jumps/falls
Keyboard: On 4 pressed
├─ AI Enemy: Set path strategy to simplest
└─ AI Enemy: Find path to (Player.X, Player.Y)

System: Every tick
└─ Action: Set text to "Strategy: " & AI Enemy.PathStrategy & " | Cost: " & AI Enemy.PathCost
```

---

## 6. STRICT JUMP POSITIONING TESTS

### Test 6.1: Property Toggle
**Purpose:** Compare movement with strict positioning on/off

**Events:**
```
// Enable strict positioning (careful jumps)
Keyboard: On 1 pressed
├─ AI Enemy: Set strict jump positioning: yes
└─ Action: Set text to "Strict: ON — AI will slow down before jumps"

// Disable strict positioning (fast but may overshoot)
Keyboard: On 2 pressed
├─ AI Enemy: Set strict jump positioning: no
└─ Action: Set text to "Strict: OFF — AI moves at full speed"

System: Every tick
└─ Action: Set text to "Strict positioning: " & (AI Enemy.StrictJumpPositioning = 1 ? "ON" : "OFF")
```

### Test 6.2: Per-Path Override
**Purpose:** Test strict/relaxed override on FindPath

**Events:**
```
// Use default (property setting)
Keyboard: On 1 pressed
└─ AI Enemy: Find path to (Player.X, Player.Y) [Ground correction: yes] [Mode: reach] [Jump positioning: default]

// Force strict for this path (careful)
Keyboard: On 2 pressed
└─ AI Enemy: Find path to (Player.X, Player.Y) [Ground correction: yes] [Mode: reach] [Jump positioning: strict]

// Force relaxed for this path (fast, reckless)
Keyboard: On 3 pressed
└─ AI Enemy: Find path to (Player.X, Player.Y) [Ground correction: yes] [Mode: reach] [Jump positioning: relaxed]
```

---

## 7. LEDGE & EDGE DETECTION TESTS

### Test 7.1: Ledge Restriction
**Purpose:** Test preventing AI from walking off edges

**Events:**
```
// Enable ledge restriction (AI stays on platform)
Keyboard: On 1 pressed
├─ AI Enemy: Set ledge restriction: yes
└─ AI Enemy: Stop pathfinding

// Disable ledge restriction (AI can walk off edges freely)
Keyboard: On 2 pressed
└─ AI Enemy: Set ledge restriction: no

// Adjust leniency (how far past the edge AI can go)
Keyboard: On + pressed
└─ AI Enemy: Set ledge leniency to AI Enemy.LedgeLeniency + 5

Keyboard: On - pressed
└─ AI Enemy: Set ledge leniency to max(0, AI Enemy.LedgeLeniency - 5)

System: Every tick
└─ Action: Set text to "Ledge restriction: " & (AI Enemy.LedgeRestriction = 1 ? "ON" : "OFF") & " | Leniency: " & AI Enemy.LedgeLeniency & "px"
```

### Test 7.2: Ledge & Island Detection
**Purpose:** Test edge detection conditions

**Events:**
```
System: Every tick
├─ Condition: AI Enemy: Is at ledge
└─ Action: Set text to "AT LEDGE!"

System: Every tick
├─ Condition: AI Enemy: Is at island
└─ Action: Set text to "ON ISLAND (single-tile platform)"
```

---

## 8. COYOTE TIME TESTS

### Test 8.1: Coyote Jump Timing
**Purpose:** Test the coyote time window for jumping after leaving a ledge

**Events:**
```
// Set coyote time
Keyboard: On 1 pressed
└─ AI Enemy: Set coyote time to 0.1 seconds

Keyboard: On 2 pressed
└─ AI Enemy: Set coyote time to 0.2 seconds

Keyboard: On 3 pressed
└─ AI Enemy: Set coyote time to 0 seconds

System: Every tick
└─ Action: Set text to "Coyote time: " & AI Enemy.CoyoteTime & "s | Timer: " & AI Enemy.CoyoteTimer & "s"
```

---

## 9. DEBUGGING & TUNING TESTS

### Test 9.1: Jump Capability Testing
**Purpose:** Verify jump height/distance calculations

**Events:**
```
Keyboard: On D pressed
├─ Action: Set text to "=== JUMP INFO ==="
├─ Action: Append newline & "Platform Jump Strength: " & AI Enemy.PlatformJumpStrength
├─ Action: Append newline & "Platform Max Speed: " & AI Enemy.PlatformMaxSpeed
├─ Action: Append newline & "Calculated Jump Height: " & AI Enemy.CalculatedJumpHeight
├─ Action: Append newline & "Calculated Jump Distance: " & AI Enemy.CalculatedJumpDistance
```

### Test 9.2: Override Jump/Fall Limits
**Purpose:** Test manual jump/fall configuration

**Events:**
```
// Override calculated values
Keyboard: On J pressed
├─ AI Enemy: Set max jump height to 200
├─ AI Enemy: Set max jump distance to 300
├─ AI Enemy: Set max fall distance to 400
└─ AI Enemy: Regenerate navigation graph
```

### Test 9.3: Grid Visualization
**Purpose:** Visualize the navigation grid and nodes

**Events:**
```
AI Enemy: On navigation graph generated
└─ Action: Set text to "Grid: " & AI Enemy.GridWidth & "x" & AI Enemy.GridHeight & " | Nodes: " & AI Enemy.NodeCount

// Log full stats to browser console
Keyboard: On G pressed
└─ AI Enemy: Log navigation graph statistics to console

// Check specific node info
Mouse: On left button clicked
├─ Local gx = AI Enemy.WorldToGridX(Mouse.X)
├─ Local gy = AI Enemy.WorldToGridY(Mouse.Y)
├─ Condition: AI Enemy: Node exists at grid (gx, gy)
├─ Action: Set text to "Node at (" & gx & "," & gy & ")"
├─ Action: Append " | Connections: " & AI Enemy.NodeConnectionCount(gx, gy)
├─ Action: Append " | Left ledge: " & AI Enemy.IsNodeLeftLedge(gx, gy)
├─ Action: Append " | Right ledge: " & AI Enemy.IsNodeRightLedge(gx, gy)
└─ Action: Append " | Island: " & AI Enemy.IsNodeIsland(gx, gy)
```

### Test 9.4: Path Info Display
**Purpose:** Display detailed path information

**Events:**
```
AI Enemy: On path found
├─ Action: Set text to "Path found!"
├─ Action: Append newline & "Waypoints: " & AI Enemy.WaypointCount
├─ Action: Append newline & "Cost: " & AI Enemy.PathCost
├─ Action: Append newline & "Target: (" & AI Enemy.PathTargetX("corrected") & ", " & AI Enemy.PathTargetY("corrected") & ")"

AI Enemy: On waypoint reached
├─ Action: Set text to "Waypoint " & AI Enemy.CurrentWaypoint & "/" & AI Enemy.WaypointCount
├─ Action: Append newline & "Position: (" & AI Enemy.CurrentWaypointX & ", " & AI Enemy.CurrentWaypointY & ")"
├─ Action: Append newline & "Action: " & AI Enemy.CurrentPathAction(AI Enemy.CurrentWaypoint)
├─ Action: Append newline & "Angle to next: " & AI Enemy.AngleToWaypoint
├─ Action: Append newline & "Distance to next: " & AI Enemy.DistanceToWaypoint

AI Enemy: On path failed
└─ Action: Set text to "Path failed: " & AI Enemy.PathFailReason

AI Enemy: On waypoint stuck
└─ Action: Set text to "Stuck at waypoint " & AI Enemy.CurrentWaypoint
```

---

## 10. MULTI-AGENT TESTS

### Test 10.1: Shared Graph Mode
**Purpose:** Test multiple AI characters sharing a navigation graph

**Setup:** Create multiple AI sprites

**Events:**
```
System: On start of layout
├─ AI1: Regenerate navigation graph
// AI2 uses shared graph automatically (default graph mode)

// Both should use same graph
Mouse: On left button clicked
├─ AI1: Find path to (Mouse.X, Mouse.Y)
└─ AI2: Find path to (Mouse.X, Mouse.Y)
```

### Test 10.2: Multi-Agent Avoidance
**Purpose:** Test AI characters avoiding each other

**Events:**
```
System: On start of layout
├─ AI Enemy: Set multi-agent avoidance: yes

System: Every tick
├─ Condition: AI Enemy: Multi-agent avoidance is enabled
└─ Action: Set text to "Avoidance ON | Nearby agents: " & AI Enemy.NearbyAgentCount
```

---

## 11. MANUAL MOVEMENT CONTROL

### Test 11.1: Auto-Control Disabled
**Purpose:** Test with auto-control disabled for custom movement handling

**Events:**
```
System: On start of layout
└─ AI Enemy: Set auto-control: no

// Handle movement manually using waypoint info
System: Every tick
├─ Condition: AI Enemy: Has active path
├─ Sub-event: AI Enemy.CurrentWaypointX < AI Enemy.X
│   └─ Action: AI Enemy.Platform: Simulate pressing Left
├─ Sub-event: AI Enemy.CurrentWaypointX > AI Enemy.X
│   └─ Action: AI Enemy.Platform: Simulate pressing Right
```

### Test 11.2: Jump Toward Position
**Purpose:** Test the jump-toward action for attacks and lunges

**Events:**
```
// Simple: jump toward the player on collision
AI Enemy: On collision with Player
└─ AI Enemy: Jump toward (Player.X, Player.Y)

// Trigger fires when the jump launches
AI Enemy: On jump toward launched
├─ Action: Set AI Enemy animation to "Attack"
├─ Action: Set text to "Lunging at: (" & AI Enemy.JumpTowardTargetX & ", " & AI Enemy.JumpTowardTargetY & ")"

// Example: jump toward mouse click
Mouse: On left button clicked
└─ AI Enemy: Jump toward (Mouse.X, Mouse.Y)
```

**Notes:**
- The character must be on the floor or have double jump enabled to jump
- Any active path is cancelled when this action executes
- The character moves horizontally toward the target throughout the jump arc
- `JumpTowardTargetX/Y` expressions return the target position

---

## 12. RE-PATHING & COOLDOWN TESTS

### Test 12.1: Re-Path Threshold
**Purpose:** Test how the re-path threshold affects path recalculation

**Events:**
```
// Set re-path threshold (how far target must move before re-pathing)
Keyboard: On 1 pressed
└─ AI Enemy: Set re-path threshold to 2

Keyboard: On 2 pressed
└─ AI Enemy: Set re-path threshold to 5

Keyboard: On 3 pressed
└─ AI Enemy: Set re-path threshold to 10

// Set re-path cooldown
Keyboard: On C pressed
└─ AI Enemy: Set re-path cooldown to 1.0 seconds

System: Every tick
└─ Action: Set text to "Re-path threshold: " & AI Enemy.RePathThreshold & " tiles | Cooldown: " & AI Enemy.RePathCooldown & "s"
```

---

## 13. SLOPE TESTS

### Test 13.1: Slope Marking
**Purpose:** Test slope tile markings

**Events:**
```
// Mark slopes
Keyboard: On L pressed
└─ AI Enemy: Set tile at world (Mouse.X, Mouse.Y) to slope-left

Keyboard: On R pressed
└─ AI Enemy: Set tile at world (Mouse.X, Mouse.Y) to slope-right

// Check slope direction
System: Every tick
├─ Local gx = AI Enemy.WorldToGridX(Mouse.X)
├─ Local gy = AI Enemy.WorldToGridY(Mouse.Y)
└─ Action: Set text to "Slope: " & AI Enemy.SlopeDirection(gx, gy)

// Clear all slopes
Keyboard: On C pressed
└─ AI Enemy: Clear all slope markings
```

---

## 14. COMPLETE INTEGRATION TEST

### Test 14.1: Full Feature Demo
**Purpose:** Comprehensive test of all systems working together

**Setup:**
- Complex level with multiple platforms at different heights
- Hazard zones (spikes, lava)
- Teleporter sprites (entry/exit pairs)
- Elevator floor markers at different heights
- Multiple AI characters

**Events:**
```
System: On start of layout
└─ Call Function "SetupLevel"

Function: SetupLevel
├─ AI Enemy: Use Pathfinding obstacle map [Auto-regenerate: yes]

AI Enemy: On Pathfinding map ready
├─ // Add hazards
├─ For each SpikeSprite:
│   └─ AI Enemy: Add rectangle hazard at (SpikeSprite.X, SpikeSprite.Y) size (SpikeSprite.Width, SpikeSprite.Height) severity 10
├─ // Add instant portals (teleporters)
├─ For each TeleportEntry:
│   ├─ AI Enemy: Add two-way instant portal from TeleportEntry to TeleportExit [Cost: 2]
├─ // Add gradual portals (ladders/ropes)
├─ For each LadderSprite:
│   └─ AI Enemy: Add two-way gradual portal from (LadderSprite.X, LadderSprite.BBoxBottom) to (LadderSprite.X, LadderSprite.BBoxTop) [Cost: 1] [Speed: 150]
├─ // Add elevator
├─ AI Enemy: Add elevator stop to group "elevator_A" at Floor1Marker [Speed: 200]
├─ AI Enemy: Add elevator stop to group "elevator_A" at Floor2Marker [Speed: 200]
├─ AI Enemy: Add elevator stop to group "elevator_A" at Floor3Marker [Speed: 200]

// Portal events
AI Enemy: On portal entry
├─ AI Enemy: Pause at portal
├─ Action: Play appropriate animation
├─ Action: Wait 0.3 seconds
└─ AI Enemy: Resume portal

AI Enemy: On portal complete
└─ Action: Set animation to "Idle"

// AI chases player
System: Every 2 seconds
├─ Condition: distance(AI Enemy.X, AI Enemy.Y, Player.X, Player.Y) > 80
└─ AI Enemy: Find path to (Player.X, Player.Y) [Ground correction: yes] [Mode: reach]

// HUD
System: Every tick
├─ Action: Set HUD text to "Portals: " & AI Enemy.PortalCount
├─ Action: Append " | Hazards: " & AI Enemy.HazardCount
├─ Action: Append " | Nodes: " & AI Enemy.NodeCount
├─ Action: Append " | Strategy: " & AI Enemy.PathStrategy
```

---

## Quick Testing Checklist

### Basic Features:
- [ ] Path finding works (reach, nearest modes)
- [ ] Auto-movement works
- [ ] Manual control works
- [ ] Stop pathfinding works
- [ ] Re-pathing triggers correctly
- [ ] Jump toward position works — character lunges horizontally toward target
- [ ] Jump toward works mid-air with double jump enabled
- [ ] On jump toward launched trigger fires
- [ ] JumpTowardTargetX/Y expressions return correct values

### Obstacle System:
- [ ] Copy from Pathfinding behavior
- [ ] Custom obstacle map (create, set tiles, clear)
- [ ] Dynamic obstacle changes at runtime
- [ ] Save/load obstacle maps (JSON)
- [ ] Tile state conditions work (solid, clear, jump-thru, avoid, slope)

### Hazard System:
- [ ] Rectangle hazards affect path choice
- [ ] Circle hazards affect path choice
- [ ] Tile hazards affect path choice
- [ ] Hazard severity affects avoidance strength
- [ ] Hazard radius setting works
- [ ] Clear hazards works (circle/rect and tile separately)

### Portal System:
- [ ] One-way instant portals work (entry to exit only)
- [ ] Two-way instant portals work (both directions)
- [ ] Gradual portals work (linear movement from entry to exit)
- [ ] Add portal from coordinates works
- [ ] Add portal from objects works
- [ ] Remove portal by ID works
- [ ] Remove portal at object works (entry or exit position)
- [ ] Set portal cost affects path choice
- [ ] Set portal speed works (gradual portals)
- [ ] Set portal ignore hazards works
- [ ] LastPortalID expression returns correct ID
- [ ] Clear all portals works
- [ ] Pause at portal works (inside OnPortalEntry)
- [ ] Resume portal executes built-in behavior
- [ ] Complete portal skips built-in behavior
- [ ] OnPortalEntry trigger fires before execution
- [ ] OnPortalComplete trigger fires after execution
- [ ] IsAtPortal condition works during pause
- [ ] IsTraversingPortal condition works during gradual movement
- [ ] PortalProgress expression works (0-1)
- [ ] PortalExitX/PortalExitY expressions work in triggers
- [ ] PortalType expression returns "instant" or "gradual"
- [ ] Elevator group helper creates pairwise portals
- [ ] TeleportToPosition works as standalone utility

### Path Strategies:
- [ ] Balanced strategy works
- [ ] Shortest strategy works
- [ ] Safest strategy works
- [ ] Simplest strategy works

### Strict Jump Positioning:
- [ ] Property default works
- [ ] ACE toggle works at runtime
- [ ] FindPath strict override works
- [ ] FindPath relaxed override works
- [ ] AI slows down before jumps when strict
- [ ] AI moves at full speed when relaxed

### Ledge Features:
- [ ] Ledge restriction prevents walking off edges
- [ ] Ledge leniency adjusts edge tolerance
- [ ] IsAtLedge condition detects edges
- [ ] IsAtIsland condition detects single-tile platforms

### Multi-Agent:
- [ ] Shared graph mode works
- [ ] Multi-agent avoidance works
- [ ] Multiple AI characters path independently

### Edge Cases:
- [ ] No valid path handling (PathFailReason)
- [ ] Character gets stuck recovery (OnWaypointStuck)
- [ ] Level layout changes (re-generate graph)
- [ ] Coyote jumps across gaps

---

## Common Issues & Solutions

**Issue: AI doesn't move**
- Check Auto-Control is enabled (or handle movement manually)
- Verify obstacle map is generated (wait for OnPathfindingMapReady or OnNavigationGraphGenerated)
- Ensure target position is reachable (check PathFailReason)
- Make sure Platform behavior is enabled (IsPlatformEnabled condition)

**Issue: AI takes strange paths**
- Check jump/fall distance settings match Platform behavior
- Verify hazard zones aren't blocking optimal paths
- Try different path strategies (balanced vs shortest)
- Regenerate navigation graph after layout changes

**Issue: AI overshoots jumps / falls off ledges**
- Enable Strict Jump Positioning (property or ACE)
- Enable Ledge Restriction if AI shouldn't leave platforms voluntarily
- Increase coyote time for gap jumps

**Issue: AI can't reach target**
- Check if path exists (use "nearest" mode to see how close AI can get)
- Verify jump height/distance settings are large enough
- Add gradual portals to connect unreachable areas (replaces ladders)
- Test with debug visualization (Log graph stats to console)

**Issue: Performance problems**
- Use larger Cell Size (fewer nodes)
- Reduce Max Search Nodes
- Limit hazard count
- Don't regenerate graph too frequently
- Use shared graph mode for multiple AI characters

**Issue: Portals not working**
- Check that portals were added AFTER the graph was generated
- Verify entry/exit positions are near walkable nodes
- Check portal cost isn't too high (AI may prefer walking)
- Use Log graph stats to verify portal connections

**Issue: Portal stays paused**
- Make sure you call "Resume portal" or "Complete portal" after "Pause at portal"
- "Pause at portal" must be called inside "On portal entry" — calling it elsewhere has no effect
- A warning appears in the console after 5+ seconds if a portal stays paused
