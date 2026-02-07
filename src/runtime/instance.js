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
      this.characterHeight = properties[2];
      this.maxSearchNodes = properties[3];
      this.setupPreset = properties[4];
      this.maxJumpHeight = properties[5];
      this.maxJumpDistance = properties[6];
      this.maxFallDistance = properties[7];
      this.autoControl = properties[8];
      this.graphMode = properties[9];
      this.enablePortals = properties[10];
      this.smoothPaths = properties[11];
      this.maxWaypointTime = properties[12];
      this.enableHazards = properties[13];
      this.coyoteTime = properties[14];
      this.ledgeRestriction = properties[15];
      this.ledgeLeniency = properties[16];
      this.rePathThreshold = properties[17];
      this.hazardRadius = properties[18];

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

      this.ladders = new Map();
      this.nextLadderId = 1;
      this.isClimbing = false;
      this.climbStartY = 0;
      this.climbTargetY = 0;
      this.climbSpeed = 0;
      this.currentLadderId = 0;

      this.coyoteTimer = 0;
      this.wasOnFloor = false;
      this.coyoteJumpPending = false;

      this.estimatedVelocityX = 0;
      this.lastInstanceX = 0;
      this.jumpStartTime = 0;
      this.doubleJumpPhase = 0;
      this.isHoldingJump = false;
      this.jumpHoldTimer = 0;

      this.rePathCooldown = 0;
      this.justUsedPortal = false;

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
    }

    _tick() {
      const dt = this.instance.dt;

      //console.log("Did Tick")
      this.logBehaviors();
      
      // First-tick initialization: acquire layout UID, behaviors, and graph mode
      if (!this._initialized) {
        this._initialized = true;
        this.layoutUID = this.instance.layout.uid;
        this._initializeGraphMode();
        this.platformBehavior = this._getPlatformBehavior();
        this.pathfindingBehavior = this._getPathfindingBehavior();
        if (this.platformBehavior) {
          this._readPlatformProperties();
          if (this.setupPreset !== "custom") this._applyPreset();
        }
      }

      // Use "Lazy Loading" - only find them if we don't have them yet
    if (!this.platformBehavior) {
        this.platformBehavior = this._getPlatformBehavior();
        if (this.platformBehavior) {
            this._readPlatformProperties();
            if (this.setupPreset !== "custom") this._applyPreset();
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

      if (this.justUsedPortal) {
        this.justUsedPortal = false;
      }

      if (this.hasPath) {
        this._followPath(dt);
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
      if (this.ladders) this.ladders.clear();
    }

    _saveToJson() {
      return {
        version: 1,
        enableDebug: this.enableDebug,
        cellSize: this.cellSize,
        characterHeight: this.characterHeight,
        maxSearchNodes: this.maxSearchNodes,
        setupPreset: this.setupPreset,
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
        ledgeRestriction: this.ledgeRestriction,
        ledgeLeniency: this.ledgeLeniency,
        rePathThreshold: this.rePathThreshold,
        hazardRadius: this.hazardRadius,
        multiAgentAvoidance: this.multiAgentAvoidance,
        currentPath: this.currentPath.map((wp) => ({
          x: wp.x,
          y: wp.y,
          action: wp.action,
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
        ladders: Array.from(this.ladders.values()),
        isClimbing: this.isClimbing,
        climbStartY: this.climbStartY,
        climbTargetY: this.climbTargetY,
        climbSpeed: this.climbSpeed,
        currentLadderId: this.currentLadderId,
        coyoteTimer: this.coyoteTimer,
        wasOnFloor: this.wasOnFloor,
        coyoteJumpPending: this.coyoteJumpPending,
        doubleJumpPhase: this.doubleJumpPhase,
        isHoldingJump: this.isHoldingJump,
        jumpHoldTimer: this.jumpHoldTimer,
      };
    }

    _loadFromJson(o) {
      if (!o || o.version !== 1) return;

      this.enableDebug = o.enableDebug;
      this.cellSize = o.cellSize;
      this.characterHeight = o.characterHeight;
      this.maxSearchNodes = o.maxSearchNodes;
      this.setupPreset = o.setupPreset;
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
      this.ledgeRestriction = o.ledgeRestriction;
      this.ledgeLeniency = o.ledgeLeniency;
      this.rePathThreshold = o.rePathThreshold;
      this.hazardRadius = o.hazardRadius;
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
      this.isClimbing = o.isClimbing;
      this.climbStartY = o.climbStartY;
      this.climbTargetY = o.climbTargetY;
      this.climbSpeed = o.climbSpeed;
      this.currentLadderId = o.currentLadderId;
      this.coyoteTimer = o.coyoteTimer;
      this.wasOnFloor = o.wasOnFloor;
      this.coyoteJumpPending = o.coyoteJumpPending;
      this.doubleJumpPhase = o.doubleJumpPhase;
      this.isHoldingJump = o.isHoldingJump;
      this.jumpHoldTimer = o.jumpHoldTimer;

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
      if (o.portals) {
        for (const p of o.portals) {
          this.portals.set(p.id, p);
          this.nextPortalId = Math.max(this.nextPortalId, p.id + 1);
        }
      }

      this.ladders.clear();
      this.nextLadderId = 1;
      if (o.ladders) {
        for (const l of o.ladders) {
          this.ladders.set(l.id, l);
          this.nextLadderId = Math.max(this.nextLadderId, l.id + 1);
        }
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
          { name: "$climbing", value: this.isClimbing },
          { name: "$coyoteTimer", value: Math.round(this.coyoteTimer * 1000) / 1000 },
          { name: "$velocityX", value: Math.round(this.estimatedVelocityX) },
          { name: "$waypointTime", value: Math.round(this.timeAtWaypoint * 1000) / 1000 },
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
      console.log("-- Searching for Platform behavior...");
      const b = this._GetBehaviorByType("Platform");
      if (b) {
        console.log("-- Detected Platform behavior");
        return b;
      }
      console.log("-- No Platform behavior found");
      return null;
    }

    _getPathfindingBehavior() {
      console.log("-- Searching for Pathfinding behavior...");
      const beh = this._GetBehaviorByType("Pathfinding");
      if (beh) {
        console.log("-- Detected Pathfinding behavior");
        return beh;
      }
      console.log("-- No Pathfinding behavior found");
      return null;
    }

        /**
     * Helper to get a behavior by its ID (as attached in Construct)
     * @param {string} behaviorId - The ID or name of the behavior to find
     * @returns {object|null} The behavior instance or null if not found
     */
    getBehaviorById(behaviorId) {
        const sdkInst = this.instance || this._inst;
        if (!sdkInst || typeof sdkInst.GetBehaviorInstances !== "function") return null;
        const behaviorInstances = sdkInst.GetBehaviorInstances();
        for (const beh of behaviorInstances) {
            const type = beh.GetBehaviorType();
            if (type && (type._id === behaviorId || type.GetName() === behaviorId)) {
                return beh;
            }
        }
        return null;
    }

    /**
   * Logs all behaviors attached to this instance
   */
    logBehaviors() {
      // debug: log what we have access to.
      console.log("Debugging Behavior Access:");
      console.log("- this.instance:", this.instance);
      console.log("this.instance.behaviors:", this.instance.behaviors);

      // try accessing through the SDK Instance's behavior array.
      const sdkInst = this.instance;
      const behaviors = sdkInst.behaviors;

      console.log("Behaviors Array: ", behaviors);
      console.log("Behaviors counts: ", behaviors? Object.values(behaviors) : "no behaviors array");

      // Iterate through behaviors and log their types.
      if(behaviors){
        for (let i = 0; i < behaviors.length; i++) {
          const beh = behaviors[i];
          console.log(`Behaviors ${i}:`, beh);
          console.log(` - type:`, beh.type);
          console.log(` - Type Name:`, beh.type ? beh.type.name : "no type");
          console.log(` - instanceof IPlatformBehaviorInstance:`, beh instanceof self.IPlatformBehaviorInstance);
          console.log(` - instanceof IPathfindingBehaviorInstance:`, beh instanceof self.IPathfindingBehaviorInstance);

          // Check by type name as fallback          if (beh.type) {
            if (beh.type.name === "Platform") {
              console.log("Found Platform behavior via type name!");
            }
            if (beh.type.name === "Pathfinding") {
              console.log("Found Pathfinding behavior via type name!");
            }
          }


      }
    }

    _GetBehaviorByType(typeName) {
        const inst = this.instance;
        if (!inst) {
            console.error("No instance found to search for behaviors.");
            return null;
        }

        // 1. Get all behaviors using the Scripting Interface method
        if (typeof inst.getAllBehaviors !== "function") {
            console.error("inst.getAllBehaviors is not a function. Check if 'this.instance' is a valid WorldInstance.");
            return null;
        }

        const allBehaviors = inst.getAllBehaviors();

        console.log(`--- [${name}] Behavior Scan ---`);
        console.log("Searching for Behavior Type:", typeName);
        console.log("Total Behaviors found on this instance:", allBehaviors.length);

        for (const b of allBehaviors) {
            // b.behaviorType.name is the internal type (e.g., "Platform", "Pathfinding")
            // b.name is what the user named it in the editor (e.g., "PlayerMovement")
            const behaviorTypeName = b.behaviorType.name;
            const instanceName = b.name;

            console.log(`Checking behavior: Name="${instanceName}", Type="${behaviorTypeName}"`, b);

            if (behaviorTypeName === typeName) {
                console.log(`MATCH FOUND: Attached behavior "${instanceName}" is a "${behaviorTypeName}" type.`);
                return b;
            }
        }

        console.warn(`No behavior of type "${typeName}" found on this instance.`);
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

    _applyPreset() {
      if (this.setupPreset === "auto") {
        this._calculateJumpParametersFromPlatform();
      } else if (this.setupPreset === "beginner") {
        this.maxJumpHeight = 64;
        this.maxJumpDistance = 96;
        this.maxFallDistance = 128;
      } else if (this.setupPreset === "intermediate") {
        this.maxJumpHeight = 96;
        this.maxJumpDistance = 128;
        this.maxFallDistance = 192;
      } else if (this.setupPreset === "advanced") {
        this.maxJumpHeight = 128;
        this.maxJumpDistance = 160;
        this.maxFallDistance = 256;
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

      const timeToApex = jumpStrength / gravity;
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

      this.maxFallDistance = this.platformProps.maxFallSpeed * 2;
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
        ladderConnections: [],
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
      const headCells = Math.ceil(this.characterHeight / this.cellSize);

      for (const [key, node] of graph) {
        const leftNode = this.getNode(node.gx - 1, node.gy);
        const rightNode = this.getNode(node.gx + 1, node.gy);

        if (leftNode) {
          let canWalk = true;
          for (let h = 1; h <= headCells; h++) {
            if (this.isCellBlocked(node.gx - 1, node.gy - h)) {
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
            if (this.isCellBlocked(node.gx + 1, node.gy - h)) {
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
      const maxDistCells = Math.ceil(this.maxJumpDistance / this.cellSize);
      let count = 0;
      const graph = this._getNavigationGraph();

      for (const [key, node] of graph) {
        for (const dir of [-1, 1]) {
          for (let dist = 1; dist <= maxDistCells; dist++) {
            for (let height = -2; height <= maxHeightCells; height++) {
              const targetGx = node.gx + dir * dist;
              const targetGy = node.gy - height;
              const target = this.getNode(targetGx, targetGy);

              if (target && this._canJump(node, target)) {
                const distance = this.distance(node.x, node.y, target.x, target.y);
                node.connections.push({
                  target,
                  action: "jump",
                  cost: distance * this.JUMP_COST,
                });
                count++;
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
            for (let dist = 1; dist <= doubleMaxDistCells; dist++) {
              for (let height = -2; height <= doubleMaxHeightCells; height++) {
                const targetGx = node.gx + dir * dist;
                const targetGy = node.gy - height;
                const target = this.getNode(targetGx, targetGy);

                if (target && this._canJump(node, target)) {
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
                    });
                    count++;
                  }
                }
              }
            }
          }
        }
      }

      this._log(`Created ${count} jump connections`);
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
        const index = grid.gy * this.gridWidth + grid.gx;

        if (
          grid.gx < 0 ||
          grid.gx >= this.gridWidth ||
          grid.gy < 0 ||
          grid.gy >= this.gridHeight
        ) {
          return false;
        }

        const cellVal = this.obstacleMap ? this.obstacleMap[index] : 0;

        if (cellVal === 1) return false;
        if (cellVal === 2) {
          const prevT = Math.max(0, (i - 1) / 8);
          const prevArcY =
            from.y +
            dy * prevT +
            4 * (apex - from.y) * prevT * (1 - prevT);
          if (arcY > prevArcY) return false;
        }
        if (cellVal === 3) return false;
      }

      return true;
    }

    _connectFall() {
      const maxFallCells = Math.ceil(this.maxFallDistance / this.cellSize);
      let count = 0;
      const graph = this._getNavigationGraph();

      for (const [key, node] of graph) {
        for (let fall = 1; fall <= maxFallCells; fall++) {
          const targetGy = node.gy + fall;
          const target = this.getNode(node.gx, targetGy);
          if (target && this._canFall(node, target)) {
            node.connections.push({
              target,
              action: "fall",
              cost: Math.abs(target.y - node.y) * this.FALL_COST,
            });
            count++;
            break;
          }
        }

        if (node.isLeftLedge) {
          this._addDiagonalFall(node, -1, maxFallCells);
        }
        if (node.isRightLedge) {
          this._addDiagonalFall(node, 1, maxFallCells);
        }
      }

      this._log(`Created ${count} fall connections`);
    }

    _canFall(from, to) {
      if (to.y <= from.y) return false;

      for (let i = 1; i < 5; i++) {
        const checkGy = from.gy + i;
        if (checkGy >= to.gy) break;
        if (this.isCellBlocked(from.gx, checkGy)) return false;
      }

      return true;
    }

    _addDiagonalFall(node, direction, maxFallCells) {
      const gravity = this.platformProps.gravity;
      const maxSpeed = this.platformProps.maxSpeed;

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
            node.connections.push({
              target,
              action: direction < 0 ? "fall_left" : "fall_right",
              cost: dist * this.FALL_COST,
            });
            break;
          }
        }
      }
    }

    _canDiagonalFall(from, to, direction) {
      const steps = 10;
      const dx = to.x - from.x;
      const dy = to.y - from.y;

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + dx * t;
        const y = from.y + dy * t * t;
        const grid = this.worldToGrid(x, y);
        if (this.isCellBlocked(grid.gx, grid.gy)) return false;
      }
      return true;
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
            node.connections.push({
              target,
              action: "fall_through",
              cost: Math.abs(target.y - node.y) * this.FALL_COST * 1.2,
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

    aceAddPortal(type, entryX, entryY, exitX, exitY, cost, ignoreHazards) {
      const portalId = this.nextPortalId++;
      const portalsMap = this._getPortalsMap();
      portalsMap.set(portalId, {
        id: portalId,
        entryX,
        entryY,
        exitX,
        exitY,
        type: type || "teleport",
        cost: cost || 10,
        ignoreHazards: ignoreHazards || false,
      });

      if (this.graphGenerated) {
        this._connectPortalToGraph(portalsMap.get(portalId));
      }

      return portalId;
    }

    aceRemovePortal(portalId) {
      const portalsMap = this._getPortalsMap();
      portalsMap.delete(portalId);
    }

    aceClearAllPortals() {
      const portalsMap = this._getPortalsMap();
      portalsMap.clear();
    }

    _connectPortalToGraph(portal) {
      const entryNode = this._findNearestNode(portal.entryX, portal.entryY);
      const exitNode = this._findNearestNode(portal.exitX, portal.exitY);

      if (!entryNode || !exitNode) {
        this._warn(`Portal ${portal.id} could not connect to graph`);
        return;
      }

      entryNode.portalConnections.push({
        target: exitNode,
        action: `portal_${portal.type}`,
        cost: portal.cost,
        portalId: portal.id,
        ignoreHazards: portal.ignoreHazards || false,
      });
    }

    _connectAllPortals() {
      if (!this.enablePortals) return;

      const portalsMap = this._getPortalsMap();
      for (const [id, portal] of portalsMap) {
        this._connectPortalToGraph(portal);
      }
      this._log(`Connected ${portalsMap.size} portals to graph`);
    }

    _findNearestNode(x, y) {
      const graph = this._getNavigationGraph();
      let nearestNode = null;
      let minDist = Infinity;

      for (const [key, node] of graph) {
        const dist = this.distance(x, y, node.x, node.y);
        if (dist < minDist) {
          minDist = dist;
          nearestNode = node;
        }
      }

      return nearestNode;
    }

    aceAddLadder(bottomX, bottomY, topX, topY, climbSpeed) {
      const ladderId = this.nextLadderId++;
      this.ladders.set(ladderId, {
        id: ladderId,
        bottomX,
        bottomY,
        topX,
        topY,
        climbSpeed,
      });

      if (this.graphGenerated) {
        this._connectLadderToGraph(ladderId);
      }
      return ladderId;
    }

    aceRemoveLadder(ladderId) {
      this.ladders.delete(ladderId);
    }

    aceSetLadderClimbSpeed(ladderId, speed) {
      const ladder = this.ladders.get(ladderId);
      if (ladder) ladder.climbSpeed = speed;
    }

    _connectLadderToGraph(ladderId) {
      const ladder = this.ladders.get(ladderId);
      if (!ladder) return;

      const bottomNode = this._findNearestNode(ladder.bottomX, ladder.bottomY);
      const topNode = this._findNearestNode(ladder.topX, ladder.topY);

      if (!bottomNode || !topNode) return;

      const height = Math.abs(ladder.topY - ladder.bottomY);
      const cost = (height / ladder.climbSpeed) * this.WALK_COST;

      if (!bottomNode.ladderConnections) bottomNode.ladderConnections = [];
      if (!topNode.ladderConnections) topNode.ladderConnections = [];

      bottomNode.ladderConnections.push({
        target: topNode,
        action: "ladder_climb",
        cost,
        ladderId,
      });
      topNode.ladderConnections.push({
        target: bottomNode,
        action: "ladder_climb",
        cost,
        ladderId,
      });
    }

    _connectAllLadders() {
      for (const [id] of this.ladders) {
        this._connectLadderToGraph(id);
      }
      this._log(`Connected ${this.ladders.size} ladders`);
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
      this._connectAllLadders();
      this._updateHazardCosts();

      this._markGraphAsGenerated();

      const endTime = performance.now();
      this._log(`Graph generated in ${(endTime - startTime).toFixed(2)}ms`);

      this._triggerGraphGenerated();
    }

    findPath(startX, startY, goalX, goalY) {
      const startGrid = this.worldToGrid(startX, startY);
      const goalGrid = this.worldToGrid(goalX, goalY);

      this._log(`Finding path from (${startGrid.gx},${startGrid.gy}) to (${goalGrid.gx},${goalGrid.gy})`);

      const startNode = this.getNode(startGrid.gx, startGrid.gy);
      const goalNode = this.getNode(goalGrid.gx, goalGrid.gy);

      if (!startNode || !goalNode) {
        if (!startNode) {
          this.lastPathFailReason = "no_start_node";
          this._warn(`Start node not found at grid (${startGrid.gx},${startGrid.gy})`);
        } else {
          this.lastPathFailReason = "no_goal_node";
          this._warn(`Goal node not found at grid (${goalGrid.gx},${goalGrid.gy})`);
        }
        return null;
      }

      const graph = this._getNavigationGraph();
      for (const [key, node] of graph) {
        node.gScore = Infinity;
        node.hScore = Infinity;
        node.fScore = Infinity;
        node.parent = null;
        node.parentAction = null;
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
          this.lastPathFailReason = "max_nodes_reached";
          this._warn(`Max search nodes reached (${this.maxSearchNodes})`);
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
          ...(current.ladderConnections || []),
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

      this.lastPathFailReason = "no_path";
      this._warn("No path found — all reachable nodes explored");
      return null;
    }

    _reconstructPath(goalNode) {
      const path = [];
      let current = goalNode;

      while (current) {
        path.unshift({
          node: current,
          action: current.parentAction || "start",
          x: current.x,
          y: current.y,
        });
        current = current.parent;
      }

      if (this.smoothPaths && path.length > 2) {
        return this._smoothPath(path);
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

      const headCells = Math.ceil(this.characterHeight / this.cellSize);
      for (let gx = startGx; gx <= endGx; gx++) {
        for (let h = 1; h <= headCells; h++) {
          if (this.isCellBlocked(gx, gy - h)) return false;
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

    _correctToGround(x, y) {
      const grid = this.worldToGrid(x, y);
      const searchRadius = 5;

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

      return { x, y };
    }

    _followPath(dt) {
      if (this.currentWaypoint >= this.currentPath.length) {
        this.hasPath = false;
        this._trigger("OnPathComplete");
        return;
      }

      const waypoint = this.currentPath[this.currentWaypoint];
      this.timeAtWaypoint += dt;

      if (this.timeAtWaypoint > this.maxWaypointTime) {
        this.hasPath = false;
        this.timeAtWaypoint = 0;
        this._log(`Stuck at waypoint ${this.currentWaypoint} (exceeded ${this.maxWaypointTime}s)`);
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
        arrivalThreshold = this.cellSize * 0.15;
      } else if (waypoint.action.includes("walk")) {
        arrivalThreshold = this.cellSize * 0.3;
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
        if (
          dist > expectedMaxDist &&
          this.platformBehavior &&
          this.platformBehavior.isOnFloor
        ) {
          this._rePath();
          return;
        }
      }

      if (this.autoControl) {
        this._executeAction(waypoint.action, waypoint.x, waypoint.y, waypoint);
      }
    }

    _rePath() {
      this.rePathCooldown = 0.5;
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
        this._executePortal(targetX, targetY);
        return;
      }

      if (action === "ladder_climb") {
        this._executeLadderClimb(targetX, targetY, waypoint);
        return;
      }

      if (action === "fall_through") {
        this._executeFallThrough(targetX, targetY);
        return;
      }

      this._executePhysicsAware(action, targetX, targetY, waypoint);
    }

    _executePortal(targetX, targetY) {
      this.instance.x = targetX;
      this.instance.y = targetY;
      this.justUsedPortal = true;
    }

    _executeLadderClimb(targetX, targetY, waypoint) {
      const dt = this.instance.dt;

      if (!this.isClimbing) {
        this.platformBehavior.isEnabled = false;
        this.isClimbing = true;
        this.climbStartY = this.instance.y;
        this.climbTargetY = targetY;

        const conn = waypoint || {};
        const ladder = this.ladders.get(conn.ladderId);
        this.climbSpeed = ladder ? ladder.climbSpeed : 100;
      }

      const direction = this.climbTargetY < this.instance.y ? -1 : 1;
      this.instance.y += direction * this.climbSpeed * dt;

      if (Math.abs(this.instance.y - this.climbTargetY) < 2) {
        this.instance.y = this.climbTargetY;
        this.platformBehavior.isEnabled = true;
        this.isClimbing = false;
        this._trigger("OnLadderClimbComplete");
      }
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
        const movingLeft = action === "walk_left";
        const wallSide = movingLeft ? "left" : "right";

        try {
          if (
            this.platformBehavior.isByWall(wallSide) &&
            this.platformBehavior.isOnFloor
          ) {
            this.platformBehavior.simulateControl("jump");
            this.platformBehavior.simulateControl(
              movingLeft ? "left" : "right"
            );
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

      if (waypoint && waypoint.node && waypoint.node.isIsland) {
        const maxSafeSpeed = Math.sqrt(2 * decel * (this.cellSize * 0.4));
        if (speed > maxSafeSpeed) return;
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

      const dir = targetX < this.instance.x ? "left" : "right";
      this.platformBehavior.simulateControl(dir);

      try {
        if (this.platformBehavior.isOnFloor) {
          this.platformBehavior.simulateControl("jump");
          this.isHoldingJump = true;
          this.jumpHoldTimer = 0;
        } else if (
          this.isHoldingJump &&
          this.platformProps.jumpSustain > 0
        ) {
          this.jumpHoldTimer += dt * 1000;
          if (this.jumpHoldTimer < this.platformProps.jumpSustain) {
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
      const dir = targetX < this.instance.x ? "left" : "right";
      this.platformBehavior.simulateControl(dir);

      try {
        if (!this.platformBehavior.isOnFloor && this.coyoteTimer > 0) {
          this.coyoteJumpPending = true;
        } else if (this.platformBehavior.isOnFloor) {
          this.platformBehavior.simulateControl(dir);
        }
      } catch (e) {
        this.platformBehavior.simulateControl(dir);
      }
    }

    _handleJumpTowardAction(targetX, targetY) {
      const dir = targetX < this.instance.x ? "left" : "right";
      this.platformBehavior.simulateControl(dir);
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
        const speed =
          this.platformBehavior.speed || Math.abs(this.estimatedVelocityX);
        const decel = this.platformProps.deceleration;
        const distToTarget = Math.abs(targetX - this.instance.x);
        const stoppingDist = (speed * speed) / (2 * decel);

        if (distToTarget > stoppingDist + 4) {
          if (targetX < this.instance.x) {
            this.platformBehavior.simulateControl("left");
          } else {
            this.platformBehavior.simulateControl("right");
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
    aceFindPath(targetX, targetY, correctToGround, mode) {
      this._log(`FindPath to (${Math.round(targetX)},${Math.round(targetY)}) mode=${mode || "reach"} groundCorrect=${correctToGround}`);
      this.lastPathFailReason = "";

      let startX = this.instance.x;
      let startY = this.instance.y;

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

      if (!path && this.lastPathMode === "jump_toward") {
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

      if (path) {
        this.currentPath = path;
        this.currentWaypoint = 0;
        this.hasPath = true;
        this.timeAtWaypoint = 0;
        this.doubleJumpPhase = 0;
        this.isHoldingJump = false;

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
    }

    /** Stops movement along the current path without clearing the path data. */
    aceStopMovement() {
      this.hasPath = false;
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

    /** Returns whether the character is currently climbing a ladder. */
    aceIsClimbingLadder() {
      return this.isClimbing ? 1 : 0;
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

    /** Returns the total number of connections (walk, jump, portal, ladder) from a node at the given grid position. */
    aceGetNodeConnectionCount(gx, gy) {
      const node = this.getNode(gx, gy);
      if (!node) return 0;
      return (
        node.connections.length +
        node.portalConnections.length +
        (node.ladderConnections ? node.ladderConnections.length : 0)
      );
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

    /** Helper to retrieve a connection by index from a node's combined connection arrays (walk + portal + ladder). */
    _getConnectionAtIndex(gx, gy, index) {
      const node = this.getNode(gx, gy);
      if (!node) return null;
      const all = [
        ...node.connections,
        ...node.portalConnections,
        ...(node.ladderConnections || []),
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
      return (
        n.connections.length +
        n.portalConnections.length +
        (n.ladderConnections ? n.ladderConnections.length : 0)
      );
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

    // ============================================================================
    // LADDERS - State Expressions
    // ============================================================================

    /** Returns the climb progress as a 0-1 ratio (0 = bottom, 1 = top). Returns 0 if not climbing. */
    aceGetLadderProgress() {
      if (!this.isClimbing) return 0;
      const total = Math.abs(this.climbTargetY - this.climbStartY);
      if (total === 0) return 1;
      const current = Math.abs(this.instance.y - this.climbStartY);
      return Math.min(1, current / total);
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
      console.log("Ladders:", this.ladders.size);
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
