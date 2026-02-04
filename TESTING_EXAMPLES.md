# Platformer Navigation Graph - Testing Examples & C3 Events

This guide provides step-by-step examples to test every feature of the Platformer Navigation Graph addon.

## 🎯 Basic Setup & Requirements

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

## 🚀 1. BASIC PATHFINDING TESTS

### Test 1.1: Simple Path Following
**Purpose:** Test basic AI movement from point A to point B

**Events:**
```
System: On start of layout
├─ AI Enemy: Regenerate navigation graph
├─ Wait 0.1 seconds
└─ AI Enemy: Find path to (Player.X, Player.Y)

// Optional: Visual feedback
System: Every tick
├─ Condition: AI Enemy: Has active path
└─ Action: Set text to "AI is moving to target"

System: Every tick  
├─ Condition: NOT AI Enemy: Has active path
└─ Action: Set text to "AI reached target or stuck"
```

### Test 1.2: Click-to-Move
**Purpose:** Test interactive pathfinding

**Events:**
```
Mouse: On left button clicked
└─ AI Enemy: Find path to (Mouse.X, Mouse.Y)

Touch: On tap gesture
└─ AI Enemy: Find path to (Touch.X, Touch.Y)
```

### Test 1.3: Following Player
**Purpose:** Test continuous pathfinding

**Events:**
```
System: Every 2 seconds
├─ Condition: System: Distance(AI Enemy.X, AI Enemy.Y, Player.X, Player.Y) > 100
└─ AI Enemy: Find path to (Player.X, Player.Y)
```

---

## 🗺️ 2. OBSTACLE MAP TESTS

### Test 2.1: Copy from Pathfinding Behavior
**Purpose:** Test automatic obstacle detection

**Setup:** Add Pathfinding behavior to a dummy object

**Events:**
```
System: On start of layout
├─ AI Enemy: Copy obstacle map from Pathfinding behavior
├─ Wait 0.1 seconds
└─ AI Enemy: Regenerate navigation graph

// Debug: Check obstacle map info
Keyboard: On Space pressed
├─ Action: Set DebugText to "Map Source: " & AI Enemy.ObstacleMapSource
├─ Action: Add to DebugText: newline & "Grid Size: " & AI Enemy.GridWidth & "x" & AI Enemy.GridHeight
```

### Test 2.2: Manual Obstacle Map
**Purpose:** Test custom obstacle creation

**Events:**
```
System: On start of layout
├─ AI Enemy: Create custom obstacle map size (20, 15)
├─ AI Enemy: Set cell obstacle at (5, 5) to solid
├─ AI Enemy: Set cell obstacle at (6, 5) to solid
├─ AI Enemy: Set cell obstacle at (7, 5) to solid
└─ AI Enemy: Regenerate navigation graph

// Test loading saved map
Keyboard: On S pressed
├─ LocalStorage: Set item "navmap" to AI Enemy.ObstacleMapJSON

Keyboard: On L pressed  
├─ AI Enemy: Load obstacle map from JSON LocalStorage.ItemValue("navmap")
└─ AI Enemy: Regenerate navigation graph
```

### Test 2.3: Dynamic Obstacle Changes
**Purpose:** Test runtime obstacle modification

**Events:**
```
// Add obstacle where clicked
Mouse: On left button clicked
├─ AI Enemy: Set cell obstacle at (AI Enemy.WorldToGridX(Mouse.X), AI Enemy.WorldToGridY(Mouse.Y)) to solid
└─ AI Enemy: Regenerate navigation graph

// Remove obstacle on right click
Mouse: On right button clicked
├─ AI Enemy: Set cell obstacle at (AI Enemy.WorldToGridX(Mouse.X), AI Enemy.WorldToGridY(Mouse.Y)) to clear
└─ AI Enemy: Regenerate navigation graph
```

---

## ⚠️ 3. HAZARD SYSTEM TESTS

### Test 3.1: Rectangle Hazards
**Purpose:** Test rectangular danger zones

**Setup:** Create red rectangle sprites to visualize hazards

