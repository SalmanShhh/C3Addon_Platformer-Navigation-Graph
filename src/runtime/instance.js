import { id, addonType, name } from "../../config.caw.js";
import AddonTypeMap from "../../template/addonTypeMap.js";
import { globalNavManager } from "./navigationManager.js";
import obstacleMapMethods from "./obstacleMap.js";
import graphBuildMethods from "./graphBuild.js";
import pathfindingMethods from "./pathfinding.js";
import movementMethods from "./movement.js";
import portalMethods from "./portals.js";
import hazardMethods from "./hazards.js";

// Core instance class: lifecycle (constructor/tick/release/save/load),
// property handling, Platform behavior integration, and shared utilities.
// Domain logic lives in the sibling modules mixed into the prototype below:
//   obstacleMap.js — tile grid building/scanning, slopes, auto-build startup
//   graphBuild.js  — node/connection generation, chunked build state machine
//   pathfinding.js — A*, path assembly, FindPath ACEs, path expressions
//   movement.js    — path following and movement execution
//   portals.js     — portal system and traversal state machine
//   hazards.js     — hazard zones and cost application
export default function (parentClass) {
  const PlatformerPathfindingInstance = class PlatformerPathfindingInstance extends parentClass {
    constructor() {
      super();

      const properties = this._getInitProperties();

      this.enableDebug = properties[0];
      // Tile Size 0 = auto-detect from the Pathfinding behavior's cell size or a
      // solid tilemap's tile size. A provisional 32 is used until detection runs.
      this.cellSizeAuto = properties[1] === 0;
      this.cellSize = this.cellSizeAuto ? 32 : properties[1];
      this._cellSizeResolved = !this.cellSizeAuto;
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
      // Auto-Build Graph: zero-event startup mode
      const autoBuildMap = ["off", "auto", "pathfinding", "solids"];
      this.autoBuildMode = autoBuildMap[properties[15]] || "off";
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

      // Incremental (chunked) graph build state — see graphBuild.js
      this._graphBuild = null;
      this.GRAPH_BUILD_BUDGET_MS = 6;

      this.events = {};

      this.nodeIndexArray = [];

      this.WALK_COST = 1.0;
      this.JUMP_COST = 1.5;
      this.FALL_COST = 0.5;
      this.COYOTE_JUMP_COST = 1.6;
      this.SLOPE_COST = 1.0;

      this.pathStrategy = "balanced";

    }

    /** Per-frame update: first-tick initialization, behavior acquisition, graph
     *  build slices, coyote/jump-toward timers, path queue, and path following. */
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

      // Graph generation is time-sliced: continue an in-progress build, or start
      // one when the graph is marked dirty. Small maps still complete in a single
      // slice; large maps spread across ticks to avoid a frame hitch.
      if (this._graphBuild) {
        this._stepGraphBuild(this.GRAPH_BUILD_BUDGET_MS);
      } else if (this._needsGraphRegeneration()) {
        if (this._startGraphBuild()) {
          this._stepGraphBuild(this.GRAPH_BUILD_BUDGET_MS);
        }
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

    /** Instance destruction: cancels any in-progress graph build, removes queued
     *  path requests, unsubscribes from the shared graph, and restores the
     *  Platform behavior if destroyed mid portal traversal. */
    _release() {
      super._release();
      this._cancelGraphBuild();
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

    /** Savegame support: serializes all runtime state. The graph itself is NOT
     *  saved — it is rebuilt from the obstacle/slope maps in _loadFromJson. */
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

    /** Savegame support: restores runtime state, synchronously rebuilds the graph
     *  (the restored path's waypoints need live node references), then re-links
     *  waypoints to graph nodes. */
    _loadFromJson(o) {
      if (!o || o.version !== 1) return;

      this._cancelGraphBuild();

      this.enableDebug = o.enableDebug;
      this.cellSize = o.cellSize;
      this._cellSizeResolved = true; // Saved cellSize is the resolved value
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
        // Synchronous rebuild: the restored path below needs graph nodes immediately
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

    /** Populates the C3 debugger inspector panels (graph, path, movement, portal,
     *  and settings sections). Read-only display; names are localized via lang keys. */
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
        // Another instance is already running an incremental build for this layout
        if (globalNavManager.isBuildInProgress(this.layoutUID)) return false;

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

  // Mix in the domain modules (see file header for the module map)
  Object.assign(
    PlatformerPathfindingInstance.prototype,
    obstacleMapMethods,
    graphBuildMethods,
    pathfindingMethods,
    movementMethods,
    portalMethods,
    hazardMethods
  );

  return PlatformerPathfindingInstance;
}
