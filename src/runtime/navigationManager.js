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

    // Incremental (chunked) graph builds: layoutUID → owning instance
    this.buildOwners = new Map();
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
        this.buildOwners.delete(layoutUID);
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

  /** Claims ownership of an in-progress incremental graph build for a layout. */
  claimBuild(layoutUID, instance) {
    this.buildOwners.set(layoutUID, instance);
  }

  /** Releases build ownership (only if this instance is the current owner). */
  releaseBuild(layoutUID, instance) {
    if (this.buildOwners.get(layoutUID) === instance) {
      this.buildOwners.delete(layoutUID);
    }
  }

  /** Returns true if an incremental graph build is in progress for this layout. */
  isBuildInProgress(layoutUID) {
    return this.buildOwners.has(layoutUID);
  }

  /** Synchronously completes any in-progress incremental build for this layout. */
  finishBuildFor(layoutUID) {
    const owner = this.buildOwners.get(layoutUID);
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

export const globalNavManager = new NavigationManager();