**Events:**
```
System: On start of layout
├─ AI Enemy: Enable hazard avoidance
├─ For each HazardZone:
│   └─ AI Enemy: Add rectangle hazard at (HazardZone.BBoxLeft, HazardZone.BBoxTop) 
│                 size (HazardZone.BBoxWidth, HazardZone.BBoxHeight) severity 5.0

// Test hazard detection
Mouse: On left button clicked
├─ Action: Set DebugText to "Position hazardous: " & AI Enemy.IsPositionHazardous(Mouse.X, Mouse.Y)
├─ Action: Add to DebugText: newline & "Hazard severity: " & AI Enemy.HazardSeverity(Mouse.X, Mouse.Y)
```

### Test 3.2: Circle Hazards  
**Purpose:** Test circular danger zones

**Setup:** Create red circle sprites for visual hazards

**Events:**
```
System: On start of layout
├─ For each CircleHazard:
│   └─ AI Enemy: Add circle hazard at (CircleHazard.X, CircleHazard.Y) 
│                radius CircleHazard.Width/2 severity 3.0

// Dynamic hazard creation
Keyboard: On H pressed
└─ AI Enemy: Add circle hazard at (Mouse.X, Mouse.Y) radius 64 severity 4.0

// Clear all hazards
Keyboard: On C pressed
└─ AI Enemy: Clear all hazards
```

### Test 3.3: Hazard Avoidance Comparison
**Purpose:** Compare paths with/without hazards

**Events:**
```
Keyboard: On 1 pressed
├─ AI Enemy: Disable hazard avoidance  
├─ Wait 0.1 seconds
└─ AI Enemy: Find path to (Player.X, Player.Y)

Keyboard: On 2 pressed
├─ AI Enemy: Enable hazard avoidance
├─ Wait 0.1 seconds  
└─ AI Enemy: Find path to (Player.X, Player.Y)

// Show hazard count
System: Every tick
└─ Action: Set HazardCounter text to "Active hazards: " & AI Enemy.HazardCount
```

---

## 🌀 4. PORTAL SYSTEM TESTS

### Test 4.1: Teleporter Portals
**Purpose:** Test instant teleportation

**Setup:** Create teleporter entrance/exit sprites

**Events:**
```
System: On start of layout
├─ For each TeleporterIn:
│   └─ AI Enemy: Add teleporter portal from (TeleporterIn.X, TeleporterIn.Y) 
│                to (TeleporterOut.X, TeleporterOut.Y) cost 1.0

// Test portal pathfinding
Mouse: On left button clicked  
└─ AI Enemy: Find path to (Mouse.X, Mouse.Y)
```

### Test 4.2: Ladder Connections
**Purpose:** Test vertical movement portals

**Events:**
```
System: On start of layout
├─ For each LadderBottom:
│   └─ AI Enemy: Add ladder portal from (LadderBottom.X, LadderBottom.Y)
│                to (LadderTop.X, LadderTop.Y) cost 2.0
```

### Test 4.3: Portal Management
**Purpose:** Test adding/removing portals

**Events:**
```
Keyboard: On P pressed
├─ AI Enemy: Add teleporter portal from (100, 200) to (500, 100) cost 1.5
└─ Action: Set DebugText to "Portal added"

Keyboard: On R pressed  
├─ AI Enemy: Remove portal ID 1
└─ Action: Set DebugText to "Portal removed"

Keyboard: On X pressed
├─ AI Enemy: Clear all portals
└─ Action: Set DebugText to "All portals cleared"
```

---

## 🔧 5. DEBUGGING & TUNING TESTS

### Test 5.1: Jump Capability Testing
**Purpose:** Verify jump height/distance calculations

**Events:**
```
Keyboard: On D pressed
├─ Action: Set DebugText to "Platform Jump Strength: " & AI Enemy.PlatformJumpStrength
├─ Action: Add to DebugText: newline & "Calculated Jump Height: " & AI Enemy.CalculatedJumpHeight  
├─ Action: Add to DebugText: newline & "Calculated Jump Distance: " & AI Enemy.CalculatedJumpDistance
├─ Action: Add to DebugText: newline & "Max Jump Height Setting: " & AI Enemy.MaxJumpHeight
├─ Action: Add to DebugText: newline & "Max Jump Distance Setting: " & AI Enemy.MaxJumpDistance
```

