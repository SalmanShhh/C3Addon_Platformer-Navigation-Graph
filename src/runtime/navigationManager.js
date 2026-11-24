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
    this._budgetTick = -1; // runtime.tickCount the counter belongs to

    // Spatial hashes for multi-agent avoidance, per nav key. Multiple maps can
    // be active on the same tick (different tags), so a single cached hash
    // would leak agents between maps.
    this._agentSpatialHashes = new Map(); // navKey → { hash, tick }

    // Graph Manager: shared agent params
    this.sharedAgentParams = new Map();   // navKey → { maxJumpHeight, ... }

    // Incremental (chunked) graph builds: navKey → owning instance
    this.buildOwners = new Map();

    // navKey -> remembered slope registrations ({kind:"ids"|"auto", cls, sets?})
    // re-applied whenever the obstacle map is rebuilt from objects. Survives
    // unsubscribe like portals/hazards; dropped at layout end.
    this.slopeRules = new Map();

    // navKey -> how the obstacle map was built from objects, so it can be
    // rebuilt the same way: { allSolids, width, height, scans: [{cls, value}] }.
    // Absent for custom / JSON maps. Dropped at layout end.
    this.scanRules = new Map();

    // navKey -> moving-solid watcher state (movingPlatforms.js). Dropped at layout end.
    this.movers = new Map();

    // navKey -> count of completed graph builds (lets watchers re-place ride
    // links after every rebuild)
    this.graphVersion = new Map();

    // navKey -> time-sliced scan job (obstacleMap.js _startScanJob)
    this.scanJobs = new Map();
    // navKey -> pending regional graph patch: a LIST of cell rects {x, y, w, h}
    // (separate areas stay separate; overlapping ones merge)
    this.pendingPatches = new Map();
    // navKey -> physics signature the current graph was fully built with
    // (graphBuild.js _physicsSignature); regional patches must match it
    this.graphBuildParams = new Map();

    // objectType -> whether instances of it can be Solid / Jump-thru obstacles
    // (cached so the instancecreate hook costs one Map lookup per creation)
    this._obstacleTypeVerdict = new Map();
    this._instanceHooked = false;

    // The project's Multiplayer object (IMultiplayerObjectType), looked up once:
    // undefined = not looked up yet, null = the project has none.
    this._multiplayerObject = undefined;

    // Maps whose baked node hazard costs are stale (hazards added/removed/
    // changed since the last _updateHazardCosts). Applied lazily before the
    // next tick's path following or the next A* search.
    this.hazardCostsDirty = new Set(); // of navKey
    // Maps where some nodes touch a standing hazard (node.isHazard), which no
    // character may enter: searches there treat targets past a hazard as
    // routinely unreachable (Nearest uses the legal-moves flood).
    this.hazardBlockedMaps = new Set(); // of navKey

    // Global hazard ID counter. Hazard maps are shared per nav key, so a
    // per-instance counter would let two instances allocate the same ID and
    // silently overwrite each other's hazards.
    this.nextHazardId = 1;
    // Portal IDs are global for the same reason: per-instance counters
    // collided in shared maps (a second instance's portal 1 overwrote the
    // first's, leaving its graph edges resolving to the wrong record).
    this.nextPortalId = 1;

    // Portal, hazard, and elevator-group records per map. These used to live
    // on the first subscriber's own Maps, so destroying that one instance
    // wiped every portal and hazard on the map (its graph edges kept pointing
    // at the vanished IDs) and elevator stops were private to whichever
    // instance added them. Their lifetime follows the LAYOUT, not the
    // subscriber count: a wave game whose characters all die between waves
    // keeps its doors and hazards, and a load that fills the stores before the
    // old instances release keeps them too. Dropped on layout end (see
    // hookLayoutEnd), so a restarted layout re-registers from a clean slate.
    this.sharedPortals = new Map();        // navKey → Map<portalId → portal>
    this.sharedHazards = new Map();        // navKey → Map<hazardId → hazard>
    this.sharedElevatorGroups = new Map(); // navKey → Map<groupId → stops[]>

    // Single-flight stamp for the per-tick tracked-hazard update: navKey →
    // gameTime of the last update, so only one instance per map does the work.
    this.trackedUpdateStamp = new Map();
    // navKey -> gameTime of the last object-following portal update (single-flight)
    this.portalUpdateStamp = new Map();

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

  /** Registers (once per runtime) the documented "beforeanylayoutend" runtime
   *  event that drops the ending layout's portal/hazard/elevator stores. Called
   *  from instance initialization and load, the first moments a runtime is
   *  available to the addon. */
  hookLayoutEnd(runtime) {
    if (this._layoutEndHooked || !runtime) return;
    this._layoutEndHooked = true;
    runtime.addEventListener("beforeanylayoutend", () => {
      const layout = runtime.layout;
      if (layout) this.dropMapStoresForLayout(layout.name);
    });
    this.hookInstanceEvents(runtime);
  }

  /** Whether THIS machine is a peer (in a multiplayer room, not the host).
   *
   *  Construct multiplayer is host-authoritative: the host runs the AI and
   *  peers receive synced positions. Navigating on a peer would fight those
   *  synced positions (jitter, snapping back) and waste CPU on graph builds,
   *  so characters pause themselves on peers (see _isPausedAsPeer).
   *
   *  Uses only the documented Multiplayer script interface: the object is
   *  found by its plugin id (whatever the user named it), then isHost and
   *  currentRoom are read. Offline (no room) and projects without a
   *  Multiplayer object count as "not a peer". Construct has no host
   *  migration (peers are kicked when the host leaves), so a peer never
   *  becomes the host. */
  isMultiplayerPeer(runtime) {
    if (this._multiplayerObject === undefined) {
      this._multiplayerObject = null;
      try {
        const objects = runtime.objects;
        for (const key in objects) {
          if (objects[key]?.plugin?.id === "Multiplayer") {
            this._multiplayerObject = objects[key];
            break;
          }
        }
      } catch (e) {}
    }
    const mp = this._multiplayerObject;
    if (!mp) return false;
    try {
      return !!mp.currentRoom && !mp.isHost;
    } catch (e) {
      return false;
    }
  }

  /** Feeds instance creation/destruction of Solid / Jump-thru objects to the
   *  moving-solid watchers (documented runtime events). Non-obstacle types are
   *  rejected with one cached Map lookup, so bullets and particles cost nothing. */
  hookInstanceEvents(runtime) {
    if (this._instanceHooked || !runtime) return;
    this._instanceHooked = true;
    runtime.addEventListener("instancecreate", (e) => {
      if (this.movers.size === 0) return;
      const inst = e.instance;
      if (!inst || !this._isObstacleType(inst)) return;
      for (const st of this.movers.values()) {
        if (st.populated) st.created.push(inst);
      }
    });
    runtime.addEventListener("instancedestroy", (e) => {
      if (this.movers.size === 0) return;
      const inst = e.instance;
      if (!inst) return;
      const uid = inst.uid;
      for (const st of this.movers.values()) {
        if (st.recs.has(uid)) st.destroyed.push(uid);
      }
    });
  }

  /** Whether instances of this object type carry a Solid or Jump-thru
   *  behavior (enabled or not). Cached per object type. */
  _isObstacleType(inst) {
    const type = inst.objectType;
    if (!type) return false;
    let verdict = this._obstacleTypeVerdict.get(type);
    if (verdict === undefined) {
      verdict = false;
      const behaviors = inst.behaviors;
      if (behaviors) {
        for (const key in behaviors) {
          const typeName = behaviors[key]?.behaviorType?.name || key;
          if (typeName === "Solid" || typeName === "Jumpthru" || key === "Solid" || key === "Jumpthru") {
            verdict = true;
            break;
          }
        }
      }
      this._obstacleTypeVerdict.set(type, verdict);
    }
    return verdict;
  }

  /** Drops every map store (all map tags) belonging to one layout. */
  dropMapStoresForLayout(layoutName) {
    const prefix = layoutName + "|";
    for (const stores of [this.sharedPortals, this.sharedHazards, this.sharedElevatorGroups, this.slopeRules,
                          this.scanRules, this.movers, this.graphVersion,
                          this.scanJobs, this.pendingPatches, this.hazardBlockedMaps]) {
      for (const key of stores.keys()) {
        if (key.startsWith(prefix)) stores.delete(key);
      }
    }
  }

  /** Returns (or creates) a nav key's entry in one of the per-map stores. */
  _getMapStore(stores, navKey) {
    let store = stores.get(navKey);
    if (!store) {
      store = new Map();
      stores.set(navKey, store);
    }
    return store;
  }

  /** Returns (or creates) the shared portals Map for a nav key. */
  getSharedPortals(navKey) {
    return this._getMapStore(this.sharedPortals, navKey);
  }

  /** Returns (or creates) the shared hazards Map for a nav key. */
  getSharedHazards(navKey) {
    return this._getMapStore(this.sharedHazards, navKey);
  }

  /** Returns (or creates) the shared elevator-groups Map for a nav key. */
  getSharedElevatorGroups(navKey) {
    return this._getMapStore(this.sharedElevatorGroups, navKey);
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
        this.hazardBlockedMaps.delete(navKey);
        this.trackedUpdateStamp.delete(navKey);
        this.portalUpdateStamp.delete(navKey);
        this.goalClaims.delete(navKey);
        this.scanJobs.delete(navKey);
        this.pendingPatches.delete(navKey);
        this.graphBuildParams.delete(navKey);
        // Portal/hazard/elevator stores deliberately survive: see hookLayoutEnd.
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
      // A discarded request takes its pending side-of-object goal with it:
      // any armed goal belongs to the queued request (the fresh aceFindPath
      // that queued it cleared prior goals), and a stale goal could fire on
      // an unrelated older path's arrival.
      dropped.instance._sideGoalInst = null;
      console.warn("[NavGraph] Path queue full (200), dropping oldest request");
    }
    this.pathQueue.push({ instance, params });
    instance.pathPending = true;
  }

  /** Starts a fresh path budget on each new tick. Keyed by the documented
   *  runtime.tickCount: an exact frame counter that also advances while the
   *  game is paused (time scale 0), unlike gameTime. A wall-clock window
   *  would reset mid-frame whenever the searches themselves took long. */
  _syncPathBudget(runtime) {
    const tick = runtime.tickCount;
    if (tick !== this._budgetTick) {
      this._budgetTick = tick;
      this._pathsThisTick = 0;
    }
  }

  /** Whether a fresh (non-queued) Find path may search now. Counts it when
   *  allowed; when the tick's budget is spent the caller queues instead. */
  takePathBudget(runtime) {
    if (this.maxPathsPerTick === 0) return true;
    this._syncPathBudget(runtime);
    if (this._pathsThisTick >= this.maxPathsPerTick) return false;
    this._pathsThisTick++;
    return true;
  }

  /** Processes queued path requests up to the per-tick budget. */
  processPathQueue(runtime) {
    if (this.pathQueue.length === 0) return;
    this._syncPathBudget(runtime);
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

  /** Removes a queued path request for a specific instance. A removed
   *  request takes its pending side-of-object goal with it (see the drop
   *  comment in queuePathRequest); the goal is cleared only when a request
   *  was actually queued, so an ACTIVE side path's goal survives. */
  removeQueuedRequest(instance) {
    const before = this.pathQueue.length;
    this.pathQueue = this.pathQueue.filter(r => r.instance !== instance);
    if (this.pathQueue.length !== before) instance._sideGoalInst = null;
    instance.pathPending = false;
  }

  /** Clears all queued path requests (called on graph rebuild). */
  clearQueue() {
    for (const req of this.pathQueue) {
      req.instance.pathPending = false;
      req.instance._sideGoalInst = null;
    }
    this.pathQueue = [];
  }

  /** Builds a spatial hash of agent positions once per tick per nav key
   *  (lazy, on first A* query; runtime.tickCount, see _syncPathBudget). Only
   *  agents on the same map avoid each other. */
  getAgentSpatialHash(navKey, cellSize, runtime) {
    const tick = runtime.tickCount;
    const cached = this._agentSpatialHashes.get(navKey);
    if (cached && cached.tick === tick) {
      return cached.hash;
    }
    const hash = new SpatialHash(cellSize * 2);
    const subs = this.subscribers.get(navKey);
    if (subs) {
      for (const inst of subs) {
        if (inst.hasPath) hash.insert(inst.instance.x, inst.instance.y);
      }
    }
    this._agentSpatialHashes.set(navKey, { hash, tick });
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
