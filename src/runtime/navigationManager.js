// ===========================
// BinaryHeap (min-heap by fScore)
// A* open set: pop() returns the node with the lowest fScore. A parallel Set
// gives O(1) contains() checks (the heap array alone would be O(n)).
// ===========================
export class BinaryHeap {
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
  /** Removes and returns the node with the lowest fScore. */
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
  /** Re-sorts a node whose fScore changed. A* only ever LOWERS fScore, so
   *  bubbling up is sufficient — no sink-down needed here. */
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
// Buckets agent positions into coarse grid cells so A* can query "agents near
// this node" without scanning every agent. Rebuilt at most once per frame.
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
  /** Returns all stored positions in cells overlapping the given radius.
   *  Coarse (cell-granular) — callers do their own exact distance check. */
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
//
// Shared navigation state is keyed by a "nav key": `layoutName + "|" + mapTag`.
// Instances with the same Map Tag on the same layout share one graph, one set
// of portals/hazards, and one build. The default tag ("") gives layout-wide
// sharing. Every instance goes through the manager (the old Per-Instance graph
// mode was removed in 0.6.0.0 in favor of Map Tags).
// ===========================
class NavigationManager {
  constructor() {
    this.sharedGraphs = new Map();        // navKey → graph Map
    this.subscribers = new Map();         // navKey → Set of instances
    this.graphCapabilities = new Map();   // navKey → { doubleJump: bool }

    // Time-sliced path queue (global across all maps — the budget is per tick,
    // not per map)
    this.pathQueue = [];
    this.maxPathsPerTick = 0; // 0 = unlimited (backward-compatible)
    this._pathsThisTick = 0;
    this._lastResetTime = 0;

    // Spatial hashes for multi-agent avoidance, per nav key. Multiple maps can
    // be active on the same tick (different tags), so a single cached hash
    // would leak agents between maps.
    this._agentSpatialHashes = new Map(); // navKey → { hash, time }

    // Graph Manager: shared agent params
    this.sharedAgentParams = new Map();   // navKey → { maxJumpHeight, ... }

    // Incremental (chunked) graph builds: navKey → owning instance
    this.buildOwners = new Map();

    // Maps whose baked node hazard costs are stale (hazards added/removed/
    // changed since the last _updateHazardCosts). Applied lazily before the
    // next tick's path following or the next A* search.
    this.hazardCostsDirty = new Set(); // of navKey

    // Global hazard ID counter. Hazard maps are shared per nav key, so a
    // per-instance counter would let two instances allocate the same ID and
    // silently overwrite each other's hazards.
    this.nextHazardId = 1;

    // Single-flight stamp for the per-tick tracked-hazard update: navKey →
    // gameTime of the last update, so only one instance per map does the work.
    this.trackedUpdateStamp = new Map();

    // Same-tick dedupe of map-setup actions. Event-sheet actions run once per
    // picked instance, so N picked instances would redo the same setup N times;
    // the first caller claims it and the rest adopt its result.
    this.setupStamps = new Map(); // navKey#action → { time, owner }

    // Crowd arrivals: goal-node claims per map, so agents pathing to the same
    // position tile onto neighboring nodes instead of stacking on one pixel.
    // Keyed by the shared graph's node OBJECTS — cleared on rebuild (new node
    // objects) and scrubbed per instance on unsubscribe.
    this.goalClaims = new Map(); // navKey → Map<node → instance>
  }

  /** Claims a goal node for an instance (releasing its previous claim). */
  claimGoal(navKey, node, instance) {
    this.releaseGoalClaim(instance);
    if (!this.goalClaims.has(navKey)) this.goalClaims.set(navKey, new Map());
    this.goalClaims.get(navKey).set(node, instance);
    instance._claimedGoalNode = node;
    instance._claimedGoalKey = navKey;
  }

  /** Releases an instance's goal claim (no-op when it has none). */
  releaseGoalClaim(instance) {
    const key = instance._claimedGoalKey;
    if (!key) return;
    const claims = this.goalClaims.get(key);
    if (claims && claims.get(instance._claimedGoalNode) === instance) {
      claims.delete(instance._claimedGoalNode);
    }
    instance._claimedGoalNode = null;
    instance._claimedGoalKey = null;
  }

  /** True when the node is claimed by ANOTHER still-subscribed instance.
   *  An agent's own claim never blocks it (re-paths to the same goal). */
  isGoalClaimedByOther(navKey, node, instance) {
    const claims = this.goalClaims.get(navKey);
    if (!claims) return false;
    const owner = claims.get(node);
    if (!owner || owner === instance) return false;
    const subs = this.subscribers.get(navKey);
    if (!subs || !subs.has(owner)) {
      claims.delete(node); // stale claim from a dead instance
      return false;
    }
    return true;
  }

  /** Returns (or creates) the shared navigation graph Map for a nav key. */
  getSharedGraph(navKey) {
    if (!this.sharedGraphs.has(navKey)) {
      this.sharedGraphs.set(navKey, new Map());
    }
    return this.sharedGraphs.get(navKey);
  }

