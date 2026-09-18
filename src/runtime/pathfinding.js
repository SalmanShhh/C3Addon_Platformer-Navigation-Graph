import { globalNavManager, BinaryHeap } from "./navigationManager.js";

// Pathfinding: bidirectional A*, path validation/combination/smoothing, the
// FindPath ACE entry points, and path data expressions.
// Mixed into the instance class prototype — `this` is the behavior instance.
export default {
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
          { x: startNode.x, y: startNode.y, node: startNode, action: "start", requiresDoubleJump: false, requiresMomentum: false, peakHeight: 0 },
          { x: goalNode.x, y: goalNode.y, node: goalNode, action, requiresDoubleJump: false, requiresMomentum: false, peakHeight: 0 }
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
      const _fmtPath = (p) => p.map((wp, i) => `${i}:(${wp.node ? wp.node.gx : '?'},${wp.node ? wp.node.gy : '?'})${wp.action}${wp.requiresDoubleJump ? '[dbl]' : ''}${wp.requiresMomentum ? '[mom]' : ''}`).join(' → ');
      this._log(`Using forward path only (no valid reverse)`);
      this._log(`  Path: ${_fmtPath(validForward)}`);
      bestPath = validForward;
    } else if (validReversed) {
      const _fmtPath = (p) => p.map((wp, i) => `${i}:(${wp.node ? wp.node.gx : '?'},${wp.node ? wp.node.gy : '?'})${wp.action}${wp.requiresDoubleJump ? '[dbl]' : ''}${wp.requiresMomentum ? '[mom]' : ''}`).join(' → ');
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
  },

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
      node.parentPeakHeight = 0;
      node.parentRequiresDoubleJump = false;
      node.parentRequiresMomentum = false;
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
      ? globalNavManager.getAgentSpatialHash(this.navKey, this.cellSize) : null;

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
          conn.cost * hazardMultiplier * agentAvoidanceCost *
            this._strategyEdgeFactor(
              conn.action, conn.target.y - current.y, conn.cost, conn.requiresMomentum
            ) +
          this._strategyEdgePenalty(conn.action);

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
          neighbor.parentRequiresMomentum = conn.requiresMomentum || false;
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
  },

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
      reversed[i + 1].requiresMomentum = conn.requiresMomentum || false;
    }
    reversed[0].action = "start";
    return reversed;
  },

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
        path[i + 1].requiresMomentum = conn.requiresMomentum || false;
      }
    }
    return path;
  },

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
  },

  /** Sums up the Euclidean distance cost of all segments in a path. */
  _pathCost(path) {
    let cost = 0;
    for (let i = 1; i < path.length; i++) {
      cost += this.distance(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
    }
    return cost;
  },

  /** Safest strategy: extra multiplier (>= 1.0) applied to a fall connection's
   *  cost based on how FAR DOWN it goes. Per-pixel pricing alone makes one
   *  6-tile drop cost the same as three 2-tile drops, so Safest had no reason
   *  to step down via intermediate ledges. Used identically by the A* search
   *  (_strategyEdgeFactor) and candidate selection (_strategyCost).
   *  dropPx: vertical drop of the connection in pixels (<= 0 means not a drop). */
  /** Flat per-connection cost added during the A* search, by strategy.
   *  Shortest: a stop penalty on each jump — every landing costs real time
   *  (brake, re-center, re-launch), so one long jump beats a chain of short
   *  hops covering the same pixels. This is what makes "Shortest Distance"
   *  behave like "fastest route" and actually use momentum skip-jumps.
   *  Simplest (Ground-Hugging): big flat fees on airborne actions — walking
   *  is free, so the AI stays on the ground and only jumps or falls when no
   *  walking route exists at all. */
  _strategyEdgePenalty(action) {
    if (this.pathStrategy === "simplest") {
      if (action === "jump" || action === "coyote_jump") return this.cellSize * 10;
      if (action.includes("fall")) return this.cellSize * 4;
      return 0;
    }
    if (
      this.pathStrategy === "shortest" &&
      (action === "jump" || action === "coyote_jump")
    )
      return this.cellSize * 2;
    return 0;
  },

  /** Safest strategy: extra multiplier (>= 1.0) on a JUMP connection's cost
   *  based on its length. Per-pixel pricing makes one long leap cost the same
   *  as two short hops covering the same distance, so Safest had no reason to
   *  prefer stepping-stone chains. Quadratic growth (reference: 4 tiles) makes
   *  long leaps genuinely expensive; capped so an unavoidable big jump cannot
   *  dominate the whole path cost. */
  _safestJumpRiskMultiplier(distPx) {
    if (distPx <= 0) return 1.0;
    const ref = distPx / (this.cellSize * 4);
    return Math.min(6, 1 + ref * ref);
  },

  _safestFallRiskMultiplier(dropPx) {
    if (dropPx <= 0) return 1.0;
    // Linear risk growth with a 3-tile reference drop: a 3-tile fall costs
    // 2x per pixel, 6 tiles 3x, and so on, capped at 5x so an unavoidable
    // huge drop can't dominate every other cost in the path. Linear (rather
    // than quadratic) keeps Safest cautious without making it refuse
    // reasonable drops entirely.
    return Math.min(5, 1 + dropPx / (this.cellSize * 3));
  },

  /** Per-connection cost factor applied DURING the A* search so the search
   *  itself follows the active strategy, not just the final pick among the
   *  forward/reverse/hybrid candidates. Without this, all strategies return
   *  identical paths whenever both searches converge on the same route (the
   *  common case), because baked connection costs always encode the balanced
   *  weighting (WALK 1.0 / JUMP 1.5 / FALL 0.5 / COYOTE 1.6 per pixel).
   *  Factors rescale relative to that baked baseline; costs only ever grow or
   *  shrink proportionally, so the distance heuristic stays admissible. */
  _strategyEdgeFactor(action, dropPx, rawCost, isMomentum) {
    switch (this.pathStrategy) {
      case "shortest":
        // Undo the action weighting AND the momentum premium — optimize raw
        // travel plus the per-jump stop penalty added at the relaxation site.
        // Without dropping the 1.25 premium, a skip-jump's raw distance ties
        // the hop chain it replaces (colinear stones), and the premium makes
        // it always lose — Shortest could never skip stones.
        if (action === "jump")
          return 1 / (this.JUMP_COST * (isMomentum ? 1.25 : 1));
        if (action === "coyote_jump") return 1 / this.COYOTE_JUMP_COST;
        if (action.includes("fall")) return 1 / this.FALL_COST;
        return 1.0;
      case "safest":
        // Rescale to the safest weights (jump 2.5, fall 1.5 per pixel),
        // matching _strategyCost's candidate weighting. Falls additionally
        // scale with drop height and jumps with jump length, so chained short
        // moves beat single long ones. Jump distance is recovered from the
        // baked cost (cost = distance × action constant).
        if (action === "jump")
          return (2.5 / this.JUMP_COST) *
            this._safestJumpRiskMultiplier((rawCost || 0) / this.JUMP_COST);
        if (action === "coyote_jump")
          return (2.5 / this.COYOTE_JUMP_COST) *
            this._safestJumpRiskMultiplier((rawCost || 0) / this.COYOTE_JUMP_COST);
        if (action.includes("fall"))
          return (1.5 / this.FALL_COST) * this._safestFallRiskMultiplier(dropPx || 0);
        return 1.0;
      case "simplest":
        // Ground-Hugging: walking is the baseline, airborne pixels are
        // expensive (jumps 4x, falls 2x per pixel; flat fees come from
        // _strategyEdgePenalty). The AI walks long detours before it jumps,
        // but still jumps when the map leaves no walking route.
        if (action === "jump") return 4 / this.JUMP_COST;
        if (action === "coyote_jump") return 4 / this.COYOTE_JUMP_COST;
        if (action.includes("fall")) return 2 / this.FALL_COST;
        return 1.0;
      default:
        // balanced uses the baked costs as-is.
        return 1.0;
    }
  },

  /** Evaluates a path's cost using the active strategy (balanced, shortest, safest, or simplest). */
  _strategyCost(path) {
    switch (this.pathStrategy) {
      case "shortest": {
        // Match the search: raw distance plus the per-jump stop penalty.
        let cost = 0;
        for (let i = 1; i < path.length; i++) {
          cost += this.distance(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
          if (path[i].action === "jump" || path[i].action === "coyote_jump")
            cost += this.cellSize * 2;
        }
        return cost;
      }

      case "safest": {
        let cost = 0;
        for (let i = 1; i < path.length; i++) {
          const dist = this.distance(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
          const action = path[i].action;
          if (action === "jump" || action === "coyote_jump")
            cost += dist * 2.5 * this._safestJumpRiskMultiplier(dist);
          else if (action.includes("fall"))
            cost += dist * 1.5 *
              this._safestFallRiskMultiplier(path[i].y - path[i - 1].y);
          else
            cost += dist * 1.0;
        }
        return cost;
      }

      case "simplest": {
        // Ground-Hugging: match the search weights (walk 1x; jump 4x + 10
        // tiles flat; fall 2x + 4 tiles flat).
        let cost = 0;
        for (let i = 1; i < path.length; i++) {
          const dist = this.distance(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
          const action = path[i].action;
          if (action === "jump" || action === "coyote_jump")
            cost += dist * 4 + this.cellSize * 10;
          else if (action.includes("fall"))
            cost += dist * 2 + this.cellSize * 4;
          else
            cost += dist;
        }
        return cost;
      }

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
  },

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
          hybrid1[fwdIdx].requiresMomentum = conn.requiresMomentum || false;
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
          hybrid2[revIdx].requiresMomentum = conn.requiresMomentum || false;
        }
      }
      const cost2 = this._strategyCost(hybrid2);
      if (cost2 < bestCost) {
        bestCost = cost2;
        bestPath = hybrid2;
      }
    }

    const _fmtPath = (p) => p.map((wp, i) => `${i}:(${wp.node ? wp.node.gx : '?'},${wp.node ? wp.node.gy : '?'})${wp.action}${wp.requiresDoubleJump ? '[dbl]' : ''}${wp.requiresMomentum ? '[mom]' : ''}`).join(' → ');
    this._log(`Combined path: cost=${Math.round(bestCost)} (fwd=${Math.round(forwardCost)}, rev=${Math.round(reverseCost)}, strategy=${this.pathStrategy})`);
    this._log(`  Forward path:  ${_fmtPath(forwardPath)}`);
    this._log(`  Reversed path: ${_fmtPath(reversedPath)}`);
    this._log(`  Selected path: ${_fmtPath(bestPath)}`);
    return bestPath;
  },

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
        requiresMomentum: current.parentRequiresMomentum || false,
        x: current.x,
        y: current.y,
      });
      current = current.parent;
    }

    return path;
  },

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
  },

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
  },

  /** For "nearest" mode: finds the closest node to the goal that is actually reachable from the start. */
  _findNearestReachableNode(startX, startY, goalX, goalY) {
    const goalGrid = this.worldToGrid(goalX, goalY);
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
  },

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
  },

  // ============================================================================
  // PATHFINDING - Core Actions
  // ============================================================================

  /** Simple FindPath: sensible defaults (ground correction on, "nearest" mode so it
   *  never fails outright, jump positioning from the property). */
  aceFindPathTo(x, y) {
    this.aceFindPath(x, y, true, "nearest", "default");
  },

  /** Simple FindPath to another object's position (first picked instance). */
  aceFindPathToObject(objectClass) {
    const inst = objectClass ? objectClass.getFirstPickedInstance() : null;
    if (!inst) {
      this._warn("Find path to object: no picked instance found");
      return;
    }
    this.aceFindPath(inst.x, inst.y, true, "nearest", "default");
  },

  /** Calculates a path from the character's current position to the target coordinates. Supports ground correction and jump-toward mode. */
  aceFindPath(targetX, targetY, correctToGround, mode, strict, isRePath) {
    if (!this.navEnabled) {
      this._log("FindPath ignored: behavior is disabled");
      return false;
    }
    // A chunked graph build may still be in progress — finish it synchronously
    // so pathfinding always sees the complete graph.
    if (this._graphBuild) {
      this._finishGraphBuildNow();
    } else {
      globalNavManager.finishBuildFor(this.navKey);
    }
    // Hazards changed this tick? Re-bake node costs before searching
    this._applyHazardCostsIfDirty();

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
      this._wpWasAirborne = false;
      this._arcTraceState = 0;
      this._momentumArmed = false;

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
  },

  /** Clears the current path and resets all path-following state (waypoint index, jump phase, etc.). */
  aceClearPath() {
    this.hasPath = false;
    this.currentPath = [];
    this.currentWaypoint = 0;
    this.doubleJumpPhase = 0;
    this.isHoldingJump = false;
    this.departureCommitted = false;
    this.coyoteJumpPending = false;
    this._wpWasAirborne = false;
    this._arcTraceState = 0;
    this._momentumArmed = false;
    // Reset portal state
    if (this.portalState === "traversing" && this.platformBehavior && this.platformWasEnabled) {
      this.platformBehavior.isEnabled = true;
    }
    this.portalState = "none";
    this.portalPaused = false;
    this.portalCurrentWaypoint = null;
  },

  /** Stops movement along the current path without clearing the path data. */
  aceStopMovement() {
    this.hasPath = false;
    this.departureCommitted = false;
  },

  /** Stops pathfinding entirely by clearing the path and stopping movement. */
  aceStopPathfinding() {
    globalNavManager.removeQueuedRequest(this);
    this.aceClearPath();
    this.aceStopMovement();
  },

  /** Marks the navigation graph as needing regeneration on the next tick. */
  aceRegenerateGraph() {
    this._cancelGraphBuild();
    this.graphGenerated = false;
  },

  /** Sets the path selection strategy: "balanced", "shortest", "safest", or "simplest". */
  aceSetPathStrategy(strategy) {
    this.pathStrategy = strategy;
  },

  /** Returns the active path selection strategy name. */
  aceGetPathStrategy() {
    return this.pathStrategy;
  },

  /** Sets the maximum number of path calculations per tick (0 = unlimited). */
  aceSetMaxPathsPerTick(count) {
    globalNavManager.maxPathsPerTick = Math.max(0, Math.floor(count));
  },

  /** Returns the current max paths per tick limit. */
  aceGetMaxPathsPerTick() {
    return globalNavManager.maxPathsPerTick;
  },

  /** Returns the number of path requests waiting in the queue. */
  aceGetPathQueueSize() {
    return globalNavManager.pathQueue.length;
  },

  /** Returns whether the character currently has an active path to follow. */
  aceHasPath() {
    return this.hasPath;
  },

  // ============================================================================
  // PATH DATA - Current Path Expressions
  // ============================================================================

  /** Returns the total number of waypoints in the current active path. Returns 0 if no path exists. */
  aceGetWaypointCount() {
    return this.currentPath.length;
  },

  /** Returns the index of the current waypoint the character is moving toward. */
  aceGetCurrentWaypoint() {
    return this.currentWaypoint;
  },

  /** Returns the world X position of the current waypoint. Returns 0 if no path or waypoint is invalid. */
  aceGetCurrentWaypointX() {
    if (!this.hasPath || this.currentWaypoint >= this.currentPath.length) return 0;
    return this.currentPath[this.currentWaypoint].x;
  },

  /** Returns the world Y position of the current waypoint. Returns 0 if no path or waypoint is invalid. */
  aceGetCurrentWaypointY() {
    if (!this.hasPath || this.currentWaypoint >= this.currentPath.length) return 0;
    return this.currentPath[this.currentWaypoint].y;
  },

  /** Returns the world X position of the waypoint at the given index. */
  aceGetWaypointX(index) {
    if (!this.currentPath || index < 0 || index >= this.currentPath.length) return 0;
    return this.currentPath[index].x;
  },

  /** Returns the world Y position of the waypoint at the given index. */
  aceGetWaypointY(index) {
    if (!this.currentPath || index < 0 || index >= this.currentPath.length) return 0;
    return this.currentPath[index].y;
  },

  /** Returns the grid X coordinate of the waypoint at the given index. */
  aceGetWaypointGridX(index) {
    if (!this.currentPath || index < 0 || index >= this.currentPath.length) return 0;
    return this.currentPath[index].node ? this.currentPath[index].node.gx : 0;
  },

  /** Returns the grid Y coordinate of the waypoint at the given index. */
  aceGetWaypointGridY(index) {
    if (!this.currentPath || index < 0 || index >= this.currentPath.length) return 0;
    return this.currentPath[index].node ? this.currentPath[index].node.gy : 0;
  },

  /** Gets the action type string for a waypoint at the given index. Returns actions like 'walk_left', 'jump', 'fall_right', etc. */
  aceGetCurrentPathAction(index) {
    if (
      !this.hasPath ||
      index < 0 ||
      index >= this.currentPath.length
    )
      return "";
    return this.currentPath[index].action || "";
  },

  /** Returns the reason the last pathfinding attempt failed. Empty string if succeeded. */
  aceGetPathFailReason() {
    return this.lastPathFailReason;
  },

  /** Returns the total estimated cost of the current path (sum of distances between waypoints). */
  aceGetPathCost() {
    return this.lastPathCost;
  },

  /** Returns the angle in degrees from the character to the current waypoint. */
  aceGetAngleToWaypoint() {
    if (!this.hasPath || this.currentWaypoint >= this.currentPath.length)
      return 0;
    const wp = this.currentPath[this.currentWaypoint];
    return (
      (Math.atan2(wp.y - this.instance.y, wp.x - this.instance.x) * 180) /
      Math.PI
    );
  },

  /** Returns the pixel distance from the character to the current waypoint. */
  aceGetDistanceToWaypoint() {
    if (!this.hasPath || this.currentWaypoint >= this.currentPath.length)
      return 0;
    const wp = this.currentPath[this.currentWaypoint];
    return this.distance(this.instance.x, this.instance.y, wp.x, wp.y);
  },

  /** Returns the world X of the calculated path's final position (the last
   *  waypoint — where the character will actually end up, which in Nearest
   *  mode can differ from the requested target). 0 if no path calculated. */
  aceGetPathEndX() {
    const path = this.currentPath;
    return path.length > 0 ? path[path.length - 1].x : 0;
  },

  /** Returns the world Y of the calculated path's final position. See aceGetPathEndX. */
  aceGetPathEndY() {
    const path = this.currentPath;
    return path.length > 0 ? path[path.length - 1].y : 0;
  },

  /** Returns the world X of the requested path target (as passed to Find path). */
  aceGetTargetX() {
    return this.pathTargetX;
  },

  /** Returns the world Y of the requested path target (as passed to Find path). */
  aceGetTargetY() {
    return this.pathTargetY;
  },

  /** Returns the grid X coordinate of the path target (after ground correction). */
  aceGetTargetGridX() {
    return this.pathTargetGridX;
  },

  /** Returns the grid Y coordinate of the path target (after ground correction). */
  aceGetTargetGridY() {
    return this.pathTargetGridY;
  },
};