### Test 5.2: Grid Visualization
**Purpose:** Visualize the navigation grid

**Events:**
```
Keyboard: On G pressed
├─ Function: DrawGrid
└─ Action: Set DebugText to "Grid: " & AI Enemy.GridWidth & "x" & AI Enemy.GridHeight

Function: DrawGrid
├─ Local variable: gx = 0
├─ Local variable: gy = 0
├─ System: Repeat AI Enemy.GridWidth times:
│   ├─ System: Repeat AI Enemy.GridHeight times:
│   │   ├─ Condition: AI Enemy.IsCellSolid(gx, gy) = 1
│   │   ├─ Action: Create RedSquare at (gx*CellSize, gy*CellSize)
│   │   └─ Add 1 to gy
│   ├─ Set gy to 0  
│   └─ Add 1 to gx
```

### Test 5.3: Performance Monitoring
**Purpose:** Monitor pathfinding performance

**Events:**
```
AI Enemy: On path found
├─ Action: Set DebugText to "Path found! Length: " & AI Enemy.PathLength
└─ Action: Add to DebugText: newline & "Search time: " & AI Enemy.LastSearchTime & "ms"

AI Enemy: On path failed  
├─ Action: Set DebugText to "Path failed!"
└─ Action: Add to DebugText: newline & "Nodes searched: " & AI Enemy.NodesSearched
```

---

## 🎮 6. ADVANCED USAGE TESTS

### Test 6.1: Multiple AI Characters
**Purpose:** Test shared vs per-instance graphs

**Setup:** Create multiple AI sprites

**Events:**
```
System: On start of layout
├─ AI1: Set graph mode to "shared"
├─ AI2: Set graph mode to "shared"  
├─ AI1: Regenerate navigation graph
└─ Wait 0.1 seconds

// Both should use same graph
Mouse: On left button clicked
├─ AI1: Find path to (Mouse.X, Mouse.Y)
└─ AI2: Find path to (Mouse.X, Mouse.Y)
```

### Test 6.2: Manual Movement Control
**Purpose:** Test with auto-control disabled

**Events:**
```
System: On start of layout
└─ AI Enemy: Set auto-control to disabled

AI Enemy: On path updated
├─ Condition: AI Enemy.CurrentWaypointX < AI Enemy.X
├─ Action: AI Enemy: Simulate Platform pressing Left
└─ Action: AI Enemy: Set Platform vector X to -200

AI Enemy: On path updated  
├─ Condition: AI Enemy.CurrentWaypointX > AI Enemy.X
├─ Action: AI Enemy: Simulate Platform pressing Right
└─ Action: AI Enemy: Set Platform vector X to 200

AI Enemy: On path updated
├─ Condition: AI Enemy.ShouldJump = 1
└─ Action: AI Enemy: Simulate Platform pressing Jump
```

### Test 6.3: Dynamic Level Changes
**Purpose:** Test adapting to moving platforms

**Events:**
```
// Moving platform
System: Every tick
├─ MovingPlatform: Set position to (MovingPlatform.X + sin(time*2)*100, MovingPlatform.Y)

// Regenerate graph periodically
System: Every 3 seconds
└─ AI Enemy: Regenerate navigation graph

// Or regenerate when platform moves significantly  
MovingPlatform: On position changed
├─ Condition: System: Distance moved > 32
└─ AI Enemy: Regenerate navigation graph
```

---

## 🔄 7. CONDITION & EXPRESSION TESTS

### Test 7.1: Condition Testing
**Purpose:** Test all condition types

**Events:**
```
System: Every tick
├─ Condition: AI Enemy: Has active path
└─ Action: Set PathStatus to "Moving"

System: Every tick
├─ Condition: NOT AI Enemy: Has active path  
└─ Action: Set PathStatus to "Idle"

System: Every tick
├─ Condition: AI Enemy: Is position hazardous (Player.X, Player.Y)
└─ Action: Set PlayerStatus to "Player in danger!"

System: Every tick
├─ Condition: NOT AI Enemy: Is position hazardous (Player.X, Player.Y)
└─ Action: Set PlayerStatus to "Player safe"
```

### Test 7.2: Expression Usage
**Purpose:** Test all expression values