  /** Registers an instance as a subscriber to its nav key's shared graph.
   *  Late joiners (instances spawned after the graph was built) inherit the
   *  existing graph instead of forcing a full rebuild — otherwise every spawn
   *  in a wave would trigger a rebuild storm. The capability-mismatch check in
   *  _needsGraphRegeneration (e.g. double jump) still requests a rebuild when
   *  the new instance genuinely needs connections the graph lacks. */
  subscribe(navKey, instance) {
    if (!this.subscribers.has(navKey)) {
      this.subscribers.set(navKey, new Set());
    }
    this.subscribers.get(navKey).add(instance);
    // graphCapabilities is recorded when a shared build completes, so its
    // presence means a built graph already exists for this nav key.
    if (this.graphCapabilities.has(navKey)) {
      instance.graphGenerated = true;
      // Also adopt the built map's state (grid dims + map references) from an
      // existing subscriber — without gridWidth, gridKey() cannot address the
      // shared graph's nodes, and movement-time map reads would see nothing.
      for (const other of this.subscribers.get(navKey)) {
        if (other !== instance && other.obstacleMap) {
          instance._adoptMapStateFrom(other);
          break;
        }
      }
    }
  }

  /** Removes an instance from its nav key's subscribers; cleans up that map's
   *  state when no subscribers remain. */
  unsubscribe(navKey, instance) {
    this.releaseGoalClaim(instance);
    const subs = this.subscribers.get(navKey);
    if (subs) {
      subs.delete(instance);
      if (subs.size === 0) {
        this.subscribers.delete(navKey);
        this.sharedGraphs.delete(navKey);
        this.graphCapabilities.delete(navKey);
        this.sharedAgentParams.delete(navKey);
        this.buildOwners.delete(navKey);
        this._agentSpatialHashes.delete(navKey);
        this.hazardCostsDirty.delete(navKey);
        this.trackedUpdateStamp.delete(navKey);
        this.goalClaims.delete(navKey);
        for (const key of this.setupStamps.keys()) {
          if (key.startsWith(navKey + "#")) this.setupStamps.delete(key);
        }
      }
    }
  }

  /** Returns all active map tags on a layout (from live subscriber keys).
   *  Used for the debug listing that makes tag typos diagnosable. */
  getActiveTagsForLayout(layoutUID) {
    const prefix = layoutUID + "|";
    const tags = [];
    for (const key of this.subscribers.keys()) {
      if (key.startsWith(prefix)) {
        tags.push(key.slice(prefix.length) || '(default)');
      }
    }
    return tags;
  }

  /** Records the capabilities the graph was built with (e.g. double jump). */
  setGraphCapabilities(navKey, capabilities) {
    this.graphCapabilities.set(navKey, { ...capabilities });
  }

  /** Returns the capabilities the graph was built with, or null if not yet built. */
  getGraphCapabilities(navKey) {
    return this.graphCapabilities.get(navKey) || null;
  }

  /** Sets graphGenerated=true on all subscriber instances for a nav key. */
  markGraphAsGenerated(navKey) {
    const subs = this.subscribers.get(navKey);
    if (subs) {
      for (const inst of subs) {
        inst.graphGenerated = true;
      }
    }
  }

  /** Returns true if any subscriber for this nav key has not yet generated its graph. */
  needsRegeneration(navKey) {
    const subs = this.subscribers.get(navKey);
    if (!subs || subs.size === 0) return false;
    for (const inst of subs) {
      if (!inst.graphGenerated) return true;
    }
    return false;
  }

  /** Claims ownership of an in-progress incremental graph build for a nav key. */
  claimBuild(navKey, instance) {
    this.buildOwners.set(navKey, instance);
  }

  /** Releases build ownership (only if this instance is the current owner). */
  releaseBuild(navKey, instance) {
    if (this.buildOwners.get(navKey) === instance) {
      this.buildOwners.delete(navKey);
    }
  }

  /** Returns true if an incremental graph build is in progress for this nav key. */
  isBuildInProgress(navKey) {
    return this.buildOwners.has(navKey);
  }

  /** Synchronously completes any in-progress incremental build for this nav key. */
  finishBuildFor(navKey) {
    const owner = this.buildOwners.get(navKey);
    if (owner && owner._graphBuild) {
      owner._finishGraphBuildNow();
    }
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

  /** Builds a spatial hash of agent positions once per frame per nav key
   *  (lazy, on first A* query). Only agents on the same map avoid each other. */
  getAgentSpatialHash(navKey, cellSize) {
    const now = performance.now();
    const cached = this._agentSpatialHashes.get(navKey);
    if (cached && now - cached.time <= 1) {
      return cached.hash;
    }
    const hash = new SpatialHash(cellSize * 2);
    const subs = this.subscribers.get(navKey);
    if (subs) {
      for (const inst of subs) {
        if (inst.hasPath) hash.insert(inst.instance.x, inst.instance.y);
      }
    }
    this._agentSpatialHashes.set(navKey, { hash, time: now });
    return hash;
  }

  /** Registers agent parameters (jump/fall/dimensions) from a Platform-bearing instance. */
  registerAgentParams(navKey, params) {
    const existing = this.sharedAgentParams.get(navKey);
    if (!existing || params.maxJumpHeight > existing.maxJumpHeight) {
      this.sharedAgentParams.set(navKey, { ...params });
    }
  }

  /** Returns registered agent parameters for a nav key, or null if none registered. */
  getAgentParams(navKey) {
    return this.sharedAgentParams.get(navKey) || null;
  }

  /** Collects world positions of all other path-following instances on the
   *  same nav key (for multi-agent avoidance). */
  getOtherInstancePositions(navKey, excludeInstance) {
    const positions = [];
    const subs = this.subscribers.get(navKey);
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

export const globalNavManager = new NavigationManager();
