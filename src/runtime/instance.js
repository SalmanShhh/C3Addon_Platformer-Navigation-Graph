import { id, addonType, name } from "../../config.caw.js";
import AddonTypeMap from "../../template/addonTypeMap.js";

export default function (parentClass) {
  // ===========================
  // NavigationManager Singleton
  // ===========================
  class NavigationManager {
    constructor() {
      this.sharedGraphs = new Map();
      this.subscribers = new Map();
    }

    getSharedGraph(layoutUID) {
      if (!this.sharedGraphs.has(layoutUID)) {
        this.sharedGraphs.set(layoutUID, new Map());
      }
      return this.sharedGraphs.get(layoutUID);
    }

    subscribe(layoutUID, instance) {
      if (!this.subscribers.has(layoutUID)) {
        this.subscribers.set(layoutUID, new Set());
      }
      this.subscribers.get(layoutUID).add(instance);
    }

    unsubscribe(layoutUID, instance) {
      const subs = this.subscribers.get(layoutUID);
      if (subs) {
        subs.delete(instance);
        if (subs.size === 0) {
          this.subscribers.delete(layoutUID);
          this.sharedGraphs.delete(layoutUID);
        }
      }
    }

    markGraphAsGenerated(layoutUID) {
      const subs = this.subscribers.get(layoutUID);
      if (subs) {
        for (const inst of subs) {
          inst.graphGenerated = true;
        }
      }
    }

    needsRegeneration(layoutUID) {
      const subs = this.subscribers.get(layoutUID);
      if (!subs || subs.size === 0) return false;
      for (const inst of subs) {
        if (!inst.graphGenerated) return true;
      }
      return false;
    }

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
      this.SLOPE_COST = 1.2;

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
        console.log(`[NavGraph] Character dimensions: ${this.characterWidth}x${this.characterHeight}px (instance: ${this.instance.width}x${this.instance.height})`);
        this._initializeGraphMode();
        this.platformBehavior = this._getPlatformBehavior();
        this.pathfindingBehavior = this._getPathfindingBehavior();
        if (this.platformBehavior) {
          this._readPlatformProperties();
          this._calculateJumpParametersFromPlatform();
        }
      }

      // Use "Lazy Loading" - only find them if we don't have them yet
    if (!this.platformBehavior) {
        this.platformBehavior = this._getPlatformBehavior();
        if (this.platformBehavior) {
            this._readPlatformProperties();
            this._calculateJumpParametersFromPlatform();
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

      if (this.hasPath) {
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
        platformProps: this.platformProps,
        graphGenerated: this.graphGenerated,
        obstacleMap: this.obstacleMap,
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
      this.platformProps = o.platformProps;
      this.graphGenerated = o.graphGenerated;
      this.obstacleMap = o.obstacleMap;
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

    _getPlatformBehavior() {
      return this._GetBehaviorByType("Platform");
    }

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

    _log(...args) {
      if (this.enableDebug) {
        console.log(`[${name}]`, ...args);
      }
    }

    _warn(...args) {
      if (this.enableDebug) {
        console.warn(`[${name}]`, ...args);
      }
    }

    _error(...args) {
      if (this.enableDebug) {
        console.error(`[${name}]`, ...args);
      }
    }

    // find behavior by plugin type (e.g. "Platform", "Pathfinding"), ensures it works even if the behavior is renamed in the editor
    

    worldToGrid(x, y) {
      const gx = Math.floor(x / this.cellSize);
      const gy = Math.floor(y / this.cellSize);
      return { gx, gy };
    }

    gridToWorld(gx, gy) {
      const x = gx * this.cellSize + this.cellSize / 2;
      const y = gy * this.cellSize + this.cellSize / 2;
      return { x, y };
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
        return globalNavManager.getSharedGraph(this.layoutUID);
      }
      return this.navGraph;
    }

    _getPortalsMap() {
      if (this.useSharedGraph) {
        const subs = globalNavManager.subscribers.get(this.layoutUID);
        if (subs && subs.size > 0) {
          return subs.values().next().value.portals;
        }
      }
      return this.portals;
    }

    _getHazardsMap() {
      if (this.useSharedGraph) {
        const subs = globalNavManager.subscribers.get(this.layoutUID);
        if (subs && subs.size > 0) {
          return subs.values().next().value.hazards;
        }
      }
      return this.hazards;
    }

    _needsGraphRegeneration() {
      if (this.useSharedGraph) {
        return globalNavManager.needsRegeneration(this.layoutUID);
      }
      return !this.graphGenerated;
    }

    _markGraphAsGenerated() {
      if (this.useSharedGraph) {
        globalNavManager.markGraphAsGenerated(this.layoutUID);
      } else {
        this.graphGenerated = true;
      }
    }

    _initializeGraphMode() {
      if (this.useSharedGraph) {
        globalNavManager.subscribe(this.layoutUID, this);
      }
    }

    _scanObstacles() {
      if (this.obstacleMapSource === "custom") {
        return;
      }

      if (this.pathfindingBehavior) {
        const success = this._copyObstacleMapFromPathfinding();
        if (!success) {
          this.isWaitingForPathfindingMap = true;
          this.waitTickCount = 0;
          this._log("Pathfinding behavior found but map not ready, starting poll...");
        }
      } else {
        this.isWaitingForPathfindingMap = true;
        this.waitTickCount = 0;
      }
    }

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

      // Map is ready
      this.isWaitingForPathfindingMap = false;
      this.waitTickCount = 0;
      this._trigger("OnPathfindingMapReady");

      if (this.autoRegenOnReady) {
        const success = this._copyObstacleMapFromPathfinding();
        if (success) {
          this._generateGraph();
        } else {
          this._trigger("OnPathfindingMapFailed");
        }
      }
    }

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
        this.obstacleMap = new Array(cellCount).fill(0);

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
      this.obstacleMap = new Array(cellCount).fill(0);
      this.obstacleMapSource = "custom";
      this._trigger("OnObstacleMapCreated");
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
      } else if (state === "jump-thru") {
        this.obstacleMap[index] = 2;
      } else if (state === "avoid") {
        this.obstacleMap[index] = 3;
      } else if (state === "slope-left") {
        this.obstacleMap[index] = 0;
        if (!this.slopeMap) {
          this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);
        }
        this.slopeMap[index] = 1;
      } else if (state === "slope-right") {
        this.obstacleMap[index] = 0;
        if (!this.slopeMap) {
          this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);
        }
        this.slopeMap[index] = 2;
      }
    }

    aceSetTileStateWorld(x, y, state) {
      const grid = this.worldToGrid(x, y);
      this.aceSetTileState(grid.gx, grid.gy, state);
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
    }

    aceClearAllHazardTiles() {
      if (this.hazardMap) this.hazardMap.fill(0);
    }

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

    _isSlopeWalkable(gx, gy) {
      if (!this.slopeMap) return false;
      const index = gy * this.gridWidth + gx;
      return this.slopeMap[index] > 0;
    }

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

    _createNode(x, y, gx, gy) {
      const leftBelowBlocked = this._isGroundAt(gx - 1, gy + 1);
      const rightBelowBlocked = this._isGroundAt(gx + 1, gy + 1);
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
      };
    }

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

    getNode(gx, gy) {
      const graph = this._getNavigationGraph();
      return graph.get(this.gridKey(gx, gy));
    }

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

    _connectJump() {
      const maxHeightCells = Math.ceil(this.maxJumpHeight / this.cellSize);
      const maxFallCells = Math.ceil(this.maxFallDistance / this.cellSize);
      const maxDistCells = Math.ceil(this.maxJumpDistance / this.cellSize);
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

              const peakHeight = target ? this._canJump(node, target) : 0;
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

                const dblPeakHeight = target ? this._canJump(node, target) : 0;
                if (dblPeakHeight > 0) {
                  if (height > maxHeightCells || dist > maxDistCells) {
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

      this._log(`Created ${count} jump connections (up=${upCount}, down=${downCount}, level=${levelCount}, maxDownCells=${maxDownCells}, maxHeightCells=${maxHeightCells}, maxDistCells=${maxDistCells})`);
    }

    _getWidthCells() {
      return Math.ceil(this.characterWidth / this.cellSize / 2);
    }

    // Returns the minimum viable peak height in pixels (>0) if jump is possible,
    // or 0 if the jump is blocked. The peak height is stored in connections and
    // used by the movement code to release the jump button at the right time.
    _canJump(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;

      if (Math.abs(dx) > this.maxJumpDistance) return 0;
      if (-dy > this.maxJumpHeight) return 0;

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
            } else {
              if (cellVal === 1 && this.platformProps.ceilingCollisionMode === "stop") return 0;
              if (cellVal === 3) return 0;
            }
          }
        }
        return this.maxJumpHeight; // Vertical jumps use full sustain
      }

      // Horizontal jump: use Bezier arc check
      // Adaptive arc: peak just high enough for the jump, capped at maxJumpHeight
      const neededPeakHeight = Math.max(-dy, 0) + this.cellSize;
      const actualPeakHeight = Math.min(this.maxJumpHeight, neededPeakHeight);
      const peakY = from.y - actualPeakHeight;
      const controlY = 2 * peakY - (from.y + to.y) / 2;

      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
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
              const prevT = Math.max(0, (i - 1) / 8);
              const prevOneMinusT = 1 - prevT;
              const prevArcY = from.y * prevOneMinusT * prevOneMinusT + 2 * controlY * prevT * prevOneMinusT + to.y * prevT * prevT;
              if (arcY > prevArcY) return 0;
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

    _connectFall() {
      const maxFallCells = Math.ceil(this.maxFallDistance / this.cellSize);
      let count = 0;
      let diagCount = 0;
      const graph = this._getNavigationGraph();

      for (const [key, node] of graph) {
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

        if (node.isLeftLedge) {
          diagCount += this._addDiagonalFall(node, -1, maxFallCells);
        }
        if (node.isRightLedge) {
          diagCount += this._addDiagonalFall(node, 1, maxFallCells);
        }
      }

      this._log(`Created ${count} straight fall + ${diagCount} diagonal fall connections (maxFallCells=${maxFallCells})`);
    }

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

    _canDiagonalFall(from, to, direction) {
      const steps = 10;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const widthCells = this._getWidthCells();

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + dx * t;
        const y = from.y + dy * t * t;
        const grid = this.worldToGrid(x, y);
        for (let w = -widthCells; w <= widthCells; w++) {
          if (this.isCellBlocked(grid.gx + w, grid.gy)) return false;
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

    _connectSlope() {
      if (!this.slopeMap) return;

      const graph = this._getNavigationGraph();
      let count = 0;

      for (const [key, node] of graph) {
        if (!node.isSlope) continue;

        if (node.slopeDirection === 1) {
          const down = this.getNode(node.gx - 1, node.gy + 1);
          const up = this.getNode(node.gx + 1, node.gy - 1);
          if (down) {
            node.connections.push({
              target: down,
              action: "walk_left",
              cost: this.cellSize * this.SLOPE_COST,
            });
            count++;
          }
          if (up) {
            node.connections.push({
              target: up,
              action: "walk_right",
              cost: this.cellSize * this.SLOPE_COST,
            });
            count++;
          }
        } else if (node.slopeDirection === 2) {
          const up = this.getNode(node.gx - 1, node.gy - 1);
          const down = this.getNode(node.gx + 1, node.gy + 1);
          if (up) {
            node.connections.push({
              target: up,
              action: "walk_left",
              cost: this.cellSize * this.SLOPE_COST,
            });
            count++;
          }
          if (down) {
            node.connections.push({
              target: down,
              action: "walk_right",
              cost: this.cellSize * this.SLOPE_COST,
            });
            count++;
          }
        }
      }

      this._log(`Created ${count} slope connections`);
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

    _generateGraph() {
      if (this.isWaitingForPathfindingMap) return;

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

      const endTime = performance.now();
      this._log(`Graph generated in ${(endTime - startTime).toFixed(2)}ms`);

      // this makes sure the trigger condition is called once the graph is generated.
      this._trigger("OnGraphGenerated");
    }

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
        const _fmtPath = (p) => p.map((wp, i) => `${i}:(${wp.node ? wp.node.gx : '?'},${wp.node ? wp.node.gy : '?'})${wp.action}`).join(' → ');
        this._log(`Using forward path only (no valid reverse)`);
        this._log(`  Path: ${_fmtPath(validForward)}`);
        bestPath = validForward;
      } else if (validReversed) {
        const _fmtPath = (p) => p.map((wp, i) => `${i}:(${wp.node ? wp.node.gx : '?'},${wp.node ? wp.node.gy : '?'})${wp.action}`).join(' → ');
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

      const openSet = [startNode];
      const closedSet = new Set();

      let nodesExplored = 0;

      const otherAgents = this.multiAgentAvoidance
        ? globalNavManager.getOtherInstancePositions(this.layoutUID, this)
        : [];

      while (openSet.length > 0) {
        if (nodesExplored >= this.maxSearchNodes) {
          this._lastAStarFailDetail = `search_exhausted (explored ${nodesExplored}/${this.maxSearchNodes} nodes)`;
          return null;
        }

        openSet.sort((a, b) => a.fScore - b.fScore);
        const current = openSet.shift();
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

          const hazardMultiplier = conn.ignoreHazards
            ? 1.0
            : this.enableHazards
            ? neighbor.hazardMultiplier || 1.0
            : 1.0;

          let agentAvoidanceCost = 1.0;
          if (this.multiAgentAvoidance && otherAgents.length > 0) {
            for (const agent of otherAgents) {
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
            neighbor.parent = current;
            neighbor.parentAction = conn.action;
            neighbor.parentPortalId = conn.portalId || null;
            neighbor.parentSpeed = conn.speed || 0;
            neighbor.parentPeakHeight = conn.peakHeight || 0;
            neighbor.gScore = tentativeG;
            neighbor.hScore = this.distance(
              neighbor.x,
              neighbor.y,
              goalNode.x,
              goalNode.y
            );
            neighbor.fScore = neighbor.gScore + neighbor.hScore;

            if (!openSet.includes(neighbor)) {
              openSet.push(neighbor);
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
        const conn = this._findConnectionBetween(fromNode, toNode);
        if (!conn) {
          this._log(`Path validation failed: no connection between (${fromNode.gx},${fromNode.gy}) and (${toNode.gx},${toNode.gy}) at waypoint ${i}`);
          return null;
        }
        // Fix action if it doesn't match the actual connection
        // (can happen when _combinePaths merges at a common node)
        if (path[i + 1].action !== conn.action) {
          path[i + 1].action = conn.action;
          path[i + 1].portalId = conn.portalId || null;
          path[i + 1].speed = conn.speed || 0;
          path[i + 1].peakHeight = conn.peakHeight || 0;
        }
      }
      return path;
    }

    _findConnectionBetween(fromNode, toNode) {
      const allConnections = [
        ...fromNode.connections,
        ...fromNode.portalConnections,
      ];
      for (const conn of allConnections) {
        if (conn.target === toNode) return conn;
      }
      return null;
    }

    _pathCost(path) {
      let cost = 0;
      for (let i = 1; i < path.length; i++) {
        cost += this.distance(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
      }
      return cost;
    }

    _strategyCost(path) {
      switch (this.pathStrategy) {
        case "shortest":
          return this._pathCost(path);

        case "safest": {
          let cost = 0;
          for (let i = 1; i < path.length; i++) {
            const dist = this.distance(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
            const action = path[i].action;
            if (action === "jump" || action === "coyote_jump" || action === "jump_toward")
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
            if (action === "jump" || action === "coyote_jump" || action === "jump_toward")
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
          }
        }
        const cost2 = this._strategyCost(hybrid2);
        if (cost2 < bestCost) {
          bestCost = cost2;
          bestPath = hybrid2;
        }
      }

      const _fmtPath = (p) => p.map((wp, i) => `${i}:(${wp.node ? wp.node.gx : '?'},${wp.node ? wp.node.gy : '?'})${wp.action}`).join(' → ');
      this._log(`Combined path: cost=${Math.round(bestCost)} (fwd=${Math.round(forwardCost)}, rev=${Math.round(reverseCost)}, strategy=${this.pathStrategy})`);
      this._log(`  Forward path:  ${_fmtPath(forwardPath)}`);
      this._log(`  Reversed path: ${_fmtPath(reversedPath)}`);
      this._log(`  Selected path: ${_fmtPath(bestPath)}`);
      return bestPath;
    }

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
          x: current.x,
          y: current.y,
        });
        current = current.parent;
      }

      return path;
    }

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

    _findBestLaunchNode(startX, startY, targetX, targetY) {
      const targetGrid = this.worldToGrid(targetX, targetY);
      const maxDistCells = Math.ceil(this.maxJumpDistance / this.cellSize);
      const maxHeightCells = Math.ceil(this.maxJumpHeight / this.cellSize);
      let bestNode = null;
      let bestDist = Infinity;

      const maxR = Math.max(maxDistCells, maxHeightCells);
      for (let r = 1; r <= maxR; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            if (Math.abs(dx) > maxDistCells) continue;
            // Only allow nodes above the target up to jump height
            if (dy < 0 && Math.abs(dy) > maxHeightCells) continue;
            const node = this.getNode(targetGrid.gx + dx, targetGrid.gy + dy);
            if (!node) continue;
            const dist = this.distance(node.x, node.y, targetX, targetY);
            if (dist < bestDist) {
              const testPath = this.findPath(startX, startY, node.x, node.y);
              if (testPath) {
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

      const dist = this.distance(
        this.instance.x,
        this.instance.y,
        waypoint.x,
        waypoint.y
      );

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
            nextWp.action === "jump_toward" || nextWp.action === "fall" ||
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
            nextWp.action === "jump_toward" || nextWp.action === "fall" ||
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

        // Convert jump to fall when the target is below and the character is on a
        // platform edge (not an island). On islands, the character must jump.
        if (effectiveAction === "jump" && waypoint.y > this.instance.y + this.cellSize * 0.3) {
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
           effectiveAction === "jump_toward" ||
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

    _rePath() {
      if (this.portalState !== "none") return;
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
        this.lastPathMode
      );
      this._trigger("OnRePathTriggered");
    }

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

    _completePortal() {
      this.justUsedPortal = true;
      this.portalPauseTimer = 0;
      this.portalPauseWarned = false;
      this._trigger("OnPortalComplete");
      this.portalState = "none";
      this.portalPaused = false;
      this.portalCurrentWaypoint = null;
    }

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

    _executePhysicsAware(action, targetX, targetY, waypoint) {
      const speed =
        this.platformBehavior.speed || Math.abs(this.estimatedVelocityX);
      const decel = this.platformProps.deceleration;
      const distToTarget = Math.abs(targetX - this.instance.x);
      const stoppingDist = (speed * speed) / (2 * decel);

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

      if (action === "jump_toward") {
        this._handleJumpTowardAction(targetX, targetY);
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
        this._handleFallAction(targetX, action);
        return;
      }
    }

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
            nextWaypoint.action === "coyote_jump" || nextWaypoint.action === "jump_toward"
          );

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

      // Strict positioning: cap speed when approaching a ledge before a departure action
      if (this.currentPathStrict && waypoint && waypoint.node) {
        const node = waypoint.node;
        if (node.isLeftLedge || node.isRightLedge || node.isIsland) {
          const nextIdx = this.currentWaypoint + 1;
          const nextWp = nextIdx < this.currentPath.length ? this.currentPath[nextIdx] : null;
          if (nextWp && (
            nextWp.action === "jump" || nextWp.action === "coyote_jump" ||
            nextWp.action === "jump_toward" || nextWp.action === "fall" ||
            nextWp.action === "fall_left" || nextWp.action === "fall_right"
          )) {
            const maxDepartureSpeed = Math.sqrt(2 * decel * (this.cellSize * 0.35));
            if (speed > maxDepartureSpeed) return; // Coast to safe speed
          }
        }
      }

      if (distToTarget > stoppingDist + this.cellSize * 0.1) {
        this.platformBehavior.simulateControl(direction);
      }
    }

    _handleJumpAction(targetX, targetY, waypoint) {
      const dt = this.instance.dt;

      if (waypoint && waypoint.requiresDoubleJump) {
        if (this.doubleJumpPhase === 0) {
          const dir = targetX < this.instance.x ? "left" : "right";
          this.platformBehavior.simulateControl(dir);
          this.platformBehavior.simulateControl("jump");
          this.doubleJumpPhase = 1;
          this.jumpStartTime = 0;
        } else if (this.doubleJumpPhase === 1) {
          const dir = targetX < this.instance.x ? "left" : "right";
          this.platformBehavior.simulateControl(dir);

          if (this.platformProps.jumpSustain > 0) {
            this.jumpStartTime += dt * 1000;
            if (this.jumpStartTime < this.platformProps.jumpSustain) {
              this.platformBehavior.simulateControl("jump");
            }
          }

          try {
            if (!this.platformBehavior.isRising) {
              this.doubleJumpPhase = 2;
            }
          } catch (e) {
            this.doubleJumpPhase = 2;
          }
        } else if (this.doubleJumpPhase === 2) {
          const dir = targetX < this.instance.x ? "left" : "right";
          this.platformBehavior.simulateControl(dir);
          this.platformBehavior.simulateControl("jump");
          this.doubleJumpPhase = 3;
          this.jumpStartTime = 0;
        } else if (this.doubleJumpPhase === 3) {
          const dir = targetX < this.instance.x ? "left" : "right";
          this.platformBehavior.simulateControl(dir);

          if (this.platformProps.jumpSustain > 0) {
            this.jumpStartTime += dt * 1000;
            if (this.jumpStartTime < this.platformProps.jumpSustain) {
              this.platformBehavior.simulateControl("jump");
            }
          }
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
          const node = prevWp.node;
          const hasLedge = (jumpDir === "right" && node.isRightLedge) ||
                           (jumpDir === "left" && node.isLeftLedge);

          if (!this.ledgeRestriction && wallBlocksJump && !isVerticalJump && hasLedge) {
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
            if (distToCenter > this.cellSize * 0.15) {
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

    _handleJumpTowardAction(targetX, targetY) {
      const xDist = Math.abs(targetX - this.instance.x);
      const dir = targetX < this.instance.x ? "left" : "right";

      if (xDist >= this.cellSize * 0.5) {
        try {
          if (!this.platformBehavior.isByWall(dir)) {
            this.platformBehavior.simulateControl(dir);
          }
        } catch (e) {
          this.platformBehavior.simulateControl(dir);
        }
      }
      this.platformBehavior.simulateControl("jump");

      if (this.platformProps.isDoubleJumpEnabled) {
        try {
          if (
            !this.platformBehavior.isRising &&
            !this.platformBehavior.isOnFloor
          ) {
            this.platformBehavior.simulateControl("jump");
          }
        } catch (e) {}
      }

      if (this.platformProps.jumpSustain > 0) {
        this.platformBehavior.simulateControl("jump");
      }

      this.jumpTowardTargetX = targetX;
      this.jumpTowardTargetY = targetY;
      this._trigger("OnJumpTowardExecuted");
    }

    _handleFallAction(targetX, action) {
      if (action === "fall_left") {
        this.platformBehavior.simulateControl("left");
      } else if (action === "fall_right") {
        this.platformBehavior.simulateControl("right");
      } else {
        // Straight fall — nudge toward target X for precise tile landing
        // This is important when a subsequent jump needs the character centered on the tile
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
    }

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
    aceFindPath(targetX, targetY, correctToGround, mode, strict) {
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

      // "jump_at" mode skips normal pathfinding — it always needs a launch node
      let path = null;
      if (this.lastPathMode !== "jump_at") {
        path = this.findPath(startX, startY, targetX, targetY);
      }

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

      // "jump_at" mode: find a launch node offset from the target, then jump at it.
      // Used for jump attacks, stomps, or hitting targets aggressively.
      if (this.lastPathMode === "jump_at") {
        const launch = this._findBestLaunchNode(
          startX,
          startY,
          this.pathTargetX,
          this.pathTargetY
        );
        if (launch) {
          path = this.findPath(startX, startY, launch.x, launch.y);
          if (path) {
            path.push({
              node: launch,
              action: "jump_toward",
              x: this.pathTargetX,
              y: this.pathTargetY,
            });
          }
        }
        // Fallback: nearest reachable node + jump
        if (!path) {
          const nearest = this._findNearestReachableNode(
            startX,
            startY,
            this.pathTargetX,
            this.pathTargetY
          );
          if (nearest) {
            path = this.findPath(startX, startY, nearest.x, nearest.y);
            if (path) {
              path.push({
                node: nearest,
                action: "jump_toward",
                x: this.pathTargetX,
                y: this.pathTargetY,
              });
            }
          }
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
      this.aceClearPath();
      this.aceStopMovement();
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
      const node = graph.get(`${gx},${gy}`);
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

    /** Returns the tile state at grid coordinates as a string: "solid", "clear", "slope", "jump-thru", or "avoid". */
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
        if (
          this.slopeMap &&
          this.slopeMap[gy * this.gridWidth + gx] > 0
        )
          return "slope";
        return "clear";
      }
      if (val === 1) return "solid";
      if (val === 2) return "jump-thru";
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
      return val === 1 ? "left" : val === 2 ? "right" : "none";
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
      const node = graph.get(`${gx},${gy}`);
      return node ? node.x : 0;
    }

    /** Returns the world Y position of the node at the given grid coordinates. Returns 0 if not found. */
    aceGetNodeWorldY(gx, gy) {
      const graph = this._getNavigationGraph();
      const node = graph.get(`${gx},${gy}`);
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

    _trigger(method) {
      this.dispatch(method);
      super._trigger(self.C3[AddonTypeMap[addonType]][id].Cnds[method]);
    }

    on(tag, callback, options) {
      if (!this.events[tag]) {
        this.events[tag] = [];
      }
      this.events[tag].push({ callback, options });
    }

    off(tag, callback) {
      if (this.events[tag]) {
        this.events[tag] = this.events[tag].filter(
          (event) => event.callback !== callback
        );
      }
    }

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
