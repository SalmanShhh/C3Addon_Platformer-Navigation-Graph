import { globalNavManager } from "./navigationManager.js";

// Graph construction: node generation, connection builders (walk/jump/fall/
// coyote/fall-through/slope), the incremental (chunked) build state machine,
// and graph node query expressions.
// Mixed into the instance class prototype — `this` is the behavior instance.
//
// How a level change reaches the graph:
//
//   Something changes in the level
//     ├─ object moved / resized / created / destroyed / animation or Solid
//     │  switch changed -> watcher (_pollMover, _checkMoverShape)
//     ├─ tilemap tile set or erased -> watcher tile sweep (_sweepTilemaps)
//     │     both mark a WORLD-space rect dirty (_markMoverDirty), debounced
//     │     -> _regenerateDirtyBox: grow the grid first if the rect is outside
//     │     -> _startScanJob(rect): rasterize those cells over a few frames
//     │     -> _completeScanJob: copy the buffer into the live map
//     ├─ Regenerate region / Regenerate region by object (same, "urgent")
//     └─ Set tile state / Mark slope region (write the map directly)
//           -> _markRegionChanged(cells): queue a patch area (a list per map;
//              touching areas merge)
//           -> _startPendingPatch: update nodes in the cells, clear and rebuild
//              the connections of every node within jump/fall reach
//           -> _finalizeGraphBuild: reconnect portals, re-bake hazards, bump
//              graphVersion, re-path characters whose path crosses the change
//
//   Full rebuilds (startup, Regenerate obstacle map, Build obstacle map from
//   layout, huge changes) use a full scan job + _markMapChanged + a full build.
//
// RULE: a connection builder writes only to its OWN node. Regional patches
// depend on it (see the patch section below).
//
// The build runs in phases, each phase visiting every node once. Phase order
// matters and must not change: fall connections read the walk connections of
// their landing targets (_fallLandingCostMultiplier), so walks build first.
// The build can be spread over multiple ticks (GRAPH_BUILD_BUDGET_MS per tick)
// to avoid a frame hitch on large maps; aceFindPath finishes any in-progress
// build synchronously, so pathfinding always sees a complete graph.
export default {
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
  },

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

    // Hazard costs are baked in one hazard-outer pass at build finalize
    // (_updateHazardCosts), not per node here — per-node queries against
    // every hazard made builds O(nodes × hazards).
    const hazardMultiplier = 1.0;

    return {
      x,
      y,
      gx,
      gy,
      walkable: true,
      connections: [],
      portalConnections: [],
      hazardMultiplier,
      isHazard: false, // standing here would touch a hazard (Walk Only never enters)
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
  },

  /** Looks up a navigation node by grid coordinates; returns undefined if no node exists there. */
  getNode(gx, gy) {
    // Out-of-range cells have no node. Without this check the row-major key
    // (gy * gridWidth + gx) ALIASES across rows: column -1 of row r is the
    // last column of row r-1 and column gridWidth is column 0 of row r+1, so
    // edge-column neighbour lookups linked tiles straight across the map and
    // off-map positions resolved to nodes on the opposite side.
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) return undefined;
    const graph = this._getNavigationGraph();
    return graph.get(this.gridKey(gx, gy));
  },

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
  },

  // ============================================================================
  // GRAPH BUILD - Incremental build state machine
  // ============================================================================

  /** Full sync graph generation (used by savegame load and as the base for the
   *  chunked build). Cancels any in-progress incremental build first. */
  _generateGraph() {
    this._cancelGraphBuild();
    if (!this._startGraphBuild()) return;
    this._finishGraphBuildNow();
  },

  /** Abandons an in-progress incremental build (graph stays marked ungenerated). */
  _cancelGraphBuild() {
    if (this._graphBuild) {
      this._graphBuild = null;
      globalNavManager.releaseBuild(this.navKey, this);
    }
  },

  /** Synchronously completes an in-progress incremental build. */
  _finishGraphBuildNow() {
    while (this._graphBuild) {
      this._stepGraphBuild(Infinity);
    }
  },

  /** Makes graph-dependent actions safe in "On start of layout", which runs
   *  BEFORE the behavior's first tick: initializes the instance if needed,
   *  finishes any in-progress build (own or another instance's), and
   *  otherwise builds the graph synchronously right now (auto-build scan
   *  included). Returns whether a generated graph is available afterwards. */
  _ensureGraphReadyNow() {
    this._ensureInitialized();
    if (!this._isNavActive()) return false;
    // A scan job lands first when nothing is built yet, or when an action
    // asked for it this tick (Regenerate obstacle map / region, then Find
    // path). Automatic refreshes are NOT forced: characters keep using the
    // current graph for the few frames until the refreshed one is ready.
    const job = globalNavManager.scanJobs.get(this.navKey);
    if (job && (!this.obstacleMap || !globalNavManager.getGraphCapabilities(this.navKey) ||
                job.urgentStamp === this.instance.runtime.gameTime)) {
      this._finishScanJobNow();
    }
    if (this._graphBuild) {
      this._finishGraphBuildNow();
    } else {
      globalNavManager.finishBuildFor(this.navKey);
    }
    if (!this.graphGenerated && this._startGraphBuild()) {
      this._finishGraphBuildNow();
    }
    // A patch requested earlier (tile edits, regions) lands before searching
    if (this.graphGenerated && this._startPendingPatch()) {
      this._finishGraphBuildNow();
      globalNavManager.finishBuildFor(this.navKey); // started by a matching agent
    }
    return this.graphGenerated;
  },

  /** Readiness for READ-ONLY graph queries that events poll every tick
   *  (same-platform checks). Unlike _ensureGraphReadyNow, never completes a
   *  mid-game rebuild synchronously (that would reintroduce the frame hitch
   *  time-slicing exists to prevent): while a map that was built before is
   *  rebuilding, the query answers "no". Only a map that has never been
   *  built is built now, so queries still work from On start of layout. */
  _graphReadyForQuery() {
    this._ensureInitialized();
    if (!this._isNavActive()) return false;
    if (this.graphGenerated) return true;
    if (this._graphBuild || globalNavManager.isBuildInProgress(this.navKey)) return false;
    if (globalNavManager.getGraphCapabilities(this.navKey)) return false; // rebuild pending
    return this._ensureGraphReadyNow();
  },

  /** Ordered connection phases for the current configuration. Order must stay
   *  walk → jump → fall → coyote → fall-through → slope (falls read their
   *  landing targets' walk connections). */
  _getGraphBuildPhaseList() {
    const phases = [
      { label: "walk", perNode: "_connectWalkForNode" },
      { label: "jump", perNode: "_connectJumpSingleForNode" },
    ];
    if (this.platformProps.isDoubleJumpEnabled) {
      phases.push({ label: "double-jump", perNode: "_connectJumpDoubleForNode" });
    }
    phases.push({ label: "fall", perNode: "_connectFallForNode" });
    if (this.coyoteTime > 0) {
      phases.push({ label: "coyote jump", perNode: "_connectCoyoteJumpForNode" });
    }
    phases.push({ label: "fall-through", perNode: "_connectFallThroughForNode" });
    if (this.slopeMap) {
      phases.push({ label: "slope", perNode: "_connectSlopeForNode" });
    }
    return phases;
  },

  /** Prepares a graph build: scans obstacles, generates nodes, and initializes
   *  the phase state. Returns false when the build cannot start yet (waiting
   *  for the Pathfinding map, no obstacle map, or missing agent params). */
  _startGraphBuild() {

    // A rebuild replaces every node OBJECT, so goal claims keyed by the old
    // nodes are meaningless — drop them; agents re-claim on their next path.
    globalNavManager.goalClaims.delete(this.navKey);

    // Graph Manager (SPOT, no Platform): inherit jump params from first Platform agent
    if (!this.platformBehavior) {
      const params = globalNavManager.getAgentParams(this.navKey);
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
        return false; // Delay graph build
      }
    }

    // Cancel any OTHER instance's in-flight build for this map before clearing
    // the shared graph it is stepping — two builds mutating the same graph
    // would corrupt each other (e.g. slope registration restarting a build
    // that a different instance started via auto-build).
    {
      const owner = globalNavManager.buildOwners.get(this._getNavKey());
      if (owner && owner !== this && owner._graphBuild) {
        owner._cancelGraphBuild();
      }
    }

    // Clear queued path requests — graph is being rebuilt (edge case #3)
    globalNavManager.clearQueue();

    const graph = this._getNavigationGraph();
    graph.clear();

    this._scanObstacles();
    if (!this.obstacleMap) return false;

    this._generateNodes();

    this._graphBuild = {
      startTime: performance.now(),
      workMs: 0,
      ticks: 0,
      phases: this._getGraphBuildPhaseList(),
      phaseIndex: 0,
      nodeIndex: 0,
      phaseCount: 0,
    };
    globalNavManager.claimBuild(this.navKey, this);
    return true;
  },

  /** Runs build phases until the time budget is exhausted or the build completes.
   *  Pass Infinity to complete the build in one call. */
  _stepGraphBuild(budgetMs) {
    const build = this._graphBuild;
    if (!build) return;
    const stepStart = performance.now();
    const deadline = stepStart + budgetMs;
    build.ticks++;
    const nodes = build.nodes || this.nodeIndexArray;

    while (build.phaseIndex < build.phases.length) {
      const phase = build.phases[build.phaseIndex];
      while (build.nodeIndex < nodes.length) {
        build.phaseCount += this[phase.perNode](nodes[build.nodeIndex]);
        build.nodeIndex++;
        // Check the clock every 32 nodes to keep performance.now() overhead low
        if ((build.nodeIndex & 31) === 0 && performance.now() >= deadline) {
          build.workMs += performance.now() - stepStart;
          return;
        }
      }
      this._log(`Created ${build.phaseCount} ${phase.label} connections`);
      build.phaseIndex++;
      build.nodeIndex = 0;
      build.phaseCount = 0;
    }

    build.workMs += performance.now() - stepStart;
    this._finalizeGraphBuild();
  },

  /** Completes a build: connects portals, applies hazard costs, marks the graph
   *  generated, and fires OnGraphGenerated. */
  _finalizeGraphBuild() {
    const build = this._graphBuild;
    if (build.patch) {
      // Unpatched nodes still carry their portal links: strip every link so
      // reconnecting all portals cannot duplicate them.
      for (const node of this._getNavigationGraph().values()) node.portalConnections = [];
    }
    this._connectAllPortals();
    this._updateHazardCosts();

    this._markGraphAsGenerated();

    // Record what this graph was built with: capabilities let late joiners
    // trigger a rebuild (double jump), and the physics numbers power the
    // mismatch warning for characters that should be on their own Map Tag.
    if (!build.patch) {
      globalNavManager.setGraphCapabilities(this.navKey, {
        doubleJump: this.platformProps.isDoubleJumpEnabled,
        maxJumpHeight: this.maxJumpHeight,
        maxJumpDistance: this.maxJumpDistance,
      });
      globalNavManager.graphBuildParams.set(this.navKey, this._physicsSignature());
    }
    this._syncMapStateToSubscribers();
    globalNavManager.graphVersion.set(this.navKey, (globalNavManager.graphVersion.get(this.navKey) || 0) + 1);

    this._graphBuild = null;
    globalNavManager.releaseBuild(this.navKey, this);

    const wallMs = performance.now() - build.startTime;
    this._log(`${build.patch ? "Graph patched" : "Graph generated"}: ${build.workMs.toFixed(2)}ms of work over ${build.ticks} tick(s) (${wallMs.toFixed(2)}ms wall)`);

    if (build.patch) {
      // Local update: no trigger (events in On navigation graph generated
      // typically add portals and must not run again for every local change)
      this._repathAgentsThroughPatch(build.patch);
      return;
    }
    this._warnIfGraphDisconnected();

    // this makes sure the trigger condition is called once the graph is generated.
    this._trigger("OnGraphGenerated");
  },

  /** Debug aid: after a build, detect isolated graph regions. A map that
   *  silently splits into components is the root of every "it just refuses to
   *  path" report — a character inside a small component can reach nothing,
   *  and nothing can reach it. Components are computed over connections
   *  treated as undirected (reachable either way still means "same region"). */
  _warnIfGraphDisconnected() {
    if (!this.enableDebug) return;
    const graph = this._getNavigationGraph();
    if (!graph || graph.size < 2) return;

    // Undirected adjacency via node identity
    const neighbors = new Map();
    for (const [, node] of graph) neighbors.set(node, new Set());
    for (const [, node] of graph) {
      for (const conn of node.connections) {
        if (!neighbors.has(conn.target)) continue;
        neighbors.get(node).add(conn.target);
        neighbors.get(conn.target).add(node);
      }
    }

    const seen = new Set();
    const components = [];
    for (const [, node] of graph) {
      if (seen.has(node)) continue;
      const comp = [];
      const stack = [node];
      seen.add(node);
      while (stack.length) {
        const n = stack.pop();
        comp.push(n);
        for (const nb of neighbors.get(n)) {
          if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
        }
      }
      components.push(comp);
    }

    if (components.length > 1) {
      components.sort((a, b) => b.length - a.length);
      for (let i = 1; i < components.length; i++) {
        const cells = components[i]
          .slice(0, 8)
          .map((n) => `(${n.gx},${n.gy})`)
          .join(" ");
        this._warn(
          `Graph has an ISOLATED region of ${components[i].length} node(s): ${cells}` +
          `${components[i].length > 8 ? " …" : ""} — characters there cannot reach the rest of the map ` +
          `(gaps too wide/tall for this character's jump physics, or blocked arcs).`
        );
      }
    }
  },

  /** Shares the builder's map state (by reference) with every same-map
   *  subscriber, so there is one copy of the obstacle/slope/hazard data per
   *  shared map, every instance's gridKey() addresses the graph correctly, and
   *  movement-time map reads see real data. Also warns (debug, once) when a
   *  subscriber's jump physics differ substantially from what this graph was
   *  built with — that character belongs on its own Map Tag. */
  _syncMapStateToSubscribers() {
    const subs = globalNavManager.subscribers.get(this.navKey);
    if (!subs) return;
    for (const inst of subs) {
      if (inst === this) continue;
      inst._adoptMapStateFrom(this);
      if (!inst._physicsMismatchWarned && inst._initialized && inst.platformBehavior && this.maxJumpHeight > 0) {
        const dh = Math.abs(this.maxJumpHeight - inst.maxJumpHeight) / this.maxJumpHeight;
        const dd = Math.abs(this.maxJumpDistance - inst.maxJumpDistance) / Math.max(this.maxJumpDistance, 1);
        if (dh > 0.2 || dd > 0.2) {
          inst._physicsMismatchWarned = true;
          inst._warn(`Jump physics differ ~${Math.round(Math.max(dh, dd) * 100)}% from the physics this map's graph was built with — paths may include jumps this character can't make (or miss ones it could). Give different movement classes their own Map Tag.`);
        }
      }
    }
  },

  // ============================================================================
  // GRAPH BUILD - Regional patches (Regenerate region, automatic refreshes,
  // tile edits). Instead of rebuilding every node, a patch:
  //   1. updates node existence/flags in the changed cells plus a 1-cell ring,
  //      keeping surviving node OBJECTS (paths, crowd claims and queued
  //      requests that reference them stay valid),
  //   2. clears and rebuilds the connections of every node whose connections
  //      can depend on those cells (the region expanded by the character's
  //      jump / fall / drift reach), through the normal phases in the normal
  //      order, time-sliced like a full build.
  // Every node's connections depend only on cells and nodes within that reach
  // of itself (the slope phase computes reverse slope links from the receiving
  // node's side for exactly this reason), so the patched graph matches a full
  // rebuild.
  // ============================================================================

  /** Records that obstacle cells [gx1, gx2) x [gy1, gy2) changed. The graph is
   *  patched over that area on the next tick. Pending areas are kept as a list
   *  per map (touching areas merge, far-apart ones stay separate, so the two
   *  edges of a sliding navigation area patch separately). Falls back to a full rebuild when no graph exists
   *  yet, a full rebuild is already pending, or the area is most of the map. */
  _markRegionChanged(gx1, gy1, gx2, gy2) {
    const navKey = this._getNavKey();
    if (navKey === null) return;
    // A tile edit may have just created this instance's slope map: share it
    // first, or the instance that runs the patch would not see (and its sync
    // would overwrite) the edit.
    this._syncMapStateToSubscribers();
    const owner = globalNavManager.buildOwners.get(navKey);
    const build = owner && owner._graphBuild;
    const neverBuilt = !globalNavManager.getGraphCapabilities(navKey);
    // While a PATCH runs every subscriber reads "not generated", which is not
    // a pending full rebuild; only a running full build or a real dirty flag is.
    const fullRebuildPending = build ? !build.patch : globalNavManager.needsRegeneration(navKey);
    if (neverBuilt || fullRebuildPending) {
      this._markMapChanged();
      return;
    }
    const rect = this._clampCellRect({ x: gx1, y: gy1, w: gx2 - gx1, h: gy2 - gy1 });
    if (!rect) return;
    // Pending changes are a LIST of areas: overlapping ones merge, separate
    // ones stay separate (a moving navigation area changes two opposite edges
    // at once, and one merged rect would cover the whole map).
    let merged = rect;
    let list = (globalNavManager.pendingPatches.get(navKey) || []).filter(r => {
      if (!this._cellRectsTouch(r, merged)) return true;
      merged = this._unionCellRect(r, merged);
      return false;
    });
    list.push(merged);
    if (list.length > 16) list = [list.reduce((a, b) => this._unionCellRect(a, b))];
    // Patches covering most of the map cost as much as a rebuild: rebuild
    const area = list.reduce((sum, r) => sum + r.w * r.h, 0);
    if (area > this.gridWidth * this.gridHeight * 0.5) {
      this._markMapChanged();
      return;
    }
    globalNavManager.pendingPatches.set(navKey, list);
  },

  /** Whether two cell rects overlap or touch. */
  _cellRectsTouch(a, b) {
    return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
  },

  /** How far (in cells) a node's connections can reach: horizontally, upward
   *  (a node this far ABOVE a cell can fall or jump down through it), and
   *  downward (a node this far BELOW a cell can jump up through it). */
  _patchReachCells() {
    const cs = this.cellSize;
    const head = Math.max(0, Math.ceil(this.characterHeight / cs) - 1);
    const width = this._getWidthCells();
    const jumpH = Math.ceil(Math.max(this.maxJumpHeight || 0, this.singleJumpHeight || 0) / cs);
    const jumpD = Math.ceil(Math.max(this.maxJumpDistance || 0, (this.singleJumpDistance || 0) * 1.45) / cs);
    const fall = Math.max(0, this.maxFallDistance || 0);
    const g = this.platformProps.gravity || 1500;
    const v = this.platformProps.maxSpeed || 330;
    const drift = Math.ceil((v * Math.sqrt((2 * fall) / g)) / cs);
    return {
      x: Math.max(jumpD, drift, 2) + width + 3,
      up: Math.max(Math.ceil(fall / cs), jumpH + 2) + head + 2,
      down: jumpH + head + 3,
    };
  },

  /** Starts the pending patch for this map, if any (and no build is running).
   *  Returns true when a patch build was started. */
  _startPendingPatch() {
    const navKey = this._getNavKey();
    const rects = navKey !== null ? globalNavManager.pendingPatches.get(navKey) : null;
    if (!rects || rects.length === 0) return false;
    if (this._graphBuild || globalNavManager.isBuildInProgress(navKey)) return false;
    globalNavManager.pendingPatches.delete(navKey);
    if (!this.obstacleMap || !globalNavManager.getGraphCapabilities(navKey)) {
      this._markMapChanged();
      return false;
    }
    // Patches run on the same physics the graph was built with; a builder
    // without agent params (Graph Manager) waits like a full build does.
    if (!this.platformBehavior && !this._jumpParamsOverridden && !globalNavManager.getAgentParams(navKey)) {
      globalNavManager.pendingPatches.set(navKey, rects);
      return false;
    }
    // A patch must use the physics the graph was BUILT with, or links in the
    // patched area would follow a different character's jumps (and its reach
    // would not cover the full build's). Hand it to a matching agent; with
    // none left, rebuild everything with the current physics instead.
    const built = globalNavManager.graphBuildParams.get(navKey);
    if (built && !this._physicsMatch(built)) {
      globalNavManager.pendingPatches.set(navKey, rects);
      for (const other of globalNavManager.subscribers.get(navKey) || []) {
        if (other !== this && other._physicsMatch && other._physicsMatch(built) && other._isNavActive()) {
          return other._startPendingPatch();
        }
      }
      globalNavManager.pendingPatches.delete(navKey);
      this._markMapChanged();
      return false;
    }

    const graph = this._getNavigationGraph();
    const gw = this.gridWidth, gh = this.gridHeight;

    // 1. Node existence + flags in each changed area and a 1-cell ring (ledge
    //    flags read neighbours; a node's existence reads the cell below it).
    const zones = rects.map(r => {
      const x1 = Math.max(0, r.x - 1), y1 = Math.max(0, r.y - 1);
      const x2 = Math.min(gw, r.x + r.w + 1), y2 = Math.min(gh, r.y + r.h + 1);
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    });
    const removed = [];
    let added = 0;
    for (const z of zones) for (let gy = z.y; gy < z.y + z.h; gy++) {
      for (let gx = z.x; gx < z.x + z.w; gx++) {
        const key = this.gridKey(gx, gy);
        const node = graph.get(key);
        const walkable = this._isWalkable(gx, gy) || this._isSlopeWalkable(gx, gy);
        if (walkable) {
          const pos = this.gridToWorld(gx, gy);
          const fresh = this._createNode(pos.x, pos.y, gx, gy);
          if (node) {
            node.isLeftLedge = fresh.isLeftLedge;
            node.isRightLedge = fresh.isRightLedge;
            node.isIsland = fresh.isIsland;
            node.isSlope = fresh.isSlope;
            node.slopeDirection = fresh.slopeDirection;
            node.isOnJumpThru = fresh.isOnJumpThru;
          } else {
            graph.set(key, fresh);
            added++;
          }
        } else if (node) {
          graph.delete(key);
          removed.push(node);
        }
      }
    }
    if (removed.length) {
      const claims = globalNavManager.goalClaims.get(navKey);
      if (claims) for (const n of removed) claims.delete(n);
    }

    // 2. Every node whose connections can depend on those cells (each zone
    //    expanded by the jump / fall reach; a node near two zones counts once)
    const reach = this._patchReachCells();
    const affectedSet = new Set();
    for (const z of zones) {
      const ax1 = Math.max(0, z.x - reach.x), ax2 = Math.min(gw, z.x + z.w + reach.x);
      const ay1 = Math.max(0, z.y - reach.up), ay2 = Math.min(gh, z.y + z.h + reach.down);
      for (let gy = ay1; gy < ay2; gy++) {
        for (let gx = ax1; gx < ax2; gx++) {
          const node = graph.get(this.gridKey(gx, gy));
          if (node) affectedSet.add(node);
        }
      }
    }
    const affected = Array.from(affectedSet);
    for (const node of affected) node.connections = [];
    this.nodeIndexArray = Array.from(graph.values());

    for (const inst of globalNavManager.subscribers.get(navKey) || []) inst.graphGenerated = false;
    this._graphBuild = {
      patch: zones,
      nodes: affected,
      startTime: performance.now(),
      workMs: 0,
      ticks: 0,
      phases: this._getGraphBuildPhaseList(),
      phaseIndex: 0,
      nodeIndex: 0,
      phaseCount: 0,
    };
    globalNavManager.claimBuild(navKey, this);
    this._log(`Graph patch: ${zones.length} area(s) (${zones.map(z => `${z.w}x${z.h} at (${z.x},${z.y})`).join(", ")}), ${added} node(s) added, ${removed.length} removed, ${affected.length} node(s) reconnected`);
    return true;
  },

  /** The physics a graph build depends on (jumps, falls, size, coyote time). */
  _physicsSignature() {
    const p = this.platformProps || {};
    return [
      this.maxJumpHeight, this.maxJumpDistance, this.singleJumpHeight, this.singleJumpDistance,
      this.maxFallDistance, this.characterHeight, this.characterWidth, this.coyoteTime,
      p.isDoubleJumpEnabled ? 1 : 0, p.gravity || 0, p.maxSpeed || 0,
    ];
  },

  _physicsMatch(sig) {
    const mine = this._physicsSignature();
    for (let i = 0; i < mine.length; i++) {
      if (Math.abs((mine[i] || 0) - (sig[i] || 0)) > 0.5) return false;
    }
    return true;
  },

  /** After a patch: characters whose remaining path runs through the patched
   *  cells re-path now instead of discovering the change by getting stuck. */
  _repathAgentsThroughPatch(zones) {
    const subs = globalNavManager.subscribers.get(this.navKey);
    if (!subs) return;
    const cs = this.cellSize;
    const boxes = zones.map(z => ({
      x1: this._cellLeft(z.x), y1: this._cellTop(z.y),
      x2: this._cellLeft(z.x + z.w), y2: this._cellTop(z.y + z.h),
    }));
    for (const inst of subs) {
      if (!inst.hasPath || inst.pathPending || inst.portalState !== "none") continue;
      const path = inst.currentPath;
      const halfW = (inst.characterWidth || cs) / 2;
      const height = inst.characterHeight || cs;
      let px = inst.instance.x, py = inst.instance.y;
      for (let i = inst.currentWaypoint; i < path.length; i++) {
        const wp = path[i];
        // The segment's box, widened by the body and raised by any jump peak
        const sx1 = Math.min(px, wp.x) - halfW, sx2 = Math.max(px, wp.x) + halfW;
        const sy1 = Math.min(py, wp.y) - (wp.peakHeight || 0) - height, sy2 = Math.max(py, wp.y) + height / 2;
        if (boxes.some(b => sx1 < b.x2 && sx2 > b.x1 && sy1 < b.y2 && sy2 > b.y1)) {
          inst._rePath(true);
          break;
        }
        px = wp.x; py = wp.y;
      }
    }
  },

  // ============================================================================
  // GRAPH BUILD - Per-node connection builders
  // ============================================================================

  /** Creates walk_left/walk_right connections from one node to horizontally adjacent nodes with sufficient headroom. */
  _connectWalkForNode(node) {
    let count = 0;
    const headCells = Math.max(0, Math.ceil(this.characterHeight / this.cellSize) - 1);
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

    return count;
  },

  /** Creates single-jump connections from one node to nodes reachable via jump arcs. */
  _connectJumpSingleForNode(node) {
    // Use single-jump limits; double-jump connections are added in a separate phase
    const singleHeight = this.platformProps.isDoubleJumpEnabled ? this.singleJumpHeight : this.maxJumpHeight;
    const singleDist = this.platformProps.isDoubleJumpEnabled ? this.singleJumpDistance : this.maxJumpDistance;
    const maxHeightCells = Math.ceil(singleHeight / this.cellSize);
    const maxFallCells = Math.ceil(this.maxFallDistance / this.cellSize);
    const maxDistCells = Math.ceil(singleDist / this.cellSize);
    // Momentum (run-up) jumps launch from the tile edge at speed, extending
    // horizontal range ~45% beyond the standstill envelope.
    const momentumDist = singleDist * 1.45;
    const momentumDistCells = Math.ceil(momentumDist / this.cellSize);
    // Cap downward range: a jump arc goes UP peakHeight then descends back.
    // From launch, you land at most ~maxHeightCells below via the arc itself.
    // Targets further below should use fall connections from ledge nodes.
    // Old formula (maxHeightCells*2+2) allowed 10-tile shortcuts when maxHeightCells=4.
    const maxDownCells = Math.min(maxFallCells, maxHeightCells + 2);
    let count = 0;

    for (const dir of [-1, 1]) {
      for (let dist = 0; dist <= momentumDistCells; dist++) {
        // When dist=0 (vertical jump), only check once (dir=1) to avoid duplicates
        if (dist === 0 && dir === -1) continue;

        for (let height = -maxDownCells; height <= maxHeightCells; height++) {
          // dist=0 with height<=0 is not a valid jump (same position or falling)
          if (dist === 0 && height <= 0) continue;

          const targetGx = node.gx + dir * dist;
          const targetGy = node.gy - height;
          const target = this.getNode(targetGx, targetGy);
          if (!target) continue;

          const peakHeight = dist <= maxDistCells
            ? this._canJump(node, target, singleHeight, singleDist)
            : 0;
          if (peakHeight > 0) {
            const distance = this.distance(node.x, node.y, target.x, target.y);
            node.connections.push({
              target,
              action: "jump",
              cost: distance * this.JUMP_COST,
              peakHeight,
            });
            count++;
          } else if (dist >= 3) {
            // Standstill launch can't make it — try a run-up (momentum) launch.
            // Slope nodes are allowed: the Platform behavior sprints on slopes
            // fine, and excluding them stranded characters on slope-only
            // terrain whose sole exits were momentum-length hops. Only hops
            // long enough to be worth the back-up-and-sprint setup.
            const momPeak = this._canJump(node, target, singleHeight, momentumDist, true);
            if (momPeak > 0) {
              const distance = this.distance(node.x, node.y, target.x, target.y);
              node.connections.push({
                target,
                action: "jump",
                // Slightly pricier than a plain jump: the run-up costs setup
                // time and the launch has tighter tolerances.
                cost: distance * this.JUMP_COST * 1.25,
                peakHeight: momPeak,
                requiresMomentum: true,
              });
              count++;
            }
          }
        }
      }
    }

    return count;
  },

  /** Creates double-jump connections from one node for targets beyond single-jump range. */
  _connectJumpDoubleForNode(node) {
    const maxHeightCells = Math.ceil(this.singleJumpHeight / this.cellSize);
    const maxFallCells = Math.ceil(this.maxFallDistance / this.cellSize);
    const maxDownCells = Math.min(maxFallCells, maxHeightCells + 2);
    const doubleMaxHeightCells = Math.ceil(this.maxJumpHeight / this.cellSize);
    const doubleMaxDistCells = Math.ceil(this.maxJumpDistance / this.cellSize);
    let count = 0;

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

    return count;
  },

  /** Creates straight-down and diagonal fall connections from one node to lower platforms. */
  _connectFallForNode(node) {
    const maxFallCells = Math.ceil(this.maxFallDistance / this.cellSize);
    let count = 0;

    // Slope nodes don't need straight falls: adjacent slope tiles below are
    // connected via the slope phase (walk), and ledge departures use diagonal falls.
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
      count += this._addDiagonalFall(node, -1, maxFallCells);
    }
    if (node.isRightLedge) {
      count += this._addDiagonalFall(node, 1, maxFallCells);
    }

    return count;
  },

  /** Creates coyote jump connections from a ledge node — jumps that start after stepping off the edge during the coyote time window. */
  _connectCoyoteJumpForNode(node) {
    if (!node.isLeftLedge && !node.isRightLedge) return 0;

    const gravity = this.platformProps.gravity;
    let count = 0;

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

    return count;
  },

  /** Creates fall-through connections from a node standing on a jump-thru platform to the node below. */
  _connectFallThroughForNode(node) {
    if (!node.isOnJumpThru) return 0;

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
        return 1;
      }
    }
    return 0;
  },

  /** Slope phase for one node. Supports 45° (1:1) and 22.5° (2:1) gentle slopes.
   *  - A SLOPE node gets its walk links along the slope (down and up the
   *    incline, plus horizontal mid-slope links on gentle slopes).
   *  - A NON-slope node gets its walk ENTRY onto any slope whose low or high end
   *    it is (the "reverse" links). These used to be pushed onto the flat
   *    neighbour by the slope node; computing them from the flat node's own
   *    side gives exactly the same links and costs, but keeps every node's
   *    connections a function of its own neighbourhood, which regional graph
   *    patches rely on. */
  _connectSlopeForNode(node) {
    // Slope edge costs must be >= Euclidean distance so the A* heuristic stays consistent.
    // sqrt(2)*cellSize for 45° diagonals, sqrt(5)*cellSize for gentle diagonals.
    const slopeDiagCost = Math.SQRT2 * this.cellSize * this.SLOPE_COST;       // 45° (1:1)
    const gentleDiagCost = Math.sqrt(5) * this.cellSize * this.SLOPE_COST;    // 22.5° (2:1)
    const midSlopeCost = this.cellSize * this.SLOPE_COST;                      // horizontal mid-slope

    if (!node.isSlope) {
      // Entries onto slopes: [dx, dy, slope direction, action, cost]. Each
      // neighbouring position holds at most one slope, so each slope adds at
      // most one entry link here, exactly as the old reverse push did.
      let count = 0;
      const entry = (dx, dy, dir, action, cost) => {
        const s = this.getNode(node.gx + dx, node.gy + dy);
        if (s && s.isSlope && s.slopeDirection === dir) {
          node.connections.push({ slopePhase: true, target: s, action, cost });
          count++;
        }
      };
      entry(1, -1, 1, "walk_right", slopeDiagCost);   // low end of a / slope
      entry(-1, 1, 1, "walk_left", slopeDiagCost);    // high end of a / slope
      entry(1, 1, 2, "walk_right", slopeDiagCost);    // high end of a \ slope
      entry(-1, -1, 2, "walk_left", slopeDiagCost);   // low end of a \ slope
      entry(2, -1, 3, "walk_right", gentleDiagCost);  // low end of a gentle / slope
      entry(-2, 1, 3, "walk_left", gentleDiagCost);   // high end of a gentle / slope
      entry(2, 1, 4, "walk_right", gentleDiagCost);   // high end of a gentle \ slope
      entry(-2, -1, 4, "walk_left", gentleDiagCost);  // low end of a gentle \ slope
      return count;
    }

    let count = 0;
    const dir = node.slopeDirection;

    if (dir === 1) {
      // 45° slope-left (/): down-left, up-right
      const down = this.getNode(node.gx - 1, node.gy + 1);
      const up = this.getNode(node.gx + 1, node.gy - 1);
      if (down) { node.connections.push({ slopePhase: true, target: down, action: "walk_left", cost: slopeDiagCost }); count++; }
      if (up) { node.connections.push({ slopePhase: true, target: up, action: "walk_right", cost: slopeDiagCost }); count++; }
    } else if (dir === 2) {
      // 45° slope-right (\): up-left, down-right
      const up = this.getNode(node.gx - 1, node.gy - 1);
      const down = this.getNode(node.gx + 1, node.gy + 1);
      if (up) { node.connections.push({ slopePhase: true, target: up, action: "walk_left", cost: slopeDiagCost }); count++; }
      if (down) { node.connections.push({ slopePhase: true, target: down, action: "walk_right", cost: slopeDiagCost }); count++; }
    } else if (dir === 3) {
      // 22.5° gentle-left (/): 2 tiles horizontal per 1 vertical
      const down = this.getNode(node.gx - 2, node.gy + 1);
      const up = this.getNode(node.gx + 2, node.gy - 1);
      if (down) { node.connections.push({ slopePhase: true, target: down, action: "walk_left", cost: gentleDiagCost }); count++; }
      if (up) { node.connections.push({ slopePhase: true, target: up, action: "walk_right", cost: gentleDiagCost }); count++; }
      // Horizontal mid-slope connections (skip if the walk phase already created this link)
      const midLeft = this.getNode(node.gx - 1, node.gy);
      const midRight = this.getNode(node.gx + 1, node.gy);
      if (midLeft && midLeft.isSlope && !node.connections.some(c => c.target === midLeft && c.action === "walk_left")) {
        node.connections.push({ slopePhase: true, target: midLeft, action: "walk_left", cost: midSlopeCost }); count++;
      }
      if (midRight && midRight.isSlope && !node.connections.some(c => c.target === midRight && c.action === "walk_right")) {
        node.connections.push({ slopePhase: true, target: midRight, action: "walk_right", cost: midSlopeCost }); count++;
      }
    } else if (dir === 4) {
      // 22.5° gentle-right (\): 2 tiles horizontal per 1 vertical
      const up = this.getNode(node.gx - 2, node.gy - 1);
      const down = this.getNode(node.gx + 2, node.gy + 1);
      if (up) { node.connections.push({ slopePhase: true, target: up, action: "walk_left", cost: gentleDiagCost }); count++; }
      if (down) { node.connections.push({ slopePhase: true, target: down, action: "walk_right", cost: gentleDiagCost }); count++; }
      // Horizontal mid-slope connections (skip if the walk phase already created this link)
      const midLeft = this.getNode(node.gx - 1, node.gy);
      const midRight = this.getNode(node.gx + 1, node.gy);
      if (midLeft && midLeft.isSlope && !node.connections.some(c => c.target === midLeft && c.action === "walk_left")) {
        node.connections.push({ slopePhase: true, target: midLeft, action: "walk_left", cost: midSlopeCost }); count++;
      }
      if (midRight && midRight.isSlope && !node.connections.some(c => c.target === midRight && c.action === "walk_right")) {
        node.connections.push({ slopePhase: true, target: midRight, action: "walk_right", cost: midSlopeCost }); count++;
      }
    }

    return count;
  },

  // ============================================================================
  // GRAPH BUILD - Arc validation helpers
  // ============================================================================

  /** Returns the number of extra cells to check on each side of the character during fall arc validation.
   *  A 16px character in 32px cells doesn't extend into adjacent cells → widthCells=0.
   *  Old formula ceil(w/cs/2) rounded up, giving 1 for any character narrower than a cell — this
   *  caused _canDiagonalFall to fail at slope ledge nodes because solid slope body cells one tile
   *  over (e.g. the body below an adjacent slope tile) are within 1 cell of the ledge surface. */
  _getWidthCells() {
    return Math.max(0, Math.ceil(this.characterWidth / this.cellSize) - 1);
  },

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
    const apexGridGy = Math.round((apexY - this.gridOriginY) / cs);

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
  },

  // Returns the minimum viable peak height in pixels (>0) if jump is possible,
  // or 0 if the jump is blocked. The peak height is stored in connections and
  // used by the movement code to release the jump button at the right time.
  // withMomentum: validate a RUN-UP launch instead of a standstill one — the
  // executor backs up across the launch tile, sprints, and leaps from the
  // tile edge at ~0.78 maxSpeed (see _handleJumpAction's momentum departure).
  _canJump(from, to, maxHeight, maxDist, withMomentum) {
    maxHeight = maxHeight || this.maxJumpHeight;
    maxDist = maxDist || this.maxJumpDistance;
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    if (Math.abs(dx) > maxDist) return 0;
    if (-dy > maxHeight) return 0;

    // Kinematic envelope: height and distance are NOT independent limits. An
    // upward jump only has until it sinks back to the landing height to cover
    // the horizontal distance. With launch speed v0 = sqrt(2g·maxHeight), the
    // second crossing of rise h is at t = (v0 + sqrt(2g(maxHeight - h))) / g.
    // Near-max height leaves near-zero range (e.g. a 128px-up jump cannot also
    // travel 192px sideways even though both are under their individual caps —
    // the character arrives at the right X but below the platform and drops).
    // The 0.8 factor mirrors the margin already baked into maxJumpDistance.
    const rise = -dy;
    if (rise > 0) {
      const g = this.platformProps.gravity;
      const maxSpd = this.platformProps.maxSpeed;
      if (g > 0 && maxSpd > 0) {
        const v0 = Math.sqrt(2 * g * maxHeight);
        const tLand = (v0 + Math.sqrt(Math.max(0, 2 * g * (maxHeight - rise)))) / g;
        // Run-up launches suffer no standstill acceleration loss (1.0 vs 0.8)
        // and start from the tile edge rather than the node center.
        const reach = withMomentum
          ? maxSpd * tLand + this.cellSize * 0.44
          : maxSpd * tLand * 0.8;
        if (Math.abs(dx) > reach) return 0;
      }
    }

    // Head clearance: arc samples are the character's CENTER, so the body
    // extends half the character height above each sample. The old formula
    // (ceil(height/cs) - 1) was ZERO for characters up to one cell tall, so
    // arcs were validated as a point — a rising jump could pass "clear" while
    // the character's head clipped the side of a block one row above the
    // sampled cell, killing the arc mid-air. standingHeadCells is the head
    // room needed when standing AT a node (start/destination cells), which is
    // less than mid-arc clearance since the sample sits at the node center.
    const halfH = (this.characterHeight || this.cellSize) / 2;
    const headCells = Math.ceil(halfH / this.cellSize);
    const standingHeadCells = Math.max(
      0,
      Math.ceil((halfH - this.cellSize / 2) / this.cellSize)
    );

    // Vertical or near-vertical jump: use straight column check instead of Bezier arc.
    // This matches how falls work (straight drop) and avoids the arc overshooting into ceilings.
    if (Math.abs(dx) < this.cellSize * 0.5) {
      const minGy = Math.min(from.gy, to.gy);
      const maxGy = Math.max(from.gy, to.gy);
      for (let gy = minGy; gy <= maxGy; gy++) {
        for (let h = 0; h <= headCells; h++) {
          // Start/destination rows only need STANDING head room — e.g. a
          // ceiling directly above the landing node must not reject the jump
          // (the character bonks harmlessly and settles onto the node).
          if (h > 0 && (gy === from.gy || gy === to.gy) && h > standingHeadCells) continue;
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

    // Horizontal jump: kinematic flight simulation.
    // The old check swept a synthetic minimal-peak Bezier ("just high enough
    // for the jump"), but the arc the character actually flies is fixed by
    // physics: with Jump Sustain = 0 every jump rises the FULL maxHeight
    // before descending. The real arc therefore flew far above the validated
    // one and clipped wall faces the Bezier missed — a side hit while rising
    // kills horizontal momentum and drops the character short, often into a
    // pit. This simulates exactly what the movement code will do — launch at
    // jump speed, accelerate horizontal input toward the target, brake inside
    // stopping distance, bonk ceilings harmlessly (C3 "stop" mode keeps the
    // flight alive), die on wall faces — and accepts the connection only if
    // the simulated character actually lands on the target node.
    const neededPeakHeight = Math.max(-dy, 0) + this.cellSize;
    // Sustain > 0: the executor releases the jump button at the needed peak.
    // Sustain = 0: jump height is fixed — every arc rises to maxHeight.
    const actualPeakHeight = this.platformProps.jumpSustain > 0
      ? Math.min(maxHeight, neededPeakHeight)
      : maxHeight;

    const cs = this.cellSize;
    const g = this.platformProps.gravity || 1500;
    const maxSpd = this.platformProps.maxSpeed || 330;
    const accel = this.platformProps.acceleration || maxSpd * 4;
    const decel = this.platformProps.deceleration || accel;
    const maxFall = this.platformProps.maxFallSpeed || 1000;
    const preserveMomentum =
      this.platformProps.ceilingCollisionMode === "preserve-momentum";
    const halfW = (this.characterWidth || cs) / 2;

    const cellAt = (gx, gy) => {
      if (gx < 0 || gx >= this.gridWidth) return -1; // off the map sideways
      if (gy < 0 || gy >= this.gridHeight) return 0; // above/below the map: open air
      return this.obstacleMap ? this.obstacleMap[gy * this.gridWidth + gx] : 0;
    };
    const slopeAt = (gx, gy) =>
      this.slopeMap && gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight
        ? this.slopeMap[gy * this.gridWidth + gx]
        : 0;
    // Surface line of a slope cell at world X (same formulas as the walk phase).
    const slopeSurfaceY = (gx, gy, px) => {
      const type = slopeAt(gx, gy);
      const localX = px - this._cellLeft(gx);
      const top = this._cellTop(gy);
      if (type === 1) return top + cs - localX;               // slope_left (/)
      if (type === 2) return top + localX;                    // slope_right (\)
      const leftType = slopeAt(gx - 1, gy);
      if (type === 3)                                          // gentle_left (/)
        return leftType === 3
          ? top + 0.5 * cs - localX * 0.5
          : top + cs - localX * 0.5;
      return leftType === 4                                    // gentle_right (\)
        ? top + 0.5 * cs + localX * 0.5
        : top + localX * 0.5;
    };

    // Run-up launch: from the tile edge at ~0.78 maxSpeed (the executor's
    // back-up-and-sprint gives ~24px of runway → sqrt(2·accel·24) ≈ 0.8 max;
    // 0.78 keeps the validator conservative against the real launch).
    const launchDir = dx < 0 ? -1 : 1;
    let x = from.x + (withMomentum ? launchDir * cs * 0.44 : 0);
    let y = from.y;
    let vx = withMomentum ? launchDir * maxSpd * 0.78 : 0;
    let vy = -Math.sqrt(2 * g * actualPeakHeight);
    const dt = 1 / 60;

    for (let t = 0; t < 3.0; t += dt) {
      // Executor's horizontal control (mirrors _handleJumpAction's airborne
      // input): drive toward the target X, brake within stopping distance.
      const distX = Math.abs(to.x - x);
      const stopDist = (vx * vx) / (2 * decel);
      if (distX > cs * 0.2 && distX > stopDist + cs * 0.1) {
        vx += (to.x < x ? -1 : 1) * accel * dt;
        if (vx > maxSpd) vx = maxSpd;
        if (vx < -maxSpd) vx = -maxSpd;
      } else if (vx !== 0) {
        const dv = decel * dt;
        vx = Math.abs(vx) <= dv ? 0 : vx - Math.sign(vx) * dv;
      }
      vy += g * dt;
      if (vy > maxFall) vy = maxFall;

      let nx = x + vx * dt;
      let ny = y + vy * dt;

      // Horizontal: leading edge against solids and slope bodies (wall hit).
      if (vx !== 0) {
        const leadX = nx + Math.sign(vx) * halfW;
        const lgx = this._toGX(leadX);
        const topGy = this._toGY(y - halfH + 2);
        const botGy = this._toGY(y + halfH - 2);
        for (let bgy = topGy; bgy <= botGy; bgy++) {
          const v = cellAt(lgx, bgy);
          if (v === -1 || v === 3) return 0; // off-map / avoid zone: reject
          if (slopeAt(lgx, bgy) > 0) {
            if (y + halfH - 2 > slopeSurfaceY(lgx, bgy, leadX)) {
              if (this._canJumpTrace) console.log(`  [sim] t=${t.toFixed(2)} slope-wall at (${lgx},${bgy}) pos=(${x.toFixed(0)},${y.toFixed(0)})`);
              vx = 0; nx = x; break;
            }
          } else if (v === 1) {
            if (this._canJumpTrace) console.log(`  [sim] t=${t.toFixed(2)} wall at (${lgx},${bgy}) pos=(${x.toFixed(0)},${y.toFixed(0)}) vy=${vy.toFixed(0)}`);
            vx = 0; nx = x; break;           // wall face: horizontal speed dies
          }
        }
      }

      if (vy < 0) {
        // Rising: head against ceilings — C3 "stop" zeroes the rise but the
        // flight continues (this is how stair hops under low ceilings work).
        const headGy = this._toGY(ny - halfH);
        const hgx0 = this._toGX(nx - halfW + 2);
        const hgx1 = this._toGX(nx + halfW - 2);
        for (let bgx = hgx0; bgx <= hgx1; bgx++) {
          const v = cellAt(bgx, headGy);
          if (v === 3) return 0;
          if (v === 1 && slopeAt(bgx, headGy) === 0) {
            if (!preserveMomentum) vy = 0;
            ny = y;
            break;
          }
        }
      } else {
        // Falling: feet against floors — the landing decides the verdict.
        const feetY = ny + halfH;
        const feetGy = this._toGY(feetY);
        const fgx0 = this._toGX(nx - halfW + 2);
        const fgx1 = this._toGX(nx + halfW - 2);
        for (let bgx = fgx0; bgx <= fgx1; bgx++) {
          const v = cellAt(bgx, feetGy);
          if (v === 3) return 0;
          let landedGy = -1;
          if (slopeAt(bgx, feetGy) > 0) {
            // Slope: land when the feet reach the surface line (the node
            // lives IN the slope cell).
            if (feetY >= slopeSurfaceY(bgx, feetGy, nx)) landedGy = feetGy;
          } else if (v === 1) {
            landedGy = feetGy - 1;           // stand on top of the solid
          } else if (v === 2 && y + halfH <= this._cellTop(feetGy) + 1) {
            landedGy = feetGy - 1;           // jump-thru: only from above
          }
          if (landedGy >= 0) {
            const nearTargetX =
              this._toGX(nx) === to.gx || Math.abs(nx - to.x) <= cs * 0.55;
            if (this._canJumpTrace) console.log(`  [sim] t=${t.toFixed(2)} landed gy=${landedGy} at pos=(${nx.toFixed(0)},${ny.toFixed(0)}) target=(${to.gx},${to.gy}) nearX=${nearTargetX}`);
            return landedGy === to.gy && nearTargetX ? actualPeakHeight : 0;
          }
        }
      }

      x = nx;
      y = ny;

      // Fell past the landing height without touching down near the target.
      // Only meaningful while DESCENDING, and measured against the lower of
      // the two endpoints — an upward jump legitimately starts below its
      // target, so comparing against to.y alone rejected every rising jump
      // at t=0 before the first physics step.
      if (vy > 0 && y > Math.max(from.y, to.y) + cs * 2 && Math.abs(x - to.x) > cs * 0.55) {
        if (this._canJumpTrace) console.log(`  [sim] t=${t.toFixed(2)} fell past target: pos=(${x.toFixed(0)},${y.toFixed(0)})`);
        return 0;
      }
    }

    return 0; // never landed within the time budget
  },

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
  },

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
  },

  /** Returns true if a diagonal fall path (parabolic approximation) is unobstructed, checking character width AND height. */
  _canDiagonalFall(from, to, direction) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dy <= 0) return false;
    const widthCells = this._getWidthCells();
    const cs = this.cellSize;
    const halfH = (this.characterHeight || cs) / 2;

    // For each row, check the full horizontal span the arc sweeps through.
    // A single center-sample per row misses cells when the arc crosses a column
    // boundary while still in the same gy row (e.g. the departure row where the
    // character transitions from gx=19 into gx=18 before gy changes, but cell
    // (18,gy) is the solid slope body of the adjacent slope tile).
    // Parabolic path: x(t) = from.x + dx*t, y(t) = from.y + dy*t²
    // The row's time window is padded by the character's HALF HEIGHT: the body
    // spans [y-halfH, y+halfH], so it overlaps row gy while the center is inside
    // (gy*cs - halfH, (gy+1)*cs + halfH). Without this padding an arc can thread
    // a gap on paper while the real character's head clips a solid's corner —
    // horizontal speed dies against the wall face and the fall lands short
    // (or misses the platform entirely). The real trajectory also crosses early
    // columns FASTER than the average-speed parabola (i.e. higher up), which the
    // height padding absorbs.
    for (let gy = from.gy; gy <= to.gy; gy++) {
      const tEnter = Math.sqrt(Math.max(0, (this._cellTop(gy) - halfH - from.y) / dy));
      const tExit  = Math.sqrt(Math.max(0, (this._cellTop(gy + 1) + halfH - from.y) / dy));
      if (tEnter > 1.0) break;
      const xEnter = from.x + dx * Math.min(tEnter, 1.0);
      const xExit  = from.x + dx * Math.min(tExit,  1.0);
      const gxMin  = this._toGX(Math.min(xEnter, xExit));
      const gxMax  = this._toGX(Math.max(xEnter, xExit));
      for (let gx = gxMin; gx <= gxMax; gx++) {
        for (let w = -widthCells; w <= widthCells; w++) {
          const cgx = gx + w;
          // Skip the launch platform's own cells: at/behind the departure
          // column below the node row. The character departs from the platform
          // EDGE (center already past node center + cs/2 + halfW), so its body
          // never overlaps those columns once it is below the node row — but
          // the height-padded sweep would otherwise flag the platform itself
          // and reject every diagonal fall.
          if (gy > from.gy && (cgx - from.gx) * direction <= 0) continue;
          if (this.isCellBlocked(cgx, gy)) return false;
        }
      }
    }
    return true;
  },

  // Prefer falling onto nodes that have walk connections — makes reverse
  // pathing produce paths that are easier to climb upward from.
  _fallLandingCostMultiplier(targetNode) {
    const hasWalk = targetNode.connections.some(
      (c) => (c.action === "walk_left" || c.action === "walk_right") && !c.slopePhase
    );
    return hasWalk ? 0.7 : 1.0;
  },

  // ============================================================================
  // GRAPH DATA - Node Query Expressions
  // ============================================================================

  /** Returns the total number of navigation nodes in the graph. */
  aceGetNodeCount() {
    return this._getNavigationGraph().size;
  },

  /** Returns whether a navigation node exists at the given grid coordinates. */
  aceNodeExistsGrid(gx, gy) {
    return !!this.getNode(gx, gy);
  },

  /** Returns whether a navigation node exists at the given world position (converts to grid internally). */
  aceNodeExistsWorld(x, y) {
    const grid = this.worldToGrid(x, y);
    return this.aceNodeExistsGrid(grid.gx, grid.gy);
  },

  /** Returns whether the node at the given grid coordinates is a ledge (left or right edge). */
  aceIsNodeLedge(gx, gy) {
    const node = this.getNode(gx, gy);
    if (!node) return false;
    return node.isLeftLedge || node.isRightLedge;
  },

  /** Returns the world X position of the node at the given grid coordinates. Returns 0 if not found. */
  aceGetNodeWorldX(gx, gy) {
    const node = this.getNode(gx, gy);
    return node ? node.x : 0;
  },

  /** Returns the world Y position of the node at the given grid coordinates. Returns 0 if not found. */
  aceGetNodeWorldY(gx, gy) {
    const node = this.getNode(gx, gy);
    return node ? node.y : 0;
  },

  /** Returns the world X position of the nearest navigation node to the given world position. Returns -1 if no nodes. */
  aceGetNearestNodeX(x, y) {
    const node = this._findNearestNode(x, y);
    return node ? node.x : -1;
  },

  /** Returns the world Y position of the nearest navigation node to the given world position. Returns -1 if no nodes. */
  aceGetNearestNodeY(x, y) {
    const node = this._findNearestNode(x, y);
    return node ? node.y : -1;
  },

  /** Returns the grid X coordinate of the nearest navigation node to the given world position. Returns -1 if no nodes. */
  aceGetNearestNodeGridX(x, y) {
    const node = this._findNearestNode(x, y);
    return node ? node.gx : -1;
  },

  /** Returns the grid Y coordinate of the nearest navigation node to the given world position. Returns -1 if no nodes. */
  aceGetNearestNodeGridY(x, y) {
    const node = this._findNearestNode(x, y);
    return node ? node.gy : -1;
  },

  /** Returns the total number of connections (walk, jump, portal) from a node at the given grid position. */
  aceGetNodeConnectionCount(gx, gy) {
    const node = this.getNode(gx, gy);
    if (!node) return 0;
    return node.connections.length + node.portalConnections.length;
  },

  /** Returns the world X of the target node for a specific connection from the node at (gx, gy). Returns -1 if invalid. */
  aceGetNodeConnectionTargetX(gx, gy, index) {
    const conn = this._getConnectionAtIndex(gx, gy, index);
    return conn ? conn.target.x : -1;
  },

  /** Returns the world Y of the target node for a specific connection from the node at (gx, gy). Returns -1 if invalid. */
  aceGetNodeConnectionTargetY(gx, gy, index) {
    const conn = this._getConnectionAtIndex(gx, gy, index);
    return conn ? conn.target.y : -1;
  },

  /** Gets the action type string for a specific connection from a node. Returns actions like 'walk_left', 'jump', 'fall_right', 'portal_instant', etc. */
  aceGetNodeConnectionAction(gx, gy, index) {
    const conn = this._getConnectionAtIndex(gx, gy, index);
    return conn ? conn.action : "";
  },

  /** Returns the traversal cost of a specific connection from a node. Returns -1 if invalid. */
  aceGetNodeConnectionCost(gx, gy, index) {
    const conn = this._getConnectionAtIndex(gx, gy, index);
    return conn ? conn.cost : -1;
  },

  /** Helper to retrieve a connection by index from a node's combined connection arrays (walk + portal). */
  _getConnectionAtIndex(gx, gy, index) {
    const node = this.getNode(gx, gy);
    if (!node) return null;
    const all = [
      ...node.connections,
      ...node.portalConnections,
    ];
    return index >= 0 && index < all.length ? all[index] : null;
  },

  /** Returns 1 if the node at (gx, gy) is a left ledge, 0 otherwise. */
  aceIsNodeLeftLedge(gx, gy) {
    const node = this.getNode(gx, gy);
    return node ? (node.isLeftLedge ? 1 : 0) : 0;
  },

  /** Returns 1 if the node at (gx, gy) is a right ledge, 0 otherwise. */
  aceIsNodeRightLedge(gx, gy) {
    const node = this.getNode(gx, gy);
    return node ? (node.isRightLedge ? 1 : 0) : 0;
  },

  /** Returns 1 if the node at (gx, gy) is an island (single isolated tile), 0 otherwise. */
  aceIsNodeIsland(gx, gy) {
    const node = this.getNode(gx, gy);
    return node ? (node.isIsland ? 1 : 0) : 0;
  },

  /** Returns 1 if the tile at (gx, gy) is a jump-thru platform, 0 otherwise. */
  aceIsTileJumpThru(gx, gy) {
    return this.isCellJumpThru(gx, gy) ? 1 : 0;
  },

  // ============================================================================
  // GRAPH DATA - Node Iteration Expressions (by index)
  // ============================================================================

  /** Returns the world X position of the node at the given index in the flat node array. Returns -1 if out of bounds. */
  aceGetNodeAtIndexX(index) {
    return index >= 0 && index < this.nodeIndexArray.length
      ? this.nodeIndexArray[index].x
      : -1;
  },

  /** Returns the world Y position of the node at the given index in the flat node array. Returns -1 if out of bounds. */
  aceGetNodeAtIndexY(index) {
    return index >= 0 && index < this.nodeIndexArray.length
      ? this.nodeIndexArray[index].y
      : -1;
  },

  /** Returns the grid X coordinate of the node at the given index. Returns -1 if out of bounds. */
  aceGetNodeAtIndexGridX(index) {
    return index >= 0 && index < this.nodeIndexArray.length
      ? this.nodeIndexArray[index].gx
      : -1;
  },

  /** Returns the grid Y coordinate of the node at the given index. Returns -1 if out of bounds. */
  aceGetNodeAtIndexGridY(index) {
    return index >= 0 && index < this.nodeIndexArray.length
      ? this.nodeIndexArray[index].gy
      : -1;
  },

  /** Returns 1 if the node at the given index is a left ledge, 0 otherwise. */
  aceGetNodeAtIndexIsLeftLedge(index) {
    return index >= 0 && index < this.nodeIndexArray.length
      ? this.nodeIndexArray[index].isLeftLedge
        ? 1
        : 0
      : 0;
  },

  /** Returns 1 if the node at the given index is a right ledge, 0 otherwise. */
  aceGetNodeAtIndexIsRightLedge(index) {
    return index >= 0 && index < this.nodeIndexArray.length
      ? this.nodeIndexArray[index].isRightLedge
        ? 1
        : 0
      : 0;
  },

  /** Returns 1 if the node at the given index is on a slope, 0 otherwise. */
  aceGetNodeAtIndexIsSlope(index) {
    return index >= 0 && index < this.nodeIndexArray.length
      ? this.nodeIndexArray[index].isSlope
        ? 1
        : 0
      : 0;
  },

  /** Returns the total number of connections for the node at the given index. */
  aceGetNodeAtIndexConnectionCount(index) {
    if (index < 0 || index >= this.nodeIndexArray.length) return 0;
    const n = this.nodeIndexArray[index];
    return n.connections.length + n.portalConnections.length;
  },

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
  },
};
