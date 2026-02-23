import { id, addonType, name } from "../../config.caw.js";
import AddonTypeMap from "../../template/addonTypeMap.js";

export default function (parentClass) {
  // ===========================
  // BinaryHeap (min-heap by fScore)
  // ===========================
  class BinaryHeap {
    constructor() {
      this._data = [];
      this._set = new Set();
    }
    get size() { return this._data.length; }
    push(node) {
      this._data.push(node);
      this._set.add(node);
      this._bubbleUp(this._data.length - 1);
    }
    pop() {
      const min = this._data[0];
      const last = this._data.pop();
      this._set.delete(min);
      if (this._data.length > 0) {
        this._data[0] = last;
        this._sinkDown(0);
      }
      return min;
    }
    contains(node) { return this._set.has(node); }
    update(node) {
      const idx = this._data.indexOf(node);
      if (idx !== -1) this._bubbleUp(idx);
    }
    _bubbleUp(idx) {
      while (idx > 0) {
        const parentIdx = (idx - 1) >> 1;
        if (this._data[idx].fScore >= this._data[parentIdx].fScore) break;
        [this._data[idx], this._data[parentIdx]] = [this._data[parentIdx], this._data[idx]];
        idx = parentIdx;
      }
    }
    _sinkDown(idx) {
      const length = this._data.length;
      while (true) {
        let smallest = idx;
        const left = 2 * idx + 1;
        const right = 2 * idx + 2;
        if (left < length && this._data[left].fScore < this._data[smallest].fScore) smallest = left;
        if (right < length && this._data[right].fScore < this._data[smallest].fScore) smallest = right;
        if (smallest === idx) break;
        [this._data[idx], this._data[smallest]] = [this._data[smallest], this._data[idx]];
        idx = smallest;
      }
    }
  }

  // ===========================
  // SpatialHash (grid-based spatial partitioning for multi-agent avoidance)
  // ===========================
  class SpatialHash {
    constructor(cellSize) {
      this._cellSize = cellSize;
      this._cells = new Map();
    }
    clear() { this._cells.clear(); }
    _key(x, y) {
      return ((x / this._cellSize) | 0) + "," + ((y / this._cellSize) | 0);
    }
    insert(x, y) {
      const key = this._key(x, y);
      if (!this._cells.has(key)) this._cells.set(key, []);
      this._cells.get(key).push({ x, y });
    }
    query(x, y, radius) {
      const results = [];
      const minGx = ((x - radius) / this._cellSize) | 0;
      const maxGx = ((x + radius) / this._cellSize) | 0;
      const minGy = ((y - radius) / this._cellSize) | 0;
      const maxGy = ((y + radius) / this._cellSize) | 0;
      for (let gx = minGx; gx <= maxGx; gx++) {
        for (let gy = minGy; gy <= maxGy; gy++) {
          const cell = this._cells.get(gx + "," + gy);
          if (cell) for (const pos of cell) results.push(pos);
        }
      }
      return results;
    }
  }

  // ===========================
  // NavigationManager Singleton
  // ===========================
  class NavigationManager {
    constructor() {
      this.sharedGraphs = new Map();
      this.subscribers = new Map();
      this.graphCapabilities = new Map(); // per-layout: { doubleJump: bool }

      // Time-sliced path queue
      this.pathQueue = [];
      this.maxPathsPerTick = 0; // 0 = unlimited (backward-compatible)
      this._pathsThisTick = 0;
      this._lastResetTime = 0;

      // Spatial hash for multi-agent avoidance
      this._agentSpatialHash = null;
      this._agentHashLastBuild = 0;

      // Graph Manager: shared agent params
      this.sharedAgentParams = new Map(); // layoutUID → { maxJumpHeight, ... }
    }

    /** Returns (or creates) the shared navigation graph Map for a given layout. */
    getSharedGraph(layoutUID) {
      if (!this.sharedGraphs.has(layoutUID)) {
        this.sharedGraphs.set(layoutUID, new Map());
      }
      return this.sharedGraphs.get(layoutUID);
    }

    /** Registers an instance as a subscriber to the shared graph for its layout. */
    subscribe(layoutUID, instance) {
      if (!this.subscribers.has(layoutUID)) {
        this.subscribers.set(layoutUID, new Set());
      }
      this.subscribers.get(layoutUID).add(instance);
    }

    /** Removes an instance from the shared graph subscribers; cleans up the graph when no subscribers remain. */
    unsubscribe(layoutUID, instance) {
      const subs = this.subscribers.get(layoutUID);
      if (subs) {
        subs.delete(instance);
        if (subs.size === 0) {
          this.subscribers.delete(layoutUID);
          this.sharedGraphs.delete(layoutUID);
          this.graphCapabilities.delete(layoutUID);
          this.sharedAgentParams.delete(layoutUID);
        }
      }
    }

    /** Records the capabilities the graph was built with (e.g. double jump). */
    setGraphCapabilities(layoutUID, capabilities) {
      this.graphCapabilities.set(layoutUID, { ...capabilities });
    }

    /** Returns the capabilities the graph was built with, or null if not yet built. */
    getGraphCapabilities(layoutUID) {
      return this.graphCapabilities.get(layoutUID) || null;
    }

    /** Sets graphGenerated=true on all subscriber instances for a layout. */
    markGraphAsGenerated(layoutUID) {
      const subs = this.subscribers.get(layoutUID);
      if (subs) {
        for (const inst of subs) {
          inst.graphGenerated = true;
        }
      }
    }

    /** Returns true if any subscriber for this layout has not yet generated its graph. */
    needsRegeneration(layoutUID) {
      const subs = this.subscribers.get(layoutUID);
      if (!subs || subs.size === 0) return false;
      for (const inst of subs) {
        if (!inst.graphGenerated) return true;
      }
      return false;
    }

    /** Queues a path request for time-sliced processing. Replaces any existing request for the same instance. */
    queuePathRequest(instance, params) {
      // Remove existing request from same instance (edge case #1, #5)
      this.pathQueue = this.pathQueue.filter(r => r.instance !== instance);
      // Cap queue at 200, drop oldest with warning (edge case #10)
      if (this.pathQueue.length >= 200) {
        const dropped = this.pathQueue.shift();
        dropped.instance.pathPending = false;
        console.warn("[NavGraph] Path queue full (200), dropping oldest request");
      }
      this.pathQueue.push({ instance, params });
      instance.pathPending = true;
    }

    /** Processes queued path requests up to the per-tick budget. */
    processPathQueue() {
      if (this.pathQueue.length === 0) return;
      const now = performance.now();
      if (now - this._lastResetTime > 1) {
        this._pathsThisTick = 0;
        this._lastResetTime = now;
      }
      while (this.pathQueue.length > 0 && (this.maxPathsPerTick === 0 || this._pathsThisTick < this.maxPathsPerTick)) {
        const req = this.pathQueue.shift();
        // Skip destroyed instances (edge case #2)
        if (!req.instance.instance || req.instance.instance.isDestroyed) {
          req.instance.pathPending = false;
          continue;
        }
        req.instance.pathPending = false;
        this._pathsThisTick++;
        req.instance.aceFindPath(req.params.targetX, req.params.targetY, req.params.correctToGround, req.params.mode, req.params.strict, true);
      }
    }

    /** Removes a queued path request for a specific instance. */
    removeQueuedRequest(instance) {
      this.pathQueue = this.pathQueue.filter(r => r.instance !== instance);
      instance.pathPending = false;
    }

    /** Clears all queued path requests (called on graph rebuild). */
    clearQueue() {
      for (const req of this.pathQueue) {
        req.instance.pathPending = false;
      }
      this.pathQueue = [];
    }

    /** Builds a spatial hash of agent positions once per frame (lazy, on first A* query). */
    getAgentSpatialHash(layoutUID, cellSize) {
      const now = performance.now();
      if (!this._agentSpatialHash || now - this._agentHashLastBuild > 1) {
        const hash = new SpatialHash(cellSize * 2);
        const subs = this.subscribers.get(layoutUID);
        if (subs) {
          for (const inst of subs) {
            if (inst.hasPath) hash.insert(inst.instance.x, inst.instance.y);
          }
        }
        this._agentSpatialHash = hash;
        this._agentHashLastBuild = now;
      }
      return this._agentSpatialHash;
    }

    /** Registers agent parameters (jump/fall/dimensions) from a Platform-bearing instance. */
    registerAgentParams(layoutUID, params) {
      const existing = this.sharedAgentParams.get(layoutUID);
      if (!existing || params.maxJumpHeight > existing.maxJumpHeight) {
        this.sharedAgentParams.set(layoutUID, { ...params });
      }
    }

    /** Returns registered agent parameters for a layout, or null if none registered. */
    getAgentParams(layoutUID) {
      return this.sharedAgentParams.get(layoutUID) || null;
    }

    /** Collects world positions of all other path-following instances (for multi-agent avoidance). */
    getOtherInstancePositions(layoutUID, excludeInstance) {
      const positions = [];
      const subs = this.subscribers.get(layoutUID);
      if (subs) {
        for (const inst of subs) {
          if (inst !== excludeInstance && inst.hasPath) {
            positions.push({ x: inst.instance.x, y: inst.instance.y });
          }
        }
      }
      return positions;
    }
  }

  const globalNavManager = new NavigationManager();

  // ===========================
  // Main Instance Class
  // ===========================
  return class PlatformerPathfindingInstance extends parentClass {
    constructor() {
      super();

      const properties = this._getInitProperties();

      this.enableDebug = properties[0];
      this.cellSize = properties[1];
      this.maxSearchNodes = properties[2];
      this.maxFallDistanceSetting = properties[3];
      this.autoControl = properties[4];
      this.graphMode = properties[5];
      const strategyMap = ["balanced", "shortest", "safest", "simplest"];
      this.pathStrategy = strategyMap[properties[6]] || "balanced";
      this.smoothPaths = properties[7];
      this.maxWaypointTime = properties[8];
      this.coyoteTime = properties[9];
      this.strictPositioning = properties[10];
      this.ledgeRestriction = properties[11];
      this.ledgeLeniency = properties[12];
      this.rePathThreshold = properties[13];
      this.hazardRadius = properties[14];
      // Auto-enabled when portals/hazards are added via ACEs
      this.enablePortals = true;
      this.enableHazards = false;

      // Auto-detected from sprite bounding box on first tick
      this.characterHeight = 32;
      this.characterWidth = 32;
      // Auto-calculated from Platform behavior (or overridden via ACEs)
      this.maxJumpHeight = 128;
      this.maxJumpDistance = 192;
      this.singleJumpHeight = 128;
      this.singleJumpDistance = 192;
      this.maxFallDistance = 256;

      this.useSharedGraph = this.graphMode === "shared";

      this._initializeState();

      // Instance properties and behaviors are acquired on the first tick,
      // not in the constructor, because the instance is not fully initialized yet
      this.layoutUID = null;
      this.platformBehavior = null;
      this.pathfindingBehavior = null;
      this._initialized = false;

      // Use C3 SDK's built-in ticking mechanism (available on base class without this.instance)
      this._setTicking(true);
    }

    /** Resets all runtime state (graph, path, portals, hazards, movement flags) to defaults. */
    _initializeState() {
      this.navGraph = new Map();
      this.graphGenerated = false;
      this.obstacleMap = null;
      this.obstacleMapSource = null;
      this.gridWidth = 0;
      this.gridHeight = 0;

      this.slopeMap = null;
      this.hazardMap = null;

      this.currentPath = [];
      this.currentWaypoint = 0;
      this.hasPath = false;
      this.timeAtWaypoint = 0;
      this.lastPathMode = "reach";
      this.lastPathCost = 0;
      this.lastPathFailReason = "";

      this.pathTargetX = 0;
      this.pathTargetY = 0;
      this.pathTargetCorrectedX = 0;
      this.pathTargetCorrectedY = 0;
      this.pathTargetGridX = 0;
      this.pathTargetGridY = 0;

      this.jumpTowardTargetX = 0;
      this.jumpTowardTargetY = 0;
      this._jumpTowardActive = false;
      this._jumpTowardGrace = 0;

      this.platformProps = {
        maxSpeed: 200,
        acceleration: 1500,
        deceleration: 1500,
        jumpStrength: 400,
        gravity: 1500,
        maxFallSpeed: 1000,
        isDoubleJumpEnabled: false,
        jumpSustain: 0,
        ceilingCollisionMode: "stop",
      };

      this.hazards = new Map();
      this.nextHazardId = 1;

      this.portals = new Map();
      this.nextPortalId = 1;
      this.lastPortalId = 0;

      this.coyoteTimer = 0;
      this.wasOnFloor = false;
      this.coyoteJumpPending = false;

      this.estimatedVelocityX = 0;
      this.lastInstanceX = 0;
      this.jumpStartTime = 0;
      this.doubleJumpPhase = 0;
      this._doubleJumpLastY = 0;
      this._doubleJumpGrace = 0;
      this.isHoldingJump = false;
      this.jumpHoldTimer = 0;
      this.jumpStartY = 0;

      this.currentPathStrict = false;
      this.departureCommitted = false;

      this.rePathCooldown = 0;
      this.rePathCooldownDuration = 0.5;
      this.rePathCount = 0;
      this.rePathBestDist = Infinity;
      this.justUsedPortal = false;
      this.currentPortalId = 0;

      // Portal execution state
      this.portalState = "none"; // "none" | "paused" | "traversing"
      this.portalPaused = false;
      this.portalTraverseProgress = 0;
      this.portalTraverseStartX = 0;
      this.portalTraverseStartY = 0;
      this.portalTraverseTargetX = 0;
      this.portalTraverseTargetY = 0;
      this.portalTraverseSpeed = 0;
      this.portalCurrentWaypoint = null;
      this.platformWasEnabled = true;
      this._inPortalEntryTrigger = false;
      this.portalPauseTimer = 0;
      this.portalPauseWarned = false;
      this.elevatorGroups = new Map();

      this.multiAgentAvoidance = false;
      this.pathPending = false;
      this._jumpParamsOverridden = false;

      this.isWaitingForPathfindingMap = false;
      this.waitTickCount = 0;
      this.autoRegenOnReady = true;
      this.maxWaitTicks = 600;

      this.events = {};

      this.nodeIndexArray = [];

      this.WALK_COST = 1.0;
      this.JUMP_COST = 1.5;
      this.FALL_COST = 0.5;
      this.COYOTE_JUMP_COST = 1.6;
      this.SLOPE_COST = 1.0;

      this.pathStrategy = "balanced";

    }

    _tick() {
      const dt = this.instance.dt;

      // First-tick initialization: acquire layout UID, behaviors, and graph mode
      if (!this._initialized) {
        this._initialized = true;
        this.layoutUID = this.instance.layout.uid;
        this.characterHeight = Math.abs(this.instance.height);
        this.characterWidth = Math.abs(this.instance.width);
        this._log(`Character dimensions: ${this.characterWidth}x${this.characterHeight}px (instance: ${this.instance.width}x${this.instance.height})`);
        this._initializeGraphMode();
        this.platformBehavior = this._getPlatformBehavior();
        this.pathfindingBehavior = this._getPathfindingBehavior();
        if (this.platformBehavior) {
          this._readPlatformProperties();
          this._calculateJumpParametersFromPlatform();
          this._log(`Double jump: ${this.platformProps.isDoubleJumpEnabled ? "ENABLED" : "disabled"} | Jump sustain: ${this.platformProps.jumpSustain}ms`);
          // Register agent params for Graph Manager support (SPOT-only)
          if (this.useSharedGraph) {
            globalNavManager.registerAgentParams(this.layoutUID, {
              maxJumpHeight: this.maxJumpHeight,
              maxJumpDistance: this.maxJumpDistance,
              maxFallDistance: this.maxFallDistance,
              singleJumpHeight: this.singleJumpHeight,
              singleJumpDistance: this.singleJumpDistance,
              characterHeight: this.characterHeight,
              characterWidth: this.characterWidth,
              platformProps: { ...this.platformProps }
            });
          }
        }
      }

      // Use "Lazy Loading" - only find them if we don't have them yet
    if (!this.platformBehavior) {
        this.platformBehavior = this._getPlatformBehavior();
        if (this.platformBehavior) {
            this._readPlatformProperties();
            this._calculateJumpParametersFromPlatform();
            this._log(`Double jump: ${this.platformProps.isDoubleJumpEnabled ? "ENABLED" : "disabled"} | Jump sustain: ${this.platformProps.jumpSustain}ms`);
        }
    }


    if (!this.pathfindingBehavior) {
        this.pathfindingBehavior = this._getPathfindingBehavior();
    }

    // If either behavior is present but disabled, skip all processing and log a warning
      if (this.platformBehavior && !this.platformBehavior.isEnabled) {
        return;
      }

      if (this.pathfindingBehavior && !this.pathfindingBehavior.isEnabled) {
        console.log("Pathfinding behavior is disabled, make sure it is enabled.");
        return;
      }

      if (this.isWaitingForPathfindingMap) {
        this._checkPathfindingMapReady();
      }

      if (this._needsGraphRegeneration()) {
        this._generateGraph();
      }

      if (this.platformBehavior) {
        this._updateCoyoteTime(dt);
      }

      if (this.rePathCooldown > 0) {
        this.rePathCooldown -= dt;
      }

      // Standalone jump-toward: keep pushing horizontally while airborne
      if (this._jumpTowardActive && this.platformBehavior) {
        // Grace period: skip the landing check for a few ticks after launch,
        // because isOnFloor is still true on the frame the jump is initiated
        if (this._jumpTowardGrace > 0) {
          this._jumpTowardGrace -= dt;
        }
        const hasLanded = this._jumpTowardGrace <= 0 && this.platformBehavior.isOnFloor;
        if (hasLanded) {
          this._jumpTowardActive = false;
        } else {
          // Push horizontally toward target
          const xDist = Math.abs(this.jumpTowardTargetX - this.instance.x);
          if (xDist >= this.cellSize * 0.5) {
            const dir = this.jumpTowardTargetX < this.instance.x ? "left" : "right";
            this.platformBehavior.simulateControl(dir);
          }
          // Sustain jump while rising
          if (this.platformProps.jumpSustain > 0 && this.platformBehavior.isRising) {
            this.platformBehavior.simulateControl("jump");
          }
        }
      }

      // Process queued path requests (time-slicing)
      globalNavManager.processPathQueue();

      if (this.hasPath && !this.pathPending) {
        this._followPath(dt);
      }

      if (this.justUsedPortal) {
        this.justUsedPortal = false;
      }

      this.estimatedVelocityX =
        (this.instance.x - this.lastInstanceX) / Math.max(dt, 0.001);
      this.lastInstanceX = this.instance.x;
    }

    _release() {
      super._release();
      globalNavManager.removeQueuedRequest(this);
      if (this.useSharedGraph && this.layoutUID !== null) {
        globalNavManager.unsubscribe(this.layoutUID, this);
      }
      this.navGraph.clear();
      this.portals.clear();
      this.hazards.clear();
      if (this.portalState === "traversing" && this.platformBehavior) {
        this.platformBehavior.isEnabled = this.platformWasEnabled;
      }
      this.portalState = "none";
    }

    _saveToJson() {
      return {
        version: 1,
        enableDebug: this.enableDebug,
        cellSize: this.cellSize,
        characterHeight: this.characterHeight,
        characterWidth: this.characterWidth,
        maxSearchNodes: this.maxSearchNodes,
        maxFallDistanceSetting: this.maxFallDistanceSetting,
        maxJumpHeight: this.maxJumpHeight,
        maxJumpDistance: this.maxJumpDistance,
        singleJumpHeight: this.singleJumpHeight,
        singleJumpDistance: this.singleJumpDistance,
        maxFallDistance: this.maxFallDistance,
        autoControl: this.autoControl,
        graphMode: this.graphMode,
        enablePortals: this.enablePortals,
        smoothPaths: this.smoothPaths,
        maxWaypointTime: this.maxWaypointTime,
        enableHazards: this.enableHazards,
        coyoteTime: this.coyoteTime,
        strictPositioning: this.strictPositioning,
        ledgeRestriction: this.ledgeRestriction,
        ledgeLeniency: this.ledgeLeniency,
        rePathThreshold: this.rePathThreshold,
        rePathCooldownDuration: this.rePathCooldownDuration,
        hazardRadius: this.hazardRadius,
        pathStrategy: this.pathStrategy,
        multiAgentAvoidance: this.multiAgentAvoidance,
        currentPath: this.currentPath.map((wp) => ({
          x: wp.x,
          y: wp.y,
          action: wp.action,
          portalId: wp.portalId || null,
          speed: wp.speed || 0,
          peakHeight: wp.peakHeight || 0,
          requiresDoubleJump: wp.requiresDoubleJump || false,
          gx: wp.node ? wp.node.gx : -1,
          gy: wp.node ? wp.node.gy : -1,
        })),
        currentWaypoint: this.currentWaypoint,
        hasPath: this.hasPath,
        timeAtWaypoint: this.timeAtWaypoint,
        lastPathMode: this.lastPathMode,
        lastPathCost: this.lastPathCost,
        lastPathFailReason: this.lastPathFailReason,
        pathTargetX: this.pathTargetX,
        pathTargetY: this.pathTargetY,
        pathTargetCorrectedX: this.pathTargetCorrectedX,
        pathTargetCorrectedY: this.pathTargetCorrectedY,
        pathTargetGridX: this.pathTargetGridX,
        pathTargetGridY: this.pathTargetGridY,
        jumpTowardTargetX: this.jumpTowardTargetX,
        jumpTowardTargetY: this.jumpTowardTargetY,
        _jumpTowardActive: this._jumpTowardActive,
        platformProps: this.platformProps,
        graphGenerated: this.graphGenerated,
        obstacleMap: this.obstacleMap ? Array.from(this.obstacleMap) : null,
        obstacleMapSource: this.obstacleMapSource,
        gridWidth: this.gridWidth,
        gridHeight: this.gridHeight,
        slopeMap: this.slopeMap ? Array.from(this.slopeMap) : null,
        hazardMap: this.hazardMap ? Array.from(this.hazardMap) : null,
        hazards: Array.from(this.hazards.values()),
        portals: Array.from(this.portals.values()),
        lastPortalId: this.lastPortalId,
        portalState: this.portalState,
        portalTraverseProgress: this.portalTraverseProgress,
        portalTraverseStartX: this.portalTraverseStartX,
        portalTraverseStartY: this.portalTraverseStartY,
        portalTraverseTargetX: this.portalTraverseTargetX,
        portalTraverseTargetY: this.portalTraverseTargetY,
        portalTraverseSpeed: this.portalTraverseSpeed,
        platformWasEnabled: this.platformWasEnabled,
        currentPortalId: this.currentPortalId,
        elevatorGroups: Object.fromEntries(this.elevatorGroups),
        coyoteTimer: this.coyoteTimer,
        wasOnFloor: this.wasOnFloor,
        coyoteJumpPending: this.coyoteJumpPending,
        doubleJumpPhase: this.doubleJumpPhase,
        isHoldingJump: this.isHoldingJump,
        jumpHoldTimer: this.jumpHoldTimer,
        jumpStartY: this.jumpStartY,
        pathPending: false, // Queue doesn't persist across save/load
        _jumpParamsOverridden: this._jumpParamsOverridden,
      };
    }

    _loadFromJson(o) {
      if (!o || o.version !== 1) return;

      this.enableDebug = o.enableDebug;
      this.cellSize = o.cellSize;
      this.characterHeight = o.characterHeight;
      this.characterWidth = o.characterWidth || 32;
      this.maxSearchNodes = o.maxSearchNodes;
      this.maxFallDistanceSetting = o.maxFallDistanceSetting || 0;
      this.maxJumpHeight = o.maxJumpHeight;
      this.maxJumpDistance = o.maxJumpDistance;
      this.singleJumpHeight = o.singleJumpHeight || o.maxJumpHeight;
      this.singleJumpDistance = o.singleJumpDistance || o.maxJumpDistance;
      this.maxFallDistance = o.maxFallDistance;
      this.autoControl = o.autoControl;
      this.graphMode = o.graphMode;
      this.enablePortals = o.enablePortals;
      this.smoothPaths = o.smoothPaths;
      this.maxWaypointTime = o.maxWaypointTime;
      this.enableHazards = o.enableHazards;
      this.coyoteTime = o.coyoteTime;
      this.strictPositioning = o.strictPositioning !== undefined ? o.strictPositioning : true;
      this.ledgeRestriction = o.ledgeRestriction;
      this.ledgeLeniency = o.ledgeLeniency;
      this.rePathThreshold = o.rePathThreshold;
      this.rePathCooldownDuration = o.rePathCooldownDuration || 0.5;
      this.hazardRadius = o.hazardRadius;
      this.pathStrategy = o.pathStrategy || "balanced";
      this.multiAgentAvoidance = o.multiAgentAvoidance;
      this.currentWaypoint = o.currentWaypoint;
      this.hasPath = o.hasPath;
      this.timeAtWaypoint = o.timeAtWaypoint;
      this.lastPathMode = o.lastPathMode;
      this.lastPathCost = o.lastPathCost;
      this.lastPathFailReason = o.lastPathFailReason || "";
      this.pathTargetX = o.pathTargetX;
      this.pathTargetY = o.pathTargetY;
      this.pathTargetCorrectedX = o.pathTargetCorrectedX;
      this.pathTargetCorrectedY = o.pathTargetCorrectedY;
      this.pathTargetGridX = o.pathTargetGridX;
      this.pathTargetGridY = o.pathTargetGridY;
      this.jumpTowardTargetX = o.jumpTowardTargetX;
      this.jumpTowardTargetY = o.jumpTowardTargetY;
      this._jumpTowardActive = o._jumpTowardActive || false;
      this.platformProps = o.platformProps;
      this.graphGenerated = o.graphGenerated;
      this.obstacleMap = o.obstacleMap ? new Uint8Array(o.obstacleMap) : null;
      this.obstacleMapSource = o.obstacleMapSource;
      this.gridWidth = o.gridWidth;
      this.gridHeight = o.gridHeight;
      this.slopeMap = o.slopeMap ? new Uint8Array(o.slopeMap) : null;
      this.hazardMap = o.hazardMap ? new Float32Array(o.hazardMap) : null;
      this.coyoteTimer = o.coyoteTimer;
      this.wasOnFloor = o.wasOnFloor;
      this.coyoteJumpPending = o.coyoteJumpPending;
      this.doubleJumpPhase = o.doubleJumpPhase;
      this.isHoldingJump = o.isHoldingJump;
      this.jumpHoldTimer = o.jumpHoldTimer;
      this.jumpStartY = o.jumpStartY || 0;
      this.pathPending = false; // Queue doesn't persist
      this._jumpParamsOverridden = o._jumpParamsOverridden || false;

      this.hazards.clear();
      this.nextHazardId = 1;
      if (o.hazards) {
        for (const h of o.hazards) {
          this.hazards.set(h.id, h);
          this.nextHazardId = Math.max(this.nextHazardId, h.id + 1);
        }
      }

      this.portals.clear();
      this.nextPortalId = 1;
      this.lastPortalId = o.lastPortalId || 0;
      if (o.portals) {
        for (const p of o.portals) {
          this.portals.set(p.id, p);
          this.nextPortalId = Math.max(this.nextPortalId, p.id + 1);
        }
      }

      // Restore portal execution state
      this.portalState = o.portalState || "none";
      this.portalTraverseProgress = o.portalTraverseProgress || 0;
      this.portalTraverseStartX = o.portalTraverseStartX || 0;
      this.portalTraverseStartY = o.portalTraverseStartY || 0;
      this.portalTraverseTargetX = o.portalTraverseTargetX || 0;
      this.portalTraverseTargetY = o.portalTraverseTargetY || 0;
      this.portalTraverseSpeed = o.portalTraverseSpeed || 0;
      this.platformWasEnabled = o.platformWasEnabled !== undefined ? o.platformWasEnabled : true;
      this.currentPortalId = o.currentPortalId || 0;

      // Restore elevator groups
      this.elevatorGroups.clear();
      if (o.elevatorGroups) {
        for (const [key, val] of Object.entries(o.elevatorGroups)) {
          this.elevatorGroups.set(key, val);
        }
      }

      // Re-disable Platform if traversing
      if (this.portalState === "traversing" && this.platformBehavior) {
        this.platformBehavior.isEnabled = false;
      }

      if (this.graphGenerated && this.obstacleMap) {
        this._generateGraph();
      }

      if (o.currentPath) {
        this.currentPath = o.currentPath.map((wp) => {
          const node =
            wp.gx >= 0 && wp.gy >= 0 ? this.getNode(wp.gx, wp.gy) : null;
          return {
            x: wp.x,
            y: wp.y,
            action: wp.action,
            portalId: wp.portalId || null,
            speed: wp.speed || 0,
            peakHeight: wp.peakHeight || 0,
            requiresDoubleJump: wp.requiresDoubleJump || false,
            node: node,
          };
        });
      }
    }

    _getDebuggerProperties() {
      const prefix = "$" + this.behaviorType.name;
      const graph = this._initialized ? this._getNavigationGraph() : new Map();
      const currentAction = this.hasPath && this.currentPath[this.currentWaypoint]
        ? this.currentPath[this.currentWaypoint].action
        : "none";

      return [{
        title: prefix + " - Navigation Graph",
        properties: [
          { name: "$generated", value: this.graphGenerated },
          { name: "$nodes", value: graph.size },
          { name: "$gridSize", value: `${this.gridWidth}x${this.gridHeight}` },
          { name: "$obstacleSource", value: this.obstacleMapSource || "none" },
        ]
      }, {
        title: prefix + " - Pathfinding",
        properties: [
          { name: "$hasPath", value: this.hasPath },
          { name: "$waypoint", value: this.hasPath ? `${this.currentWaypoint}/${this.currentPath.length}` : "N/A" },
          { name: "$action", value: currentAction },
          { name: "$pathCost", value: Math.round(this.lastPathCost) },
          { name: "$failReason", value: this.lastPathFailReason || "none" },
          { name: "$target", value: `(${Math.round(this.pathTargetX)}, ${Math.round(this.pathTargetY)})` },
        ]
      }, {
        title: prefix + " - Movement",
        properties: [
          { name: "$coyoteTimer", value: Math.round(this.coyoteTimer * 1000) / 1000 },
          { name: "$velocityX", value: Math.round(this.estimatedVelocityX) },
          { name: "$waypointTime", value: Math.round(this.timeAtWaypoint * 1000) / 1000 },
        ]
      }, {
        title: prefix + " - Portals",
        properties: [
          { name: "$portalCount", value: this._getPortalsMap().size },
          { name: "$portalState", value: this.portalState },
          { name: "$currentPortalId", value: this.currentPortalId },
          { name: "$traverseProgress", value: Math.round(this.portalTraverseProgress * 100) + "%" },
          { name: "$elevatorGroups", value: this.elevatorGroups.size },
        ]
      }, {
        title: prefix + " - Settings",
        properties: [
          { name: "$cellSize", value: this.cellSize },
          { name: "$maxJumpHeight", value: Math.round(this.maxJumpHeight) },
          { name: "$maxJumpDistance", value: Math.round(this.maxJumpDistance) },
          { name: "$maxFallDistance", value: Math.round(this.maxFallDistance) },
          { name: "$debug", value: this.enableDebug },
          { name: "$platformBehavior", value: this.platformBehavior ? "found" : "not found" },
          { name: "$pathfindingBehavior", value: this.pathfindingBehavior ? "found" : "not found" },
          { name: "$waitingForMap", value: this.isWaitingForPathfindingMap },
        ]
      }];
    }

    /** Finds and returns the Platform behavior instance on this object. */
    _getPlatformBehavior() {
      return this._GetBehaviorByType("Platform");
    }

    /** Finds and returns the Pathfinding behavior instance on this object. */
    _getPathfindingBehavior() {
      return this._GetBehaviorByType("Pathfinding");
    }

    // Utility to find a behavior by its plugin type name, even if renamed in the editor
    _GetBehaviorByType(typeName) {
        const behaviors = this.instance?.behaviors;
        if (!behaviors) return null;

        // Fast path: direct access when editor name matches type name (default case)
        const direct = behaviors[typeName];
        if (direct) return direct;

        // Fallback: iterate via for...in to handle renamed behaviors,
        // checking behaviorType.name for the actual plugin type
        for (const key in behaviors) {
            const b = behaviors[key];
            if (b?.behaviorType?.name === typeName) return b;
        }

        return null;
    }

    /** Reads speed, jump, gravity, and double-jump settings from the Platform behavior into platformProps. */
    _readPlatformProperties() {
      if (!this.platformBehavior) return;

      try {
        this.platformProps.maxSpeed = this.platformBehavior.maxSpeed || 200;
        this.platformProps.acceleration =
          this.platformBehavior.acceleration || 1500;
        this.platformProps.deceleration =
          this.platformBehavior.deceleration || 1500;
        this.platformProps.jumpStrength =
          this.platformBehavior.jumpStrength || 400;
        this.platformProps.gravity = this.platformBehavior.gravity || 1500;
        this.platformProps.maxFallSpeed =
          this.platformBehavior.maxFallSpeed || 1000;

        if (this.platformBehavior.isDoubleJumpEnabled !== undefined) {
          this.platformProps.isDoubleJumpEnabled =
            this.platformBehavior.isDoubleJumpEnabled;
        }
        if (this.platformBehavior.jumpSustain !== undefined) {
          this.platformProps.jumpSustain = this.platformBehavior.jumpSustain;
        }
        if (this.platformBehavior.ceilingCollisionMode !== undefined) {
          this.platformProps.ceilingCollisionMode =
            this.platformBehavior.ceilingCollisionMode;
        }
      } catch (e) {
        this._error("Error reading Platform properties:", e);
      }
    }

    /** Derives maxJumpHeight, maxJumpDistance, singleJumpHeight/Distance, and maxFallDistance from Platform behavior physics. */
    _calculateJumpParametersFromPlatform() {
      const {
        jumpStrength,
        gravity,
        maxSpeed,
        jumpSustain,
        isDoubleJumpEnabled,
      } = this.platformProps;

      let singleJumpHeight = (jumpStrength * jumpStrength) / (2 * gravity);

      if (jumpSustain > 0) {
        const sustainTime = jumpSustain / 1000;
        const sustainBonus =
          jumpStrength * sustainTime - 0.5 * gravity * sustainTime * sustainTime;
        singleJumpHeight += Math.max(0, sustainBonus);
      }

      const sustainTime = jumpSustain > 0 ? jumpSustain / 1000 : 0;
      const timeToApex = jumpStrength / gravity + sustainTime;
      const totalJumpTime = timeToApex * 2;
      let maxJumpDist = maxSpeed * totalJumpTime * 0.8;

      this.singleJumpHeight = singleJumpHeight;
      this.singleJumpDistance = maxJumpDist;
      this.maxJumpHeight = singleJumpHeight;
      this.maxJumpDistance = maxJumpDist;

      if (isDoubleJumpEnabled) {
        const doubleJumpHeight =
          singleJumpHeight + (jumpStrength * jumpStrength) / (2 * gravity);
        this.maxJumpHeight = doubleJumpHeight;
        const totalDoubleTime = timeToApex * 2 + (jumpStrength / gravity) * 2;
        this.maxJumpDistance = maxSpeed * totalDoubleTime * 0.8;
      }

      // Apply maxFallDistance based on property setting
      if (this.maxFallDistanceSetting === 0) {
        // Auto: use physics-based fall distance — the distance to reach terminal
        // velocity gives a good baseline, then ensure it's at least 2x jump height.
        // v²/(2g) = distance to reach terminal velocity; we use v²/g for margin.
        const physicalFallDist = (this.platformProps.maxFallSpeed ** 2) / this.platformProps.gravity;
        this.maxFallDistance = Math.max(this.maxJumpHeight * 2, this.cellSize * 6, physicalFallDist);
      } else if (this.maxFallDistanceSetting < 0) {
        // Unlimited
        this.maxFallDistance = 9999;
      } else {
        // Custom value
        this.maxFallDistance = this.maxFallDistanceSetting;
      }

      this._log(`Jump params: maxJumpHeight=${Math.round(this.maxJumpHeight)}px, maxJumpDistance=${Math.round(this.maxJumpDistance)}px, maxFallDistance=${Math.round(this.maxFallDistance)}px (${Math.ceil(this.maxFallDistance / this.cellSize)} tiles), maxFallSpeed=${this.platformProps.maxFallSpeed}, gravity=${this.platformProps.gravity}`);
    }

    /** Converts a C3 combo parameter (numeric index) to its string key. */
    _combo(value, keys) {
      if (typeof value === "number") return keys[value] || keys[0];
      return value || keys[0];
    }

    /** Logs a debug message to the console (only when debug mode is enabled). */
    _log(...args) {
      if (this.enableDebug) {
        console.log(`[${name}]`, ...args);
      }
    }

    /** Logs a warning to the console (only when debug mode is enabled). */
    _warn(...args) {
      if (this.enableDebug) {
        console.warn(`[${name}]`, ...args);
      }
    }

    /** Logs an error to the console (only when debug mode is enabled). */
    _error(...args) {
      if (this.enableDebug) {
        console.error(`[${name}]`, ...args);
      }
    }

    /** Converts world pixel coordinates to grid cell coordinates. */
    worldToGrid(x, y) {
      const gx = Math.floor(x / this.cellSize);
      const gy = Math.floor(y / this.cellSize);
      return { gx, gy };
    }

    /** Converts grid cell coordinates to world pixel coordinates (center of cell). */
    gridToWorld(gx, gy) {
      const x = gx * this.cellSize + this.cellSize / 2;
      const y = gy * this.cellSize + this.cellSize / 2;
      return { x, y };
    }

    /** Returns a numeric key for use as a Map key in the navigation graph. */
    gridKey(gx, gy) {
      return gy * this.gridWidth + gx;
    }

    /** Returns the Euclidean distance between two points. */
    distance(x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      return Math.sqrt(dx * dx + dy * dy);
    }

    /** Returns the active navigation graph (shared across instances or per-instance, based on graph mode). */
    _getNavigationGraph() {
      if (this.useSharedGraph) {
        return globalNavManager.getSharedGraph(this.layoutUID);
      }
      return this.navGraph;
    }

    /** Returns the portals Map (shared or per-instance). */
    _getPortalsMap() {
      if (this.useSharedGraph) {
        const subs = globalNavManager.subscribers.get(this.layoutUID);
        if (subs && subs.size > 0) {
          return subs.values().next().value.portals;
        }
      }
      return this.portals;
    }

    /** Returns the hazards Map (shared or per-instance). */
    _getHazardsMap() {
      if (this.useSharedGraph) {
        const subs = globalNavManager.subscribers.get(this.layoutUID);
        if (subs && subs.size > 0) {
          return subs.values().next().value.hazards;
        }
      }
      return this.hazards;
    }

    /** Returns true if the navigation graph needs to be regenerated. */
    _needsGraphRegeneration() {
      if (this.useSharedGraph) {
        // Graph Manager without Platform: delay until agent params are available
        if (!this.platformBehavior && !this._jumpParamsOverridden) {
          const params = globalNavManager.getAgentParams(this.layoutUID);
          if (!params) return false; // Wait for a Platform agent to register
        }

        if (globalNavManager.needsRegeneration(this.layoutUID)) return true;

        // Check capability mismatch: if this instance has double jump but the
        // shared graph was built without it, the graph is missing double-jump
        // connections and needs rebuilding.
        if (this.platformProps.isDoubleJumpEnabled) {
          const caps = globalNavManager.getGraphCapabilities(this.layoutUID);
          if (caps && !caps.doubleJump) {
            this._log("Shared graph missing double-jump connections — rebuilding");
            return true;
          }
        }

        return false;
      }
      return !this.graphGenerated;
    }

    /** Marks the graph as generated for this instance (or all shared subscribers). */
    _markGraphAsGenerated() {
      if (this.useSharedGraph) {
        globalNavManager.markGraphAsGenerated(this.layoutUID);
      } else {
        this.graphGenerated = true;
      }
    }

    /** Subscribes this instance to the shared graph manager if using shared mode. */
    _initializeGraphMode() {
      if (this.useSharedGraph) {
        globalNavManager.subscribe(this.layoutUID, this);
      }
    }

    /** Attempts to copy the obstacle map from the Pathfinding behavior, or starts polling if not ready. */
    _scanObstacles() {
      if (this.obstacleMapSource === "custom" || this.obstacleMapSource === "collision") {
        return; // Obstacle map was built externally — don't overwrite with Pathfinding copy
      }

      if (this.pathfindingBehavior) {
        const success = this._copyObstacleMapFromPathfinding();
        if (!success) {
          this.isWaitingForPathfindingMap = true;
          this.waitTickCount = 0;
          this._log("Pathfinding behavior found but map not ready, starting poll...");
        } else if (this.slopeMap) {
          // Re-apply slope overrides: slope cells must be clear in obstacleMap
          // (the pathfinding copy may have set them as solid)
          for (let i = 0; i < this.slopeMap.length && i < this.obstacleMap.length; i++) {
            if (this.slopeMap[i] > 0) this.obstacleMap[i] = 0;
          }
        }
      } else {
        this.isWaitingForPathfindingMap = true;
        this.waitTickCount = 0;
      }
    }

    /** Polls each tick to check if the Pathfinding behavior's obstacle map is ready; triggers graph generation when it is. */
    _checkPathfindingMapReady() {
      this.waitTickCount++;
      if (this.waitTickCount >= this.maxWaitTicks) {
        this._warn(
          "Pathfinding map not ready after max wait time (" + this.maxWaitTicks + " ticks)."
        );
        this.isWaitingForPathfindingMap = false;
        this._trigger("OnPathfindingMapTimeout");
        return;
      }

      if (!this.pathfindingBehavior) {
        this.pathfindingBehavior = this._getPathfindingBehavior();
      }

      if (!this.pathfindingBehavior) return;

      // Check if the map data is actually ready via .map interface
      const pfMap = this.pathfindingBehavior.map;
      if (!pfMap) return;
      const w = pfMap.widthInCells;
      const h = pfMap.heightInCells;
      if (!w || !h || w <= 0 || h <= 0) return;

      // Map is ready — copy obstacle data FIRST so the map is available
      // when OnPathfindingMapReady fires (user may add slopes in that trigger)
      this.isWaitingForPathfindingMap = false;
      this.waitTickCount = 0;

      const success = this._copyObstacleMapFromPathfinding();
      if (!success) {
        this._trigger("OnPathfindingMapFailed");
        return;
      }

      this._trigger("OnPathfindingMapReady");

      if (this.autoRegenOnReady) {
        this._generateGraph();
      }
    }

    /** Copies the cell-by-cell obstacle data from the C3 Pathfinding behavior's map into our obstacleMap array. */
    _copyObstacleMapFromPathfinding() {
      if (!this.pathfindingBehavior) return false;

      try {
        const pfMap = this.pathfindingBehavior.map;
        if (!pfMap) {
          this._log("Pathfinding .map interface not available");
          return false;
        }

        const w = pfMap.widthInCells;
        const h = pfMap.heightInCells;

        if (!w || !h || w <= 0 || h <= 0) {
          this._log("Pathfinding map not ready yet (widthInCells=" + w + ", heightInCells=" + h + ")");
          return false;
        }

        this.gridWidth = w;
        this.gridHeight = h;

        const cellCount = w * h;
        this.obstacleMap = new Uint8Array(cellCount);

        for (let gy = 0; gy < h; gy++) {
          for (let gx = 0; gx < w; gx++) {
            if (pfMap.isCellObstacle(gx, gy)) {
              this.obstacleMap[gy * w + gx] = 1;
            }
          }
        }

        this.obstacleMapSource = "pathfinding";
        this._log(`Copied obstacle map from Pathfinding: ${w}x${h} (${cellCount} cells)`);
        return true;
      } catch (e) {
        this._error("Error copying obstacle map from Pathfinding:", e);
        return false;
      }
    }

    aceSetObstacleCell(gx, gy, blocked) {
      if (
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      ) {
        return;
      }
      if (!this.obstacleMap) return;

      const index = gy * this.gridWidth + gx;
      this.obstacleMap[index] = blocked ? 1 : 0;
    }

    aceCreateCustomObstacleMap(widthInTiles, heightInTiles) {
      this.gridWidth = Math.ceil(widthInTiles);
      this.gridHeight = Math.ceil(heightInTiles);
      const cellCount = this.gridWidth * this.gridHeight;
      this.obstacleMap = new Uint8Array(cellCount);
      this.obstacleMapSource = "custom";
      this._trigger("OnObstacleMapCreated");
    }

    /** Creates an empty obstacle map grid from layout pixel dimensions.
     *  Sets obstacleMapSource = "collision" so _scanObstacles won't overwrite it.
     *  Follow with ScanSolidObjectsIntoObstacleMap / ScanJumpThruObjectsIntoObstacleMap. */
    aceBuildObstacleMapFromLayout(layoutWidth, layoutHeight) {
      const cs = this.cellSize;
      this.gridWidth = Math.ceil(layoutWidth / cs);
      this.gridHeight = Math.ceil(layoutHeight / cs);
      this.obstacleMap = new Uint8Array(this.gridWidth * this.gridHeight);
      this.obstacleMapSource = "collision";
      this.isWaitingForPathfindingMap = false;
      this._log(`Built obstacle map from layout: ${this.gridWidth}x${this.gridHeight} (${this.gridWidth * this.gridHeight} cells)`);
      this._trigger("OnObstacleMapCreated");
    }

    /** Scans objects with the Solid behavior into the obstacle map as solid cells (value=1). */
    aceScanSolidObjectsIntoObstacleMap(solidClass) {
      this._scanObjectsIntoObstacleMap(solidClass, 1);
    }

    /** Scans objects with the Jump-thru behavior into the obstacle map as jump-thru cells (value=2). */
    aceScanJumpThruObjectsIntoObstacleMap(jumpThruClass) {
      this._scanObjectsIntoObstacleMap(jumpThruClass, 2);
    }

    /** Shared helper: scans instances of objClass into the obstacle map with the given cellValue.
     *  Validates that each instance has the required C3 behavior enabled (Solid=1, Jumpthru=2).
     *  Tilemaps are scanned cell-by-cell; sprites use bounding box rasterization. */
    _scanObjectsIntoObstacleMap(objClass, cellValue) {
      if (!objClass) return;
      if (!this.obstacleMap) {
        this._warn("ScanObjectsIntoObstacleMap: no obstacle map exists — call BuildObstacleMapFromLayout first");
        return;
      }
      const requiredBehavior = cellValue === 1 ? "Solid" : "Jumpthru";

      // Find an enabled behavior by plugin type name, handling editor-renamed behaviors.
      const getEnabledBehavior = (inst, typeName) => {
        const behaviors = inst.behaviors;
        if (!behaviors) return null;
        const direct = behaviors[typeName];
        if (direct?.isEnabled) return direct;
        for (const key in behaviors) {
          const b = behaviors[key];
          if (b?.behaviorType?.name === typeName && b.isEnabled) return b;
        }
        return null;
      };

      const gw = this.gridWidth;
      const gh = this.gridHeight;
      const cs = this.cellSize;
      const fullRect = new DOMRect(0, 0, gw * cs, gh * cs);
      const candidates = this.instance.runtime.collisions.getCollisionCandidates([objClass], fullRect);
      const seen = new Set();
      let count = 0;

      for (const inst of candidates) {
        if (seen.has(inst)) continue;
        seen.add(inst);
        if (!getEnabledBehavior(inst, requiredBehavior)) {
          this._warn(`ScanObjectsIntoObstacleMap: "${inst.objectType?.name}" skipped — no enabled "${requiredBehavior}" behavior`);
          continue;
        }
        if (typeof inst.getTileAt === "function") {
          // Tilemap: cell-by-cell (tile size must match cellSize)
          for (let gy = 0; gy < gh; gy++) {
            for (let gx = 0; gx < gw; gx++) {
              let tileId;
              try { tileId = inst.getTileAt(gx, gy); } catch (e) { continue; }
              if (tileId >= 0) { this.obstacleMap[gy * gw + gx] = cellValue; count++; }
            }
          }
        } else {
          // Sprite: bounding box rasterization
          const bbox = inst.getBoundingBox();
          const x1 = Math.floor(bbox.left / cs);
          const y1 = Math.floor(bbox.top / cs);
          const x2 = Math.ceil(bbox.right / cs);
          const y2 = Math.ceil(bbox.bottom / cs);
          for (let gy = Math.max(0, y1); gy < Math.min(gh, y2); gy++) {
            for (let gx = Math.max(0, x1); gx < Math.min(gw, x2); gx++) {
              this.obstacleMap[gy * gw + gx] = cellValue; count++;
            }
          }
        }
      }
      this._log(`Scanned ${count} cells (value=${cellValue}) from "${requiredBehavior}" objects`);
    }

    aceClearObstacleMap() {
      this.obstacleMap = null;
      this.obstacleMapSource = null;
      this.gridWidth = 0;
      this.gridHeight = 0;
      this.graphGenerated = false;
      this._trigger("OnObstacleMapRemoved");
    }

    aceSaveObstacleMapToJSON() {
      if (!this.obstacleMap) return "{}";
      return JSON.stringify({
        gridWidth: this.gridWidth,
        gridHeight: this.gridHeight,
        cellSize: this.cellSize,
        map: this.obstacleMap,
        slopeMap: this.slopeMap ? Array.from(this.slopeMap) : null,
        hazardMap: this.hazardMap ? Array.from(this.hazardMap) : null,
      });
    }

    aceLoadObstacleMapFromJSON(json) {
      try {
        const data = JSON.parse(json);
        this.gridWidth = data.gridWidth;
        this.gridHeight = data.gridHeight;
        this.cellSize = data.cellSize;
        this.obstacleMap = data.map;
        this.obstacleMapSource = "custom";

        if (data.slopeMap) {
          this.slopeMap = new Uint8Array(data.slopeMap);
        }
        if (data.hazardMap) {
          this.hazardMap = new Float32Array(data.hazardMap);
        }
      } catch (e) {
        this._error("Error loading obstacle map from JSON:", e);
      }
    }

    aceGenerateNodesFromCustomMap() {
      this.graphGenerated = false;
    }

    aceUsePathfindingObstacleMap(autoRegen) {
      this.obstacleMapSource = null;
      this.obstacleMap = null;
      this.graphGenerated = false;
      this.autoRegenOnReady = autoRegen !== false;

      // Try to copy immediately if pathfinding behavior is already available and ready
      if (this.pathfindingBehavior) {
        const success = this._copyObstacleMapFromPathfinding();
        if (success) {
          this._trigger("OnPathfindingMapReady");
          if (this.autoRegenOnReady) {
            this._generateGraph();
          }
          return;
        }
      }

      // Not ready yet — start polling
      this.isWaitingForPathfindingMap = true;
      this.waitTickCount = 0;
      this._log("Waiting for Pathfinding obstacle map...");
    }

    aceSetTileState(gx, gy, state) {
      if (
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      ) {
        return;
      }
      if (!this.obstacleMap) return;

      const index = gy * this.gridWidth + gx;

      if (state === "solid") {
        this.obstacleMap[index] = 1;
        if (this.slopeMap) this.slopeMap[index] = 0;
      } else if (state === "clear") {
        this.obstacleMap[index] = 0;
        if (this.slopeMap) this.slopeMap[index] = 0;
      } else if (state === "jump_thru") {
        this.obstacleMap[index] = 2;
      } else if (state === "avoid") {
        this.obstacleMap[index] = 3;
      } else if (state === "slope_left") {
        this.obstacleMap[index] = 0;
        if (!this.slopeMap) {
          this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);
        }
        this.slopeMap[index] = 1;
      } else if (state === "slope_right") {
        this.obstacleMap[index] = 0;
        if (!this.slopeMap) {
          this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);
        }
        this.slopeMap[index] = 2;
      } else if (state === "gentle_slope_left") {
        this.obstacleMap[index] = 0;
        if (!this.slopeMap) {
          this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);
        }
        this.slopeMap[index] = 3;
      } else if (state === "gentle_slope_right") {
        this.obstacleMap[index] = 0;
        if (!this.slopeMap) {
          this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);
        }
        this.slopeMap[index] = 4;
      }
      // Auto-regenerate graph when slope tiles change
      if (state.includes("slope")) {
        this.graphGenerated = false;
      }
    }

    aceSetTileStateWorld(x, y, state) {
      const grid = this.worldToGrid(x, y);
      this.aceSetTileState(grid.gx, grid.gy, state);
    }

    /** Marks a diagonal line of tiles as slope from (startGx,startGy) to (endGx,endGy). */
    aceMarkSlopeRegion(startGx, startGy, endGx, endGy, direction) {
      if (!this.obstacleMap) return;
      if (!this.slopeMap) this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);

      const slopeVal = direction === "slope_left" ? 1
        : direction === "slope_right" ? 2
        : direction === "gentle_slope_left" ? 3
        : direction === "gentle_slope_right" ? 4 : 0;
      if (slopeVal === 0) return;

      const isGentle = slopeVal >= 3;
      const dx = endGx > startGx ? 1 : -1;
      const dy = endGy > startGy ? 1 : -1;

      let gx = startGx;
      let gy = startGy;

      while (true) {
        if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight) {
          const index = gy * this.gridWidth + gx;
          this.obstacleMap[index] = 0;
          this.slopeMap[index] = slopeVal;
        }

        if (gx === endGx && gy === endGy) break;

        if (isGentle) {
          // Gentle slope: mark intermediate horizontal cell too
          gx += dx;
          if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight) {
            const index = gy * this.gridWidth + gx;
            this.obstacleMap[index] = 0;
            this.slopeMap[index] = slopeVal;
          }
          gx += dx;
          gy += dy;
        } else {
          gx += dx;
          gy += dy;
        }

        // Safety: prevent infinite loop
        if (Math.abs(gx - startGx) > 500 || Math.abs(gy - startGy) > 500) break;
      }
      this.graphGenerated = false;
    }

    /** Scans a Tilemap and marks tiles matching the given tile IDs as slopes. */
    aceMapSlopeTilesFromTilemap(tilemapClass, slopeLeftIds, slopeRightIds, gentleLeftIds, gentleRightIds) {
      const tilemapInst = tilemapClass.getFirstPickedInstance();
      if (!tilemapInst) {
        this._warn("MapSlopeTilesFromTilemap: tilemap instance not found");
        return;
      }
      if (!this.obstacleMap) {
        this._warn("MapSlopeTilesFromTilemap: obstacle map not created yet");
        return;
      }

      const parseIds = (str) => {
        if (!str || str.trim() === "") return new Set();
        return new Set(str.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)));
      };

      const leftSet = parseIds(slopeLeftIds);
      const rightSet = parseIds(slopeRightIds);
      const gentleLeftSet = parseIds(gentleLeftIds);
      const gentleRightSet = parseIds(gentleRightIds);

      if (leftSet.size === 0 && rightSet.size === 0 && gentleLeftSet.size === 0 && gentleRightSet.size === 0) return;

      if (!this.slopeMap) this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);

      let count = 0;
      // In debug mode: collect tile IDs that exist in the tilemap but aren't in any slope set.
      // These unregistered tiles may silently allow invalid jump connections through them.
      const unregisteredIds = this.enableDebug ? new Map() : null; // tileId → example {gx, gy}

      for (let gy = 0; gy < this.gridHeight; gy++) {
        for (let gx = 0; gx < this.gridWidth; gx++) {
          let tileId;
          try {
            tileId = tilemapInst.getTileAt(gx, gy);
          } catch (e) {
            continue;
          }
          if (tileId < 0) continue;

          const index = gy * this.gridWidth + gx;
          let slopeVal = 0;
          if (leftSet.has(tileId)) slopeVal = 1;
          else if (rightSet.has(tileId)) slopeVal = 2;
          else if (gentleLeftSet.has(tileId)) slopeVal = 3;
          else if (gentleRightSet.has(tileId)) slopeVal = 4;

          if (slopeVal > 0) {
            this.obstacleMap[index] = 0;
            this.slopeMap[index] = slopeVal;
            count++;
          } else if (unregisteredIds && !unregisteredIds.has(tileId)) {
            // Record one example position per unregistered tile ID (for debug output)
            unregisteredIds.set(tileId, { gx, gy });
          }
        }
      }
      this._log(`Mapped ${count} slope tiles from tilemap`);
      if (unregisteredIds && unregisteredIds.size > 0) {
        const examples = [];
        for (const [id, pos] of unregisteredIds) {
          examples.push(`tileId=${id} (e.g. gx=${pos.gx},gy=${pos.gy})`);
        }
        this._log(`[Debug] Tilemap has ${unregisteredIds.size} unregistered tile ID(s) — if any are slope tiles, add them to MapSlopesFromTilemaps: ${examples.join("; ")}`);
      }
      if (count > 0) {
        if (this.graphGenerated && this.obstacleMap) {
          // Graph was built before slopes were registered (common on scene restart when the
          // Pathfinding map is immediately available, so GenerateGraph fires synchronously
          // before MapSlopeTilesFromTilemap runs). Rebuild now so that any FindPath call
          // on the same tick uses the correct slope-aware graph.
          this._log("Slopes registered after graph was already built — rebuilding with slope data");
          this._generateGraph();
        } else {
          // Graph not yet built — mark dirty so the next build picks up the slope data.
          this.graphGenerated = false;
        }
      }
    }

    aceSetTileHazard(gx, gy, severity) {
      if (
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      ) {
        return;
      }
      if (severity > 0) this.enableHazards = true;
      if (!this.hazardMap) {
        this.hazardMap = new Float32Array(this.gridWidth * this.gridHeight);
      }
      this.hazardMap[gy * this.gridWidth + gx] = severity;
    }

    aceClearAllSlopes() {
      if (this.slopeMap) this.slopeMap.fill(0);
      this.graphGenerated = false;
    }

    aceClearAllHazardTiles() {
      if (this.hazardMap) this.hazardMap.fill(0);
    }

    /** Returns true if a cell is impassable (solid or jump-thru). Out-of-bounds counts as blocked. */
    isCellBlocked(gx, gy) {
      if (
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      ) {
        return true;
      }
      const index = gy * this.gridWidth + gx;
      if (!this.obstacleMap) return false;
      const val = this.obstacleMap[index];
      return val === 1 || val === 2;
    }

    /** Returns true if a cell is solid (obstacle value 1). Out-of-bounds counts as solid. */
    isCellSolid(gx, gy) {
      if (
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      ) {
        return true;
      }
      const index = gy * this.gridWidth + gx;
      if (!this.obstacleMap) return false;
      return this.obstacleMap[index] === 1;
    }

    /** Returns true if a cell is a jump-thru platform (obstacle value 2). */
    isCellJumpThru(gx, gy) {
      if (
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      ) {
        return false;
      }
      const index = gy * this.gridWidth + gx;
      if (!this.obstacleMap) return false;
      return this.obstacleMap[index] === 2;
    }

    /** Returns true if a cell is marked as "avoid" (obstacle value 3). */
    isCellAvoid(gx, gy) {
      if (
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      ) {
        return false;
      }
      const index = gy * this.gridWidth + gx;
      if (!this.obstacleMap) return false;
      return this.obstacleMap[index] === 3;
    }

    /** Returns true if a cell is clear (value 0) with solid or jump-thru ground directly below it. */
    _isWalkable(gx, gy) {
      if (
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      ) {
        return false;
      }
      const index = gy * this.gridWidth + gx;
      const val = this.obstacleMap ? this.obstacleMap[index] : 0;

      if (val !== 0) return false;

      const belowIndex = (gy + 1) * this.gridWidth + gx;
      if (gy + 1 >= this.gridHeight) return false;
      const belowVal = this.obstacleMap ? this.obstacleMap[belowIndex] : 0;

      return belowVal === 1 || belowVal === 2;
    }

    /** Returns true if a cell is a walkable slope tile (has a non-zero slopeMap value). */
    _isSlopeWalkable(gx, gy) {
      if (!this.slopeMap) return false;
      const index = gy * this.gridWidth + gx;
      return this.slopeMap[index] > 0;
    }

    /** Scans the obstacle map and creates a navigation node for every walkable/slope cell. */
    _generateNodes() {
      let nodeCount = 0;
      const graph = this._getNavigationGraph();

      for (let gy = 0; gy < this.gridHeight; gy++) {
        for (let gx = 0; gx < this.gridWidth; gx++) {
          if (this._isWalkable(gx, gy) || this._isSlopeWalkable(gx, gy)) {
            const worldPos = this.gridToWorld(gx, gy);
            const node = this._createNode(worldPos.x, worldPos.y, gx, gy);
            graph.set(this.gridKey(gx, gy), node);
            nodeCount++;
          }
        }
      }

      this.nodeIndexArray = Array.from(graph.values());
      this._log(`Generated ${nodeCount} nodes`);
    }

    /** Creates a navigation node with ledge flags, slope info, hazard multiplier, and A* bookkeeping fields. */
    _createNode(x, y, gx, gy) {
      // Treat slope tiles as walkable ground for ledge detection.
      // _isGroundAt only recognizes obstacleMap 1/2 (solid/jump-thru), not slope tiles (obstacleMap=0).
      // Two checks are needed:
      //   1. Diagonal neighbor (gx±1, gy+1): slope tile one row below — original fix for 45° slopes.
      //   2. Same-row neighbor (gx±1, gy): slope tile at the same height — needed for gentle slopes
      //      where two tiles share the same gy (e.g. gentle_right (31,3) and (32,3) both at gy=3).
      //      Without this, (31,3) sees empty space at (32,4) → spurious isRightLedge=true, creating
      //      a phantom fall_right connection that bypasses the walkable slope at (32,3).
      const leftBelowBlocked = this._isGroundAt(gx - 1, gy + 1) || this._isSlopeWalkable(gx - 1, gy + 1) || this._isSlopeWalkable(gx - 1, gy);
      const rightBelowBlocked = this._isGroundAt(gx + 1, gy + 1) || this._isSlopeWalkable(gx + 1, gy + 1) || this._isSlopeWalkable(gx + 1, gy);
      const isLeftLedge = !leftBelowBlocked;
      const isRightLedge = !rightBelowBlocked;
      const isIsland = isLeftLedge && isRightLedge;

      const isSlope = this.slopeMap
        ? this.slopeMap[gy * this.gridWidth + gx] > 0
        : false;
      const slopeDirection = this.slopeMap
        ? this.slopeMap[gy * this.gridWidth + gx]
        : 0;

      const belowIndex = (gy + 1) * this.gridWidth + gx;
      const isOnJumpThru =
        this.obstacleMap && gy + 1 < this.gridHeight
          ? this.obstacleMap[belowIndex] === 2
          : false;

      const hazardMultiplier = this.enableHazards
        ? this._getHazardSeverity(x, y)
        : 1.0;

      return {
        x,
        y,
        gx,
        gy,
        walkable: true,
        connections: [],
        portalConnections: [],
        hazardMultiplier,
        isLeftLedge,
        isRightLedge,
        isIsland,
        isSlope,
        slopeDirection,
        isOnJumpThru,
        gScore: Infinity,
        hScore: Infinity,
        fScore: Infinity,
        parent: null,
        parentAction: null,
        parentPortalId: null,
        parentSpeed: null,
        parentPeakHeight: null,
        parentRequiresDoubleJump: false,
      };
    }

    /** Returns true if a cell contains ground (solid or jump-thru). Used for ledge detection. */
    _isGroundAt(gx, gy) {
      if (
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      ) {
        return false;
      }
      const index = gy * this.gridWidth + gx;
      if (!this.obstacleMap) return false;
      const val = this.obstacleMap[index];
      return val === 1 || val === 2;
    }

    /** Looks up a navigation node by grid coordinates; returns undefined if no node exists there. */
    getNode(gx, gy) {
      const graph = this._getNavigationGraph();
      return graph.get(this.gridKey(gx, gy));
    }

    /** Creates walk_left/walk_right connections between horizontally adjacent nodes with sufficient headroom. */
    _connectWalk() {
      let count = 0;
      const graph = this._getNavigationGraph();
      const headCells = Math.max(0, Math.ceil(this.characterHeight / this.cellSize) - 1);

      for (const [key, node] of graph) {
        const leftNode = this.getNode(node.gx - 1, node.gy);
        const rightNode = this.getNode(node.gx + 1, node.gy);

        if (leftNode) {
          // Only check center column headroom for walk connections.
          // The Platform behavior handles horizontal wall collisions at runtime —
          // if the character can't physically fit, movement will detect the wall and repath.
          let canWalk = true;
          for (let h = 1; h <= headCells; h++) {
            if (this.isCellBlocked(leftNode.gx, leftNode.gy - h)) {
              canWalk = false;
              break;
            }
          }
          if (canWalk) {
            node.connections.push({
              target: leftNode,
              action: "walk_left",
              cost: this.cellSize * this.WALK_COST,
            });
            count++;
          }
        }

        if (rightNode) {
          let canWalk = true;
          for (let h = 1; h <= headCells; h++) {
            if (this.isCellBlocked(rightNode.gx, rightNode.gy - h)) {
              canWalk = false;
              break;
            }
          }
          if (canWalk) {
            node.connections.push({
              target: rightNode,
              action: "walk_right",
              cost: this.cellSize * this.WALK_COST,
            });
            count++;
          }
        }
      }

      this._log(`Created ${count} walk connections`);
    }

    /** Creates jump connections between nodes reachable via single-jump arcs, then adds double-jump connections for targets beyond single-jump range. */
    _connectJump() {
      // Use single-jump limits for the first loop; double-jump connections are added separately below
      const singleHeight = this.platformProps.isDoubleJumpEnabled ? this.singleJumpHeight : this.maxJumpHeight;
      const singleDist = this.platformProps.isDoubleJumpEnabled ? this.singleJumpDistance : this.maxJumpDistance;
      const maxHeightCells = Math.ceil(singleHeight / this.cellSize);
      const maxFallCells = Math.ceil(this.maxFallDistance / this.cellSize);
      const maxDistCells = Math.ceil(singleDist / this.cellSize);
      // Cap downward range: a jump arc goes UP peakHeight then descends back.
      // From launch, you land at most ~maxHeightCells below via the arc itself.
      // Targets further below should use fall connections from ledge nodes.
      // Old formula (maxHeightCells*2+2) allowed 10-tile shortcuts when maxHeightCells=4.
      const maxDownCells = Math.min(maxFallCells, maxHeightCells + 2);
      let count = 0;
      let upCount = 0, downCount = 0, levelCount = 0;
      const graph = this._getNavigationGraph();

      for (const [key, node] of graph) {
        for (const dir of [-1, 1]) {
          for (let dist = 0; dist <= maxDistCells; dist++) {
            // When dist=0 (vertical jump), only check once (dir=1) to avoid duplicates
            if (dist === 0 && dir === -1) continue;

            for (let height = -maxDownCells; height <= maxHeightCells; height++) {
              // dist=0 with height<=0 is not a valid jump (same position or falling)
              if (dist === 0 && height <= 0) continue;

              const targetGx = node.gx + dir * dist;
              const targetGy = node.gy - height;
              const target = this.getNode(targetGx, targetGy);

              const peakHeight = target ? this._canJump(node, target, singleHeight, singleDist) : 0;
              if (peakHeight > 0) {
                const distance = this.distance(node.x, node.y, target.x, target.y);
                node.connections.push({
                  target,
                  action: "jump",
                  cost: distance * this.JUMP_COST,
                  peakHeight,
                });
                count++;
                if (height > 0) upCount++;
                else if (height < 0) downCount++;
                else levelCount++;
              }
            }
          }
        }
      }

      if (this.platformProps.isDoubleJumpEnabled) {
        const doubleMaxHeightCells = Math.ceil(
          this.maxJumpHeight / this.cellSize
        );
        const doubleMaxDistCells = Math.ceil(
          this.maxJumpDistance / this.cellSize
        );

        for (const [key, node] of graph) {
          for (const dir of [-1, 1]) {
            for (let dist = 0; dist <= doubleMaxDistCells; dist++) {
              if (dist === 0 && dir === -1) continue;
              for (let height = -maxDownCells; height <= doubleMaxHeightCells; height++) {
                if (dist === 0 && height <= 0) continue;
                const targetGx = node.gx + dir * dist;
                const targetGy = node.gy - height;
                const target = this.getNode(targetGx, targetGy);

                const dblPeakHeight = target ? this._canDoubleJump(node, target) : 0;
                if (dblPeakHeight > 0) {
                  // Check if this connection already exists as a single jump
                  const alreadyConnected = node.connections.some(
                    c => c.target === target && c.action === "jump" && !c.requiresDoubleJump
                  );
                  if (!alreadyConnected) {
                    const distance = this.distance(
                      node.x,
                      node.y,
                      target.x,
                      target.y
                    );
                    node.connections.push({
                      target,
                      action: "jump",
                      cost: distance * this.JUMP_COST * 1.3,
                      requiresDoubleJump: true,
                      peakHeight: dblPeakHeight,
                    });
                    count++;
                  }
                }
              }
            }
          }
        }
      }

      this._log(`Created ${count} jump connections (up=${upCount}, down=${downCount}, level=${levelCount}, maxDownCells=${maxDownCells}, singleHeightCells=${maxHeightCells}, singleDistCells=${maxDistCells}, doubleJump=${this.platformProps.isDoubleJumpEnabled})`);
    }

    /** Returns the number of extra cells to check on each side of the character during fall arc validation.
     *  A 16px character in 32px cells doesn't extend into adjacent cells → widthCells=0.
     *  Old formula ceil(w/cs/2) rounded up, giving 1 for any character narrower than a cell — this
     *  caused _canDiagonalFall to fail at slope ledge nodes because solid slope body cells one tile
     *  over (e.g. the body below an adjacent slope tile) are within 1 cell of the ledge surface. */
    _getWidthCells() {
      return Math.max(0, Math.ceil(this.characterWidth / this.cellSize) - 1);
    }

    /** Validates a double jump as two separate arcs: first arc goes vertically up by singleJumpHeight, second arc is a Bezier from that apex to the target. Returns the second arc's peakHeight (>0) if both arcs are clear, or 0 if blocked. */
    _canDoubleJump(from, to) {
      const cs = this.cellSize;
      const headCells = Math.max(0, Math.ceil(this.characterHeight / cs) - 1);

      // First arc: vertical column check from 'from' upward by singleJumpHeight
      const apexGy = from.gy - Math.floor(this.singleJumpHeight / cs);
      const minCheckGy = Math.max(0, apexGy);
      for (let gy = from.gy - 1; gy >= minCheckGy; gy--) {
        for (let h = 0; h <= headCells; h++) {
          const checkGy = gy - h;
          if (checkGy < 0) continue;
          if (checkGy >= this.gridHeight) continue;
          const index = checkGy * this.gridWidth + from.gx;
          if (from.gx < 0 || from.gx >= this.gridWidth) return 0;
          const cellVal = this.obstacleMap ? this.obstacleMap[index] : 0;
          if (h === 0) {
            if (cellVal === 1 || cellVal === 3) return 0;
            // Slopes block vertical column at intermediate cells
            if (this.slopeMap && this.slopeMap[index] > 0) return 0;
          } else {
            if (cellVal === 1 && this.platformProps.ceilingCollisionMode === "stop") return 0;
            if (cellVal === 3) return 0;
          }
        }
      }

      // Compute apex position (first jump is vertical, no horizontal drift)
      const apexX = from.x;
      const apexY = from.y - this.singleJumpHeight;
      const apexGridGx = from.gx;
      const apexGridGy = Math.round(apexY / cs);

      // Horizontal clearance at apex: the character starts horizontal movement
      // from the apex position. Check the first adjacent cell in the target
      // direction at the apex height to ensure the character won't immediately
      // slam into a wall. The Bezier arc check handles the rest of the path.
      const hDir = to.gx > from.gx ? 1 : -1;
      const clampedApexGy = Math.max(0, apexGridGy);
      const adjacentGx = from.gx + hDir;
      if (adjacentGx >= 0 && adjacentGx < this.gridWidth) {
        for (let h = 0; h <= headCells; h++) {
          const checkGy = clampedApexGy - h;
          if (checkGy < 0) continue;
          if (checkGy >= this.gridHeight) continue;
          const cellVal = this.obstacleMap ? this.obstacleMap[checkGy * this.gridWidth + adjacentGx] : 0;
          if (cellVal === 1 || cellVal === 3) return 0;
        }
      }

      // Second arc: Bezier check from apex to target using single-jump limits
      const apexVirtual = { x: apexX, y: apexY, gx: apexGridGx, gy: apexGridGy };
      return this._canJump(apexVirtual, to, this.singleJumpHeight, this.singleJumpDistance);
    }

    // Returns the minimum viable peak height in pixels (>0) if jump is possible,
    // or 0 if the jump is blocked. The peak height is stored in connections and
    // used by the movement code to release the jump button at the right time.
    _canJump(from, to, maxHeight, maxDist) {
      maxHeight = maxHeight || this.maxJumpHeight;
      maxDist = maxDist || this.maxJumpDistance;
      const dx = to.x - from.x;
      const dy = to.y - from.y;

      if (Math.abs(dx) > maxDist) return 0;
      if (-dy > maxHeight) return 0;

      const headCells = Math.max(0, Math.ceil(this.characterHeight / this.cellSize) - 1);

      // Vertical or near-vertical jump: use straight column check instead of Bezier arc.
      // This matches how falls work (straight drop) and avoids the arc overshooting into ceilings.
      if (Math.abs(dx) < this.cellSize * 0.5) {
        const minGy = Math.min(from.gy, to.gy);
        const maxGy = Math.max(from.gy, to.gy);
        for (let gy = minGy; gy <= maxGy; gy++) {
          for (let h = 0; h <= headCells; h++) {
            const checkGy = gy - h;
            if (checkGy < 0) continue; // Above grid — no ceiling to hit
            const index = checkGy * this.gridWidth + from.gx;
            if (from.gx < 0 || from.gx >= this.gridWidth) return 0;
            const cellVal = this.obstacleMap ? this.obstacleMap[index] : 0;
            if (h === 0) {
              if (cellVal === 1 || cellVal === 3) return 0;
              // Slopes block vertical jumps at any cell except the departure.
              // Destination slope is allowed only when jumping DOWNWARD (landing on slope from above).
              // Jumping upward INTO a slope destination is blocked — the character can't pass
              // through the solid slope body going upward.
              if (this.slopeMap && this.slopeMap[index] > 0 && gy !== from.gy) {
                const jumpingDown = from.gy < to.gy;
                if (!jumpingDown || gy !== to.gy) return 0;
              }
            } else {
              if (cellVal === 1 && this.platformProps.ceilingCollisionMode === "stop") return 0;
              if (cellVal === 3) return 0;
            }
          }
        }
        return maxHeight; // Vertical jumps use full sustain
      }

      // Horizontal jump: use Bezier arc check
      // Adaptive arc: peak just high enough for the jump, capped at maxHeight
      const neededPeakHeight = Math.max(-dy, 0) + this.cellSize;
      const actualPeakHeight = Math.min(maxHeight, neededPeakHeight);
      const peakY = from.y - actualPeakHeight;
      const controlY = 2 * peakY - (from.y + to.y) / 2;

      // Adaptive sample count based on total arc travel (not straight-line distance).
      // The Bezier can bow significantly above the start→end line (especially for
      // double-jump second arcs with large downward drops), so use the total vertical
      // travel (up to peak + peak down to end) plus horizontal distance.
      const totalArcTravel = Math.abs(dx) + Math.abs(from.y - peakY) + Math.abs(peakY - to.y);
      const numSteps = Math.max(8, Math.ceil(totalArcTravel / (this.cellSize * 0.5)));

      for (let i = 0; i <= numSteps; i++) {
        const t = i / numSteps;
        const x = from.x + dx * t;
        const oneMinusT = 1 - t;
        const arcY = from.y * oneMinusT * oneMinusT + 2 * controlY * t * oneMinusT + to.y * t * t;

        const grid = this.worldToGrid(x, arcY);

        if (
          grid.gx < 0 ||
          grid.gx >= this.gridWidth ||
          grid.gy < 0 ||
          grid.gy >= this.gridHeight
        ) {
          return 0;
        }

        // Only check center column — Platform behavior handles wall collisions at runtime.
        // This allows jumps through 1-tile-wide gaps and past adjacent walls.
        for (let h = 0; h <= headCells; h++) {
          const checkGy = grid.gy - h;
          if (checkGy < 0) return 0;
          const index = checkGy * this.gridWidth + grid.gx;
          const cellVal = this.obstacleMap ? this.obstacleMap[index] : 0;

          if (h === 0) {
            if (cellVal === 1) return 0;
            if (cellVal === 3) return 0;
            if (cellVal === 2) {
              const prevT = Math.max(0, (i - 1) / numSteps);
              const prevOneMinusT = 1 - prevT;
              const prevArcY = from.y * prevOneMinusT * prevOneMinusT + 2 * controlY * prevT * prevOneMinusT + to.y * prevT * prevT;
              if (arcY > prevArcY) return 0;
            }
            // Slope blocking: only block arcs that pass through the SOLID BODY of a slope
            // tile (below the slope's surface line). Arcs passing above the slope surface
            // are in clear air and must not be blocked — e.g. a jump from (31,6) to (25,7)
            // legitimately passes over slope tiles (30,7) and (29,7) which are walkable ground.
            // The old "block any slope cell at i>0" approach caused 83 fewer jump connections
            // when slopes were registered vs not registered.
            // The destination cell is always exempt — it's the landing zone.
            const isDestCell = (grid.gx === to.gx && grid.gy === to.gy);
            if (i > 0 && i < numSteps && !isDestCell && this.slopeMap && this.slopeMap[index] > 0) {
              // Calculate the slope's surface Y at the arc's X position within the cell.
              // Block only when arcY > surfaceY (arc is inside the solid body below the surface).
              const cs = this.cellSize;
              const slopeType = this.slopeMap[index];
              const localX = x - grid.gx * cs; // X offset within the tile [0, cs)
              let surfaceY;
              if (slopeType === 1) {
                // slope_left (/): surface from bottom-left to top-right
                surfaceY = (grid.gy + 1) * cs - localX;
              } else if (slopeType === 2) {
                // slope_right (\): surface from top-left to bottom-right
                surfaceY = grid.gy * cs + localX;
              } else if (slopeType === 3) {
                // gentle_left (/): 22.5° — spans two same-row tiles.
                // Right half if the same-row left neighbour is also gentle_left.
                const leftIdx = grid.gy * this.gridWidth + (grid.gx - 1);
                const isRightHalf = grid.gx > 0 && this.slopeMap[leftIdx] === 3;
                surfaceY = isRightHalf
                  ? (grid.gy + 0.5) * cs - localX * 0.5   // right half: mid→top-right
                  : (grid.gy + 1) * cs - localX * 0.5;    // left half: bottom-left→mid
              } else {
                // gentle_right (\): 22.5° — spans two same-row tiles.
                const leftIdx = grid.gy * this.gridWidth + (grid.gx - 1);
                const isRightHalf = grid.gx > 0 && this.slopeMap[leftIdx] === 4;
                surfaceY = isRightHalf
                  ? (grid.gy + 0.5) * cs + localX * 0.5   // right half: mid→bottom-right
                  : grid.gy * cs + localX * 0.5;           // left half: top-left→mid
              }
              if (arcY > surfaceY) return 0;
            }
          } else {
            if (cellVal === 1 && this.platformProps.ceilingCollisionMode === "stop") {
              return 0;
            }
            if (cellVal === 3) return 0;
          }
        }
      }

      return actualPeakHeight;
    }

    /** Creates straight-down and diagonal fall connections from nodes to lower platforms within maxFallDistance. */
    _connectFall() {
      const maxFallCells = Math.ceil(this.maxFallDistance / this.cellSize);
      let count = 0;
      let diagCount = 0;
      const graph = this._getNavigationGraph();

      for (const [key, node] of graph) {
        // Slope nodes don't need straight falls: adjacent slope tiles below are
        // connected via _connectSlope (walk), and ledge departures use diagonal falls.
        if (!node.isSlope) {
          for (let fall = 1; fall <= maxFallCells; fall++) {
            const targetGy = node.gy + fall;
            const target = this.getNode(node.gx, targetGy);
            if (target && this._canFall(node, target)) {
              const baseCost = Math.abs(target.y - node.y) * this.FALL_COST;
              node.connections.push({
                target,
                action: "fall",
                cost: baseCost * this._fallLandingCostMultiplier(target),
              });
              count++;
              break;
            }
          }
        }

        if (node.isLeftLedge) {
          diagCount += this._addDiagonalFall(node, -1, maxFallCells);
        }
        if (node.isRightLedge) {
          diagCount += this._addDiagonalFall(node, 1, maxFallCells);
        }
      }

      this._log(`Created ${count} straight fall + ${diagCount} diagonal fall connections (maxFallCells=${maxFallCells})`);
    }

    /** Returns true if a straight vertical fall from one node to another is unobstructed. */
    _canFall(from, to) {
      if (to.y <= from.y) return false;
      const widthCells = this._getWidthCells();

      for (let i = 1; i < 5; i++) {
        const checkGy = from.gy + i;
        if (checkGy >= to.gy) break;
        for (let w = -widthCells; w <= widthCells; w++) {
          if (this.isCellBlocked(from.gx + w, checkGy)) return false;
        }
      }

      return true;
    }

    /** Adds diagonal fall_left/fall_right connections from a ledge node, based on gravity and max horizontal drift. */
    _addDiagonalFall(node, direction, maxFallCells) {
      const gravity = this.platformProps.gravity;
      const maxSpeed = this.platformProps.maxSpeed;
      let added = 0;

      for (let fall = 1; fall <= maxFallCells; fall++) {
        const fallDist = fall * this.cellSize;
        const fallTime = Math.sqrt((2 * fallDist) / gravity);
        const maxDrift = Math.ceil((maxSpeed * fallTime) / this.cellSize);

        for (let drift = 1; drift <= maxDrift; drift++) {
          const targetGx = node.gx + direction * drift;
          const targetGy = node.gy + fall;
          const target = this.getNode(targetGx, targetGy);

          if (target && this._canDiagonalFall(node, target, direction)) {
            const dist = this.distance(node.x, node.y, target.x, target.y);
            const baseCost = dist * this.FALL_COST;
            node.connections.push({
              target,
              action: direction < 0 ? "fall_left" : "fall_right",
              cost: baseCost * this._fallLandingCostMultiplier(target),
            });
            added++;
            break;
          }
        }
      }
      return added;
    }

    /** Returns true if a diagonal fall path (parabolic approximation) is unobstructed, checking character width. */
    _canDiagonalFall(from, to, direction) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (dy <= 0) return false;
      const widthCells = this._getWidthCells();
      const cs = this.cellSize;

      // For each row, check the full horizontal span the arc sweeps through.
      // A single center-sample per row misses cells when the arc crosses a column
      // boundary while still in the same gy row (e.g. the departure row where the
      // character transitions from gx=19 into gx=18 before gy changes, but cell
      // (18,gy) is the solid slope body of the adjacent slope tile).
      // Parabolic path: x(t) = from.x + dx*t, y(t) = from.y + dy*t²
      // t at top/bottom of each row: t = sqrt((rowEdgeY - from.y) / dy)
      for (let gy = from.gy; gy <= to.gy; gy++) {
        const tEnter = Math.sqrt(Math.max(0, (gy * cs - from.y) / dy));
        const tExit  = Math.sqrt(Math.max(0, ((gy + 1) * cs - from.y) / dy));
        if (tEnter > 1.0) break;
        const xEnter = from.x + dx * Math.min(tEnter, 1.0);
        const xExit  = from.x + dx * Math.min(tExit,  1.0);
        const gxMin  = Math.floor(Math.min(xEnter, xExit) / cs);
        const gxMax  = Math.floor(Math.max(xEnter, xExit) / cs);
        for (let gx = gxMin; gx <= gxMax; gx++) {
          for (let w = -widthCells; w <= widthCells; w++) {
            if (this.isCellBlocked(gx + w, gy)) return false;
          }
        }
      }
      return true;
    }

    // Prefer falling onto nodes that have walk connections — makes reverse
    // pathing produce paths that are easier to climb upward from.
    _fallLandingCostMultiplier(targetNode) {
      const hasWalk = targetNode.connections.some(
        (c) => c.action === "walk_left" || c.action === "walk_right"
      );
      return hasWalk ? 0.7 : 1.0;
    }

    /** Creates coyote jump connections from ledge nodes — jumps that start after stepping off the edge during the coyote time window. */
    _connectCoyoteJump() {
      if (this.coyoteTime <= 0) return;

      const graph = this._getNavigationGraph();
      const gravity = this.platformProps.gravity;
      const jumpStrength = this.platformProps.jumpStrength;
      let count = 0;

      for (const [key, node] of graph) {
        if (!node.isLeftLedge && !node.isRightLedge) continue;

        const coyoteFallDist =
          0.5 * gravity * this.coyoteTime * this.coyoteTime;
        const effectiveStartY = node.y + coyoteFallDist;

        const maxHeightCells = Math.ceil(this.maxJumpHeight / this.cellSize);
        const maxDistCells = Math.ceil(this.maxJumpDistance / this.cellSize);

        for (const dir of [-1, 1]) {
          if (dir === -1 && !node.isLeftLedge) continue;
          if (dir === 1 && !node.isRightLedge) continue;

          for (let dist = 1; dist <= maxDistCells; dist++) {
            for (let height = -2; height <= maxHeightCells; height++) {
              const targetGx = node.gx + dir * dist;
              const targetGy = node.gy - height;
              const target = this.getNode(targetGx, targetGy);

              if (target) {
                const effectiveHeight = effectiveStartY - target.y;
                if (effectiveHeight > this.maxJumpHeight) continue;

                const distance = this.distance(
                  node.x,
                  effectiveStartY,
                  target.x,
                  target.y
                );
                node.connections.push({
                  target,
                  action: "coyote_jump",
                  cost: distance * this.COYOTE_JUMP_COST,
                });
                count++;
              }
            }
          }
        }
      }

      this._log(`Created ${count} coyote jump connections`);
    }

    /** Creates fall-through connections from nodes standing on jump-thru platforms to nodes below. */
    _connectFallThrough() {
      const graph = this._getNavigationGraph();
      let count = 0;

      for (const [key, node] of graph) {
        if (!node.isOnJumpThru) continue;

        const maxFallCells = Math.ceil(this.maxFallDistance / this.cellSize);
        for (let fall = 2; fall <= maxFallCells; fall++) {
          const target = this.getNode(node.gx, node.gy + fall);
          if (target) {
            const baseCost = Math.abs(target.y - node.y) * this.FALL_COST * 1.2;
            node.connections.push({
              target,
              action: "fall_through",
              cost: baseCost * this._fallLandingCostMultiplier(target),
            });
            count++;
            break;
          }
        }
      }

      this._log(`Created ${count} fall-through connections`);
    }

    /** Creates walk connections along slope tiles, linking diagonally adjacent slope/flat nodes based on slope direction. Supports 45° (1:1) and 22.5° (2:1) gentle slopes. */
    _connectSlope() {
      if (!this.slopeMap) return;

      const graph = this._getNavigationGraph();
      let count = 0;

      const dirNames = { 1: "slope_left(/)", 2: "slope_right(\\)", 3: "gentle_left(/)", 4: "gentle_right(\\)" };
      const dirCounts = {};

      // Slope edge costs must be >= Euclidean distance so the A* heuristic stays consistent.
      // sqrt(2)*cellSize for 45° diagonals, sqrt(5)*cellSize for gentle diagonals.
      const slopeDiagCost = Math.SQRT2 * this.cellSize * this.SLOPE_COST;       // 45° (1:1)
      const gentleDiagCost = Math.sqrt(5) * this.cellSize * this.SLOPE_COST;    // 22.5° (2:1)
      const midSlopeCost = this.cellSize * this.SLOPE_COST;                      // horizontal mid-slope

      for (const [key, node] of graph) {
        if (!node.isSlope) continue;

        const dir = node.slopeDirection;
        dirCounts[dir] = (dirCounts[dir] || 0) + 1;

        if (dir === 1) {
          // 45° slope-left (/): down-left, up-right
          const down = this.getNode(node.gx - 1, node.gy + 1);
          const up = this.getNode(node.gx + 1, node.gy - 1);
          if (down) {
            node.connections.push({ target: down, action: "walk_left", cost: slopeDiagCost }); count++;
            if (!down.isSlope) { down.connections.push({ target: node, action: "walk_right", cost: slopeDiagCost }); count++; }
          }
          if (up) {
            node.connections.push({ target: up, action: "walk_right", cost: slopeDiagCost }); count++;
            if (!up.isSlope) { up.connections.push({ target: node, action: "walk_left", cost: slopeDiagCost }); count++; }
          }
        } else if (dir === 2) {
          // 45° slope-right (\): up-left, down-right
          const up = this.getNode(node.gx - 1, node.gy - 1);
          const down = this.getNode(node.gx + 1, node.gy + 1);
          if (up) {
            node.connections.push({ target: up, action: "walk_left", cost: slopeDiagCost }); count++;
            if (!up.isSlope) { up.connections.push({ target: node, action: "walk_right", cost: slopeDiagCost }); count++; }
          }
          if (down) {
            node.connections.push({ target: down, action: "walk_right", cost: slopeDiagCost }); count++;
            if (!down.isSlope) { down.connections.push({ target: node, action: "walk_left", cost: slopeDiagCost }); count++; }
          }
        } else if (dir === 3) {
          // 22.5° gentle-left (/): 2 tiles horizontal per 1 vertical
          const down = this.getNode(node.gx - 2, node.gy + 1);
          const up = this.getNode(node.gx + 2, node.gy - 1);
          if (down) {
            node.connections.push({ target: down, action: "walk_left", cost: gentleDiagCost }); count++;
            if (!down.isSlope) { down.connections.push({ target: node, action: "walk_right", cost: gentleDiagCost }); count++; }
          }
          if (up) {
            node.connections.push({ target: up, action: "walk_right", cost: gentleDiagCost }); count++;
            if (!up.isSlope) { up.connections.push({ target: node, action: "walk_left", cost: gentleDiagCost }); count++; }
          }
          // Horizontal mid-slope connections (skip if _connectWalk already created this link)
          const midLeft = this.getNode(node.gx - 1, node.gy);
          const midRight = this.getNode(node.gx + 1, node.gy);
          if (midLeft && midLeft.isSlope && !node.connections.some(c => c.target === midLeft && c.action === "walk_left")) {
            node.connections.push({ target: midLeft, action: "walk_left", cost: midSlopeCost }); count++;
          }
          if (midRight && midRight.isSlope && !node.connections.some(c => c.target === midRight && c.action === "walk_right")) {
            node.connections.push({ target: midRight, action: "walk_right", cost: midSlopeCost }); count++;
          }
        } else if (dir === 4) {
          // 22.5° gentle-right (\): 2 tiles horizontal per 1 vertical
          const up = this.getNode(node.gx - 2, node.gy - 1);
          const down = this.getNode(node.gx + 2, node.gy + 1);
          if (up) {
            node.connections.push({ target: up, action: "walk_left", cost: gentleDiagCost }); count++;
            if (!up.isSlope) { up.connections.push({ target: node, action: "walk_right", cost: gentleDiagCost }); count++; }
          }
          if (down) {
            node.connections.push({ target: down, action: "walk_right", cost: gentleDiagCost }); count++;
            if (!down.isSlope) { down.connections.push({ target: node, action: "walk_left", cost: gentleDiagCost }); count++; }
          }
          // Horizontal mid-slope connections (skip if _connectWalk already created this link)
          const midLeft = this.getNode(node.gx - 1, node.gy);
          const midRight = this.getNode(node.gx + 1, node.gy);
          if (midLeft && midLeft.isSlope && !node.connections.some(c => c.target === midLeft && c.action === "walk_left")) {
            node.connections.push({ target: midLeft, action: "walk_left", cost: midSlopeCost }); count++;
          }
          if (midRight && midRight.isSlope && !node.connections.some(c => c.target === midRight && c.action === "walk_right")) {
            node.connections.push({ target: midRight, action: "walk_right", cost: midSlopeCost }); count++;
          }
        }
      }

      const dirSummary = Object.entries(dirCounts).map(([d, c]) => `${dirNames[d] || "unknown(" + d + ")"}:${c}`).join(", ");
      this._log(`Created ${count} slope connections (${dirSummary || "no slope nodes"})`);

      // Diagnostic: dump each slope node's slope connections
      for (const [key, node] of graph) {
        if (!node.isSlope) continue;
        const slopeConns = node.connections.filter(c => c.action.includes("walk")).map(c => `${c.action}→(${c.target.gx},${c.target.gy})`).join(", ");
        this._log(`  Slope node (${node.gx},${node.gy}) dir=${dirNames[node.slopeDirection]}: ${slopeConns || "NO walk connections"}`);
      }
    }

    aceAddCircleHazard(x, y, radius, severity) {
      this.enableHazards = true;
      const hazardId = this.nextHazardId++;
      const hazardsMap = this._getHazardsMap();
      hazardsMap.set(hazardId, {
        id: hazardId,
        type: "circle",
        x,
        y,
        radius,
        severity,
      });
      return hazardId;
    }

    aceAddRectHazard(x, y, width, height, severity) {
      this.enableHazards = true;
      const hazardId = this.nextHazardId++;
      const hazardsMap = this._getHazardsMap();
      hazardsMap.set(hazardId, {
        id: hazardId,
        type: "rect",
        x,
        y,
        width,
        height,
        severity,
      });
      return hazardId;
    }

    aceRemoveHazard(hazardId) {
      const hazardsMap = this._getHazardsMap();
      hazardsMap.delete(hazardId);
    }

    aceClearAllHazards() {
      const hazardsMap = this._getHazardsMap();
      hazardsMap.clear();
    }

    /** Returns true if a world position falls within any registered circle or rect hazard. */
    _isPositionHazardous(x, y) {
      if (!this.enableHazards) return false;

      const hazardsMap = this._getHazardsMap();
      for (const [id, hazard] of hazardsMap) {
        if (hazard.type === "circle") {
          const dist = this.distance(x, y, hazard.x, hazard.y);
          if (dist <= hazard.radius) return true;
        } else if (hazard.type === "rect") {
          const inX = x >= hazard.x && x <= hazard.x + hazard.width;
          const inY = y >= hazard.y && y <= hazard.y + hazard.height;
          if (inX && inY) return true;
        }
      }
      return false;
    }

    /** Returns the maximum hazard severity at a world position (1.0 = no hazard, higher = more dangerous). */
    _getHazardSeverity(x, y) {
      if (!this.enableHazards) return 1.0;

      let maxSeverity = 1.0;
      const hazardsMap = this._getHazardsMap();

      for (const [id, hazard] of hazardsMap) {
        if (hazard.type === "circle") {
          const dist = this.distance(x, y, hazard.x, hazard.y);
          if (dist <= hazard.radius) {
            maxSeverity = Math.max(maxSeverity, hazard.severity);
          }
        } else if (hazard.type === "rect") {
          const inX = x >= hazard.x && x <= hazard.x + hazard.width;
          const inY = y >= hazard.y && y <= hazard.y + hazard.height;
          if (inX && inY) {
            maxSeverity = Math.max(maxSeverity, hazard.severity);
          }
        }
      }

      return maxSeverity;
    }

    /** Recalculates the hazardMultiplier on every node in the graph based on current hazard zones and tile hazards. */
    _updateHazardCosts() {
      if (!this.enableHazards) return;

      const graph = this._getNavigationGraph();

      for (const [key, node] of graph) {
        let maxSeverity = 1.0;

        maxSeverity = Math.max(
          maxSeverity,
          this._getHazardSeverity(node.x, node.y)
        );

        if (this.hazardMap && this.hazardRadius > 0) {
          for (let dy = -this.hazardRadius; dy <= this.hazardRadius; dy++) {
            for (let dx = -this.hazardRadius; dx <= this.hazardRadius; dx++) {
              const hgx = node.gx + dx;
              const hgy = node.gy + dy;
              if (
                hgx < 0 ||
                hgx >= this.gridWidth ||
                hgy < 0 ||
                hgy >= this.gridHeight
              )
                continue;
              const tileSeverity =
                this.hazardMap[hgy * this.gridWidth + hgx] || 0;
              if (tileSeverity > 0) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= this.hazardRadius) {
                  const falloff = 1 - dist / (this.hazardRadius + 1);
                  const effectiveSeverity = 1 + (tileSeverity - 1) * falloff;
                  maxSeverity = Math.max(maxSeverity, effectiveSeverity);
                }
              }
            }
          }
        } else if (this.hazardMap) {
          const tileSeverity =
            this.hazardMap[node.gy * this.gridWidth + node.gx] || 0;
          if (tileSeverity > 0) {
            maxSeverity = Math.max(maxSeverity, tileSeverity);
          }
        }

        node.hazardMultiplier = maxSeverity;
      }
    }

    aceAddPortal(direction, entryX, entryY, exitX, exitY, portalType, cost, speed) {
      this.enablePortals = true;
      const portalsMap = this._getPortalsMap();
      const portalId = this.nextPortalId++;
      this.lastPortalId = portalId;

      const portal = {
        id: portalId,
        entryX,
        entryY,
        exitX,
        exitY,
        type: portalType || "instant",
        cost: (cost != null && cost > 0) ? cost : 1,
        speed: speed || 0,
        ignoreHazards: false,
        twoWay: direction === "two_way",
      };
      portalsMap.set(portalId, portal);

      if (this.graphGenerated) {
        this._connectPortalToGraph(portal);
      }
    }

    aceAddInstantPortal(direction, entryX, entryY, exitX, exitY, cost) {
      this.aceAddPortal(direction, entryX, entryY, exitX, exitY, "instant", cost, 0);
    }

    aceAddGradualPortal(direction, entryX, entryY, exitX, exitY, cost, speed) {
      this.aceAddPortal(direction, entryX, entryY, exitX, exitY, "gradual", cost, speed);
    }

    aceRemovePortal(portalId) {
      const portalsMap = this._getPortalsMap();
      const portal = portalsMap.get(portalId);
      if (portal) {
        this._removePortalConnections(portalId, portal);
        portalsMap.delete(portalId);
      }
    }

    aceClearAllPortals() {
      const portalsMap = this._getPortalsMap();
      const graph = this._getNavigationGraph();
      for (const [, node] of graph) {
        node.portalConnections = [];
      }
      portalsMap.clear();
    }

    /** Adds portal connections from the nearest entry node to the nearest exit node (and reverse if two-way). */
    _connectPortalToGraph(portal) {
      const entryNode = this._findNearestNode(portal.entryX, portal.entryY);
      const exitNode = this._findNearestNode(portal.exitX, portal.exitY);

      if (!entryNode || !exitNode) {
        this._warn(`Portal ${portal.id} could not connect to graph — entry: ${!!entryNode}, exit: ${!!exitNode}`);
        return;
      }

      if (entryNode === exitNode) {
        this._warn(`Portal ${portal.id}: entry and exit resolved to the same node (${entryNode.gx},${entryNode.gy}). Make sure entry and exit positions are on different platforms/nodes.`);
      }

      let portalCost = portal.cost;
      if (portal.type === "gradual" && portal.speed > 0 && portalCost === 1) {
        const dist = Math.sqrt((portal.exitX - portal.entryX) ** 2 + (portal.exitY - portal.entryY) ** 2);
        portalCost = (dist / portal.speed) * this.WALK_COST;
      }

      entryNode.portalConnections.push({
        target: exitNode,
        action: `portal_${portal.type}`,
        cost: portalCost,
        portalId: portal.id,
        speed: portal.speed || 0,
        ignoreHazards: portal.ignoreHazards || false,
      });

      if (portal.twoWay) {
        exitNode.portalConnections.push({
          target: entryNode,
          action: `portal_${portal.type}`,
          cost: portalCost,
          portalId: portal.id,
          speed: portal.speed || 0,
          ignoreHazards: portal.ignoreHazards || false,
        });
      }
    }

    /** Connects all registered portals to the navigation graph after node generation. */
    _connectAllPortals() {
      if (!this.enablePortals) return;

      const portalsMap = this._getPortalsMap();
      for (const [id, portal] of portalsMap) {
        this._connectPortalToGraph(portal);
      }
    }

    aceAddPortalFromObjects(direction, entryObjectClass, exitObjectClass, portalType, cost, speed) {
      const entryInst = entryObjectClass.getFirstPickedInstance();
      const exitInst = exitObjectClass.getFirstPickedInstance();
      if (!entryInst || !exitInst) {
        this._warn("Add portal from objects: could not find picked instances");
        return;
      }
      this.aceAddPortal(direction, entryInst.x, entryInst.y, exitInst.x, exitInst.y, portalType, cost, speed);
    }

    aceAddInstantPortalFromObjects(direction, entryObjectClass, exitObjectClass, cost) {
      this.aceAddPortalFromObjects(direction, entryObjectClass, exitObjectClass, "instant", cost, 0);
    }

    aceAddGradualPortalFromObjects(direction, entryObjectClass, exitObjectClass, cost, speed) {
      this.aceAddPortalFromObjects(direction, entryObjectClass, exitObjectClass, "gradual", cost, speed);
    }

    aceRemovePortalAtObject(objectClass) {
      const inst = objectClass.getFirstPickedInstance();
      if (!inst) return;
      const portalsMap = this._getPortalsMap();
      let closestId = -1;
      let closestDist = Infinity;
      for (const [id, portal] of portalsMap) {
        const entryDist = this.distance(inst.x, inst.y, portal.entryX, portal.entryY);
        const exitDist = this.distance(inst.x, inst.y, portal.exitX, portal.exitY);
        const dist = Math.min(entryDist, exitDist);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = id;
        }
      }
      if (closestId >= 0) {
        this.aceRemovePortal(closestId);
      }
    }

    aceSetPortalCost(portalId, cost) {
      const portalsMap = this._getPortalsMap();
      const portal = portalsMap.get(portalId);
      if (!portal) return;
      portal.cost = cost;
      if (this.graphGenerated) {
        this._removePortalConnections(portalId, portal);
        this._connectPortalToGraph(portal);
      }
    }

    aceSetPortalIgnoreHazards(portalId, ignoreHazards) {
      const portalsMap = this._getPortalsMap();
      const portal = portalsMap.get(portalId);
      if (!portal) return;
      portal.ignoreHazards = ignoreHazards;
      if (this.graphGenerated) {
        this._removePortalConnections(portalId, portal);
        this._connectPortalToGraph(portal);
      }
    }

    aceSetPortalSpeed(portalId, speed) {
      const portalsMap = this._getPortalsMap();
      const portal = portalsMap.get(portalId);
      if (!portal) return;
      portal.speed = speed;
      if (this.graphGenerated) {
        this._removePortalConnections(portalId, portal);
        this._connectPortalToGraph(portal);
      }
    }

    aceAddElevatorStop(groupId, x, y, speed) {
      if (!this.elevatorGroups.has(groupId)) {
        this.elevatorGroups.set(groupId, []);
      }
      const stops = this.elevatorGroups.get(groupId);
      const newStop = { x, y, speed };

      // Create two-way gradual portals between this stop and all existing stops
      for (const stop of stops) {
        const dist = Math.sqrt((x - stop.x) ** 2 + (y - stop.y) ** 2);
        const portalSpeed = speed || stop.speed || 100;
        const cost = dist > 0 ? (dist / portalSpeed) * this.WALK_COST : 1;
        this.aceAddPortal("two_way", stop.x, stop.y, x, y, "gradual", cost, portalSpeed);
      }

      stops.push(newStop);
    }

    aceAddElevatorStopFromObject(groupId, objectClass, speed) {
      const inst = objectClass.getFirstPickedInstance();
      if (!inst) {
        this._warn("Add elevator stop from object: could not find picked instance");
        return;
      }
      this.aceAddElevatorStop(groupId, inst.x, inst.y, speed);
    }

    /** Removes all portal connections for a specific portal ID from graph nodes. */
    _removePortalConnections(portalId, portal) {
      const entryNode = this._findNearestNode(portal.entryX, portal.entryY);
      if (entryNode) {
        entryNode.portalConnections = entryNode.portalConnections.filter(
          c => c.portalId !== portalId
        );
      }
      if (portal.twoWay) {
        const exitNode = this._findNearestNode(portal.exitX, portal.exitY);
        if (exitNode) {
          exitNode.portalConnections = exitNode.portalConnections.filter(
            c => c.portalId !== portalId
          );
        }
      }
    }

    aceGetLastPortalId() {
      return this.lastPortalId;
    }

    aceGetCurrentPortalId() {
      return this.currentPortalId;
    }

    /** Finds the closest navigation node to a world position (checks the exact cell first, then searches nearby cells). */
    _findNearestNode(x, y) {
      // Use the same resolution logic as findPath to ensure consistency
      const grid = this.worldToGrid(x, y);

      // 1. Try exact grid cell
      let node = this.getNode(grid.gx, grid.gy);
      if (node) return node;

      // 2. Try adjacent cells (Manhattan-expanding search like _correctToGround)
      for (let r = 1; r <= 10; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) + Math.abs(dy) !== r) continue;
            node = this.getNode(grid.gx + dx, grid.gy + dy);
            if (node) return node;
          }
        }
      }

      return null;
    }

    /** Full graph generation pipeline: scans obstacles, generates nodes, then creates walk/jump/fall/coyote/slope/portal connections. */
    _generateGraph() {
      if (this.isWaitingForPathfindingMap) return;

      // Graph Manager (SPOT, no Platform): inherit jump params from first Platform agent
      if (!this.platformBehavior && this.useSharedGraph) {
        const params = globalNavManager.getAgentParams(this.layoutUID);
        if (params) {
          if (!this._jumpParamsOverridden) {
            this.maxJumpHeight = params.maxJumpHeight;
            this.maxJumpDistance = params.maxJumpDistance;
            this.maxFallDistance = params.maxFallDistance;
            this.singleJumpHeight = params.singleJumpHeight;
            this.singleJumpDistance = params.singleJumpDistance;
            this.platformProps = { ...params.platformProps };
          }
          this.characterHeight = params.characterHeight;
          this.characterWidth = params.characterWidth;
        } else if (!this._jumpParamsOverridden) {
          this._log("Graph Manager: waiting for Platform agent to register params");
          return; // Delay graph build
        }
      }

      // Clear queued path requests — graph is being rebuilt (edge case #3)
      globalNavManager.clearQueue();

      const startTime = performance.now();
      const graph = this._getNavigationGraph();
      graph.clear();

      this._scanObstacles();
      if (!this.obstacleMap) return;

      this._generateNodes();
      this._connectWalk();
      this._connectJump();
      this._connectFall();
      this._connectCoyoteJump();
      this._connectFallThrough();
      this._connectSlope();
      this._connectAllPortals();
      this._updateHazardCosts();

      this._markGraphAsGenerated();

      // Record what capabilities this graph was built with so late-joining
      // instances with different capabilities can trigger a rebuild.
      if (this.useSharedGraph) {
        globalNavManager.setGraphCapabilities(this.layoutUID, {
          doubleJump: this.platformProps.isDoubleJumpEnabled,
        });
      }

      const endTime = performance.now();
      this._log(`Graph generated in ${(endTime - startTime).toFixed(2)}ms`);

      // this makes sure the trigger condition is called once the graph is generated.
      this._trigger("OnGraphGenerated");
    }

    /** Runs bidirectional A* (forward + reverse) and returns the best combined path between two world positions. */
    findPath(startX, startY, goalX, goalY) {
      let startGrid = this.worldToGrid(startX, startY);
      let goalGrid = this.worldToGrid(goalX, goalY);

      this._log(`Finding path from (${startGrid.gx},${startGrid.gy}) to (${goalGrid.gx},${goalGrid.gy})`);

      let startNode = this.getNode(startGrid.gx, startGrid.gy);
      let goalNode = this.getNode(goalGrid.gx, goalGrid.gy);

      // Snap to closest adjacent node if one is nearer (handles ledge-edge positions)
      if (startNode) {
        let bestDist = this.distance(startX, startY, startNode.x, startNode.y);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const adj = this.getNode(startGrid.gx + dx, startGrid.gy + dy);
            if (adj) {
              const adjDist = this.distance(startX, startY, adj.x, adj.y);
              if (adjDist < bestDist) {
                startNode = adj;
                startGrid = { gx: adj.gx, gy: adj.gy };
                bestDist = adjDist;
              }
            }
          }
        }
      }

      // Auto-correct to nearest ground node if exact position isn't on a node
      if (!startNode) {
        const corrected = this._correctToGround(startX, startY);
        startGrid = this.worldToGrid(corrected.x, corrected.y);
        startNode = this.getNode(startGrid.gx, startGrid.gy);
      }
      if (!goalNode) {
        const corrected = this._correctToGround(goalX, goalY);
        goalGrid = this.worldToGrid(corrected.x, corrected.y);
        goalNode = this.getNode(goalGrid.gx, goalGrid.gy);
      }

      if (!startNode || !goalNode) {
        if (!startNode) {
          this.lastPathFailReason = "no_start_node";
          this._warn(`Start node not found at grid (${startGrid.gx},${startGrid.gy}) even after ground correction`);
        } else {
          this.lastPathFailReason = "no_goal_node";
          this._warn(`Goal node not found at grid (${goalGrid.gx},${goalGrid.gy}) even after ground correction`);
        }
        return null;
      }

      // Early exit: same ground level, continuous walkable ground, no gaps/walls
      const sameLevel = Math.abs(startGrid.gy - goalGrid.gy) <= 1;
      if (sameLevel && startNode && goalNode) {
        const walkDir = goalGrid.gx > startGrid.gx ? 1 : -1;
        let canDirectWalk = true;
        const checkGy = startGrid.gy;
        for (let gx = startGrid.gx; gx !== goalGrid.gx + walkDir; gx += walkDir) {
          if (!this._isGroundAt(gx, checkGy + 1) && !this._isSlopeWalkable(gx, checkGy)) {
            canDirectWalk = false;
            break;
          }
          const cellVal = this.obstacleMap[checkGy * this.gridWidth + gx];
          if (cellVal === 1 || cellVal === 3) {
            canDirectWalk = false;
            break;
          }
        }
        if (canDirectWalk) {
          const action = walkDir > 0 ? "walk_right" : "walk_left";
          this._log(`Early exit: direct walk ${action}`);
          return [
            { x: startNode.x, y: startNode.y, node: startNode, action: "start", requiresDoubleJump: false, peakHeight: 0 },
            { x: goalNode.x, y: goalNode.y, node: goalNode, action, requiresDoubleJump: false, peakHeight: 0 }
          ];
        }
      }

      // Log start/goal node connection summary
      const _connSummary = (n) => {
        const conns = [...n.connections, ...n.portalConnections];
        const actions = {};
        for (const c of conns) { actions[c.action] = (actions[c.action] || 0) + 1; }
        return Object.entries(actions).map(([a,c]) => `${a}:${c}`).join(', ');
      };
      this._log(`Start node (${startNode.gx},${startNode.gy}): ${startNode.connections.length + startNode.portalConnections.length} connections [${_connSummary(startNode)}]`);
      this._log(`Goal node (${goalNode.gx},${goalNode.gy}): ${goalNode.connections.length + goalNode.portalConnections.length} connections [${_connSummary(goalNode)}]`);

      // Try forward path (start → goal)
      this._lastAStarFailDetail = "";
      const forwardPath = this._runAStar(startNode, goalNode);
      const forwardFailDetail = this._lastAStarFailDetail;

      // Try reverse path (goal → start), then reverse it for a start → goal path
      this._lastAStarFailDetail = "";
      const reversePath = this._runAStar(goalNode, startNode);
      const reverseFailDetail = this._lastAStarFailDetail;
      let reversedPath = null;
      if (reversePath) {
        reversedPath = this._reversePathDirection(reversePath);
      }

      // Validate paths — reject any with broken connections
      const validForward = this._validatePath(forwardPath);
      const validReversed = this._validatePath(reversedPath);

      if (!validForward && forwardPath) this._log(`Forward path REJECTED by validation`);
      if (!validReversed && reversedPath) this._log(`Reversed path REJECTED by validation`);
      if (!validForward && !forwardPath) this._log(`Forward A* found no path: ${forwardFailDetail}`);
      if (!validReversed && !reversePath) this._log(`Reverse A* found no path: ${reverseFailDetail}`);

      // Combine forward and reverse paths for the best result
      let bestPath = null;
      if (validForward && validReversed) {
        bestPath = this._combinePaths(validForward, validReversed);
      } else if (validForward) {
        const _fmtPath = (p) => p.map((wp, i) => `${i}:(${wp.node ? wp.node.gx : '?'},${wp.node ? wp.node.gy : '?'})${wp.action}${wp.requiresDoubleJump ? '[dbl]' : ''}`).join(' → ');
        this._log(`Using forward path only (no valid reverse)`);
        this._log(`  Path: ${_fmtPath(validForward)}`);
        bestPath = validForward;
      } else if (validReversed) {
        const _fmtPath = (p) => p.map((wp, i) => `${i}:(${wp.node ? wp.node.gx : '?'},${wp.node ? wp.node.gy : '?'})${wp.action}${wp.requiresDoubleJump ? '[dbl]' : ''}`).join(' → ');
        this._log(`Using reversed path only (no valid forward)`);
        this._log(`  Path: ${_fmtPath(validReversed)}`);
        bestPath = validReversed;
      }

      // Validate the final combined path too
      bestPath = this._validatePath(bestPath);

      if (bestPath) {
        if (this.smoothPaths && bestPath.length > 2) {
          return this._smoothPath(bestPath);
        }
        return bestPath;
      }

      // Build informative fail reason
      const startConns = startNode.connections.length + startNode.portalConnections.length;
      const goalConns = goalNode.connections.length + goalNode.portalConnections.length;

      if (startConns === 0 && goalConns === 0) {
        this.lastPathFailReason = "both_isolated";
        this._warn(`No path: both start (${startGrid.gx},${startGrid.gy}) and goal (${goalGrid.gx},${goalGrid.gy}) have 0 connections`);
      } else if (startConns === 0) {
        this.lastPathFailReason = "start_isolated";
        this._warn(`No path: start node (${startGrid.gx},${startGrid.gy}) has 0 connections`);
      } else if (goalConns === 0) {
        this.lastPathFailReason = "goal_isolated";
        this._warn(`No path: goal node (${goalGrid.gx},${goalGrid.gy}) has 0 connections`);
      } else {
        this.lastPathFailReason = "no_path";
        this._warn(`No path found. Forward: ${forwardFailDetail || "failed"}. Reverse: ${reverseFailDetail || "failed"}`);
      }
      return null;
    }

    /** Runs A* search from startNode to goalNode; returns the reconstructed path or null if unreachable. */
    _runAStar(startNode, goalNode) {
      const graph = this._getNavigationGraph();
      for (const [key, node] of graph) {
        node.gScore = Infinity;
        node.hScore = Infinity;
        node.fScore = Infinity;
        node.parent = null;
        node.parentAction = null;
        node.parentPortalId = null;
        node.parentSpeed = null;
      }

      startNode.gScore = 0;
      startNode.hScore = this.distance(
        startNode.x,
        startNode.y,
        goalNode.x,
        goalNode.y
      );
      startNode.fScore = startNode.hScore;

      const openSet = new BinaryHeap();
      openSet.push(startNode);
      const closedSet = new Set();

      let nodesExplored = 0;

      const agentHash = this.multiAgentAvoidance
        ? globalNavManager.getAgentSpatialHash(this.layoutUID, this.cellSize) : null;

      while (openSet.size > 0) {
        if (nodesExplored >= this.maxSearchNodes) {
          this._lastAStarFailDetail = `search_exhausted (explored ${nodesExplored}/${this.maxSearchNodes} nodes)`;
          return null;
        }

        const current = openSet.pop();
        nodesExplored++;

        if (current === goalNode) {
          return this._reconstructPath(goalNode);
        }

        closedSet.add(current);

        const allConnections = [
          ...current.connections,
          ...current.portalConnections,
        ];

        for (const conn of allConnections) {
          const neighbor = conn.target;
          if (closedSet.has(neighbor)) continue;

          // Skip double-jump connections if this instance can't double jump.
          // The graph is shared (SPOT), so connections built by a double-jump
          // instance must not be traversed by non-double-jump instances.
          if (conn.requiresDoubleJump && !this.platformProps.isDoubleJumpEnabled) continue;

          const hazardMultiplier = conn.ignoreHazards
            ? 1.0
            : this.enableHazards
            ? neighbor.hazardMultiplier || 1.0
            : 1.0;

          let agentAvoidanceCost = 1.0;
          if (agentHash) {
            const nearby = agentHash.query(neighbor.x, neighbor.y, this.cellSize * 2);
            for (const agent of nearby) {
              const dist = this.distance(
                neighbor.x,
                neighbor.y,
                agent.x,
                agent.y
              );
              if (dist < this.cellSize * 2) {
                agentAvoidanceCost +=
                  (2 - dist / (this.cellSize * 2)) * 3.0;
              }
            }
          }

          const tentativeG =
            current.gScore +
            conn.cost * hazardMultiplier * agentAvoidanceCost;

          if (tentativeG < neighbor.gScore) {
            // Diagnostic: log every update to the goal node
            if (neighbor === goalNode) {
              this._log(`  A* goal update: from (${current.gx},${current.gy}) action=${conn.action} cost=${conn.cost.toFixed(1)} tentativeG=${tentativeG.toFixed(1)} (prev gScore=${neighbor.gScore === Infinity ? "Inf" : neighbor.gScore.toFixed(1)} action=${neighbor.parentAction || "none"})`);
            }
            neighbor.parent = current;
            neighbor.parentAction = conn.action;
            neighbor.parentPortalId = conn.portalId || null;
            neighbor.parentSpeed = conn.speed || 0;
            neighbor.parentPeakHeight = conn.peakHeight || 0;
            neighbor.parentRequiresDoubleJump = conn.requiresDoubleJump || false;
            neighbor.gScore = tentativeG;
            neighbor.hScore = this.distance(
              neighbor.x,
              neighbor.y,
              goalNode.x,
              goalNode.y
            );
            neighbor.fScore = neighbor.gScore + neighbor.hScore;

            if (!openSet.contains(neighbor)) {
              openSet.push(neighbor);
            } else {
              openSet.update(neighbor);
            }
          }
        }
      }

      const startConns = startNode.connections.length + startNode.portalConnections.length;
      if (startConns === 0) {
        this._lastAStarFailDetail = `start_isolated (node at ${startNode.gx},${startNode.gy} has 0 connections)`;
      } else {
        this._lastAStarFailDetail = `goal_unreachable (explored ${nodesExplored} nodes, goal at ${goalNode.gx},${goalNode.gy})`;
      }
      return null;
    }

    /** Reverses an A* path (goal→start becomes start→goal) and fixes each waypoint's action using actual graph connections. */
    _reversePathDirection(path) {
      // The path was found goal→start, so waypoints are [goal, ..., start].
      // Reverse order to get [start, ..., goal].
      const reversed = [];
      for (let i = path.length - 1; i >= 0; i--) {
        reversed.push({
          node: path[i].node,
          x: path[i].x,
          y: path[i].y,
          action: "start",
          portalId: null,
          speed: 0,
          requiresDoubleJump: false,
        });
      }
      // Fix actions: each waypoint needs the action to reach the NEXT waypoint
      // Look up actual connections between consecutive nodes in the forward direction
      for (let i = 0; i < reversed.length - 1; i++) {
        const fromNode = reversed[i].node;
        const toNode = reversed[i + 1].node;
        const conn = this._findConnectionBetween(fromNode, toNode);
        if (!conn) {
          return null;
        }
        reversed[i + 1].action = conn.action;
        reversed[i + 1].portalId = conn.portalId || null;
        reversed[i + 1].speed = conn.speed || 0;
        reversed[i + 1].peakHeight = conn.peakHeight || 0;
        reversed[i + 1].requiresDoubleJump = conn.requiresDoubleJump || false;
      }
      reversed[0].action = "start";
      return reversed;
    }

    /** Validate that every consecutive waypoint pair has a valid graph connection.
     * Returns the path if valid, or null if any segment is unreachable. */
    _validatePath(path) {
      if (!path || path.length < 2) return path;
      for (let i = 0; i < path.length - 1; i++) {
        const fromNode = path[i].node;
        const toNode = path[i + 1].node;
        if (!fromNode || !toNode) continue; // start/end may not have nodes
        if (fromNode === toNode) continue;
        // Try to find the connection matching the path's action first; fall back to cheapest
        const conn = this._findConnectionBetween(fromNode, toNode, path[i + 1].action);
        if (!conn) {
          this._log(`Path validation failed: no connection between (${fromNode.gx},${fromNode.gy}) and (${toNode.gx},${toNode.gy}) at waypoint ${i}`);
          return null;
        }
        // Fix action only if the path's action doesn't exist for this edge
        // (can happen when _combinePaths merges at a common node)
        if (path[i + 1].action !== conn.action) {
          path[i + 1].action = conn.action;
          path[i + 1].portalId = conn.portalId || null;
          path[i + 1].speed = conn.speed || 0;
          path[i + 1].peakHeight = conn.peakHeight || 0;
          path[i + 1].requiresDoubleJump = conn.requiresDoubleJump || false;
        }
      }
      return path;
    }

    /** Returns the best graph connection from one node to another, or null.
     *  If preferredAction is given, returns that action's connection if it exists;
     *  otherwise returns the cheapest connection to the target. */
    _findConnectionBetween(fromNode, toNode, preferredAction) {
      const allConnections = [
        ...fromNode.connections,
        ...fromNode.portalConnections,
      ];
      let best = null;
      for (const conn of allConnections) {
        if (conn.target !== toNode) continue;
        if (preferredAction && conn.action === preferredAction) return conn;
        if (!best || conn.cost < best.cost) best = conn;
      }
      return best;
    }

    /** Sums up the Euclidean distance cost of all segments in a path. */
    _pathCost(path) {
      let cost = 0;
      for (let i = 1; i < path.length; i++) {
        cost += this.distance(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
      }
      return cost;
    }

    /** Evaluates a path's cost using the active strategy (balanced, shortest, safest, or simplest). */
    _strategyCost(path) {
      switch (this.pathStrategy) {
        case "shortest":
          return this._pathCost(path);

        case "safest": {
          let cost = 0;
          for (let i = 1; i < path.length; i++) {
            const dist = this.distance(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
            const action = path[i].action;
            if (action === "jump" || action === "coyote_jump")
              cost += dist * 2.5;
            else if (action.includes("fall"))
              cost += dist * 1.5;
            else
              cost += dist * 1.0;
          }
          return cost;
        }

        case "simplest":
          return path.length * 10000 + this._pathCost(path);

        case "balanced":
        default: {
          let cost = 0;
          for (let i = 1; i < path.length; i++) {
            const dist = this.distance(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
            const action = path[i].action;
            if (action === "jump" || action === "coyote_jump")
              cost += dist * 1.5;
            else if (action.includes("fall"))
              cost += dist * 1.2;
            else
              cost += dist * 1.0;
          }
          return cost;
        }
      }
    }

    /** Selects the best path from forward, reversed, and hybrid combinations through common intermediate nodes. */
    _combinePaths(forwardPath, reversedPath) {
      const forwardCost = this._strategyCost(forwardPath);
      const reverseCost = this._strategyCost(reversedPath);

      // Build node→index maps for each path
      const forwardNodeIdx = new Map();
      for (let i = 0; i < forwardPath.length; i++) {
        const key = forwardPath[i].node;
        if (!forwardNodeIdx.has(key)) forwardNodeIdx.set(key, i);
      }
      const reverseNodeIdx = new Map();
      for (let i = 0; i < reversedPath.length; i++) {
        const key = reversedPath[i].node;
        if (!reverseNodeIdx.has(key)) reverseNodeIdx.set(key, i);
      }

      // Start with the pure paths as candidates
      let bestPath = forwardCost <= reverseCost ? forwardPath : reversedPath;
      let bestCost = Math.min(forwardCost, reverseCost);

      // Try hybrid paths through common intermediate nodes
      for (const [node, fwdIdx] of forwardNodeIdx) {
        if (!reverseNodeIdx.has(node)) continue;
        const revIdx = reverseNodeIdx.get(node);

        // Skip start/end nodes — no hybrid benefit
        if (fwdIdx === 0 || revIdx === 0) continue;
        if (fwdIdx === forwardPath.length - 1 || revIdx === reversedPath.length - 1) continue;

        // Hybrid 1: forward first half + reverse second half
        const hybrid1 = [
          ...forwardPath.slice(0, fwdIdx),
          ...reversedPath.slice(revIdx),
        ];
        // Fix merge point: the first waypoint of the second half carries the action
        // from the reversed path's predecessor, not the forward path's. Look up the
        // actual connection between the last first-half node and the merge point.
        if (fwdIdx > 0 && hybrid1.length > fwdIdx) {
          const conn = this._findConnectionBetween(hybrid1[fwdIdx - 1].node, hybrid1[fwdIdx].node);
          if (conn) {
            hybrid1[fwdIdx].action = conn.action;
            hybrid1[fwdIdx].portalId = conn.portalId || null;
            hybrid1[fwdIdx].speed = conn.speed || 0;
            hybrid1[fwdIdx].peakHeight = conn.peakHeight || 0;
            hybrid1[fwdIdx].requiresDoubleJump = conn.requiresDoubleJump || false;
          }
        }
        const cost1 = this._strategyCost(hybrid1);
        if (cost1 < bestCost) {
          bestCost = cost1;
          bestPath = hybrid1;
        }

        // Hybrid 2: reverse first half + forward second half
        const hybrid2 = [
          ...reversedPath.slice(0, revIdx),
          ...forwardPath.slice(fwdIdx),
        ];
        // Fix merge point action (same issue — forward path's action is for a different predecessor)
        if (revIdx > 0 && hybrid2.length > revIdx) {
          const conn = this._findConnectionBetween(hybrid2[revIdx - 1].node, hybrid2[revIdx].node);
          if (conn) {
            hybrid2[revIdx].action = conn.action;
            hybrid2[revIdx].portalId = conn.portalId || null;
            hybrid2[revIdx].speed = conn.speed || 0;
            hybrid2[revIdx].peakHeight = conn.peakHeight || 0;
            hybrid2[revIdx].requiresDoubleJump = conn.requiresDoubleJump || false;
          }
        }
        const cost2 = this._strategyCost(hybrid2);
        if (cost2 < bestCost) {
          bestCost = cost2;
          bestPath = hybrid2;
        }
      }

      const _fmtPath = (p) => p.map((wp, i) => `${i}:(${wp.node ? wp.node.gx : '?'},${wp.node ? wp.node.gy : '?'})${wp.action}${wp.requiresDoubleJump ? '[dbl]' : ''}`).join(' → ');
      this._log(`Combined path: cost=${Math.round(bestCost)} (fwd=${Math.round(forwardCost)}, rev=${Math.round(reverseCost)}, strategy=${this.pathStrategy})`);
      this._log(`  Forward path:  ${_fmtPath(forwardPath)}`);
      this._log(`  Reversed path: ${_fmtPath(reversedPath)}`);
      this._log(`  Selected path: ${_fmtPath(bestPath)}`);
      return bestPath;
    }

    /** Traces parent pointers from the goal back to the start, building a waypoint array with actions and metadata. */
    _reconstructPath(goalNode) {
      const path = [];
      let current = goalNode;

      while (current) {
        path.unshift({
          node: current,
          action: current.parentAction || "start",
          portalId: current.parentPortalId || null,
          speed: current.parentSpeed || 0,
          peakHeight: current.parentPeakHeight || 0,
          requiresDoubleJump: current.parentRequiresDoubleJump || false,
          x: current.x,
          y: current.y,
        });
        current = current.parent;
      }

      return path;
    }

    /** Removes redundant walk waypoints by skipping intermediate nodes that can be walked directly (line-of-sight). */
    _smoothPath(path) {
      if (path.length <= 2) return path;

      const smoothed = [path[0]];
      let i = 0;

      while (i < path.length - 1) {
        let farthest = i + 1;

        for (let j = i + 2; j < path.length; j++) {
          if (this._canSkipTo(path[i], path[j])) {
            farthest = j;
          } else {
            break;
          }
        }

        smoothed.push(path[farthest]);
        i = farthest;
      }

      return smoothed;
    }

    /** Returns true if a character can walk directly from waypointA to waypointB without obstacles or gaps. */
    _canSkipTo(waypointA, waypointB) {
      if (
        !waypointA.action.includes("walk") ||
        !waypointB.action.includes("walk")
      )
        return false;
      if (waypointA.node.gy !== waypointB.node.gy) return false;

      const startGx = Math.min(waypointA.node.gx, waypointB.node.gx);
      const endGx = Math.max(waypointA.node.gx, waypointB.node.gx);
      const gy = waypointA.node.gy;

      for (let gx = startGx; gx <= endGx; gx++) {
        if (this.isCellBlocked(gx, gy)) return false;
        if (
          !this._isGroundAt(gx, gy + 1) &&
          !this._isSlopeWalkable(gx, gy)
        )
          return false;
      }

      const headCells = Math.max(0, Math.ceil(this.characterHeight / this.cellSize) - 1);
      const widthCells = this._getWidthCells();
      for (let gx = startGx; gx <= endGx; gx++) {
        for (let w = -widthCells; w <= widthCells; w++) {
          for (let h = 1; h <= headCells; h++) {
            if (this.isCellBlocked(gx + w, gy - h)) return false;
          }
        }
      }

      return true;
    }

    /** For "nearest" mode: finds the closest node to the goal that is actually reachable from the start. */
    _findNearestReachableNode(startX, startY, goalX, goalY) {
      const goalGrid = this.worldToGrid(goalX, goalY);
      const graph = this._getNavigationGraph();
      let bestNode = null;
      let bestDist = Infinity;

      for (let r = 0; r <= 10; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const node = this.getNode(goalGrid.gx + dx, goalGrid.gy + dy);
            if (!node) continue;

            const dist = this.distance(node.x, node.y, goalX, goalY);
            if (dist < bestDist) {
              const testPath = this.findPath(startX, startY, node.x, node.y);
              if (testPath !== null) {
                bestNode = node;
                bestDist = dist;
              }
            }
          }
        }
        if (bestNode) break;
      }

      return bestNode;
    }

    /** Snaps a world position downward to the nearest walkable ground node (used for path target correction). */
    _correctToGround(x, y) {
      const grid = this.worldToGrid(x, y);
      const searchRadius = 10;

      for (let r = 0; r <= searchRadius; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) + Math.abs(dy) !== r) continue;
            const node = this.getNode(grid.gx + dx, grid.gy + dy);
            if (node) {
              return { x: node.x, y: node.y };
            }
          }
        }
      }

      this._warn(`No ground node found within ${searchRadius} tiles of (${Math.round(x)}, ${Math.round(y)})`);
      return { x, y };
    }

    /** Main path-following loop: checks waypoint arrival, handles stuck detection, converts actions, and dispatches movement. */
    _followPath(dt) {
      if (this.currentWaypoint >= this.currentPath.length) {
        // Centre within the final tile before completing the path
        const lastWp = this.currentPath[this.currentPath.length - 1];
        if (lastWp && this.autoControl && this.platformBehavior) {
          try {
            // Wait for landing before centering or completing
            if (!this.platformBehavior.isOnFloor) {
              return;
            }
            const distToCenter = Math.abs(this.instance.x - lastWp.x);
            if (distToCenter > this.cellSize * 0.15) {
              const dir = lastWp.x < this.instance.x ? "left" : "right";
              if (!this.platformBehavior.isByWall(dir)) {
                this.platformBehavior.simulateControl(dir);
                return; // Wait until centered
              }
            }
          } catch (e) {}
        }
        this.hasPath = false;
        this.departureCommitted = false;
        this._trigger("OnPathComplete");
        return;
      }

      // Portal state machine — block path advancement during portal execution
      if (this.portalState !== "none") {
        if (this.portalState === "paused") {
          this.portalPauseTimer = (this.portalPauseTimer || 0) + dt;
          if (this.portalPauseTimer > 5 && !this.portalPauseWarned) {
            this.portalPauseWarned = true;
            this._warn("Portal paused for 5+ seconds. Call 'Resume portal' or 'Complete portal' to continue pathfinding.");
          }
          return;
        }
        if (this.portalState === "traversing") {
          this._updatePortalTraverse();
        }
        return;
      }

      const waypoint = this.currentPath[this.currentWaypoint];
      this.timeAtWaypoint += dt;

      if (this.timeAtWaypoint > this.maxWaypointTime) {
        this.hasPath = false;
        this.departureCommitted = false;
        this.timeAtWaypoint = 0;
        this._log(`Stuck at waypoint ${this.currentWaypoint} action=${waypoint.action} target=(${Math.round(waypoint.x)},${Math.round(waypoint.y)}) pos=(${Math.round(this.instance.x)},${Math.round(this.instance.y)}) (exceeded ${this.maxWaypointTime}s)`);
        this._trigger("OnWaypointStuck");
        return;
      }

      // Walk/fall/landed-jump arrivals: use X-only distance when the Y offset is
      // slope-plausible (< cellSize). For slope targets during walk/fall, also bypass
      // the Y check — slope surfaces can be offset from the node center.
      // IMPORTANT: Do NOT apply the slope bypass for jump-action waypoints. A vertical
      // jump (dx≈0) to a slope target would immediately read dist=0 at the launch
      // position (same X, different Y), triggering false arrival before the jump fires.
      // IMPORTANT: Do NOT apply the slope bypass while airborne (e.g. fall_right to a
      // slope node). The character may be at the right X but still far above the target Y.
      // Only bypass when isOnFloor — the character is actually standing on the slope.
      let dist;
      const dy = Math.abs(this.instance.y - waypoint.y);
      const isOnFloor = this.platformBehavior && this.platformBehavior.isOnFloor;
      const isGroundArrival = waypoint.action.includes("walk") || waypoint.action.includes("fall") ||
        (waypoint.action === "jump" && isOnFloor);
      const isSlopeTarget = waypoint.node && waypoint.node.isSlope;
      // Slope bypass: X-only distance ONLY when walking along the slope surface.
      // Fall/jump actions approach the slope from above — the character may be at the
      // right X but still above the target Y, so Y must be checked normally.
      const isWalkAction = waypoint.action === "walk_left" || waypoint.action === "walk_right";
      const applySlopeBypass = isSlopeTarget && isWalkAction && isOnFloor;
      if (isGroundArrival && (dy < this.cellSize || applySlopeBypass)) {
        dist = Math.abs(this.instance.x - waypoint.x);
      } else {
        dist = this.distance(this.instance.x, this.instance.y, waypoint.x, waypoint.y);
      }

      let arrivalThreshold;
      if (waypoint.node && waypoint.node.isIsland) {
        // If walls on both sides, character can't overshoot — use a relaxed threshold
        let walledBothSides = false;
        try {
          if (this.platformBehavior) {
            walledBothSides = this.platformBehavior.isByWall("left") && this.platformBehavior.isByWall("right");
          }
        } catch (e) {}
        arrivalThreshold = walledBothSides ? this.cellSize * 0.45 : this.cellSize * 0.15;
      } else if (waypoint.action.includes("walk")) {
        // Strict positioning: tighten arrival when the next action is a departure (jump/fall)
        if (this.currentPathStrict) {
          const nextIdx = this.currentWaypoint + 1;
          const nextWp = nextIdx < this.currentPath.length ? this.currentPath[nextIdx] : null;
          const nextIsDeparture = nextWp && (
            nextWp.action === "jump" || nextWp.action === "coyote_jump" ||
            nextWp.action === "fall" ||
            nextWp.action === "fall_left" || nextWp.action === "fall_right"
          );
          arrivalThreshold = nextIsDeparture ? this.cellSize * 0.15 : this.cellSize * 0.3;
        } else {
          arrivalThreshold = this.cellSize * 0.3;
        }
      } else if (
        waypoint.action === "jump" ||
        waypoint.action === "coyote_jump"
      ) {
        const landingNode = waypoint.node;
        arrivalThreshold =
          landingNode && landingNode.isIsland
            ? this.cellSize * 0.2
            : this.cellSize * 0.75;
      } else {
        arrivalThreshold = this.cellSize * 0.5;
      }

      if (dist < arrivalThreshold) {
        // Before advancing, check if the next waypoint requires ground contact (jump, fall, etc.)
        // If so, the character must land first — don't advance while still airborne
        const nextIdx = this.currentWaypoint + 1;
        const nextWp = nextIdx < this.currentPath.length ? this.currentPath[nextIdx] : null;
        if (nextWp && this.platformBehavior) {
          const nextNeedsGround = nextWp.action === "jump" || nextWp.action === "coyote_jump" ||
            nextWp.action === "fall" ||
            nextWp.action === "fall_left" || nextWp.action === "fall_right" ||
            nextWp.action === "fall_through";
          try {
            if (nextNeedsGround && !this.platformBehavior.isOnFloor) {
              // Close to waypoint but still airborne — wait for landing before advancing
              return;
            }
          } catch (e) {}
        }

        this._log(`Waypoint ${this.currentWaypoint} reached (action=${waypoint.action})`);
        this.currentWaypoint++;
        this.timeAtWaypoint = 0;
        // Reset per-action state so the NEXT waypoint starts clean.
        // departureCommitted is set during jump pre-centering; if the waypoint arrival
        // fires mid-air (e.g. double jump still descending), the flag stays true and
        // blocks walk input on the following waypoint.
        // doubleJumpPhase/isHoldingJump must also be cleared so the next action doesn't
        // inherit stale jump state from the previous waypoint's trajectory.
        this.departureCommitted = false;
        this.doubleJumpPhase = 0;
        this.isHoldingJump = false;
        this._trigger("OnWaypointReached");
        return;
      }

      if (
        this.rePathThreshold > 0 &&
        this.rePathCooldown <= 0 &&
        !this.justUsedPortal
      ) {
        const expectedMaxDist = this.cellSize * this.rePathThreshold;
        // Only trigger repath when grounded AND performing a ground-based action.
        // During jumps/falls the character is expected to be far from the waypoint
        // temporarily — repathing mid-air would trigger false positives.
        const isGroundAction = waypoint.action.includes("walk") ||
          waypoint.action === "fall_through" || waypoint.action === "start";
        if (
          dist > expectedMaxDist &&
          isGroundAction &&
          this.platformBehavior &&
          this.platformBehavior.isOnFloor
        ) {
          this._rePath();
          return;
        }
      }

      if (this.autoControl) {
        let effectiveAction = waypoint.action;

        // Convert jump to fall when the target is below, character is on the floor,
        // and not on an island. Only when grounded — mid-air conversion disrupts the jump arc.
        if (effectiveAction === "jump" && this.platformBehavior.isOnFloor && waypoint.y > this.instance.y + this.cellSize * 0.3) {
          const prevWpIdx = this.currentWaypoint - 1;
          const prevWp = prevWpIdx >= 0 ? this.currentPath[prevWpIdx] : null;
          const prevNode = prevWp ? prevWp.node : null;
          const isOnIsland = prevNode && prevNode.isIsland;
          if (!isOnIsland) {
            const xDiff = waypoint.x - this.instance.x;
            if (Math.abs(xDiff) < this.cellSize * 0.3) {
              effectiveAction = "fall";
            } else {
              effectiveAction = xDiff < 0 ? "fall_left" : "fall_right";
            }
          }
        }

        if (
          (effectiveAction === "jump" || effectiveAction === "coyote_jump" ||
           effectiveAction === "fall" || effectiveAction === "fall_left" ||
           effectiveAction === "fall_right") &&
          this.platformBehavior?.isOnFloor
        ) {
          const yDist = Math.abs(this.instance.y - waypoint.y);
          if (yDist < this.cellSize * 0.75) {
            const walkDir = waypoint.x < this.instance.x ? "left" : "right";
            // Don't convert to walk if blocked by a wall or if there's a gap between here and the waypoint
            let canWalkDirectly = true;
            try {
              if (this.platformBehavior.isByWall(walkDir)) {
                canWalkDirectly = false;
              } else {
                // Check for continuous ground between character and waypoint
                const charGrid = this.worldToGrid(this.instance.x, this.instance.y);
                const wpGrid = this.worldToGrid(waypoint.x, waypoint.y);
                const minGx = Math.min(charGrid.gx, wpGrid.gx);
                const maxGx = Math.max(charGrid.gx, wpGrid.gx);
                for (let gx = minGx; gx <= maxGx; gx++) {
                  if (!this._isGroundAt(gx, charGrid.gy + 1) && !this._isSlopeWalkable(gx, charGrid.gy)) {
                    canWalkDirectly = false;
                    break;
                  }
                }
              }
            } catch (e) {}
            if (canWalkDirectly) {
              effectiveAction = walkDir === "left" ? "walk_left" : "walk_right";
            }
          }
        }

        this._executeAction(effectiveAction, waypoint.x, waypoint.y, waypoint);
      }
    }

    /** Re-calculates the path to the current target; detects re-path loops and triggers OnWaypointStuck if stuck. */
    _rePath() {
      if (this.portalState !== "none") return;
      // Remove any queued request — re-paths always run immediately (edge case #4)
      globalNavManager.removeQueuedRequest(this);
      this.rePathCooldown = this.rePathCooldownDuration;

      // Track distance to goal to detect re-path loops
      const distToGoal = this.distance(
        this.instance.x, this.instance.y,
        this.pathTargetX, this.pathTargetY
      );

      if (distToGoal < this.rePathBestDist - this.cellSize) {
        // Making progress — reset counter
        this.rePathBestDist = distToGoal;
        this.rePathCount = 0;
      }

      this.rePathCount++;

      if (this.rePathCount >= 5) {
        // Re-pathed 5 times without getting closer — stuck in a loop
        this._warn(`Re-path loop detected (${this.rePathCount} re-paths without progress)`);
        this.hasPath = false;
        this.departureCommitted = false;
        this.rePathCount = 0;
        this.rePathBestDist = Infinity;
        this._trigger("OnWaypointStuck");
        return;
      }

      this.aceFindPath(
        this.pathTargetX,
        this.pathTargetY,
        true,
        this.lastPathMode,
        undefined,
        true // isRePath — always immediate, bypass queue
      );
      this._trigger("OnRePathTriggered");
    }

    /** Top-level action dispatcher: routes portal, fall-through, and physics-based actions to their handlers. */
    _executeAction(action, targetX, targetY, waypoint) {
      if (!this.platformBehavior) return;
      if (!this.platformBehavior.isEnabled) return;

      if (action.includes("portal")) {
        this._executePortal(targetX, targetY, waypoint);
        return;
      }

      if (action === "fall_through") {
        this._executeFallThrough(targetX, targetY);
        return;
      }

      this._executePhysicsAware(action, targetX, targetY, waypoint);
    }

    /** Handles portal waypoint execution: triggers OnPortalEntry, applies pause if requested, or executes the portal behavior. */
    _executePortal(targetX, targetY, waypoint) {
      if (this.portalState === "none") {
        this.portalPaused = false;
        this.currentPortalId = (waypoint && waypoint.portalId) || 0;
        this.portalCurrentWaypoint = waypoint;
        this.portalTraverseTargetX = targetX;
        this.portalTraverseTargetY = targetY;

        this._inPortalEntryTrigger = true;
        this._trigger("OnPortalEntry");
        this._inPortalEntryTrigger = false;

        if (this.portalPaused) {
          this.portalState = "paused";
          this.portalPauseTimer = 0;
          this.portalPauseWarned = false;
          return;
        }
        this._executePortalBehavior(waypoint);
        return;
      }

      if (this.portalState === "paused") return;
      if (this.portalState === "traversing") {
        this._updatePortalTraverse();
        return;
      }
    }

    /** Starts the portal behavior: instant portals teleport immediately; gradual portals begin linear movement and disable Platform. */
    _executePortalBehavior(waypoint) {
      const action = waypoint ? waypoint.action : "portal_instant";

      if (action === "portal_gradual") {
        this.portalState = "traversing";
        this.portalTraverseStartX = this.instance.x;
        this.portalTraverseStartY = this.instance.y;
        this.portalTraverseProgress = 0;
        this.portalTraverseSpeed = (waypoint && waypoint.speed) || 100;

        if (this.platformBehavior) {
          this.platformWasEnabled = this.platformBehavior.isEnabled;
          this.platformBehavior.isEnabled = false;
        }
        return;
      }

      // Instant: teleport and complete
      this.instance.x = this.portalTraverseTargetX;
      this.instance.y = this.portalTraverseTargetY;
      this._completePortal();
    }

    /** Tick update for gradual portal traversal: linearly interpolates position toward exit at the portal's speed. */
    _updatePortalTraverse() {
      const dt = this.instance.dt;
      const dx = this.portalTraverseTargetX - this.portalTraverseStartX;
      const dy = this.portalTraverseTargetY - this.portalTraverseStartY;
      const totalDist = Math.sqrt(dx * dx + dy * dy);

      if (totalDist === 0) {
        this.portalTraverseProgress = 1;
      } else {
        this.portalTraverseProgress += (this.portalTraverseSpeed * dt) / totalDist;
      }

      if (this.portalTraverseProgress >= 1) {
        this.portalTraverseProgress = 1;
        this.instance.x = this.portalTraverseTargetX;
        this.instance.y = this.portalTraverseTargetY;
        if (this.platformBehavior && this.platformWasEnabled) {
          this.platformBehavior.isEnabled = true;
        }
        this._completePortal();
        return;
      }

      this.instance.x = this.portalTraverseStartX + dx * this.portalTraverseProgress;
      this.instance.y = this.portalTraverseStartY + dy * this.portalTraverseProgress;
    }

    /** Finalizes portal traversal: resets portal state, advances waypoint, and triggers OnPortalComplete. */
    _completePortal() {
      this.justUsedPortal = true;
      this.portalPauseTimer = 0;
      this.portalPauseWarned = false;
      this._trigger("OnPortalComplete");
      this.portalState = "none";
      this.portalPaused = false;
      this.portalCurrentWaypoint = null;
    }

    /** Simulates pressing "down" to fall through a jump-thru platform. */
    _executeFallThrough(targetX, targetY) {
      if (this.platformBehavior.isOnFloor) {
        this.platformBehavior.fallThrough();
        if (targetX < this.instance.x) {
          this.platformBehavior.simulateControl("left");
        } else if (targetX > this.instance.x) {
          this.platformBehavior.simulateControl("right");
        }
      }
    }

    /** Routes physics-based actions (walk, jump, coyote_jump, fall) to their specific movement handlers. */
    _executePhysicsAware(action, targetX, targetY, waypoint) {
      if (action === "walk_left" || action === "walk_right") {
        // Committed departure: skip walk input so character doesn't overshoot before jump fires
        if (this.departureCommitted) return;

        const movingLeft = action === "walk_left";
        const wallSide = movingLeft ? "left" : "right";

        try {
          if (
            this.platformBehavior.isByWall(wallSide) &&
            this.platformBehavior.isOnFloor
          ) {
            // Check if character still has room to move within this tile toward the target
            const halfCell = this.cellSize / 2;
            const stillHasRoom = movingLeft
              ? this.instance.x - targetX > halfCell * 0.1
              : targetX - this.instance.x > halfCell * 0.1;

            if (stillHasRoom) {
              // Character hit the wall but hasn't reached the waypoint yet —
              // don't try to jump, just let the walk handler move within the tile
              this._handleWalkAction(targetX, movingLeft ? "left" : "right", waypoint);
              return;
            }

            // Truly blocked by wall while grounded — path is invalid, repath
            this._warn(`Walk blocked by wall (${wallSide}) while grounded — repathing`);
            this._rePath();
            return;
          }
        } catch (e) {}

        this._handleWalkAction(targetX, movingLeft ? "left" : "right", waypoint);
        return;
      }

      if (action === "jump") {
        this._handleJumpAction(targetX, targetY, waypoint);
        return;
      }

      if (action === "coyote_jump") {
        this._handleCoyoteJumpAction(targetX, targetY, waypoint);
        return;
      }

      if (
        action === "fall" ||
        action === "fall_left" ||
        action === "fall_right"
      ) {
        // Strict positioning: edge-align before diagonal falls
        if (this.currentPathStrict && (action === "fall_left" || action === "fall_right")) {
          try {
            if (this.platformBehavior.isOnFloor) {
              const prevIdx = this.currentWaypoint - 1;
              const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
              if (prevWp && prevWp.node) {
                const dir = action === "fall_right" ? "right" : "left";
                const edgeX = prevWp.node.x + (dir === "right" ? 1 : -1) * (this.cellSize / 2 - this.cellSize * 0.1);
                const distToEdge = Math.abs(this.instance.x - edgeX);
                const pastEdge = dir === "right" ? this.instance.x >= edgeX : this.instance.x <= edgeX;
                if (!pastEdge && distToEdge > this.cellSize * 0.15) {
                  if (!this.platformBehavior.isByWall(dir)) {
                    this.platformBehavior.simulateControl(dir);
                  }
                  return; // Wait until at edge
                }
              }
            }
          } catch (e) {}
        }
        this._handleFallAction(targetX);
        return;
      }
    }

    /** Applies horizontal simulateControl toward a walk waypoint; handles ledge restriction and arrival centering. */
    _handleWalkAction(targetX, direction, waypoint) {
      const speed =
        this.platformBehavior.speed || Math.abs(this.estimatedVelocityX);
      const decel = this.platformProps.deceleration;
      const distToTarget = Math.abs(targetX - this.instance.x);
      const stoppingDist = (speed * speed) / (2 * decel);

      if (this.ledgeRestriction && waypoint && waypoint.node) {
        const node = waypoint.node;
        if (
          (direction === "left" && node.isLeftLedge) ||
          (direction === "right" && node.isRightLedge)
        ) {
          const nextIdx = this.currentWaypoint + 1;
          const nextWaypoint = nextIdx < this.currentPath.length ? this.currentPath[nextIdx] : null;
          const nextNeedsDeparture = nextWaypoint && (
            nextWaypoint.action === "fall" || nextWaypoint.action === "fall_left" ||
            nextWaypoint.action === "fall_right" || nextWaypoint.action === "jump" ||
            nextWaypoint.action === "coyote_jump"          );

          if (!nextNeedsDeparture) {
            const edgeX =
              node.x +
              (direction === "right" ? 1 : -1) *
                (this.cellSize / 2 + this.ledgeLeniency);
            const pastEdge =
              direction === "right"
                ? this.instance.x >= edgeX
                : this.instance.x <= edgeX;
            if (pastEdge) return;
          }
        }
      }

      if (waypoint && waypoint.node && waypoint.node.isIsland) {
        // Check if walls on both sides — if so, character can't overshoot, no speed cap needed
        let walledBothSides = false;
        try {
          walledBothSides = this.platformBehavior.isByWall("left") && this.platformBehavior.isByWall("right");
        } catch (e) {}

        if (!walledBothSides) {
          const maxSafeSpeed = Math.sqrt(2 * decel * (this.cellSize * 0.4));
          if (speed > maxSafeSpeed) return;
        }
      }

      // Strict positioning: cap speed when approaching a ledge before a departure action.
      // Only applies when grounded — mid-air speed capping is counterproductive (e.g. after micro-jumps).
      if (this.currentPathStrict && this.platformBehavior.isOnFloor && waypoint && waypoint.node) {
        const node = waypoint.node;
        if (node.isLeftLedge || node.isRightLedge || node.isIsland) {
          const nextIdx = this.currentWaypoint + 1;
          const nextWp = nextIdx < this.currentPath.length ? this.currentPath[nextIdx] : null;
          if (nextWp && (
            nextWp.action === "jump" || nextWp.action === "coyote_jump" ||
            nextWp.action === "fall" ||
            nextWp.action === "fall_left" || nextWp.action === "fall_right"
          )) {
            const maxDepartureSpeed = Math.sqrt(2 * decel * (this.cellSize * 0.35));
            if (speed > maxDepartureSpeed) return;
          }
        }
      }

      if (distToTarget > stoppingDist + this.cellSize * 0.1) {
        this.platformBehavior.simulateControl(direction);

        // Slope micro-jump: if the character hasn't moved for several ticks while
        // walk input is being applied, a gentle slope tile boundary is likely blocking.
        // A small jump dislodges the character without disrupting the walk path.
        if (this._walkStuckX === undefined) { this._walkStuckX = -1; this._walkStuckCount = 0; }
        const roundedX = Math.round(this.instance.x * 10);
        if (roundedX === this._walkStuckX) {
          this._walkStuckCount++;
          if (this._walkStuckCount >= 5 && this.platformBehavior.isOnFloor) {
            this.platformBehavior.simulateControl("jump");
            this._walkStuckCount = 0;
          }
        } else {
          this._walkStuckX = roundedX;
          this._walkStuckCount = 0;
        }
      } else {
        this._walkStuckCount = 0;
      }
    }

    /** Checks if the cell adjacent to the character (in the given direction) is clear at the current height, accounting for character head cells. Used per-frame during double jump to gate horizontal input. */
    _isDoubleJumpHorizontalClear(dir) {
      const cs = this.cellSize;
      const headCells = Math.max(0, Math.ceil(this.characterHeight / cs) - 1);
      const grid = this.worldToGrid(this.instance.x, this.instance.y);
      const checkGx = grid.gx + (dir === "right" ? 1 : -1);
      if (checkGx < 0 || checkGx >= this.gridWidth) return false;

      for (let h = 0; h <= headCells; h++) {
        const checkGy = grid.gy - h;
        if (checkGy < 0 || checkGy >= this.gridHeight) continue;
        const val = this.obstacleMap[checkGy * this.gridWidth + checkGx];
        if (val === 1 || val === 3) return false;
      }
      return true;
    }

    /** Handles jump execution: double-jump state machine (5 phases with release frame), pre-positioning (center or slide-off), and variable jump hold. */
    _handleJumpAction(targetX, targetY, waypoint) {
      const dt = this.instance.dt;

      if (waypoint && waypoint.requiresDoubleJump) {
        const dir = targetX < this.instance.x ? "left" : "right";
        const atOrAboveTarget = this.instance.y <= targetY + this.cellSize;
        // Phase 0-1 (first jump): only horizontal when at/above target — gain height first.
        // Phase 2-4 (second jump): horizontal when at/above target OR adjacent cell clear —
        // move toward target during second jump and landing.
        const firstJumpHorizontal = atOrAboveTarget;
        const secondJumpHorizontal = atOrAboveTarget || this._isDoubleJumpHorizontalClear(dir);

        // Pre-position for double jump: center on launch node before phase 0.
        // Without this, the character launches from wherever it landed (possibly
        // off-center), causing the first vertical phase to pass through different
        // grid cells than _canDoubleJump() validated — hitting ceilings.
        if (this.doubleJumpPhase === 0 && this.platformBehavior.isOnFloor) {
          const prevIdx = this.currentWaypoint - 1;
          const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
          if (prevWp && prevWp.node) {
            const tileCenterX = prevWp.node.x;
            const distToCenter = Math.abs(this.instance.x - tileCenterX);
            // Same slope tolerance as single-jump: slope surface shifts Y while walking X,
            // so half-tile precision is sufficient for arc correctness.
            const centerTolerance = prevWp.node.isSlope ? this.cellSize * 0.5 : this.cellSize * 0.15;
            if (distToCenter > centerTolerance) {
              const centerDir = tileCenterX < this.instance.x ? "left" : "right";
              try {
                if (!this.platformBehavior.isByWall(centerDir)) {
                  this.platformBehavior.simulateControl(centerDir);
                }
              } catch (e) {}
              return; // Wait until centered
            }
            if (this.currentPathStrict) {
              this.departureCommitted = true;
            }
          }
        }

        if (this.doubleJumpPhase === 0) {
          // Phase 0: Initiate first jump from the ground
          this._log(`Double jump initiated toward (${Math.round(targetX)}, ${Math.round(targetY)})`);
          if (firstJumpHorizontal) this.platformBehavior.simulateControl(dir);
          this.platformBehavior.simulateControl("jump");
          this.doubleJumpPhase = 1;
          this.jumpStartTime = 0;
          this._doubleJumpGrace = 0.1; // 100ms grace before checking isFalling
          this._doubleJumpLastY = this.instance.y;
        } else if (this.doubleJumpPhase === 1) {
          // Phase 1: Sustain first jump, wait for isFalling (apex reached)
          if (firstJumpHorizontal) this.platformBehavior.simulateControl(dir);

          if (this.platformProps.jumpSustain > 0) {
            this.jumpStartTime += dt * 1000;
            if (this.jumpStartTime < this.platformProps.jumpSustain) {
              this.platformBehavior.simulateControl("jump");
            }
          }

          // Wait for grace period, then detect apex
          this._doubleJumpGrace -= dt;
          if (this._doubleJumpGrace <= 0) {
            // Ceiling hit detection: if character moved downward during first jump
            // (y increased), a ceiling stopped the ascent — repath immediately
            if (this.instance.y > this._doubleJumpLastY + 1) {
              this._warn(`Double jump: ceiling hit during phase 1 — repathing`);
              this.doubleJumpPhase = 0;
              this._rePath();
              return;
            }
            this._doubleJumpLastY = this.instance.y;
            // If character fell back to floor, first jump failed entirely — repath
            if (this.platformBehavior.isOnFloor && !this.platformBehavior.isJumping) {
              this._warn(`Double jump: back on floor before second jump — repathing`);
              this.doubleJumpPhase = 0;
              this._rePath();
              return;
            }
            // Once falling (past apex), proceed to second jump
            if (this.platformBehavior.isFalling) {
              this.doubleJumpPhase = 2;
            }
          }
        } else if (this.doubleJumpPhase === 2) {
          // Phase 2: Release frame — no jump input so Platform behavior sees a "release"
          this._log(`Double jump: release frame`);
          if (secondJumpHorizontal) this.platformBehavior.simulateControl(dir);
          this.doubleJumpPhase = 3;
        } else if (this.doubleJumpPhase === 3) {
          // Phase 3: Fire second jump (fresh press after release)
          this._log(`Double jump: second jump fired`);
          if (secondJumpHorizontal) this.platformBehavior.simulateControl(dir);
          this.platformBehavior.simulateControl("jump");
          this.doubleJumpPhase = 4;
          this.jumpStartTime = 0;
          this._doubleJumpLastY = this.instance.y;
        } else if (this.doubleJumpPhase === 4) {
          // Phase 4: Sustain second jump
          if (secondJumpHorizontal) this.platformBehavior.simulateControl(dir);

          if (this.platformProps.jumpSustain > 0) {
            this.jumpStartTime += dt * 1000;
            if (this.jumpStartTime < this.platformProps.jumpSustain) {
              this.platformBehavior.simulateControl("jump");
            }
          }

          // Ceiling hit detection for second jump — only check during ascent.
          // platformBehavior.isFalling is true once the character has passed the
          // apex and is descending. Checking without this guard causes a false
          // positive with jumpSustain=0: the character reaches the apex and starts
          // falling normally, but the per-tick y delta exceeds 1px a few frames
          // into the descent, triggering a spurious repath.
          if (!this.platformBehavior.isFalling && this.instance.y > this._doubleJumpLastY + 1) {
            this._warn(`Double jump: ceiling hit during phase 4 — repathing`);
            this.doubleJumpPhase = 0;
            this._rePath();
            return;
          }
          this._doubleJumpLastY = this.instance.y;
        }

        // Wall collision detection for phases 2-4: if moving horizontally and
        // hitting a wall, the character can't reach the target — repath immediately
        // instead of waiting for the 5s waypoint timeout.
        if (this.doubleJumpPhase >= 2) {
          let hitWall = false;
          try { hitWall = this.platformBehavior.isByWall(dir); } catch (e) {}
          if (hitWall) {
            this._warn(`Double jump: hit wall during phase ${this.doubleJumpPhase} — repathing`);
            this.doubleJumpPhase = 0;
            this._rePath();
            return;
          }
        }

        // Floor landing detection for phases 3-4: if the character has landed
        // after the second jump, the double jump is complete (success or fail).
        // Normal waypoint arrival handles success; this catches failures where
        // the character landed but didn't reach the target.
        if (this.doubleJumpPhase >= 3 && this.platformBehavior.isOnFloor && !this.platformBehavior.isJumping) {
          this.doubleJumpPhase = 0;
          this.departureCommitted = false;
          // Don't repath here — let normal waypoint arrival check handle it.
          // The character may have landed close enough to the target.
        }
        return;
      }

      const xDist = Math.abs(targetX - this.instance.x);
      const isVerticalJump = xDist < this.cellSize * 0.5;

      // Detect if the character has fallen off the expected launch platform.
      // After reaching a walk waypoint, momentum can carry the character past the
      // edge, landing on a lower platform. Jumping from here is futile — repath.
      if (this.platformBehavior.isOnFloor) {
        const prevIdx = this.currentWaypoint - 1;
        const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
        if (prevWp && prevWp.node) {
          const expectedY = prevWp.node.y;
          const actualY = this.instance.y;
          if (actualY > expectedY + this.cellSize * 1.5) {
            this._warn(`Fell off launch platform (expected y=${Math.round(expectedY)}, actual y=${Math.round(actualY)}) — repathing`);
            this._rePath();
            return;
          }
        }
      }

      // Pre-position before jumping.
      // When ledge restriction is OFF, a wall blocks the jump direction, AND the
      // node has a ledge on that side (overhang scenario), walk to the platform edge
      // to get horizontal clearance before jumping.
      // Otherwise, centre within the current tile for an optimal arc start position.
      if (this.platformBehavior.isOnFloor) {
        const prevIdx = this.currentWaypoint - 1;
        const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
        if (prevWp && prevWp.node) {
          const jumpDir = targetX < this.instance.x ? "left" : "right";
          let wallBlocksJump = false;
          try { wallBlocksJump = this.platformBehavior.isByWall(jumpDir); } catch (e) {}

          // Slide-off: only when ledge restriction is OFF, a wall blocks the jump,
          // AND the node has a ledge on the jump side (overhang, not a corner).
          // If the node is NOT a ledge on that side, the character is in a corner
          // with solid ground — can't slide off, fall through to normal centering.
          // Skip slide-off for primarily upward jumps — centering gives a cleaner arc
          // and avoids hitting the underside of adjacent blocks.
          const node = prevWp.node;
          const hasLedge = (jumpDir === "right" && node.isRightLedge) ||
                           (jumpDir === "left" && node.isLeftLedge);
          const targetSignificantlyAbove = targetY < this.instance.y - this.cellSize * 1.5;

          if (!this.ledgeRestriction && wallBlocksJump && !isVerticalJump && hasLedge && !targetSignificantlyAbove) {
            const edgeLimitX = node.x + (jumpDir === "right" ? 1 : -1) * (this.cellSize * 0.45);
            const pastEdge = jumpDir === "right"
              ? this.instance.x >= edgeLimitX
              : this.instance.x <= edgeLimitX;
            if (!pastEdge) {
              this.platformBehavior.simulateControl(jumpDir);
              return; // Walk toward edge before jumping
            }
            // At edge — commit and proceed to jump
            if (this.currentPathStrict) {
              this.departureCommitted = true;
            }
          } else {
            const tileCenterX = node.x;
            const distToCenter = Math.abs(this.instance.x - tileCenterX);
            // Slope departure: the slope surface shifts the character's Y as they walk X,
            // making it hard to settle within a tight X tolerance. Half a tile is enough
            // since arc validation uses grid-cell precision, not sub-cell precision.
            const centerTolerance = node.isSlope ? this.cellSize * 0.5 : this.cellSize * 0.15;
            if (distToCenter > centerTolerance) {
              // Walk toward tile center before jumping
              const centerDir = tileCenterX < this.instance.x ? "left" : "right";
              try {
                if (!this.platformBehavior.isByWall(centerDir)) {
                  this.platformBehavior.simulateControl(centerDir);
                }
              } catch (e) {}
              return; // Wait until centered
            }
            // Centering complete — commit to departure (prevents walk input on this frame)
            if (this.currentPathStrict) {
              this.departureCommitted = true;
            }
          }
        }
      }

      // Apply horizontal input toward target during jump
      if (!isVerticalJump) {
        const dir = targetX < this.instance.x ? "left" : "right";
        this.platformBehavior.simulateControl(dir);
      }

      try {
        if (this.platformBehavior.isOnFloor) {
          this.platformBehavior.simulateControl("jump");
          this.isHoldingJump = true;
          this.jumpHoldTimer = 0;
          this.jumpStartY = this.instance.y;
          this.departureCommitted = false;
        } else if (
          this.isHoldingJump &&
          this.platformProps.jumpSustain > 0
        ) {
          this.jumpHoldTimer += dt * 1000;
          // Release jump when we've reached the needed peak height,
          // or when the sustain timer expires — whichever comes first.
          const currentHeight = this.jumpStartY - this.instance.y;
          const neededPeak = (waypoint && waypoint.peakHeight) ? waypoint.peakHeight : this.maxJumpHeight;

          if (currentHeight >= neededPeak) {
            this.isHoldingJump = false;
          } else if (this.jumpHoldTimer < this.platformProps.jumpSustain) {
            this.platformBehavior.simulateControl("jump");
          } else {
            this.isHoldingJump = false;
          }
        }
      } catch (e) {
        this.platformBehavior.simulateControl("jump");
      }
    }

    /** Handles coyote jump: walks off the ledge edge, then jumps during the coyote time window while applying horizontal input. */
    _handleCoyoteJumpAction(targetX, targetY, waypoint) {
      const xDist = Math.abs(targetX - this.instance.x);
      const isVerticalJump = xDist < this.cellSize * 0.5;

      // Strict positioning: edge-align before stepping off for coyote jump
      if (this.currentPathStrict && this.platformBehavior.isOnFloor) {
        const prevIdx = this.currentWaypoint - 1;
        const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
        if (prevWp && prevWp.node) {
          const dir = targetX < this.instance.x ? "left" : "right";
          // Target edge position: just inside the tile edge (90% from center to edge)
          const edgeX = prevWp.node.x + (dir === "right" ? 1 : -1) * (this.cellSize / 2 - this.cellSize * 0.1);
          const distToEdge = Math.abs(this.instance.x - edgeX);
          const pastEdge = dir === "right" ? this.instance.x >= edgeX : this.instance.x <= edgeX;
          if (!pastEdge && distToEdge > this.cellSize * 0.15) {
            // Walk toward edge before stepping off
            try {
              if (!this.platformBehavior.isByWall(dir)) {
                this.platformBehavior.simulateControl(dir);
              }
            } catch (e) {}
            return; // Wait until at edge
          }
        }
      }

      if (!isVerticalJump) {
        const dir = targetX < this.instance.x ? "left" : "right";
        try {
          if (!this.platformBehavior.isByWall(dir)) {
            this.platformBehavior.simulateControl(dir);
          }
        } catch (e) {
          this.platformBehavior.simulateControl(dir);
        }
      }

      try {
        if (!this.platformBehavior.isOnFloor && this.coyoteTimer > 0) {
          this.coyoteJumpPending = true;
        } else if (this.platformBehavior.isOnFloor) {
          const dir = targetX < this.instance.x ? "left" : "right";
          if (!isVerticalJump) {
            this.platformBehavior.simulateControl(dir);
          }
        }
      } catch (e) {}
    }

    /** Handles fall/fall_left/fall_right by applying directional input to drift toward the landing target.
     *  Uses deceleration-based braking to avoid overshooting the target X. */
    _handleFallAction(targetX) {
      const speed =
        this.platformBehavior.speed || Math.abs(this.estimatedVelocityX);
      const decel = this.platformProps.deceleration;
      const distToTarget = Math.abs(targetX - this.instance.x);
      const stoppingDist = (speed * speed) / (2 * decel);

      if (distToTarget > this.cellSize * 0.2) {
        const dir = targetX < this.instance.x ? "left" : "right";
        if (distToTarget > stoppingDist + this.cellSize * 0.1) {
          this.platformBehavior.simulateControl(dir);
        }
      }
    }

    /** Tracks the coyote timer: counts up when the character walks off a ledge, resets when grounded or jumping. */
    _updateCoyoteTime(dt) {
      if (this.coyoteTime <= 0) return;

      try {
        const isOnFloor = this.platformBehavior.isOnFloor;
        const isJumping = this.platformBehavior.isJumping;
        const isFalling = this.platformBehavior.isFalling;

        if (this.wasOnFloor && !isOnFloor && !isJumping) {
          this.coyoteTimer = this.coyoteTime;
        }

        if (this.coyoteTimer > 0) {
          this.coyoteTimer -= dt;
          if (this.coyoteJumpPending && this.coyoteTimer > 0 && isFalling) {
            this.platformBehavior.vectorY = -this.platformProps.jumpStrength;
            this.coyoteJumpPending = false;
            this.coyoteTimer = 0;
          }
        }

        this.wasOnFloor = isOnFloor;
      } catch (e) {}
    }

    // ============================================================================
    // PATHFINDING - Core Actions
    // ============================================================================

    /** Calculates a path from the character's current position to the target coordinates. Supports ground correction and jump-toward mode. */
    aceFindPath(targetX, targetY, correctToGround, mode, strict, isRePath) {
      // Time-slicing: queue if budget exhausted (unless this is a re-path, which always runs immediately)
      if (globalNavManager.maxPathsPerTick > 0 && !isRePath) {
        const now = performance.now();
        if (now - globalNavManager._lastResetTime > 1) {
          globalNavManager._pathsThisTick = 0;
          globalNavManager._lastResetTime = now;
        }
        if (globalNavManager._pathsThisTick >= globalNavManager.maxPathsPerTick) {
          globalNavManager.queuePathRequest(this, { targetX, targetY, correctToGround, mode, strict });
          return;
        }
        globalNavManager._pathsThisTick++;
      }

      this._log(`FindPath to (${Math.round(targetX)},${Math.round(targetY)}) mode=${mode || "reach"} groundCorrect=${correctToGround} strict=${strict || "default"}`);
      this.lastPathFailReason = "";

      let startX = this.instance.x;
      let startY = this.instance.y;

      // Reset re-path loop detection when target changes
      if (targetX !== this.pathTargetX || targetY !== this.pathTargetY) {
        this.rePathCount = 0;
        this.rePathBestDist = Infinity;
      }

      this.pathTargetX = targetX;
      this.pathTargetY = targetY;
      this.lastPathMode = mode || "reach";

      if (correctToGround) {
        const correctedStart = this._correctToGround(startX, startY);
        const correctedTarget = this._correctToGround(targetX, targetY);
        startX = correctedStart.x;
        startY = correctedStart.y;
        targetX = correctedTarget.x;
        targetY = correctedTarget.y;
      }

      this.pathTargetCorrectedX = targetX;
      this.pathTargetCorrectedY = targetY;
      const correctedGrid = this.worldToGrid(targetX, targetY);
      this.pathTargetGridX = correctedGrid.gx;
      this.pathTargetGridY = correctedGrid.gy;

      let path = this.findPath(startX, startY, targetX, targetY);

      // "nearest" mode: if normal pathfinding fails, path to the closest reachable node
      if (!path && this.lastPathMode === "nearest") {
        const nearest = this._findNearestReachableNode(
          startX,
          startY,
          this.pathTargetX,
          this.pathTargetY
        );
        if (nearest) {
          path = this.findPath(startX, startY, nearest.x, nearest.y);
        }
      }

      if (path) {
        this.currentPath = path;
        // Skip waypoint 0 (the start node) — the character is already there
        this.currentWaypoint = path.length > 1 ? 1 : 0;
        this.hasPath = true;
        this.timeAtWaypoint = 0;
        this.doubleJumpPhase = 0;
        this.isHoldingJump = false;
        this.coyoteJumpPending = false;
        this.departureCommitted = false;

        // Resolve strict jump positioning for this path
        // Priority: FindPath param > ACE/property setting
        if (strict === "strict") {
          this.currentPathStrict = true;
        } else if (strict === "relaxed") {
          this.currentPathStrict = false;
        } else {
          this.currentPathStrict = !!this.strictPositioning;
        }

        this.lastPathCost = 0;
        for (let i = 1; i < path.length; i++) {
          this.lastPathCost += this.distance(
            path[i - 1].x,
            path[i - 1].y,
            path[i].x,
            path[i].y
          );
        }

        this.lastPathFailReason = "";
        this._log(`Path found: ${path.length} waypoints, cost=${Math.round(this.lastPathCost)}`);
        this._trigger("OnPathFound");
        return true;
      }

      this._log(`Path failed: ${this.lastPathFailReason}`);
      this._trigger("OnPathFailed");
      return false;
    }

    /** Clears the current path and resets all path-following state (waypoint index, jump phase, etc.). */
    aceClearPath() {
      this.hasPath = false;
      this.currentPath = [];
      this.currentWaypoint = 0;
      this.doubleJumpPhase = 0;
      this.isHoldingJump = false;
      this.departureCommitted = false;
      this.coyoteJumpPending = false;
      // Reset portal state
      if (this.portalState === "traversing" && this.platformBehavior && this.platformWasEnabled) {
        this.platformBehavior.isEnabled = true;
      }
      this.portalState = "none";
      this.portalPaused = false;
      this.portalCurrentWaypoint = null;
    }

    /** Stops movement along the current path without clearing the path data. */
    aceStopMovement() {
      this.hasPath = false;
      this.departureCommitted = false;
    }

    /** Stops pathfinding entirely by clearing the path and stopping movement. */
    aceStopPathfinding() {
      globalNavManager.removeQueuedRequest(this);
      this.aceClearPath();
      this.aceStopMovement();
    }

    /** Immediately jump toward a target position from the current position. No pathfinding involved. */
    aceJumpTowardPosition(targetX, targetY) {
      if (!this.platformBehavior) return;

      const onFloor = this.platformBehavior.isOnFloor;
      const canDoubleJump = !onFloor && this.platformProps.isDoubleJumpEnabled;

      // Must be on the floor OR able to double jump
      if (!onFloor && !canDoubleJump) return;

      this.hasPath = false;
      this.currentPath = [];
      this.currentWaypoint = 0;
      this.jumpTowardTargetX = targetX;
      this.jumpTowardTargetY = targetY;
      this._jumpTowardActive = true;
      this._jumpTowardGrace = 0.1; // 100ms grace before checking isOnFloor (jump hasn't left ground yet)

      // Initial horizontal push + jump on the launch frame
      const xDist = Math.abs(targetX - this.instance.x);
      const dir = targetX < this.instance.x ? "left" : "right";
      if (xDist >= this.cellSize * 0.5) {
        this.platformBehavior.simulateControl(dir);
      }
      this.platformBehavior.simulateControl("jump");
      if (this.platformProps.jumpSustain > 0) {
        this.platformBehavior.simulateControl("jump");
      }
      this._trigger("OnJumpTowardLaunched");
    }

    /** Marks the navigation graph as needing regeneration on the next tick. */
    aceRegenerateGraph() {
      this.graphGenerated = false;
    }

    // ============================================================================
    // PATHFINDING - Settings Actions
    // ============================================================================

    /** Enables or disables automatic platform control (simulating input to follow the path). */
    aceSetAutoControl(enabled) {
      this.autoControl = enabled;
    }

    /** Sets the coyote time duration in seconds (grace period for jumping after leaving a ledge). */
    aceSetCoyoteTime(seconds) {
      this.coyoteTime = seconds;
    }

    /** Enables or disables strict jump positioning (careful tile alignment before jumps/falls). */
    aceSetStrictJumpPositioning(enabled) {
      this.strictPositioning = enabled;
    }

    /** Enables or disables ledge restriction (prevents the character from walking off platform edges). */
    aceSetLedgeRestriction(enabled) {
      this.ledgeRestriction = enabled;
    }

    /** Sets the ledge leniency distance in pixels (how close to a ledge before restriction kicks in). */
    aceSetLedgeLeniency(pixels) {
      this.ledgeLeniency = pixels;
    }

    /** Sets the re-path threshold in tiles (minimum deviation before automatically recalculating the path). */
    aceSetRePathThreshold(tiles) {
      this.rePathThreshold = tiles;
    }

    /** Sets the re-path cooldown duration in seconds (minimum time between re-path attempts). */
    aceSetRePathCooldown(seconds) {
      this.rePathCooldownDuration = Math.max(0, seconds);
    }

    aceSetPathStrategy(strategy) {
      this.pathStrategy = strategy;
    }

    /** Sets the hazard avoidance radius in tiles (how far to steer around hazardous areas). */
    aceSetHazardRadius(tiles) {
      this.hazardRadius = tiles;
    }

    /** Enables or disables multi-agent avoidance (agents try not to overlap each other). */
    aceSetMultiAgentAvoidance(enabled) {
      this.multiAgentAvoidance = enabled;
    }

    /** Sets the maximum number of path calculations per tick (0 = unlimited). */
    aceSetMaxPathsPerTick(count) {
      globalNavManager.maxPathsPerTick = Math.max(0, Math.floor(count));
    }

    /** Returns the current max paths per tick limit. */
    aceGetMaxPathsPerTick() {
      return globalNavManager.maxPathsPerTick;
    }

    /** Returns the number of path requests waiting in the queue. */
    aceGetPathQueueSize() {
      return globalNavManager.pathQueue.length;
    }

    // ============================================================================
    // PATHFINDING - State Queries (Conditions)
    // ============================================================================

    /** Returns whether the character currently has an active path to follow. */
    aceHasPath() {
      return this.hasPath;
    }

    /** Returns whether the platform behavior is currently enabled on this instance. */
    aceIsPlatformEnabled() {
      return this.platformBehavior ? this.platformBehavior.isEnabled : false;
    }

    /** Returns whether the character is currently standing on a ledge node (left or right platform edge). */
    aceIsAtLedge() {
      const grid = this.worldToGrid(this.instance.x, this.instance.y);
      const node = this.getNode(grid.gx, grid.gy);
      return node ? node.isLeftLedge || node.isRightLedge : false;
    }

    /** Returns whether the character is currently standing on an island node (a single isolated platform tile). */
    aceIsAtIsland() {
      const grid = this.worldToGrid(this.instance.x, this.instance.y);
      const node = this.getNode(grid.gx, grid.gy);
      return node ? node.isIsland : false;
    }

    /** Returns whether the navigation graph has been generated and is ready for pathfinding. */
    aceIsGraphGenerated() {
      return this.graphGenerated;
    }

    /** Returns whether a navigation node exists at the given grid coordinates. */
    aceNodeExistsGrid(gx, gy) {
      const graph = this._getNavigationGraph();
      return graph.has(`${gx},${gy}`);
    }

    /** Returns whether a navigation node exists at the given world position (converts to grid internally). */
    aceNodeExistsWorld(x, y) {
      const grid = this.worldToGrid(x, y);
      return this.aceNodeExistsGrid(grid.gx, grid.gy);
    }

    /** Returns whether the pathfinding system is still initializing (waiting for obstacle map setup). */
    aceIsSettingUpPathfinding() {
      return this.isWaitingForPathfindingMap || false;
    }

    /** Returns whether the node at the given grid coordinates is a ledge (left or right edge). */
    aceIsNodeLedge(gx, gy) {
      const graph = this._getNavigationGraph();
      const node = graph.get(this.gridKey(gx, gy));
      if (!node) return false;
      return node.isLeftLedge || node.isRightLedge;
    }

    /** Returns whether multi-agent avoidance is currently enabled. */
    aceIsMultiAgentAvoidanceEnabled() {
      return this.multiAgentAvoidance || false;
    }

    /** Returns whether the given world position falls within a hazardous area. */
    aceIsPositionHazardous(x, y) {
      return this._isPositionHazardous(x, y);
    }

    // ============================================================================
    // PATH DATA - Current Path Expressions
    // ============================================================================

    /** Returns the total number of waypoints in the current active path. Returns 0 if no path exists. */
    aceGetWaypointCount() {
      return this.currentPath.length;
    }

    /** Returns the index of the current waypoint the character is moving toward. */
    aceGetCurrentWaypoint() {
      return this.currentWaypoint;
    }

    /** Returns the world X position of the current waypoint. Returns 0 if no path or waypoint is invalid. */
    aceGetCurrentWaypointX() {
      if (!this.hasPath || this.currentWaypoint >= this.currentPath.length) return 0;
      return this.currentPath[this.currentWaypoint].x;
    }

    /** Returns the world Y position of the current waypoint. Returns 0 if no path or waypoint is invalid. */
    aceGetCurrentWaypointY() {
      if (!this.hasPath || this.currentWaypoint >= this.currentPath.length) return 0;
      return this.currentPath[this.currentWaypoint].y;
    }

    /** Returns the world X position of the waypoint at the given index. */
    aceGetWaypointX(index) {
      if (!this.currentPath || index < 0 || index >= this.currentPath.length) return 0;
      return this.currentPath[index].x;
    }

    /** Returns the world Y position of the waypoint at the given index. */
    aceGetWaypointY(index) {
      if (!this.currentPath || index < 0 || index >= this.currentPath.length) return 0;
      return this.currentPath[index].y;
    }

    /** Returns the grid X coordinate of the waypoint at the given index. */
    aceGetWaypointGridX(index) {
      if (!this.currentPath || index < 0 || index >= this.currentPath.length) return 0;
      return this.currentPath[index].node ? this.currentPath[index].node.gx : 0;
    }

    /** Returns the grid Y coordinate of the waypoint at the given index. */
    aceGetWaypointGridY(index) {
      if (!this.currentPath || index < 0 || index >= this.currentPath.length) return 0;
      return this.currentPath[index].node ? this.currentPath[index].node.gy : 0;
    }

    /** Gets the action type string for a waypoint at the given index. Returns actions like 'walk_left', 'jump', 'fall_right', etc. */
    aceGetCurrentPathAction(index) {
      if (
        !this.hasPath ||
        index < 0 ||
        index >= this.currentPath.length
      )
        return "";
      return this.currentPath[index].action || "";
    }

    /** Returns the reason the last pathfinding attempt failed. Empty string if succeeded. */
    aceGetPathFailReason() {
      return this.lastPathFailReason;
    }

    /** Returns the total estimated cost of the current path (sum of distances between waypoints). */
    aceGetPathCost() {
      return this.lastPathCost;
    }

    /** Returns the angle in degrees from the character to the current waypoint. */
    aceGetAngleToWaypoint() {
      if (!this.hasPath || this.currentWaypoint >= this.currentPath.length)
        return 0;
      const wp = this.currentPath[this.currentWaypoint];
      return (
        (Math.atan2(wp.y - this.instance.y, wp.x - this.instance.x) * 180) /
        Math.PI
      );
    }

    /** Returns the pixel distance from the character to the current waypoint. */
    aceGetDistanceToWaypoint() {
      if (!this.hasPath || this.currentWaypoint >= this.currentPath.length)
        return 0;
      const wp = this.currentPath[this.currentWaypoint];
      return this.distance(this.instance.x, this.instance.y, wp.x, wp.y);
    }

    /** Returns the world X of the path target. Pass "corrected" for the ground-corrected position. */
    aceGetPathTargetX(corrected) {
      return corrected === "corrected"
        ? this.pathTargetCorrectedX
        : this.pathTargetX;
    }

    /** Returns the world Y of the path target. Pass "corrected" for the ground-corrected position. */
    aceGetPathTargetY(corrected) {
      return corrected === "corrected"
        ? this.pathTargetCorrectedY
        : this.pathTargetY;
    }

    /** Returns the grid X coordinate of the path target (after ground correction). */
    aceGetPathTargetGridX() {
      return this.pathTargetGridX;
    }

    /** Returns the grid Y coordinate of the path target (after ground correction). */
    aceGetPathTargetGridY() {
      return this.pathTargetGridY;
    }

    /** Returns the world X position of the jump-toward target (the final unreachable destination). */
    aceGetJumpTowardTargetX() {
      return this.jumpTowardTargetX;
    }

    /** Returns the world Y position of the jump-toward target (the final unreachable destination). */
    aceGetJumpTowardTargetY() {
      return this.jumpTowardTargetY;
    }

    // ============================================================================
    // MOVEMENT STATE - Physics & Movement Expressions
    // ============================================================================

    /** Returns the estimated horizontal velocity based on position delta between ticks. */
    aceGetEstimatedVelocityX() {
      return this.estimatedVelocityX;
    }

    /** Returns the estimated stopping distance in pixels based on current speed and deceleration. */
    aceGetStoppingDistance() {
      const speed = this.platformBehavior
        ? this.platformBehavior.speed || Math.abs(this.estimatedVelocityX)
        : 0;
      const decel = this.platformProps.deceleration;
      return decel > 0 ? (speed * speed) / (2 * decel) : 0;
    }

    /** Returns the configured coyote time in seconds. */
    aceGetCoyoteTime() {
      return this.coyoteTime;
    }

    /** Returns the current coyote timer value (counts down from coyoteTime when leaving ground). */
    aceGetCoyoteTimer() {
      return this.coyoteTimer;
    }

    /** Returns 1 if strict jump positioning is enabled, 0 otherwise. */
    aceGetStrictJumpPositioning() {
      return this.strictPositioning ? 1 : 0;
    }

    /** Returns 1 if ledge restriction is enabled, 0 otherwise. */
    aceGetLedgeRestriction() {
      return this.ledgeRestriction ? 1 : 0;
    }

    /** Returns the ledge leniency distance in pixels. */
    aceGetLedgeLeniency() {
      return this.ledgeLeniency;
    }

    /** Returns the re-path threshold in tiles. */
    aceGetRePathThreshold() {
      return this.rePathThreshold;
    }

    /** Returns the re-path cooldown duration in seconds. */
    aceGetRePathCooldown() {
      return this.rePathCooldownDuration;
    }

    aceGetPathStrategy() {
      return this.pathStrategy;
    }

    // ============================================================================
    // OBSTACLE MAP - Grid & Map Expressions
    // ============================================================================

    /** Returns the total number of navigation nodes in the graph. */
    aceGetNodeCount() {
      return this._getNavigationGraph().size;
    }

    /** Returns the width of the obstacle grid in tiles. */
    aceGetGridWidth() {
      return this.gridWidth;
    }

    /** Returns the height of the obstacle grid in tiles. */
    aceGetGridHeight() {
      return this.gridHeight;
    }

    /** Returns the cell size (tile size) in pixels used by the obstacle map. */
    aceGetCellSize() {
      return this.cellSize;
    }

    /** Returns the grid tile size in pixels (alias for cell size). */
    aceGetGridTileSize() {
      return this.cellSize;
    }

    /** Converts a world X position (pixels) to the corresponding grid tile X coordinate. */
    aceWorldToGridX(x) {
      return Math.floor(x / this.cellSize);
    }

    /** Converts a world Y position (pixels) to the corresponding grid tile Y coordinate. */
    aceWorldToGridY(y) {
      return Math.floor(y / this.cellSize);
    }

    /** Returns the tile state at grid coordinates as a string: "solid", "clear", "slope", "jump_thru", or "avoid". */
    aceGetTileState(gx, gy) {
      if (
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      )
        return "solid";
      if (!this.obstacleMap) return "clear";
      const val = this.obstacleMap[gy * this.gridWidth + gx];
      if (val === 0) {
        if (this.slopeMap) {
          const sv = this.slopeMap[gy * this.gridWidth + gx];
          if (sv === 1) return "slope_left";
          if (sv === 2) return "slope_right";
          if (sv === 3) return "gentle_slope_left";
          if (sv === 4) return "gentle_slope_right";
        }
        return "clear";
      }
      if (val === 1) return "solid";
      if (val === 2) return "jump_thru";
      if (val === 3) return "avoid";
      return "clear";
    }

    /** Returns the tile state at world coordinates by converting to grid first. */
    aceGetTileStateWorld(x, y) {
      const grid = this.worldToGrid(x, y);
      return this.aceGetTileState(grid.gx, grid.gy);
    }

    /** Returns the slope direction at the given grid position: "left", "right", or "none". */
    aceGetSlopeDirection(gx, gy) {
      if (
        !this.slopeMap ||
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      )
        return "none";
      const val = this.slopeMap[gy * this.gridWidth + gx];
      if (val === 1) return "left";
      if (val === 2) return "right";
      if (val === 3) return "gentle_left";
      if (val === 4) return "gentle_right";
      return "none";
    }

    /** Returns the obstacle map as a JSON string for serialization/debugging. */
    aceGetObstacleMapJSON() {
      return this.aceSaveObstacleMapToJSON();
    }

    /** Returns the source of the current obstacle map (e.g. "tilemap", "solid", or "none"). */
    aceGetObstacleMapSource() {
      return this.obstacleMapSource || "none";
    }

    /** Returns the number of ticks spent waiting during pathfinding setup. */
    aceGetWaitTickCount() {
      return this.waitTickCount || 0;
    }

    // ============================================================================
    // GRAPH DATA - Node Query Expressions
    // ============================================================================

    /** Returns the world X position of the node at the given grid coordinates. Returns 0 if not found. */
    aceGetNodeWorldX(gx, gy) {
      const graph = this._getNavigationGraph();
      const node = graph.get(this.gridKey(gx, gy));
      return node ? node.x : 0;
    }

    /** Returns the world Y position of the node at the given grid coordinates. Returns 0 if not found. */
    aceGetNodeWorldY(gx, gy) {
      const graph = this._getNavigationGraph();
      const node = graph.get(this.gridKey(gx, gy));
      return node ? node.y : 0;
    }

    /** Returns the world X position of the nearest navigation node to the given world position. Returns -1 if no nodes. */
    aceGetNearestNodeX(x, y) {
      const node = this._findNearestNode(x, y);
      return node ? node.x : -1;
    }

    /** Returns the world Y position of the nearest navigation node to the given world position. Returns -1 if no nodes. */
    aceGetNearestNodeY(x, y) {
      const node = this._findNearestNode(x, y);
      return node ? node.y : -1;
    }

    /** Returns the grid X coordinate of the nearest navigation node to the given world position. Returns -1 if no nodes. */
    aceGetNearestNodeGridX(x, y) {
      const node = this._findNearestNode(x, y);
      return node ? node.gx : -1;
    }

    /** Returns the grid Y coordinate of the nearest navigation node to the given world position. Returns -1 if no nodes. */
    aceGetNearestNodeGridY(x, y) {
      const node = this._findNearestNode(x, y);
      return node ? node.gy : -1;
    }

    /** Returns the total number of connections (walk, jump, portal) from a node at the given grid position. */
    aceGetNodeConnectionCount(gx, gy) {
      const node = this.getNode(gx, gy);
      if (!node) return 0;
      return node.connections.length + node.portalConnections.length;
    }

    /** Returns the world X of the target node for a specific connection from the node at (gx, gy). Returns -1 if invalid. */
    aceGetNodeConnectionTargetX(gx, gy, index) {
      const conn = this._getConnectionAtIndex(gx, gy, index);
      return conn ? conn.target.x : -1;
    }

    /** Returns the world Y of the target node for a specific connection from the node at (gx, gy). Returns -1 if invalid. */
    aceGetNodeConnectionTargetY(gx, gy, index) {
      const conn = this._getConnectionAtIndex(gx, gy, index);
      return conn ? conn.target.y : -1;
    }

    /** Gets the action type string for a specific connection from a node. Returns actions like 'walk_left', 'jump', 'fall_right', 'portal_teleport', etc. */
    aceGetNodeConnectionAction(gx, gy, index) {
      const conn = this._getConnectionAtIndex(gx, gy, index);
      return conn ? conn.action : "";
    }

    /** Returns the traversal cost of a specific connection from a node. Returns -1 if invalid. */
    aceGetNodeConnectionCost(gx, gy, index) {
      const conn = this._getConnectionAtIndex(gx, gy, index);
      return conn ? conn.cost : -1;
    }

    /** Helper to retrieve a connection by index from a node's combined connection arrays (walk + portal). */
    _getConnectionAtIndex(gx, gy, index) {
      const node = this.getNode(gx, gy);
      if (!node) return null;
      const all = [
        ...node.connections,
        ...node.portalConnections,
      ];
      return index >= 0 && index < all.length ? all[index] : null;
    }

    /** Returns 1 if the node at (gx, gy) is a left ledge, 0 otherwise. */
    aceIsNodeLeftLedge(gx, gy) {
      const node = this.getNode(gx, gy);
      return node ? (node.isLeftLedge ? 1 : 0) : 0;
    }

    /** Returns 1 if the node at (gx, gy) is a right ledge, 0 otherwise. */
    aceIsNodeRightLedge(gx, gy) {
      const node = this.getNode(gx, gy);
      return node ? (node.isRightLedge ? 1 : 0) : 0;
    }

    /** Returns 1 if the node at (gx, gy) is an island (single isolated tile), 0 otherwise. */
    aceIsNodeIsland(gx, gy) {
      const node = this.getNode(gx, gy);
      return node ? (node.isIsland ? 1 : 0) : 0;
    }

    /** Returns 1 if the tile at (gx, gy) is a jump-thru platform, 0 otherwise. */
    aceIsTileJumpThru(gx, gy) {
      return this.isCellJumpThru(gx, gy) ? 1 : 0;
    }

    // ============================================================================
    // GRAPH DATA - Node Iteration Expressions (by index)
    // ============================================================================

    /** Returns the world X position of the node at the given index in the flat node array. Returns -1 if out of bounds. */
    aceGetNodeAtIndexX(index) {
      return index >= 0 && index < this.nodeIndexArray.length
        ? this.nodeIndexArray[index].x
        : -1;
    }

    /** Returns the world Y position of the node at the given index in the flat node array. Returns -1 if out of bounds. */
    aceGetNodeAtIndexY(index) {
      return index >= 0 && index < this.nodeIndexArray.length
        ? this.nodeIndexArray[index].y
        : -1;
    }

    /** Returns the grid X coordinate of the node at the given index. Returns -1 if out of bounds. */
    aceGetNodeAtIndexGridX(index) {
      return index >= 0 && index < this.nodeIndexArray.length
        ? this.nodeIndexArray[index].gx
        : -1;
    }

    /** Returns the grid Y coordinate of the node at the given index. Returns -1 if out of bounds. */
    aceGetNodeAtIndexGridY(index) {
      return index >= 0 && index < this.nodeIndexArray.length
        ? this.nodeIndexArray[index].gy
        : -1;
    }

    /** Returns 1 if the node at the given index is a left ledge, 0 otherwise. */
    aceGetNodeAtIndexIsLeftLedge(index) {
      return index >= 0 && index < this.nodeIndexArray.length
        ? this.nodeIndexArray[index].isLeftLedge
          ? 1
          : 0
        : 0;
    }

    /** Returns 1 if the node at the given index is a right ledge, 0 otherwise. */
    aceGetNodeAtIndexIsRightLedge(index) {
      return index >= 0 && index < this.nodeIndexArray.length
        ? this.nodeIndexArray[index].isRightLedge
          ? 1
          : 0
        : 0;
    }

    /** Returns 1 if the node at the given index is on a slope, 0 otherwise. */
    aceGetNodeAtIndexIsSlope(index) {
      return index >= 0 && index < this.nodeIndexArray.length
        ? this.nodeIndexArray[index].isSlope
          ? 1
          : 0
        : 0;
    }

    /** Returns the total number of connections for the node at the given index. */
    aceGetNodeAtIndexConnectionCount(index) {
      if (index < 0 || index >= this.nodeIndexArray.length) return 0;
      const n = this.nodeIndexArray[index];
      return n.connections.length + n.portalConnections.length;
    }

    // ============================================================================
    // HAZARDS - Query Expressions
    // ============================================================================

    /** Returns the total number of registered hazard instances. */
    aceGetHazardCount() {
      return this._getHazardsMap().size;
    }

    /** Returns the hazard severity value at the given world position. */
    aceGetHazardSeverity(x, y) {
      return this._getHazardSeverity(x, y);
    }

    /** Returns the hazard severity value at the given grid tile. Returns 0 if out of bounds or no hazard map. */
    aceGetTileHazardSeverity(gx, gy) {
      if (
        !this.hazardMap ||
        gx < 0 ||
        gx >= this.gridWidth ||
        gy < 0 ||
        gy >= this.gridHeight
      )
        return 0;
      return this.hazardMap[gy * this.gridWidth + gx] || 0;
    }

    /** Returns the configured hazard avoidance radius in tiles. */
    aceGetHazardRadius() {
      return this.hazardRadius;
    }

    // ============================================================================
    // PORTALS - Query Expressions
    // ============================================================================

    /** Returns the total number of registered portal instances. */
    aceGetPortalCount() {
      return this._getPortalsMap().size;
    }

    /** Returns the last portal ID that was added. */
    aceGetLastPortalID() {
      return this.lastPortalId;
    }

    /** Returns the portal ID during OnPortalEntry/OnPortalComplete triggers. */
    aceGetCurrentPortalID() {
      return this.currentPortalId;
    }

    /** Returns 0-1 traversal progress for gradual portals (0 if not traversing). */
    aceGetPortalProgress() {
      return this.portalTraverseProgress;
    }

    /** Returns exit X position of the current portal. */
    aceGetPortalExitX() {
      return this.portalTraverseTargetX;
    }

    /** Returns exit Y position of the current portal. */
    aceGetPortalExitY() {
      return this.portalTraverseTargetY;
    }

    /** Returns "instant" or "gradual" for the given portal ID. */
    aceGetPortalType(portalId) {
      const portalsMap = this._getPortalsMap();
      const portal = portalsMap.get(portalId);
      return portal ? portal.type : "";
    }

    // Portal state conditions
    aceIsAtPortal() {
      return this.portalState === "paused";
    }

    aceIsTraversingPortal() {
      return this.portalState === "traversing";
    }

    // Portal control actions
    acePauseAtPortal() {
      if (this._inPortalEntryTrigger) {
        this.portalPaused = true;
      }
    }

    aceResumePortal() {
      if (this.portalState !== "paused") return;
      this.portalPaused = false;
      this._executePortalBehavior(this.portalCurrentWaypoint);
    }

    aceCompletePortal() {
      if (this.portalState !== "paused" && this.portalState !== "traversing") return;
      if (this.portalState === "traversing" && this.platformBehavior && this.platformWasEnabled) {
        this.platformBehavior.isEnabled = true;
      }
      this._completePortal();
    }

    aceTeleportToPosition(x, y) {
      this.instance.x = x;
      this.instance.y = y;
      this.justUsedPortal = true;
    }

    // ============================================================================
    // MULTI-AGENT - Expressions
    // ============================================================================

    /** Returns the number of other pathfinding agents within 3 cells of this character. Returns 0 if avoidance is disabled. */
    aceGetNearbyAgentCount() {
      if (!this.multiAgentAvoidance || !this.useSharedGraph) return 0;
      const others = globalNavManager.getOtherInstancePositions(
        this.layoutUID,
        this
      );
      let count = 0;
      for (const agent of others) {
        if (
          this.distance(this.instance.x, this.instance.y, agent.x, agent.y) <
          this.cellSize * 3
        )
          count++;
      }
      return count;
    }

    // ============================================================================
    // DEBUG - Platform Behavior Expressions
    // ============================================================================

    /** Returns the platform behavior's configured max speed. */
    aceGetPlatformMaxSpeed() {
      return this.platformProps ? this.platformProps.maxSpeed : 0;
    }

    /** Returns the platform behavior's configured jump strength. */
    aceGetPlatformJumpStrength() {
      return this.platformProps ? this.platformProps.jumpStrength : 0;
    }

    /** Returns the calculated maximum jump height in pixels based on physics properties. */
    aceGetCalculatedJumpHeight() {
      return this.maxJumpHeight || 0;
    }

    /** Returns the calculated maximum jump distance in pixels based on physics properties. */
    aceGetCalculatedJumpDistance() {
      return this.maxJumpDistance || 0;
    }

    // ============================================================================
    // DEBUG - Graph Diagnostics
    // ============================================================================

    /** Logs detailed navigation graph statistics to the browser console (node counts, connections, ledges, portals, etc.). */
    aceLogGraphStats() {
      const graph = this._getNavigationGraph();
      let totalConnections = 0;
      let ledgeCount = 0;
      let slopeCount = 0;
      let islandCount = 0;
      let jumpThruCount = 0;

      for (const [key, node] of graph) {
        totalConnections +=
          node.connections.length + node.portalConnections.length;
        if (node.isLeftLedge || node.isRightLedge) ledgeCount++;
        if (node.isSlope) slopeCount++;
        if (node.isIsland) islandCount++;
        if (node.isOnJumpThru) jumpThruCount++;
      }

      console.log("=== Navigation Graph Stats ===");
      console.log("Nodes:", graph.size);
      console.log("Connections:", totalConnections);
      console.log("Ledge nodes:", ledgeCount);
      console.log("Island nodes:", islandCount);
      console.log("Slope nodes:", slopeCount);
      console.log("Jump-thru nodes:", jumpThruCount);
      console.log("Portals:", this._getPortalsMap().size);
      console.log("Hazards:", this._getHazardsMap().size);
    }

    /** Fires a C3 trigger condition and dispatches the corresponding custom event. Called internally to notify both event sheets and JS listeners. */
    _trigger(method) {
      this.dispatch(method);
      super._trigger(self.C3[AddonTypeMap[addonType]][id].Cnds[method]);
    }

    /** Registers a JavaScript callback for a named event tag. Supports options like {once: true} for one-shot listeners and {params: [...]} for conditional filtering. */
    on(tag, callback, options) {
      if (!this.events[tag]) {
        this.events[tag] = [];
      }
      this.events[tag].push({ callback, options });
    }

    /** Removes a previously registered JavaScript callback for a named event tag. */
    off(tag, callback) {
      if (this.events[tag]) {
        this.events[tag] = this.events[tag].filter(
          (event) => event.callback !== callback
        );
      }
    }

    /** Invokes all registered callbacks for a named event tag. If a listener has params, the corresponding C3 condition is checked first — callbacks are skipped if the condition returns false. One-shot listeners are automatically removed after firing. */
    dispatch(tag) {
      if (this.events[tag]) {
        this.events[tag].forEach((event) => {
          if (event.options && event.options.params) {
            const fn = self.C3[AddonTypeMap[addonType]][id].Cnds[tag];
            if (fn && !fn.call(this, ...event.options.params)) {
              return;
            }
          }
          event.callback();
          if (event.options && event.options.once) {
            this.off(tag, event.callback);
          }
        });
      }
    }
  };
}
