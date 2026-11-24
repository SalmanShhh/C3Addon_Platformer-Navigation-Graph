import { id, addonType, name } from "../../config.caw.js";
import AddonTypeMap from "../../template/addonTypeMap.js";
import { globalNavManager } from "./navigationManager.js";
import obstacleMapMethods from "./obstacleMap.js";
import graphBuildMethods from "./graphBuild.js";
import pathfindingMethods from "./pathfinding.js";
import movementMethods from "./movement.js";
import portalMethods from "./portals.js";
import hazardMethods from "./hazards.js";
import movingPlatformMethods from "./movingPlatforms.js";

// ============================================================================
// HOW THE RUNTIME WORKS (start here when debugging or extending)
// ============================================================================
// Three layers:
//   1. Obstacle map: a grid of cells (obstacleMap, one byte each: 0 clear,
//      1 solid, 2 jump-thru, 3 avoid), plus slopeMap and hazardMap. Built by
//      scanning Solid / Jump-thru objects (or tilemaps / tile states).
//   2. Navigation graph: one node per standable cell, connections between
//      nodes (walk, jump, fall, coyote jump, fall-through, slope walk, portal,
//      ride). Built from the obstacle map.
//   3. Paths and movement: A* over the graph per character, then the path
//      follower presses Platform behavior controls.
// Every character on the same layout and Map Tag shares layers 1 and 2. That
// shared state is keyed by navKey ("layoutName|mapTag") and lives in
// globalNavManager (navigationManager.js). Each character keeps its own path.
//
// This file is the core class: lifecycle (constructor / _tick / release /
// save / load), properties, Platform behavior integration, the debugger panel,
// and the world <-> grid conversion helpers. Domain logic lives in the sibling
// modules mixed into the prototype below (`this` is the instance in all):
//   navigationManager.js — globalNavManager: everything shared per map (graph,
//                          subscribers, portals, hazards, scan jobs, pending
//                          patches, watcher state, scan and slope recipes),
//                          the path request queue, runtime event hooks
//   obstacleMap.js     — the rasterizer, time-sliced scan jobs, scan recipes,
//                        automatic map extent, growth and the navigation area,
//                        slopes, tile states
//   graphBuild.js      — full graph builds and regional patches (see the
//                        "level change" overview at the top of that file),
//                        the Find path safety valve _ensureGraphReadyNow
//   pathfinding.js     — A*, path strategies, edge rules (_isEdgeAllowed),
//                        the Find path actions, path expressions
//   movement.js        — path following, jump/fall execution, patrols, idle
//                        separation
//   portals.js         — portals and elevator stops, object-following portals,
//                        portal execution (instant, gradual)
//   hazards.js         — hazard zones and baking their costs onto nodes
//   movingPlatforms.js — the obstacle watcher, danger areas over moving
//                        obstacles, ride links, the ride state machine
//
// Rules that must hold:
//   - Every world/grid position conversion goes through worldToGrid /
//     gridToWorld / _cellLeft / _cellTop / _toGX / _toGY. The grid can start
//     anywhere (gridOriginX/Y), so never divide by cellSize directly.
//   - Grid keys are row-major (gy * gridWidth + gx) and alias across rows when
//     gx is out of range: look nodes up with getNode, or bounds-check first.
//   - Map arrays are shared BY REFERENCE between the characters on a map. A
//     newly created slope or hazard map must be synced
//     (_syncMapStateToSubscribers).
//   - Full map changes go through _markMapChanged, local ones through
//     _markRegionChanged (graphBuild.js).
//   - After release, ACE IDs, combo option order and property order never
//     change. Hide an ACE with isDeprecated: true before removing it, and add
//     new combo options and new properties only at the end (values are
//     stored by index).
//
// Debugging: see the notes above _log (console log lines worth looking for).
// ============================================================================
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
      const strategyMap = ["balanced", "shortest", "safest", "simplest", "no_drop", "walk_only"];
      this.pathStrategy = strategyMap[properties[5]] || "balanced";
      this.smoothPaths = properties[6];
      this.maxWaypointTime = properties[7];
      this.coyoteTime = properties[8];
      this.strictPositioning = properties[9];
      this.ledgeRestriction = properties[10];
      this.ledgeLeniency = properties[11];
      this.rePathThreshold = properties[12];
      this.hazardRadius = properties[13];
      // Auto-Build Graph: zero-event startup mode
      const autoBuildMap = ["off", "auto"];
      this.autoBuildMode = autoBuildMap[properties[14]] || "off";
      // Map Tag: instances with the same tag on a layout share one navigation
      // map/graph. "" (default) shares with everyone.
      this.mapTag = typeof properties[15] === "string" ? properties[15].trim() : "";
      // Detect Slopes: classify slope tiles from collision-shape probes during scans
      this.detectSlopes = !!properties[16];

      // Crowd arrivals: goal reservation (per map tag)
      this.crowdArrivals = !!properties[17];
      // Idle separation: personal space in pixels for idle characters (0 = off)
      this.idleSeparation = Math.max(0, properties[18] || 0);
      // Separation cooldown: rest time after giving up on an unsatisfiable
      // separation (0 = never rest, keep trying)
      this.separationCooldown =
        typeof properties[19] === "number" ? Math.max(0, properties[19]) : 5;
      // Separation give-up time: how long a character keeps nudging before it
      // gives up and rests. ACE-only setting (no property) — 1.2s suits most
      // games; tune via 'Set separation give-up time'.
      this.separationGiveUpTime = 1.2;
      // Enabled: standard behavior toggle. Disabled = frozen (state kept)
      this.navEnabled = properties[20] !== false;
      // Multiplayer: "host_only" (default) pauses navigation on peers, where
      // the host runs the AI; "everywhere" always runs (Set multiplayer mode).
      this.multiplayerMode = "host_only";
      this._peerPaused = false; // last seen peer state, to act on changes
      // Auto-enabled when portals are added via ACEs (hazards need no switch:
      // every character on a map avoids its hazards)
      this.enablePortals = true;

      // Auto-detected from sprite bounding box on first tick
      this.characterHeight = 32;
      this.characterWidth = 32;
      // Auto-calculated from Platform behavior (or overridden via ACEs)
      this.maxJumpHeight = 128;
      this.maxJumpDistance = 192;
      this.singleJumpHeight = 128;
      this.singleJumpDistance = 192;
      this.maxFallDistance = 256;

      this._initializeState();

      // Instance properties and behaviors are acquired on the first tick,
      // not in the constructor, because the instance is not fully initialized yet
      this.layoutUID = null;
      this.navKey = null; // layoutUID + "|" + mapTag — key for all shared nav state
      this.platformBehavior = null;
      this._initialized = false;

      // Use C3 SDK's built-in ticking mechanism (available on base class without this.instance)
      this._setTicking(true);
    }

    /** Resets all runtime state (graph, path, portals, hazards, movement flags) to defaults. */
    _initializeState() {
      this.graphGenerated = false;
      this.obstacleMap = null;
      this.obstacleMapSource = null;
      this.gridWidth = 0;
      this.gridHeight = 0;
      // World position (pixels) of grid cell (0, 0). 0,0 unless the map covers
      // content left of / above the layout or grew to include new content.
      this.gridOriginX = 0;
      this.gridOriginY = 0;

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

      // Hazard, portal, and elevator-group RECORDS live per map on
      // globalNavManager (see _getHazardsMap / _getPortalsMap); only the
      // "last ID this instance created" is per instance.
      this.lastHazardId = 0;
      this.lastPortalId = 0; // IDs come from globalNavManager.nextPortalId

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
      this.portalState = "none"; // "none" | "paused" | "traversing" | "riding"
      this._ride = null; // moving-platform ride state (movingPlatforms.js)
      this._deferredFindPath = null; // Find path held during a ride / gradual portal
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

      this.multiAgentAvoidance = false;
      this.pathPending = false;

      // Ledge-to-ledge patrol state (movement.js). _patrolRange is the edge
      // distance in PIXELS (turn that far short of each platform end);
      // _patrolDir: 1 = right, -1 = left, meaningful only while active.
      this._patrolActive = false;
      this._patrolBumpCooldown = 0;   // patrol: ignore other characters briefly after a bump-turn
      // Patrol settings (Set patrol setting / Set patrol option); persist
      // across Start patrol calls
      this._patrolDwellVar = 0;       // s, random +/- on each wait
      this._patrolSpeedPct = 100;     // % of Platform max speed while patrolling
      this._patrolSpeedBase = null;   // Platform max speed saved while scaled
      this._patrolResumeAfter = 0;    // s idle before a cancelled patrol resumes (0 = never)
      this._patrolMemory = null;      // the patrol a Find path cancelled
      this._patrolResumeTimer = 0;
      this._patrolTurnAtChars = true;
      this._patrolTurnDanger = true;
      this._patrolGraphVersion = 0;   // patrol: graph version its ends were measured on
      // Route patrol (Start patrol between objects, movement.js); null = off
      this._route = null;
      this._routeFindingPath = false;
      this._patrolDir = 1;
      this._patrolDwell = 0;
      this._patrolDwellTimer = 0;
      this._patrolRange = 0;
      this._patrolLeftX = 0;
      this._patrolRightX = 0;
      this._patrolY = 0;

      // Find path to side of object state (pathfinding.js). The armed goal
      // (_sideGoalInst + side/dist) is consumed at arrival by
      // _checkSideGoalReached; _reachedObjectSide backs the ReachedObjectSide
      // expression (-1/1 inside OnObjectSideReached, 0 otherwise).
      this._sideGoalInst = null;
      this._sideGoalSide = 0;
      this._sideGoalDist = 0;
      this._reachedObjectSide = 0;

      // Find object on same platform result (pathfinding.js): UID for the
      // PlatformObjectUID expression, -1 = none found.
      this._platformObjectUid = -1;

      // Per-agent descent limit in pixels: airborne edges with a larger net
      // drop are skipped at search time. -1 = unlimited (default), 0 = never
      // descend by air at all (ramps and portals only). ACE-only, no property.
      this.maxTraversalDrop = -1;

      this._jumpParamsOverridden = false;
      this._physicsMismatchWarned = false;

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
      // NOTE: pathStrategy is set from the Path Strategy property near the top
      // of the constructor — do not reassign it here (a stale default here
      // silently disabled the property for every instance).

    }

    /** First-run initialization: layout key, behaviors, graph mode, agent
     *  params. Normally runs on the first tick, but graph-dependent actions
     *  call it too so they work from "On start of layout" (which runs BEFORE
     *  the first tick). Idempotent. */
    _ensureInitialized() {
      if (!this._initialized) {
        this._initialized = true;
        // ILayout has no uid in the documented API (it read undefined) —
        // the layout NAME is documented and unique per project.
        this.layoutUID = this.instance.layout.name;
        this.navKey = this.layoutUID + "|" + this.mapTag;
        globalNavManager.hookLayoutEnd(this.instance.runtime);
        this.characterHeight = Math.abs(this.instance.height);
        this.characterWidth = Math.abs(this.instance.width);
        this._log(`Character dimensions: ${this.characterWidth}x${this.characterHeight}px (instance: ${this.instance.width}x${this.instance.height})`);
        this._initializeGraphMode();
        this.platformBehavior = this._getPlatformBehavior();
        if (this.platformBehavior) {
          this._readPlatformProperties();
          this._calculateJumpParametersFromPlatform();
          this._log(`Double jump: ${this.platformProps.isDoubleJumpEnabled ? "ENABLED" : "disabled"} | Jump sustain: ${this.platformProps.jumpSustain}ms`);
          // Register agent params for Graph Manager support (SPOT)
          globalNavManager.registerAgentParams(this.navKey, {
            maxJumpHeight: this.maxJumpHeight,
            maxJumpDistance: this.maxJumpDistance,
            maxFallDistance: this.maxFallDistance,
            singleJumpHeight: this.singleJumpHeight,
            singleJumpDistance: this.singleJumpDistance,
            characterHeight: this.characterHeight,
            characterWidth: this.characterWidth,
            platformProps: { ...this.platformProps }
          });
          // Late spawner joining an already-built graph: warn (debug, once)
          // when this instance's jump physics differ substantially from the
          // graph's build physics — it belongs on its own Map Tag.
          const caps = globalNavManager.getGraphCapabilities(this.navKey);
          if (caps && caps.maxJumpHeight > 0 && !this._physicsMismatchWarned) {
            const dh = Math.abs(caps.maxJumpHeight - this.maxJumpHeight) / caps.maxJumpHeight;
            const dd = Math.abs(caps.maxJumpDistance - this.maxJumpDistance) / Math.max(caps.maxJumpDistance, 1);
            if (dh > 0.2 || dd > 0.2) {
              this._physicsMismatchWarned = true;
              this._warn(`Jump physics differ ~${Math.round(Math.max(dh, dd) * 100)}% from the physics this map's graph was built with — paths may include jumps this character can't make (or miss ones it could). Give different movement classes their own Map Tag.`);
            }
          }
        }
      }
    }

    /** Per-frame update. Order matters:
     *
     *  Nothing below runs while the behavior is disabled or this machine is a
     *  multiplayer peer (_isPausedAsPeer: the host runs the AI).
     *
     *  Map-level work first. One character per map does each job per frame
     *  (the others find it already done), and it runs even while that
     *  character's Platform behavior is disabled:
     *    1. Start the startup scan if no map exists yet; step the current scan
     *       job (about 4 ms).
     *    2. Step the current graph build or patch (about 6 ms), or start one.
     *    3. Move tracked hazards and object-following portals.
     *    4. Run the obstacle watcher (_updateMoversIfOwner).
     *    5. Re-bake hazard costs if they changed.
     *
     *  Then per-character work. It stops if the user disabled this character's
     *  Platform behavior (a gradual portal disables it on purpose, so that
     *  case continues):
     *    6. Coyote time, Jump toward position, the path request queue.
     *    7. Exactly one of: follow the path, run the route patrol, run the
     *       platform patrol, wait to resume a patrol, or idle separation.
     *    8. Apply patrol walking speed. */
    _tick() {
      const dt = this.instance.dt;
      this._ensureInitialized();

      // Use "Lazy Loading" - only find them if we don't have them yet
    if (!this.platformBehavior) {
        this.platformBehavior = this._getPlatformBehavior();
        if (this.platformBehavior) {
            this._readPlatformProperties();
            this._calculateJumpParametersFromPlatform();
            this._log(`Double jump: ${this.platformProps.isDoubleJumpEnabled ? "ENABLED" : "disabled"} | Jump sustain: ${this.platformProps.jumpSustain}ms`);
        }
    }


      // Multiplayer peer: the host runs this character's AI, so it pauses here
      // exactly like Set enabled "Disabled" (state kept). Checked every tick
      // (two property reads) because joining a room happens after start.
      const peerPaused = this._isPausedAsPeer();
      if (peerPaused !== this._peerPaused) {
        this._peerPaused = peerPaused;
        if (peerPaused) {
          this._releaseNavWork();
          this._log("Multiplayer peer: navigation paused on this machine (the host runs it)");
        } else {
          this._log("Multiplayer: navigation resumed on this machine");
        }
      }

      // Behavior disabled: initialization and subscriptions above stay live so
      // re-enabling resumes seamlessly, but no navigation work happens. Note a
      // frozen gradual-portal traversal stays frozen (Platform stays disabled)
      // until this behavior is re-enabled.
      if (!this.navEnabled || peerPaused) return;

      // Graph generation is time-sliced: continue an in-progress build, or start
      // one when the graph is marked dirty. Small maps still complete in a single
      // slice; large maps spread across ticks to avoid a frame hitch.
      // Obstacle scans are time-sliced too: the startup auto-build, Regenerate
      // obstacle map / region, and automatic refreshes run a few ms per tick
      // (one instance per map does the work) while the current map stays in use.
      if (!this.obstacleMap && this.obstacleMapSource === null && this.autoBuildMode === "auto" &&
          !globalNavManager.scanJobs.has(this.navKey)) {
        let peer = null;
        for (const other of globalNavManager.subscribers.get(this.navKey) || []) {
          if (other !== this && other.obstacleMap) { peer = other; break; }
        }
        if (peer) {
          // Spawned while the map is being built: share it, do not rescan
          this._adoptMapStateFrom(peer);
        } else if (!globalNavManager.isBuildInProgress(this.navKey) && !this._getScanRule()) {
          this._startScanJob(null);
          this._ensureMoversPopulated(); // catch changes made while it runs
        }
      }
      this._stepScanJob();
      const scanPending = globalNavManager.scanJobs.has(this.navKey);
      if (this._graphBuild) {
        this._stepGraphBuild(this.GRAPH_BUILD_BUDGET_MS);
      } else if (!scanPending && this._needsGraphRegeneration()) {
        if (this._startGraphBuild()) {
          this._stepGraphBuild(this.GRAPH_BUILD_BUDGET_MS);
        }
      } else if (!scanPending && this._startPendingPatch()) {
        // Regional patch (tile edits, regions, moved obstacles)
        this._stepGraphBuild(this.GRAPH_BUILD_BUDGET_MS);
      }

      // Refresh tracked (object-following) hazards, then re-bake stale hazard
      // costs. Both are once per map per tick regardless of instance count —
      // the stamps/flags are per map and the first instance does the work.
      this._updateTrackedHazardsIfOwner();
      // Object-based portals follow their objects (once per map per tick)
      this._updateTrackedPortalsIfOwner();
      // Moving / spawned / destroyed solids: keep the map current and the
      // moving-platform ride links placed (once per map per tick)
      this._updateMoversIfOwner();
      this._applyHazardCostsIfDirty();

      // Per-character work stops while the user has this character's Platform
      // behavior disabled. The map-level work above keeps running (other agents
      // share it), and a gradual portal disables Platform ON PURPOSE while it
      // moves the character, so that traversal keeps advancing.
      if (this.platformBehavior && !this.platformBehavior.isEnabled && this.portalState !== "traversing") {
        return;
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
          // Sustain jump while moving upwards. isJumping is the documented
          // "currently moving upwards" flag (isRising does not exist in the API).
          if (this.platformProps.jumpSustain > 0 && this.platformBehavior.isJumping) {
            this.platformBehavior.simulateControl("jump");
          }
        }
      }

      // Process queued path requests (time-slicing)
      globalNavManager.processPathQueue(this.instance.runtime);

      if (this.hasPath && !this.pathPending) {
        this._followPath(dt);
      } else if (this._route) {
        // Route patrol: walk/jump/ride from marker to marker
        this._updatePatrolRoute(dt);
      } else if (this._patrolActive) {
        // Ledge-to-ledge patrol: drives the character between its platform's
        // ends. Mutually exclusive with idle separation (a patroller is a
        // mover, so idle neighbors step aside for it instead).
        this._updatePatrol(dt);
      } else if (this._patrolMemory && this._tickPatrolResume(dt)) {
        // Waiting to resume a patrol a Find path cancelled ("Resume after")
      } else {
        // Idle separation: idle agents drift apart when overlapping (no-op
        // unless Idle Separation > 0 and a same-map neighbor is too close).
        this._applyIdleSeparation(dt);
      }
      // Patrol walking speed (Set patrol setting "Speed")
      this._updatePatrolSpeed();
      // "Resume after" counts idle time only: any new path restarts the count
      if (this.hasPath || this.pathPending) this._patrolResumeTimer = 0;

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
      if (this.navKey !== null) {
        globalNavManager.unsubscribe(this.navKey, this);
      }
      // Portal/hazard records are per map: unsubscribe drops them only when
      // this was the map's last instance, so one destroyed character no
      // longer takes the whole map's portals and hazards with it.
      if (this.portalState === "traversing" && this.platformBehavior) {
        this.platformBehavior.isEnabled = this.platformWasEnabled;
      }
      this.portalState = "none";
      this._ride = null;
    }

    /** Savegame support: serializes all runtime state. The graph itself is NOT
     *  saved — it is rebuilt from the obstacle/slope maps in _loadFromJson. */
    _saveToJson() {
      return {
        // Save format version 1 = the 1.0.0.0 release baseline. Bump it (and
        // keep loading every older version) whenever the format changes.
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
        navEnabled: this.navEnabled,
        multiplayerMode: this.multiplayerMode,
        enablePortals: this.enablePortals,
        smoothPaths: this.smoothPaths,
        maxWaypointTime: this.maxWaypointTime,
        coyoteTime: this.coyoteTime,
        strictPositioning: this.strictPositioning,
        ledgeRestriction: this.ledgeRestriction,
        ledgeLeniency: this.ledgeLeniency,
        rePathThreshold: this.rePathThreshold,
        rePathCooldownDuration: this.rePathCooldownDuration,
        hazardRadius: this.hazardRadius,
        pathStrategy: this.pathStrategy,
        multiAgentAvoidance: this.multiAgentAvoidance,
        crowdArrivals: this.crowdArrivals,
        idleSeparation: this.idleSeparation,
        separationCooldown: this.separationCooldown,
        separationGiveUpTime: this.separationGiveUpTime,
        maxTraversalDrop: this.maxTraversalDrop,
        // Patrol survives savegames (bounds re-discover on load anyway via
        // re-anchoring). The side-of-object goal is deliberately NOT saved:
        // instance references don't serialize, so a save mid-path loses only
        // that arrival's OnObjectSideReached trigger.
        patrol: { active: this._patrolActive, dir: this._patrolDir, dwell: this._patrolDwell, range: this._patrolRange, leftX: this._patrolLeftX, rightX: this._patrolRightX, y: this._patrolY },
        route: this._route,
        patrolSettings: {
          dwellVar: this._patrolDwellVar, speedPct: this._patrolSpeedPct, speedBase: this._patrolSpeedBase,
          resumeAfter: this._patrolResumeAfter, memory: this._patrolMemory, resumeTimer: this._patrolResumeTimer,
          turnAtChars: this._patrolTurnAtChars, turnDanger: this._patrolTurnDanger,
        },
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
        gridOriginX: this.gridOriginX,
        gridOriginY: this.gridOriginY,
        slopeMap: this.slopeMap ? Array.from(this.slopeMap) : null,
        hazardMap: this.hazardMap ? Array.from(this.hazardMap) : null,
        // Every instance saves its map's FULL shared set (read without
        // initializing: saving must not subscribe as a side effect), so the
        // records survive no matter which instances exist at load time.
        hazards: Array.from(this._peekMapStore(globalNavManager.sharedHazards)?.values() || []),
        lastHazardId: this.lastHazardId,
        portals: Array.from(this._peekMapStore(globalNavManager.sharedPortals)?.values() || []),
        lastPortalId: this.lastPortalId,
        portalState: this.portalState,
        portalTraverseProgress: this.portalTraverseProgress,
        portalTraverseStartX: this.portalTraverseStartX,
        portalTraverseStartY: this.portalTraverseStartY,
        portalTraverseTargetX: this.portalTraverseTargetX,
        portalTraverseTargetY: this.portalTraverseTargetY,
        portalTraverseSpeed: this.portalTraverseSpeed,
        platformWasEnabled: this.platformWasEnabled,
        ride: this._ride,
        currentPortalId: this.currentPortalId,
        elevatorGroups: Object.fromEntries(this._peekMapStore(globalNavManager.sharedElevatorGroups) || []),
        // False before this instance has a map: its empty lists above mean
        // "not captured", and load must not let them clear the shared stores.
        hasMapStores: this.navKey !== null,
        // A rescan or patch was pending: redo a full (time-sliced) rescan on load
        pendingRefresh: this.navKey !== null && (globalNavManager.scanJobs.has(this.navKey) ||
          globalNavManager.pendingPatches.has(this.navKey) ||
          !!globalNavManager.movers.get(this.navKey)?.dirtyBox),
        // How this map rebuilds itself from objects (scan recipe + slope
        // registrations), by object type NAME, so automatic regeneration and
        // Regenerate obstacle map keep working after a load, even into a
        // different layout. Shared per map like portals/hazards.
        navRecipes: this._serializeMapRecipes(),
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
      this.navEnabled = o.navEnabled !== undefined ? o.navEnabled : true;
      this.multiplayerMode = o.multiplayerMode === "everywhere" ? "everywhere" : "host_only";
      this.enablePortals = o.enablePortals;
      this.smoothPaths = o.smoothPaths;
      this.maxWaypointTime = o.maxWaypointTime;
      this.coyoteTime = o.coyoteTime;
      this.strictPositioning = o.strictPositioning !== undefined ? o.strictPositioning : true;
      this.ledgeRestriction = o.ledgeRestriction;
      this.ledgeLeniency = o.ledgeLeniency;
      this.rePathThreshold = o.rePathThreshold;
      this.rePathCooldownDuration = o.rePathCooldownDuration || 0.5;
      this.hazardRadius = o.hazardRadius;
      this.pathStrategy = o.pathStrategy || "balanced";
      this.multiAgentAvoidance = o.multiAgentAvoidance;
      this.crowdArrivals = !!o.crowdArrivals;
      this.idleSeparation = Math.max(0, o.idleSeparation || 0);
      this.separationCooldown = typeof o.separationCooldown === "number" ? Math.max(0, o.separationCooldown) : 5;
      this.separationGiveUpTime = typeof o.separationGiveUpTime === "number" ? Math.max(0, o.separationGiveUpTime) : 1.2;
      this.maxTraversalDrop = typeof o.maxTraversalDrop === "number" ? o.maxTraversalDrop : -1;
      if (o.patrol) {
        this._patrolActive = !!o.patrol.active;
        this._patrolDir = o.patrol.dir || 1;
        this._patrolDwell = o.patrol.dwell || 0;
        this._patrolRange = o.patrol.range || 0;
        this._patrolLeftX = o.patrol.leftX || 0;
        this._patrolRightX = o.patrol.rightX || 0;
        this._patrolY = o.patrol.y || 0;
      }
      this._route = o.route || null; // route patrol (plain data: marker UIDs, phase)
      const ps = o.patrolSettings || {};
      this._patrolDwellVar = ps.dwellVar || 0;
      this._patrolSpeedPct = ps.speedPct || 100;
      this._patrolSpeedBase = typeof ps.speedBase === "number" ? ps.speedBase : null;
      this._patrolResumeAfter = ps.resumeAfter || 0;
      this._patrolMemory = ps.memory || null;
      this._patrolResumeTimer = ps.resumeTimer || 0;
      this._patrolTurnAtChars = ps.turnAtChars !== false;
      this._patrolTurnDanger = ps.turnDanger !== false;
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
      this.gridOriginX = o.gridOriginX || 0;
      this.gridOriginY = o.gridOriginY || 0;
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

      // Portals, hazards, and elevator groups are shared per map and every
      // initialized instance saves the full set, so each loading instance on a
      // map restores the same records (clear + refill is idempotent). A save
      // from an instance that had not initialized yet (hasMapStores false)
      // holds NO records rather than "no portals", so it must not clear the
      // stores other instances restored. _getNavKey, not _ensureInitialized:
      // init would re-read Platform properties over the values just restored.
      const loadNavKey = this._getNavKey();
      globalNavManager.hookLayoutEnd(this.instance.runtime);
      const restoreStores = o.hasMapStores !== false;
      if (restoreStores) {
        // How this map rebuilds itself from objects (scan + slope recipes)
        this._restoreMapRecipes(o.navRecipes, loadNavKey);
        // The moving-solid watcher restarts from the loaded instances: its old
        // records point at instances the load replaced.
        globalNavManager.movers.delete(loadNavKey);
        // A scan job or patch queued before the load would overwrite the
        // loaded map when it finished
        globalNavManager.scanJobs.delete(loadNavKey);
        globalNavManager.pendingPatches.delete(loadNavKey);
        if (o.pendingRefresh && this.obstacleMap && this._getScanRule()) this._startScanJob(null);
        const hazardsMap = globalNavManager.getSharedHazards(loadNavKey);
        hazardsMap.clear();
        if (o.hazards) {
          for (const h of o.hazards) {
            hazardsMap.set(h.id, h);
            // Global counter: never re-issue an ID a loaded hazard already uses
            globalNavManager.nextHazardId = Math.max(globalNavManager.nextHazardId, h.id + 1);
          }
        }

        const portalsMap = globalNavManager.getSharedPortals(loadNavKey);
        portalsMap.clear();
        if (o.portals) {
          for (const p of o.portals) {
            portalsMap.set(p.id, p);
            globalNavManager.nextPortalId = Math.max(globalNavManager.nextPortalId, p.id + 1);
          }
        }
      }
      this.lastHazardId = o.lastHazardId || 0;
      this.lastPortalId = o.lastPortalId || 0;

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
      this._ride = o.ride || null;
      if (this.portalState === "riding" && !this._ride) this.portalState = "none";

      // Restore elevator groups (shared per map, see above)
      if (restoreStores) {
        const elevatorGroups = globalNavManager.getSharedElevatorGroups(loadNavKey);
        elevatorGroups.clear();
        if (o.elevatorGroups) {
          for (const [key, val] of Object.entries(o.elevatorGroups)) {
            elevatorGroups.set(key, val);
          }
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
          { name: "$mapTag", value: this.mapTag || "(default)" },
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
          { name: "$portalCount", value: this._peekMapStore(globalNavManager.sharedPortals)?.size || 0 },
          { name: "$portalState", value: this.portalState },
          { name: "$currentPortalId", value: this.currentPortalId },
          { name: "$traverseProgress", value: Math.round(this.portalTraverseProgress * 100) + "%" },
          { name: "$elevatorGroups", value: this._peekMapStore(globalNavManager.sharedElevatorGroups)?.size || 0 },
        ]
      }, {
        title: prefix + " - Settings",
        properties: [
          { name: "$navEnabled", value: this.navEnabled },
          { name: "$multiplayer", value: this.multiplayerMode === "everywhere" ? "runs everywhere"
              : (this._peerPaused ? "paused (peer)" : "host only") },
          { name: "$cellSize", value: this.cellSize },
          { name: "$maxJumpHeight", value: Math.round(this.maxJumpHeight) },
          { name: "$maxJumpDistance", value: Math.round(this.maxJumpDistance) },
          { name: "$maxFallDistance", value: Math.round(this.maxFallDistance) },
          { name: "$debug", value: this.enableDebug },
          { name: "$platformBehavior", value: this.platformBehavior ? "found" : "not found" },
        ]
      }];
    }

    /** Finds and returns the Platform behavior instance on this object. */
    _getPlatformBehavior() {
      return this._GetBehaviorByType("Platform");
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
          // The scripting docs give jumpSustain in SECONDS while the editor
          // property (and this addon's math) uses milliseconds. Normalize by
          // magnitude: a value under 10 can only be seconds (nobody sustains a
          // jump 10+ seconds, and millisecond values are 16+).
          const rawSustain = this.platformBehavior.jumpSustain;
          this.platformProps.jumpSustain =
            rawSustain > 0 && rawSustain < 10 ? rawSustain * 1000 : rawSustain;
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

    /** Logs a debug message to the console (only when the Enable Debug
     *  Logging property is on).
     *
     *  Log lines worth looking for:
     *    "Obstacle map rebuilt (time-sliced)" / "Graph generated"
     *        full rebuild (startup, Regenerate obstacle map)
     *    "Obstacles moved, appeared or disappeared: regenerating ..."
     *        the obstacle watcher saw a change
     *    "Obstacle region rebuilt" / "Graph patch" / "Graph patched"
     *        a local update and its timing
     *    "Navigation map is now WxH cells from (x, y)"
     *        the grid grew (streaming) or the navigation area moved
     *    "Moving platform N: ride link ..." / "Ride: wait -> board after Ns" / "Ride aborted: ..."
     *        ride links, and why a ride was abandoned
     *    "Route patrol started" / "Route patrol stopped"
     *    "Add hazard from object: ..." / "Hazard costs: ..."
     *        hazards registered, and how many tiles cost more after a
     *        re-bake (no "Hazard costs" line = the map has no hazards)
     *    "Same floor, but a gap, wall or hazard is in the way: searching"
     *        the direct-walk shortcut was skipped (the search may jump it)
     *
     *  Other tools: the Construct debugger shows this behavior's state on each
     *  character; Log graph stats prints node / connection / slope / portal /
     *  hazard counts; the Debug expressions inspect single nodes and links.
     *  A character will not path somewhere: check PathFailReason, then whether
     *  a node exists there, then that node's connections. The map looks wrong
     *  after a change: if the watcher line is missing, the change is one the
     *  watcher cannot see (call Regenerate region over the area). */
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
      const gx = Math.floor((x - this.gridOriginX) / this.cellSize);
      const gy = Math.floor((y - this.gridOriginY) / this.cellSize);
      return { gx, gy };
    }

    /** World X of a grid column's left edge / world Y of a grid row's top edge. */
    _cellLeft(gx) { return this.gridOriginX + gx * this.cellSize; }
    _cellTop(gy) { return this.gridOriginY + gy * this.cellSize; }
    /** Grid column / row containing a world X / Y. */
    _toGX(x) { return Math.floor((x - this.gridOriginX) / this.cellSize); }
    _toGY(y) { return Math.floor((y - this.gridOriginY) / this.cellSize); }

    /** Converts grid cell coordinates to world pixel coordinates (center of cell). */
    gridToWorld(gx, gy) {
      const x = this.gridOriginX + gx * this.cellSize + this.cellSize / 2;
      const y = this.gridOriginY + gy * this.cellSize + this.cellSize / 2;
      return { x, y };
    }

    /** Returns a numeric key for use as a Map key in the navigation graph. */
    gridKey(gx, gy) {
      return gy * this.gridWidth + gx;
    }

    /** Returns the shared-state key (layoutUID|mapTag), computing it lazily.
     *  Needed because On-start-of-layout actions run BEFORE the first tick,
     *  when the tick-time initialization has not set navKey yet. */
    _getNavKey() {
      if (this.navKey === null && this.instance) {
        this.layoutUID = this.instance.layout.name; // documented; ILayout has no uid
        this.navKey = this.layoutUID + "|" + this.mapTag;
      }
      return this.navKey;
    }

    /** Returns the Euclidean distance between two points. */
    distance(x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      return Math.sqrt(dx * dx + dy * dy);
    }

    /** Returns this instance's navigation graph (shared per nav key). */
    _getNavigationGraph() {
      return globalNavManager.getSharedGraph(this.navKey);
    }

    /** Returns the portals Map (shared per nav key, stored on the manager).
     *  Portals are per map tag: a door portal added by a "ghost"-tagged instance
     *  exists only in the ghost map. Initializes first so actions in "On start
     *  of layout" (before the first tick) reach the right map's store. */
    _getPortalsMap() {
      this._ensureInitialized();
      return globalNavManager.getSharedPortals(this.navKey);
    }

    /** Returns the hazards Map (shared per nav key), like portals, including
     *  the same pre-first-tick initialization. */
    _getHazardsMap() {
      this._ensureInitialized();
      return globalNavManager.getSharedHazards(this.navKey);
    }

    /** Returns the elevator groups Map (shared per nav key), like portals. */
    _getElevatorGroups() {
      this._ensureInitialized();
      return globalNavManager.getSharedElevatorGroups(this.navKey);
    }

    /** Reads one of the manager's per-map stores WITHOUT initializing (save and
     *  debugger paths must not subscribe as a side effect). Null before this
     *  instance has a nav key or when the map has no store yet. */
    _peekMapStore(stores) {
      return this.navKey !== null ? (stores.get(this.navKey) || null) : null;
    }

    /** Returns true if the navigation graph needs to be regenerated. */
    _needsGraphRegeneration() {
      // Another instance is already running an incremental build for this map
      if (globalNavManager.isBuildInProgress(this.navKey)) return false;

      // Graph Manager without Platform: delay until agent params are available
      if (!this.platformBehavior && !this._jumpParamsOverridden) {
        const params = globalNavManager.getAgentParams(this.navKey);
        if (!params) return false; // Wait for a Platform agent to register
      }

      if (globalNavManager.needsRegeneration(this.navKey)) return true;

      // Check capability mismatch: if this instance has double jump but the
      // shared graph was built without it, the graph is missing double-jump
      // connections and needs rebuilding.
      if (this.platformProps.isDoubleJumpEnabled) {
        const caps = globalNavManager.getGraphCapabilities(this.navKey);
        if (caps && !caps.doubleJump) {
          this._log("Shared graph missing double-jump connections — rebuilding");
          return true;
        }
      }

      return false;
    }

    /** Marks the graph as generated for all same-map subscribers. */
    _markGraphAsGenerated() {
      globalNavManager.markGraphAsGenerated(this.navKey);
    }

    /** Subscribes this instance to its nav key's shared graph. */
    _initializeGraphMode() {
      // Log when a NEW map tag first becomes active on this layout: a typo in
      // the Map Tag property silently creates a separate, unconfigured map,
      // and this listing is how that gets diagnosed.
      const isNewMap = !globalNavManager.subscribers.has(this.navKey);
      globalNavManager.subscribe(this.navKey, this);
      if (isNewMap && this.enableDebug) {
        const tags = globalNavManager.getActiveTagsForLayout(this.layoutUID);
        if (tags.length > 1 || this.mapTag !== "") {
          this._log(`Map tag "${this.mapTag || "(default)"}" active — tags on this layout: ${tags.join(", ")}`);
        }
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
    hazardMethods,
    movingPlatformMethods
  );

  return PlatformerPathfindingInstance;
}