**Events:**
```
Keyboard: On I pressed
├─ Action: Set InfoText to "=== NAVIGATION INFO ==="
├─ Action: Add to InfoText: newline & "Map Source: " & AI Enemy.ObstacleMapSource  
├─ Action: Add to InfoText: newline & "Grid Size: " & AI Enemy.GridWidth & " x " & AI Enemy.GridHeight
├─ Action: Add to InfoText: newline & "Current Waypoint: (" & AI Enemy.CurrentWaypointX & ", " & AI Enemy.CurrentWaypointY & ")"
├─ Action: Add to InfoText: newline & "Path Progress: " & AI Enemy.PathProgress & "%"
├─ Action: Add to InfoText: newline & "Hazard Count: " & AI Enemy.HazardCount
├─ Action: Add to InfoText: newline & "Portal Count: " & AI Enemy.PortalCount
```

---

## 📋 8. COMPLETE INTEGRATION TEST

### Test 8.1: Full Feature Demo
**Purpose:** Comprehensive test of all systems

**Setup:**
- Complex level with multiple platforms
- Hazard zones (spikes, enemies)  
- Teleporters/ladders
- Moving platforms
- Multiple AI characters

**Events:**
```
System: On start of layout
├─ Call Function "SetupLevel"
└─ Wait 0.5 seconds

Function: SetupLevel
├─ AI Enemy: Copy obstacle map from Pathfinding behavior
├─ AI Enemy: Enable hazard avoidance
├─ For each HazardSprite: AI Enemy: Add rectangle hazard at HazardSprite
├─ For each Teleporter: AI Enemy: Add teleporter portal between entrance/exit
├─ AI Enemy: Regenerate navigation graph

// Continuous gameplay
System: Every 0.5 seconds
├─ Condition: System: Random(0,100) < 30
└─ AI Enemy: Find path to (random(LayoutWidth), random(LayoutHeight))

// Dynamic hazards (moving enemies)
EnemyPatrol: Every 2 seconds
├─ AI Enemy: Remove hazard ID EnemyPatrol.HazardID
└─ AI Enemy: Add circle hazard at EnemyPatrol position, store ID in EnemyPatrol.HazardID

// Performance monitoring
System: Every 5 seconds
├─ Action: Set PerformanceText to "Active Paths: " & AI Enemy.ActivePathCount
├─ Action: Add to PerformanceText: newline & "Avg Search Time: " & AI Enemy.AverageSearchTime & "ms"
```

---

## 🎯 Quick Testing Checklist

### ✅ Basic Features:
- [ ] Path finding works
- [ ] Auto-movement works
- [ ] Manual control works
- [ ] Stop pathfinding works

### ✅ Obstacle System:
- [ ] Copy from Pathfinding behavior
- [ ] Custom obstacle map
- [ ] Dynamic obstacle changes
- [ ] Save/load obstacle maps

### ✅ Hazard System:
- [ ] Rectangle hazards avoid correctly
- [ ] Circle hazards avoid correctly  
- [ ] Hazard severity affects path choice
- [ ] Clear hazards works

### ✅ Portal System:
- [ ] Teleporter portals work
- [ ] Ladder portals work
- [ ] Portal costs affect path choice
- [ ] Add/remove portals works

### ✅ Advanced Features:
- [ ] Multiple AI characters work
- [ ] Shared graph mode works
- [ ] Debug expressions show correct values
- [ ] Performance is acceptable

### ✅ Edge Cases:
- [ ] No valid path handling
- [ ] Character gets stuck recovery
- [ ] Level layout changes
- [ ] Memory management (no leaks)

---

## 🚨 Common Issues & Solutions

**Issue: AI doesn't move**
- Check Auto-Control is enabled
- Verify obstacle map is generated
- Ensure target position is reachable

**Issue: AI takes strange paths**
- Check jump/fall distance settings match Platform behavior
- Verify hazard zones aren't blocking optimal paths
- Try regenerating navigation graph

**Issue: Performance problems**
- Reduce Max Search Nodes
- Use larger Cell Size  
- Limit hazard count
- Don't regenerate graph too frequently

**Issue: AI can't reach target**
- Check if path exists without portals/jumps
- Verify character height clearance
- Test with debug visualization enabled