export default function(parentClass) {

  // ════════════════════════════════════════════════════════════
  // NAVIGATION MANAGER SINGLETON (Phase 10)
  // ════════════════════════════════════════════════════════════

  class NavigationManager {
    constructor() {
      if (NavigationManager.instance) {
        return NavigationManager.instance;
      }
      this.graphs = new Map();
      this.subscribers = new Map();
      NavigationManager.instance = this;
    }
    
    getGraph(layoutUID) {
      if (!this.graphs.has(layoutUID)) {
        this.graphs.set(layoutUID, {
          nodes: new Map(),
          portals: new Map(),
          hazards: new Map(),
          needsRegen: true
        });
      }
      return this.graphs.get(layoutUID);
    }
    
    subscribe(layoutUID, instance) {
      if (!this.subscribers.has(layoutUID)) {
        this.subscribers.set(layoutUID, new Set());
      }
      this.subscribers.get(layoutUID).add(instance);
    }
    
    unsubscribe(layoutUID, instance) {
      if (this.subscribers.has(layoutUID)) {
        this.subscribers.get(layoutUID).delete(instance);
        if (this.subscribers.get(layoutUID).size === 0) {
          this.graphs.delete(layoutUID);
          this.subscribers.delete(layoutUID);
        }
      }
    }
  }

  // Create the global singleton instance
  const globalNavManager = new NavigationManager();

  /**
 * Platformer Pathfinding Behavior - COMPLETE IMPLEMENTATION
 * Version 1.0.0
 * 
 * Features:
 * - All 13 phases (0-12)
 * - Platform behavior property reading
 * - Physics-based calculations
 * - Custom obstacle map creation/editing
 * - Save/load obstacle maps to JSON
 * - Proper debug logging
 * - SPOT pattern (shared graphs)
 * - Portal system
 * - Path smoothing & stuck detection
 */
  return class PlatformerPathfindingInstance extends parentClass {
    constructor() {
      super();

      // Read properties
      const props = this._getInitProperties();
      this.enableDebug = props[0];
      this.cellSize = props[1];
      this.characterHeight = props[2];
      this.maxSearchNodes = props[3];
      this.maxJumpHeight = props[4];
      this.maxJumpDistance = props[5];
      this.maxFallDistance = props[6];
      this.autoControl = props[7];
      this.graphMode = props[8];
      this.enablePortals = props[9];
      this.smoothPaths = props[10];
      this.maxWaypointTime = props[11];
      this.setupPreset = props[12];
      this.enableHazards = props[13]
      
      if (this.enableDebug) {
        console.log("╔═══════════════════════════════════════╗");
        console.log("║  PLATFORMER PATHFINDING INITIALIZED  ║");
        console.log("╚═══════════════════════════════════════╝");
      }

      // Initialize state
      this._initializeState();

      // Get behaviors and read properties
      this.platformBehavior = this._getPlatformBehavior();
      this.pathfindingBehavior = this._getPathfindingBehavior();
      this._readPlatformProperties();
      
      // Apply preset
      if (this.setupPreset !== "custom") {
        this._applyPreset();
      }

      // Initialize graph mode
      this._initializeGraphMode();

      this.log("Ready!", {
        cellSize: this.cellSize,
        graphMode: this.graphMode,
        preset: this.setupPreset,
        platformFound: this.platformBehavior !== null,
        pathfindingFound: this.pathfindingBehavior !== null
      });

      // enable ticking.
      this._setTicking(true);


    }

    // ════════════════════════════════════════
    // INITIALIZATION
    // ════════════════════════════════════════
    
    _initializeState() {
      // Graph data
      this.navGraph = new Map();
      this.graphGenerated = false;
      this.obstacleMap = null;
      this.obstacleMapSource = null; // "pathfinding", "custom", or null
      this.gridWidth = 0;
      this.gridHeight = 0;
      
      // Path following
      this.currentPath = [];
      this.currentWaypoint = 0;
      this.hasPath = false;
      this.timeAtWaypoint = 0;
      
      // Platform properties
      this.platformProps = {
        maxSpeed: 200,
        acceleration: 1500,
        deceleration: 1500,
        jumpStrength: 400,
        gravity: 1500,
        maxFallSpeed: 1000
      };

       // Hazards ⭐ NEW
      this.hazards = new Map();
      this.nextHazardId = 1;
      
      // Portals
      this.portals = new Map();
      this.nextPortalId = 1;
      
      // Constants
      this.WALK_COST = 1.0;
      this.JUMP_COST = 1.5;
      this.FALL_COST = 0.5;
    }
    
    _initializeGraphMode() {
      if (this.graphMode === "shared") {
        this.useSharedGraph = true;
        const layout = this._runtime.layout;
        this.layoutUID = layout.uid;
        globalNavManager.subscribe(this.layoutUID, this);
        this.log("Using SHARED graph mode");
      } else {
        this.useSharedGraph = false;
        this.log("Using INSTANCE graph mode");
      }
    }

    
    // ════════════════════════════════════════
    // LIFECYCLE
    // ════════════════════════════════════════
    _release() {
      super._release();

      if (this.useSharedGraph) {
        globalNavManager.unsubscribe(this.layoutUID, this);
      }
      
      this.navGraph.clear();
      this.portals.clear();
      this.hazards.clear();
    }

    _tick() {
      const dt = this.instance.dt;
      
      // Generate graph if needed
      if (this._needsGraphRegeneration()) {
        this._generateGraph();
      }
      
      // Follow path
      if (this.hasPath) {
        this._followPath(dt);
      }
    }

    _saveToJson() {
      return {
        version: 1,
        hasPath: this.hasPath,
        waypointIndex: this.currentWaypoint,
        obstacleMapSource: this.obstacleMapSource
      };
    }

    _loadFromJson(o) {
      if (o.version !== 1) return;
      this.hasPath = o.hasPath || false;
      this.currentWaypoint = o.waypointIndex || 0;
      this.obstacleMapSource = o.obstacleMapSource || null;

    }


    // ════════════════════════════════════════
    // BEHAVIOR DETECTION & PROPERTY READING
    // ════════════════════════════════════════

    _getPlatformBehavior(behaviorName) {
      // failback to common names if none provided
      behaviorName = behaviorName || "Platform" ;

      // commented out debug check.
      if(!this.instance || !this.instance.behaviors){
        this.error("[PlatformNavGraph] Instance or behaviors not found (looking for Platform Behavior)  ");
        return null;
      }
      // returns the behavior if found.
      return this.instance.behaviors[behaviorName] || null;
    }

    _getPathfindingBehavior(behavior) {

      // failback to common names if none provided
      behaviorName = behaviorName || "Pathfinding" ;
      if(!this.instance || !this.instance.behaviors) {
        // Log error only if debug enabled.
        this.error("[PlatformNavGraph] Instance or behaviors not found (looking for Pathfinding Behavior)  ");
        return null;
        }
        
      // returns the behavior if found.
      return this.instance.behaviors[behaviorName] || null; 
    }

    _readPlatformProperties() {
      if (!this.platformBehavior) {
        this.warn("Platform behavior not found - using default values");
        return;
      }
      
      try {
        if (this.platformBehavior.maxSpeed !== undefined) {
          this.platformProps.maxSpeed = this.platformBehavior.maxSpeed;
        }
        if (this.platformBehavior.acceleration !== undefined) {
          this.platformProps.acceleration = this.platformBehavior.acceleration;
        }
        if (this.platformBehavior.deceleration !== undefined) {
          this.platformProps.deceleration = this.platformBehavior.deceleration;
        }
        if (this.platformBehavior.jumpStrength !== undefined) {
          this.platformProps.jumpStrength = this.platformBehavior.jumpStrength;
        }
        if (this.platformBehavior.gravity !== undefined) {
          this.platformProps.gravity = this.platformBehavior.gravity;
        }
        if (this.platformBehavior.maxFallSpeed !== undefined) {
          this.platformProps.maxFallSpeed = this.platformBehavior.maxFallSpeed;
        }
        
        this.log("Platform properties read", this.platformProps);
      } catch (e) {
        this.warn("Error reading Platform properties: " + e.message);
      }
    }

    // ════════════════════════════════════════
    // PHASE 12: PRESETS
    // ════════════════════════════════════════

    _applyPreset() {
      if (this.setupPreset === "auto") {
        this._autoConfigureFromPlatform();
      } else if (this.setupPreset === "beginner") {
        this.cellSize = 64;
        this.maxSearchNodes = 1000;
        this._calculateJumpParametersFromPlatform();
      } else if (this.setupPreset === "intermediate") {
        this.cellSize = 32;
        this.maxSearchNodes = 2000;
        this._calculateJumpParametersFromPlatform();
      } else if (this.setupPreset === "advanced") {
        this.cellSize = 16;
        this.maxSearchNodes = 5000;
        this._calculateJumpParametersFromPlatform();
      }
      
      this.log("Preset applied", this.setupPreset);
    }

    _autoConfigureFromPlatform() {
      const speed = this.platformProps.maxSpeed;
      this.cellSize = Math.max(16, Math.min(64, Math.floor(speed * 0.4)));
      this._calculateJumpParametersFromPlatform();
      
      this.log("Auto-configured from Platform", {
        cellSize: this.cellSize,
        maxJumpHeight: this.maxJumpHeight.toFixed(1),
        maxJumpDistance: this.maxJumpDistance.toFixed(1)
      });
    }

    _calculateJumpParametersFromPlatform() {
      const jumpStrength = this.platformProps.jumpStrength;
      const gravity = this.platformProps.gravity;
      const maxSpeed = this.platformProps.maxSpeed;
      
      // h = v² / (2g)
      this.maxJumpHeight = (jumpStrength * jumpStrength) / (2 * gravity);
      
      // t = v / g
      const timeToApex = jumpStrength / gravity;
      const totalJumpTime = timeToApex * 2;
      
      // Horizontal distance
      this.maxJumpDistance = maxSpeed * totalJumpTime * 0.8;
      
      // Safe fall distance
      this.maxFallDistance = this.platformProps.maxFallSpeed * 2;
      
      this.log("Jump parameters calculated", {
        maxJumpHeight: this.maxJumpHeight.toFixed(1),
        maxJumpDistance: this.maxJumpDistance.toFixed(1)
      });
    }
    

    // ═══════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════
    log(message, data) {
      if (this.enableDebug) {
        console.log(`[PlatformerPathfinding] ${message}`, data || '');
      }
    }

    warn(message) {
      if (this.enableDebug) {
        console.warn(`[PlatformerPathfinding] ${message}`);
      }
    }

    error(message) {
      console.error(`[PlatformerPathfinding] ${message}`);
    }

    // helper to get behavior by name
    _GetBehavior(inst, behaviorName) {
      if (!inst || !inst.behaviors) return null;
      return inst.behaviors[behaviorName] || null;
    }
    
    worldToGrid(x, y) {
      return {
        gx: Math.floor(x / this.cellSize),
        gy: Math.floor(y / this.cellSize)
      };
    }

    gridToWorld(gx, gy) {
      return {
        x: gx * this.cellSize + this.cellSize / 2,
        y: gy * this.cellSize + this.cellSize / 2
      };
    }

    gridKey(gx, gy) {
      return `${gx},${gy}`;
    }

    distance(x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      return Math.sqrt(dx * dx + dy * dy);
    }

    _getNavigationGraph() {
      if (this.useSharedGraph) {
        return globalNavManager.getGraph(this.layoutUID).nodes;
      }
      return this.navGraph;
    }

    _getPortalsMap() {
      if (this.useSharedGraph) {
        return globalNavManager.getGraph(this.layoutUID).portals;
      }
      return this.portals;
    }

    _getHazardsMap() {
      if (this.useSharedGraph) {
        return globalNavManager.getGraph(this.layoutUID).hazards;
      }
      return this.hazards;
    }

    _needsGraphRegeneration() {
      if (this.useSharedGraph) {
        return globalNavManager.getGraph(this.layoutUID).needsRegen;
      }
      return !this.graphGenerated;
    }

    _markGraphAsGenerated() {
      if (this.useSharedGraph) {
        globalNavManager.getGraph(this.layoutUID).needsRegen = false;
      }
      this.graphGenerated = true;
    }

    // ═══════════════════════════════════
    // PHASE 1: OBSTACLE DETECTION
    // ═══════════════════════════════════

    _scanObstacles() {
      this.log("Phase 1: Scanning obstacles...");
      
      // Check if custom obstacle map exists
      if (this.obstacleMapSource === "custom") {
        this.log("Using existing custom obstacle map");
        this._triggerObstacleMapCreated();
        return;
      }
      
      // Otherwise use Pathfinding behavior
      const pathfinding = this.pathfindingBehavior;
      
      if (!pathfinding) {
        this.error("═══════════════════════════════════════");
        this.error("❌ PATHFINDING BEHAVIOR REQUIRED!");
        this.error("═══════════════════════════════════════");
        this.error("Either:");
        this.error("1. Add Pathfinding behavior (cell size: " + this.cellSize + ")");
        this.error("2. Use custom obstacle map ACEs");
        this.error("═══════════════════════════════════════");
        return;
      } this.log("Pathfinding behavior found, generating obstacle map...");
      
      // Get layout dimensions
      const layout = this.instance.layer.layout;
      this.gridWidth = Math.ceil(layout.width / this.cellSize);
      this.gridHeight = Math.ceil(layout.height / this.cellSize);
      
      this.log("Grid dimensions", {
        width: this.gridWidth,
        height: this.gridHeight
      });
      
      // Force Pathfinding to regenerate
      pathfinding.regenerateObstacleMap();
      
      // Copy obstacle map
      this._copyObstacleMapFromPathfinding(pathfinding);
      
      this.obstacleMapSource = "pathfinding";
      this._triggerObstacleMapCreated();
      
      this.log("Phase 1: Complete!");
    }

    _copyObstacleMapFromPathfinding(pathfinding) {

      const cellCount = this.gridWidth * this.gridHeight;
      this.obstacleMap = new Array(cellCount).fill(false);

      // Get the IPathfindingMap interface
      const pfMap = pathfinding.map;
      if (!pfMap) {
        this.error("Could not access Pathfinding map interface, unable to copy obstacle map.");
        return -1;
      }

      // Get pathfinding grid dimensions (these are properties, not methods)
      const pfCellSize = pfMap.cellSize;
      const pfWidth = pfMap.widthInCells;
      const pfHeight = pfMap.heightInCells;

      this.log("Copying obstacle map from Pathfinding...");
      this.log("Pathfinding map info", {
        cellSize: pfCellSize,
        widthInCells: pfWidth,
        heightInCells: pfHeight
      });

      let blockedCount = 0;
      
      // Check each NavGraph cell against Pathfinding obstacle state
      for (let gx = 0; gx < this.gridWidth; gx++) {
        for (let gy = 0; gy < this.gridHeight; gy++) {
          // Get world position of NavGraph cell center
          const worldX = gx * this.cellSize + (this.cellSize / 2);
          const worldY = gy * this.cellSize + (this.cellSize / 2);
          
          // Convert world position to Pathfinding cell coordinates
          const pfX = Math.floor(worldX / pfCellSize);
          const pfY = Math.floor(worldY / pfCellSize);
          
          const index = gy * this.gridWidth + gx;
          
          // Check if within Pathfinding grid bounds
          if (pfX >= 0 && pfX < pfWidth && pfY >= 0 && pfY < pfHeight) {
            // Use IPathfindingMap.isCellObstacle(x, y) to check if cell is blocked
            if (pfMap.isCellObstacle(pfX, pfY)) {
              this.obstacleMap[index] = true;
              blockedCount++;
            }
          } else {
            // Out of bounds = treat as blocked
            this.obstacleMap[index] = true;
            blockedCount++;
          }
        }
      }
      
      this.log("Obstacle map synced from Pathfinding", {
        total: cellCount,
        blocked: blockedCount
      });
    }

    isCellBlocked(gx, gy) {
      if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
        return true;
      }
      
      if (!this.obstacleMap) {
        return false;
      }
      
      const index = gy * this.gridWidth + gx;
      return this.obstacleMap[index];
    }

    // ════════════════════════════════════════
    // CUSTOM OBSTACLE MAP ACEs
    // ════════════════════════════════════════
    
    aceCreateCustomObstacleMap(width, height) {
      this.gridWidth = width;
      this.gridHeight = height;
      
      const cellCount = width * height;
      this.obstacleMap = new Array(cellCount).fill(false);
      
      this.obstacleMapSource = "custom";
      this.graphGenerated = false;
      
      this.log("Custom obstacle map created", { width, height });
      this._triggerObstacleMapCreated();
    }

    aceSetObstacleCell(gx, gy, blocked) {
      if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
        this.warn(`Cell (${gx}, ${gy}) out of bounds`);
        return;
      }
      
      if (!this.obstacleMap) {
        this.warn("No obstacle map exists - create one first");
        return;
      }
      
      const index = gy * this.gridWidth + gx;
      this.obstacleMap[index] = blocked;
    }

    aceClearObstacleMap() {
      this.obstacleMap = null;
      this.obstacleMapSource = null;
      this.graphGenerated = false;
      this.gridWidth = 0;
      this.gridHeight = 0;
      
      const graph = this._getNavigationGraph();
      graph.clear();
      
      this.log("Obstacle map cleared");
      this._triggerObstacleMapRemoved();
    }

    aceSaveObstacleMapToJSON() {
      if (!this.obstacleMap) {
        return "{}";
      }
      
      const data = {
        version: 1,
        width: this.gridWidth,
        height: this.gridHeight,
        cellSize: this.cellSize,
        source: this.obstacleMapSource,
        map: this.obstacleMap
      };
      
      return JSON.stringify(data);
    }


    aceLoadObstacleMapFromJSON(jsonString) {
      try {
        const data = JSON.parse(jsonString);
        
        if (data.version !== 1) {
          this.error("Invalid obstacle map version");
          return false;
        }
        
        this.gridWidth = data.width;
        this.gridHeight = data.height;
        this.cellSize = data.cellSize || this.cellSize;
        this.obstacleMap = data.map;
        this.obstacleMapSource = "custom";
        this.graphGenerated = false;
        
        this.log("Obstacle map loaded from JSON", {
          width: this.gridWidth,
          height: this.gridHeight
        });
        
        this._triggerObstacleMapCreated();
        return true;
        
      } catch (e) {
        this.error("Failed to load obstacle map: " + e.message);
        return false;
      }
    }

    aceGenerateNodesFromCustomMap() {
      if (!this.obstacleMap || this.obstacleMapSource !== "custom") {
        this.warn("No custom obstacle map exists");
        return;
      }
      
      this.log("Generating nodes from custom map...");
      
      const graph = this._getNavigationGraph();
      graph.clear();
      
      this._generateNodes();
      this._connectWalk();
      this._connectJump();
      this._connectFall();
      this._connectAllPortals();
      
      this._markGraphAsGenerated();
      
      this.log("Node generation complete!", { nodes: graph.size });
    }

    // ════════════════════════════════════════
    // Trigger methods to signal obstacle map creation/removal
    // ════════════════════════════════════════

    _triggerObstacleMapCreated() {
      this._trigger("OnObstacleMapCreated");
    }

    _triggerObstacleMapRemoved() {
      this._trigger("OnObstacleMapRemoved");
    }


    // ════════════════════════════════════════
    // PHASE 2: SURFACE NODE GENERATION
    // ════════════════════════════════════════

    _generateNodes() {
      this.log("Phase 2: Generating nodes...");
      
      let nodeCount = 0;
      
      for (let gy = 0; gy < this.gridHeight; gy++) {
        for (let gx = 0; gx < this.gridWidth; gx++) {
          if (this._isWalkable(gx, gy)) {
            const worldPos = this.gridToWorld(gx, gy);
            const node = this._createNode(worldPos.x, worldPos.y, gx, gy);
            
            const graph = this._getNavigationGraph();
            graph.set(this.gridKey(gx, gy), node);
            nodeCount++;
          }
        }
      }
      
      this.log("Phase 2: Complete!", { nodes: nodeCount });
    }

    _isWalkable(gx, gy) {
      if (this.isCellBlocked(gx, gy)) {
        return false;
      }
      const belowGy = gy + 1;
      return this.isCellBlocked(gx, belowGy);
    }

    _createNode(x, y, gx, gy) {
      const hazardMultiplier = this.enableHazards ? 
      this._getHazardSeverity(x, y) : 1.0;

      return {
        x, y, gx, gy,
        walkable: true,
        connections: [],
        portalConnections: [],
        hazardMultiplier: hazardMultiplier,
        gScore: Infinity,
        hScore: Infinity,
        fScore: Infinity,
        parent: null,
        parentAction: null
      };
    }

    getNode(gx, gy) {
      const graph = this._getNavigationGraph();
      return graph.get(this.gridKey(gx, gy)) || null;
    }

    // ════════════════════════════════════════
    // PHASE 3: WALK CONNECTIONS
    // ════════════════════════════════════════

    _connectWalk() {
      this.log("Phase 3: Connecting walk nodes...");
      
      let count = 0;
      const graph = this._getNavigationGraph();
      
      for (const [key, node] of graph) {
        const leftNode = this.getNode(node.gx - 1, node.gy);
        if (leftNode && this._canWalk(node, leftNode)) {
          node.connections.push({
            target: leftNode,
            action: "walk_left",
            cost: this.cellSize * this.WALK_COST
          });
          count++;
        }
        
        const rightNode = this.getNode(node.gx + 1, node.gy);
        if (rightNode && this._canWalk(node, rightNode)) {
          node.connections.push({
            target: rightNode,
            action: "walk_right",
            cost: this.cellSize * this.WALK_COST
          });
          count++;
        }
      }
      
      this.log("Phase 3: Complete!", { walkConnections: count });
    }

    _canWalk(fromNode, toNode) {
      const headY = fromNode.y - this.characterHeight;
      const headGrid = this.worldToGrid(fromNode.x, headY);
      return !this.isCellBlocked(headGrid.gx, headGrid.gy);
    }

    // ════════════════════════════════════════
    // PHASE 4: JUMP CONNECTIONS
    // ════════════════════════════════════════

    _connectJump() {
      this.log("Phase 4: Connecting jump nodes...");
      
      const maxDistCells = Math.ceil(this.maxJumpDistance / this.cellSize);
      const maxHeightCells = Math.ceil(this.maxJumpHeight / this.cellSize);
      
      let count = 0;
      const graph = this._getNavigationGraph();
      
      for (const [key, node] of graph) {
        for (const dir of [-1, 1]) {
          for (let dist = 2; dist <= maxDistCells; dist++) {
            for (let height = 1; height <= maxHeightCells; height++) {
              const targetGx = node.gx + (dir * dist);
              const targetGy = node.gy - height;
              const target = this.getNode(targetGx, targetGy);
              
              if (target && this._canJump(node, target)) {
                const distance = this.distance(node.x, node.y, target.x, target.y);
                
                node.connections.push({
                  target: target,
                  action: "jump",
                  cost: distance * this.JUMP_COST
                });
                count++;
              }
            }
          }
        }
      }
      
      this.log("Phase 4: Complete!", { jumpConnections: count });
    }

    _canJump(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      
      if (Math.abs(dx) > this.maxJumpDistance) return false;
      if (-dy > this.maxJumpHeight) return false;
      
      const apex = Math.max(from.y - this.maxJumpHeight, to.y);
      
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const x = from.x + dx * t;
        const linearY = from.y + dy * t;
        const arcY = linearY + 4 * (apex - from.y) * t * (1 - t);
        
        const grid = this.worldToGrid(x, arcY);
        if (this.isCellBlocked(grid.gx, grid.gy)) {
          return false;
        }
      }
      
      return true;
    }


    // ════════════════════════════════════════
    // PHASE 5: FALL CONNECTIONS
    // ════════════════════════════════════════

    _connectFall() {
      this.log("Phase 5: Connecting fall nodes...");
      
      const maxFallCells = Math.ceil(this.maxFallDistance / this.cellSize);
      let count = 0;
      const graph = this._getNavigationGraph();
      
      for (const [key, node] of graph) {
        for (let fall = 1; fall <= maxFallCells; fall++) {
          const targetGy = node.gy + fall;
          const target = this.getNode(node.gx, targetGy);
          
          if (target && this._canFall(node, target)) {
            const distance = Math.abs(target.y - node.y);
            
            node.connections.push({
              target: target,
              action: "fall",
              cost: distance * this.FALL_COST
            });
            count++;
            break;
          }
        }
      }
      
      this.log("Phase 5: Complete!", { fallConnections: count });
    }

    _canFall(from, to) {
      for (let i = 1; i <= 5; i++) {
        const t = i / 5;
        const y = from.y + (to.y - from.y) * t;
        const grid = this.worldToGrid(from.x, y);
        
        if (this.isCellBlocked(grid.gx, grid.gy)) {
          return false;
        }
      }
      return true;
    }


    // ════════════════════════════════════════
    // HAZARD SYSTEM
    // ════════════════════════════════════════

    aceAddCircleHazard(x, y, radius, severity) {
      if (!this.enableHazards) return -1;
      
      const hazards = this._getHazardsMap();
      const hazardId = this.nextHazardId++;
      
      const hazard = {
        id: hazardId,
        type: "circle",
        x: x,
        y: y,
        radius: radius,
        severity: severity, // cost multiplier (1.0 = normal, 2.0 = double cost, etc.)
        enabled: true
      };
      
      hazards.set(hazardId, hazard);
      
      // Update graph if already generated
      if (this.graphGenerated) {
        this._updateHazardCosts();
      }
      
      this.log("Circle hazard added", { id: hazardId, x, y, radius, severity });
      return hazardId;
    }

    aceAddRectHazard(x1, y1, x2, y2, severity) {
      if (!this.enableHazards) return -1;
      
      const hazards = this._getHazardsMap();
      const hazardId = this.nextHazardId++;
      
      // Normalize coordinates (ensure x1 < x2, y1 < y2)
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const right = Math.max(x1, x2);
      const bottom = Math.max(y1, y2);
      
      const hazard = {
        id: hazardId,
        type: "rect",
        left: left,
        top: top,
        right: right,
        bottom: bottom,
        severity: severity,
        enabled: true
      };
      
      hazards.set(hazardId, hazard);
      
      // Update graph if already generated
      if (this.graphGenerated) {
        this._updateHazardCosts();
      }
      
      this.log("Rect hazard added", { id: hazardId, left, top, right, bottom, severity });
      return hazardId;
    }

    aceRemoveHazard(hazardId) {
      const hazards = this._getHazardsMap();
      if (hazards.has(hazardId)) {
        hazards.delete(hazardId);
        
        // Update graph if already generated
        if (this.graphGenerated) {
          this._updateHazardCosts();
        }
        
        this.log("Hazard removed", { id: hazardId });
        return true;
      }
      return false;
    }

    aceClearAllHazards() {
      const hazards = this._getHazardsMap();
      const count = hazards.size;
      hazards.clear();
      
      // Reset all node hazard multipliers
      if (this.graphGenerated) {
        const graph = this._getNavigationGraph();
        for (const [key, node] of graph) {
          node.hazardMultiplier = 1.0;
        }
      }
      
      this.log("All hazards cleared", { count });
    }

    _isPositionHazardous(x, y) {
      if (!this.enableHazards) return false;
      
      const hazards = this._getHazardsMap();
      
      for (const hazard of hazards.values()) {
        if (!hazard.enabled) continue;
        
        if (hazard.type === "circle") {
          const dist = this.distance(x, y, hazard.x, hazard.y);
          if (dist <= hazard.radius) {
            return true;
          }
        } else if (hazard.type === "rect") {
          if (x >= hazard.left && x <= hazard.right &&
              y >= hazard.top && y <= hazard.bottom) {
            return true;
          }
        }
      }
      
      return false;
    }

    _getHazardSeverity(x, y) {
      if (!this.enableHazards) return 1.0;
      
      const hazards = this._getHazardsMap();
      let maxSeverity = 1.0;
      
      for (const hazard of hazards.values()) {
        if (!hazard.enabled) continue;
        
        if (hazard.type === "circle") {
          const dist = this.distance(x, y, hazard.x, hazard.y);
          if (dist <= hazard.radius) {
            // Inside hazard zone - use full severity
            maxSeverity = Math.max(maxSeverity, hazard.severity);
          } else if (dist <= hazard.radius * 1.5) {
            // Near hazard - use partial severity (linear falloff)
            const falloff = 1 - ((dist - hazard.radius) / (hazard.radius * 0.5));
            const partialSeverity = 1 + (hazard.severity - 1) * falloff;
            maxSeverity = Math.max(maxSeverity, partialSeverity);
          }
        } else if (hazard.type === "rect") {
          // Check if inside rectangle
          if (x >= hazard.left && x <= hazard.right &&
              y >= hazard.top && y <= hazard.bottom) {
            maxSeverity = Math.max(maxSeverity, hazard.severity);
          } else {
            // Check distance to rectangle edges for falloff
            const distX = Math.max(hazard.left - x, 0, x - hazard.right);
            const distY = Math.max(hazard.top - y, 0, y - hazard.bottom);
            const dist = Math.sqrt(distX * distX + distY * distY);
            
            const falloffDist = this.cellSize; // Falloff distance = 1 cell
            if (dist < falloffDist) {
              const falloff = 1 - (dist / falloffDist);
              const partialSeverity = 1 + (hazard.severity - 1) * falloff;
              maxSeverity = Math.max(maxSeverity, partialSeverity);
            }
          }
        }
      }
      
      return maxSeverity;
    }

    _updateHazardCosts() {
      if (!this.enableHazards) return;
      
      const graph = this._getNavigationGraph();
      let updated = 0;
      
      for (const [key, node] of graph) {
        const oldMultiplier = node.hazardMultiplier || 1.0;
        const severity = this._getHazardSeverity(node.x, node.y);
        node.hazardMultiplier = severity;
        
        if (severity !== oldMultiplier) {
          updated++;
        }
      }
      
      if (updated > 0) {
        this.log("Hazard costs updated", { nodesAffected: updated });
      }
    }

    aceGetHazardCount() {
      return this._getHazardsMap().size;
    }

    aceIsPositionHazardous(x, y) {
      return this._isPositionHazardous(x, y) ? 1 : 0;
    }


    // ════════════════════════════════════════
    // PHASE 9: PORTAL SYSTEM
    // ════════════════════════════════════════


    addPortal(entryX, entryY, exitX, exitY, type, cost) {
      if (!this.enablePortals) return null;
      
      const portals = this._getPortalsMap();
      const portalId = this.nextPortalId++;
      
      const portal = {
        id: portalId,
        entry: { x: entryX, y: entryY },
        exit: { x: exitX, y: exitY },
        type: type,
        cost: cost,
        enabled: true
      };
      
      portals.set(portalId, portal);
      
      if (this.graphGenerated) {
        this._connectPortalToGraph(portal);
      }
      
      this.log("Portal added", { id: portalId, type: type });
      return portalId;
    }

    _connectPortalToGraph(portal) {
      const entryNode = this._findNearestNode(portal.entry.x, portal.entry.y);
      const exitNode = this._findNearestNode(portal.exit.x, portal.exit.y);
      
      if (!entryNode || !exitNode) {
        this.warn("Portal connection failed");
        return;
      }
      
      entryNode.portalConnections.push({
        target: exitNode,
        action: `portal_${portal.type}`,
        cost: portal.cost,
        portalId: portal.id
      });
    }

    _connectAllPortals() {
      if (!this.enablePortals) return;
      
      const portals = this._getPortalsMap();
      let count = 0;
      
      for (const portal of portals.values()) {
        if (portal.enabled) {
          this._connectPortalToGraph(portal);
          count++;
        }
      }
      
      if (count > 0) {
        this.log("Portals connected", { count });
      }
    }

    // ════════════════════════════════════════
    // GRAPH GENERATION
    // ════════════════════════════════════════

    _generateGraph() {
      if (this.enableDebug) {
        console.log("╔═══════════════════════════════════════╗");
        console.log("║     GENERATING NAVIGATION GRAPH       ║");
        console.log("╚═══════════════════════════════════════╝");
      }
      
      const startTime = performance.now();
      
      const graph = this._getNavigationGraph();
      graph.clear();
      
      this._scanObstacles();
      
      if (!this.obstacleMap) {
        this.error("Graph generation aborted - no obstacle map");
        return;
      }
      
      this._generateNodes();
      this._connectWalk();
      this._connectJump();
      this._connectFall();
      this._connectAllPortals();
      this._updateHazardCosts();
      
      this._markGraphAsGenerated();
      
      const elapsed = performance.now() - startTime;
      
      if (this.enableDebug) {
        console.log("╔═══════════════════════════════════════╗");
        console.log("║         GRAPH COMPLETE!               ║");
        console.log(`║  Nodes: ${graph.size.toString().padStart(5)}                          ║`);
        console.log(`║  Time:  ${elapsed.toFixed(1).padStart(5)}ms                       ║`);
        console.log("╚═══════════════════════════════════════╝");
      }
    }

    // ════════════════════════════════════════
    // PHASE 6: A* PATHFINDING
    // ════════════════════════════════════════

    findPath(startX, startY, goalX, goalY) {
      this.log("Finding path...", {
        from: [Math.round(startX), Math.round(startY)],
        to: [Math.round(goalX), Math.round(goalY)]
      });
      
      const startNode = this._findNearestNode(startX, startY);
      const goalNode = this._findNearestNode(goalX, goalY);
      
      if (!startNode || !goalNode) {
        this.warn("No valid nodes found");
        return null;
      }
      
      if (startNode === goalNode) {
        return [];
      }
      
      // Reset A* data
      const graph = this._getNavigationGraph();
      for (const [key, node] of graph) {
        node.gScore = Infinity;
        node.hScore = Infinity;
        node.fScore = Infinity;
        node.parent = null;
        node.parentAction = null;
      }
      
      startNode.gScore = 0;
      startNode.hScore = this._heuristic(startNode, goalNode);
      startNode.fScore = startNode.hScore;
      
      const openSet = [startNode];
      const closedSet = new Set();
      
      let nodesSearched = 0;
      
      while (openSet.length > 0 && nodesSearched < this.maxSearchNodes) {
        nodesSearched++;
        
        let currentIndex = 0;
        for (let i = 1; i < openSet.length; i++) {
          if (openSet[i].fScore < openSet[currentIndex].fScore) {
            currentIndex = i;
          }
        }
        
        const current = openSet[currentIndex];
        
        if (current === goalNode) {
          const path = this._reconstructPath(current);
          this.log("Path found!", {
            waypoints: path.length,
            nodesSearched
          });
          return path;
        }
        
        openSet.splice(currentIndex, 1);
        closedSet.add(current);
        
        const allConnections = [...current.connections, ...current.portalConnections];
        
        for (const conn of allConnections) {
          const neighbor = conn.target;
          
          if (closedSet.has(neighbor)) continue;
          
          // Apply hazard cost multiplier if hazards are enabled
          const hazardMultiplier = this.enableHazards ? 
            (neighbor.hazardMultiplier || 1.0) : 1.0;
          const tentativeG = current.gScore + (conn.cost * hazardMultiplier);
          
          if (!openSet.includes(neighbor)) {
            openSet.push(neighbor);
          } else if (tentativeG >= neighbor.gScore) {
            continue;
          }
          
          neighbor.parent = current;
          neighbor.parentAction = conn.action;
          neighbor.gScore = tentativeG;
          neighbor.hScore = this._heuristic(neighbor, goalNode);
          neighbor.fScore = neighbor.gScore + neighbor.hScore;
        }
      }
      
      this.warn("No path found", { nodesSearched });
      return null;
    }

    _findNearestNode(x, y) {
      const grid = this.worldToGrid(x, y);
      
      let node = this.getNode(grid.gx, grid.gy);
      if (node) return node;
      
      for (let r = 1; r <= 3; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.abs(dx) === r || Math.abs(dy) === r) {
              node = this.getNode(grid.gx + dx, grid.gy + dy);
              if (node) return node;
            }
          }
        }
      }
      
      return null;
    }

    _heuristic(nodeA, nodeB) {
      const dx = Math.abs(nodeB.x - nodeA.x);
      const dy = nodeA.y - nodeB.y;
      
      const horizontalCost = dx * this.WALK_COST;
      
      let verticalCost;
      if (dy < 0) {
        const jumps = Math.ceil(Math.abs(dy) / this.maxJumpHeight);
        verticalCost = jumps * this.maxJumpDistance * this.JUMP_COST;
      } else {
        verticalCost = dy * this.FALL_COST;
      }
      
      return horizontalCost + verticalCost;
    }

    _reconstructPath(goalNode) {
      const path = [];
      let current = goalNode;
      
      while (current.parent) {
        path.unshift({
          node: current,
          action: current.parentAction,
          x: current.x,
          y: current.y
        });
        current = current.parent;
      }
      
      if (this.smoothPaths && path.length > 2) {
        return this._smoothPath(path);
      }
      
      return path;
    }


    // ════════════════════════════════════════
    // PHASE 11: PATH SMOOTHING
    // ════════════════════════════════════════

    _smoothPath(path) {
      const smoothed = [path[0]];
      let current = 0;
      
      while (current < path.length - 1) {
        let farthest = current + 1;
        
        for (let i = path.length - 1; i > current + 1; i--) {
          if (this._canSkipTo(path[current], path[i])) {
            farthest = i;
            break;
          }
        }
        
        smoothed.push(path[farthest]);
        current = farthest;
      }
      
      this.log("Path smoothed", {
        original: path.length,
        smoothed: smoothed.length
      });
      
      return smoothed;
    }

    _canSkipTo(waypointA, waypointB) {
      if (waypointA.action.includes("walk") && waypointB.action.includes("walk")) {
        return true;
      }
      return false;
    }


    // ════════════════════════════════════════
    // PHASE 8: PATH FOLLOWING
    // ════════════════════════════════════════


     _followPath(dt) {
      if (this.currentWaypoint >= this.currentPath.length) {
        this.hasPath = false;
        this.log("Path complete!");
        return;
      }
      
      const waypoint = this.currentPath[this.currentWaypoint];
      
      this.timeAtWaypoint += dt;
      
      if (this.timeAtWaypoint > this.maxWaypointTime) {
        this.warn("Stuck detected - clearing path");
        this.hasPath = false;
        this.timeAtWaypoint = 0;
        return;
      }
      
      const dist = this.distance(this._inst.x, this._inst.y, waypoint.x, waypoint.y);
      
      if (dist < 16) {
        this.currentWaypoint++;
        this.timeAtWaypoint = 0;
        this.log("Waypoint reached", this.currentWaypoint - 1);
        return;
      }
      
      if (this.autoControl) {
        this._executeAction(waypoint.action, waypoint.x, waypoint.y);
      }
    }

    _executeAction(action, targetX, targetY) {
      if (!this.platformBehavior) return;
      
      if (action === "walk_left") {
        this.platformBehavior.simulateControl("left");
      } else if (action === "walk_right") {
        this.platformBehavior.simulateControl("right");
      } else if (action === "jump") {
        if (targetX < this._inst.x) {
          this.platformBehavior.simulateControl("left");
        } else {
          this.platformBehavior.simulateControl("right");
        }
        this.platformBehavior.simulateControl("jump");
      } else if (action === "fall") {
        if (targetX < this._inst.x) {
          this.platformBehavior.simulateControl("left");
        } else if (targetX > this._inst.x) {
          this.platformBehavior.simulateControl("right");
        }
      } else if (action.includes("portal")) {
        this._inst.x = targetX;
        this._inst.y = targetY;
      }
    }

    // ════════════════════════════════════════
    // PUBLIC API (Called from ACEs)
    // ════════════════════════════════════════

    aceFindPath(targetX, targetY) {
      const path = this.findPath(this._inst.x, this._inst.y, targetX, targetY);
      
      if (path) {
        this.currentPath = path;
        this.currentWaypoint = 0;
        this.hasPath = true;
        this.timeAtWaypoint = 0;
        return true;
      }
      
      return false;
    }

    aceStopPathfinding() {
      this.currentPath = [];
      this.hasPath = false;
      this.currentWaypoint = 0;
      this.log("Pathfinding stopped");
    }

    aceRegenerateGraph() {
      if (this.useSharedGraph) {
        globalNavManager.getGraph(this.layoutUID).needsRegen = true;
      }
      this.graphGenerated = false;
      this.log("Graph regeneration requested");
    }

    aceAddPortal(entryX, entryY, exitX, exitY, type, cost) {
      return this.addPortal(entryX, entryY, exitX, exitY, type, cost);
    }

    // Getters for expressions

    aceGetPathLength() {
      return this.currentPath.length;
    }

    aceGetCurrentWaypoint() {
      return this.currentWaypoint;
    }

    aceGetNodeCount() {
      return this._getNavigationGraph().size;
    }

    aceGetPortalCount() {
      return this._getPortalsMap().size;
    }

    aceHasPath() {
      return this.hasPath;
    }

    aceGetPlatformMaxSpeed() {
      return this.platformProps.maxSpeed;
    }

    aceGetPlatformJumpStrength() {
      return this.platformProps.jumpStrength;
    }

    aceGetCalculatedJumpHeight() {
      return this.maxJumpHeight;
    }

    aceGetCalculatedJumpDistance() {
      return this.maxJumpDistance;
    }

    aceGetObstacleMapSource() {
      return this.obstacleMapSource || "none";
    }

    aceGetGridWidth() {
      return this.gridWidth;
    }

    aceGetGridHeight() {
      return this.gridHeight;
    }

    aceIsCellBlocked(gx, gy) {
      return this.isCellBlocked(gx, gy) ? 1 : 0;
    }



  };

}