import { globalNavManager } from "./navigationManager.js";

// Graph construction: node generation, connection builders (walk/jump/fall/
// coyote/fall-through/slope), the incremental (chunked) build state machine,
// and graph node query expressions.
// Mixed into the instance class prototype — `this` is the behavior instance.
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

  /** Cancels any in-progress build, then starts a fresh one and runs the first
   *  budgeted slice. Used where a rebuild is requested mid-game (slope
   *  registration, Pathfinding map ready, etc.). */
  _restartGraphBuild() {
    this._cancelGraphBuild();
    if (!this._startGraphBuild()) return;
    this._stepGraphBuild(this.GRAPH_BUILD_BUDGET_MS);
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
    if (this.isWaitingForPathfindingMap) return false;

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
    const nodes = this.nodeIndexArray;

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
    this._connectAllPortals();
    this._updateHazardCosts();

    this._markGraphAsGenerated();

    // Record what this graph was built with: capabilities let late joiners
    // trigger a rebuild (double jump), and the physics numbers power the
    // mismatch warning for characters that should be on their own Map Tag.
    globalNavManager.setGraphCapabilities(this.navKey, {
      doubleJump: this.platformProps.isDoubleJumpEnabled,
      maxJumpHeight: this.maxJumpHeight,
      maxJumpDistance: this.maxJumpDistance,
    });
    this._syncMapStateToSubscribers();

    this._graphBuild = null;
    globalNavManager.releaseBuild(this.navKey, this);

    const wallMs = performance.now() - build.startTime;
    this._log(`Graph generated: ${build.workMs.toFixed(2)}ms of work over ${build.ticks} tick(s) (${wallMs.toFixed(2)}ms wall)`);

    // this makes sure the trigger condition is called once the graph is generated.
    this._trigger("OnGraphGenerated");
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
    // Cap downward range: a jump arc goes UP peakHeight then descends back.
    // From launch, you land at most ~maxHeightCells below via the arc itself.
    // Targets further below should use fall connections from ledge nodes.
    // Old formula (maxHeightCells*2+2) allowed 10-tile shortcuts when maxHeightCells=4.
    const maxDownCells = Math.min(maxFallCells, maxHeightCells + 2);
    let count = 0;

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

  /** Creates walk connections along slope tiles for one slope node, linking diagonally
   *  adjacent slope/flat nodes based on slope direction. Supports 45° (1:1) and 22.5°
   *  (2:1) gentle slopes. Also adds reverse connections on non-slope neighbors so flat
   *  nodes have a walk entry onto the slope. */
  _connectSlopeForNode(node) {
    if (!node.isSlope) return 0;

    let count = 0;
    // Slope edge costs must be >= Euclidean distance so the A* heuristic stays consistent.
    // sqrt(2)*cellSize for 45° diagonals, sqrt(5)*cellSize for gentle diagonals.
    const slopeDiagCost = Math.SQRT2 * this.cellSize * this.SLOPE_COST;       // 45° (1:1)
    const gentleDiagCost = Math.sqrt(5) * this.cellSize * this.SLOPE_COST;    // 22.5° (2:1)
    const midSlopeCost = this.cellSize * this.SLOPE_COST;                      // horizontal mid-slope

    const dir = node.slopeDirection;

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
      // Horizontal mid-slope connections (skip if the walk phase already created this link)
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
      // Horizontal mid-slope connections (skip if the walk phase already created this link)
      const midLeft = this.getNode(node.gx - 1, node.gy);
      const midRight = this.getNode(node.gx + 1, node.gy);
      if (midLeft && midLeft.isSlope && !node.connections.some(c => c.target === midLeft && c.action === "walk_left")) {
        node.connections.push({ target: midLeft, action: "walk_left", cost: midSlopeCost }); count++;
      }
      if (midRight && midRight.isSlope && !node.connections.some(c => c.target === midRight && c.action === "walk_right")) {
        node.connections.push({ target: midRight, action: "walk_right", cost: midSlopeCost }); count++;
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
  },

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
  },

  // Prefer falling onto nodes that have walk connections — makes reverse
  // pathing produce paths that are easier to climb upward from.
  _fallLandingCostMultiplier(targetNode) {
    const hasWalk = targetNode.connections.some(
      (c) => c.action === "walk_left" || c.action === "walk_right"
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

  /** Returns whether the navigation graph has been generated and is ready for pathfinding. */
  aceIsGraphGenerated() {
    return this.graphGenerated;
  },

  /** Returns whether a navigation node exists at the given grid coordinates. */
  aceNodeExistsGrid(gx, gy) {
    const graph = this._getNavigationGraph();
    return graph.has(this.gridKey(gx, gy));
  },

  /** Returns whether a navigation node exists at the given world position (converts to grid internally). */
  aceNodeExistsWorld(x, y) {
    const grid = this.worldToGrid(x, y);
    return this.aceNodeExistsGrid(grid.gx, grid.gy);
  },

  /** Returns whether the node at the given grid coordinates is a ledge (left or right edge). */
  aceIsNodeLedge(gx, gy) {
    const graph = this._getNavigationGraph();
    const node = graph.get(this.gridKey(gx, gy));
    if (!node) return false;
    return node.isLeftLedge || node.isRightLedge;
  },

  /** Returns the world X position of the node at the given grid coordinates. Returns 0 if not found. */
  aceGetNodeWorldX(gx, gy) {
    const graph = this._getNavigationGraph();
    const node = graph.get(this.gridKey(gx, gy));
    return node ? node.x : 0;
  },

  /** Returns the world Y position of the node at the given grid coordinates. Returns 0 if not found. */
  aceGetNodeWorldY(gx, gy) {
    const graph = this._getNavigationGraph();
    const node = graph.get(this.gridKey(gx, gy));
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
