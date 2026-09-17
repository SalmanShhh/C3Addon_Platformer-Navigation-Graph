import { globalNavManager } from "./navigationManager.js";

// Hazard system: circle/rect hazard zones, tile hazards, severity queries,
// and per-node hazard cost application.
// Mixed into the instance class prototype — `this` is the behavior instance.
export default {
  /** Marks this map's baked node hazard costs stale. They re-bake lazily
   *  before the next path follow / A* search (coalescing a burst of hazard
   *  changes in one tick into a single O(nodes) update). */
  _markHazardCostsDirty() {
    const navKey = this._getNavKey();
    if (navKey !== null) globalNavManager.hazardCostsDirty.add(navKey);
  },

  /** Re-bakes node hazard costs now if this map is marked stale. */
  _applyHazardCostsIfDirty() {
    const navKey = this._getNavKey();
    if (navKey !== null && globalNavManager.hazardCostsDirty.has(navKey)) {
      globalNavManager.hazardCostsDirty.delete(navKey);
      if (this.graphGenerated) this._updateHazardCosts();
    }
  },

  /** Adds a circular hazard zone and auto-enables hazard avoidance.
   *  The new ID is readable via the LastHazardID expression. */
  aceAddCircleHazard(x, y, radius, severity) {
    this.enableHazards = true;
    const hazardId = globalNavManager.nextHazardId++;
    this.lastHazardId = hazardId;
    const hazardsMap = this._getHazardsMap();
    hazardsMap.set(hazardId, {
      id: hazardId,
      type: "circle",
      x,
      y,
      radius,
      severity,
    });
    this._markHazardCostsDirty();
    return hazardId;
  },

  /** Adds a rectangular hazard zone (x,y = top-left) and auto-enables hazard
   *  avoidance. The new ID is readable via the LastHazardID expression. */
  aceAddRectHazard(x, y, width, height, severity) {
    this.enableHazards = true;
    const hazardId = globalNavManager.nextHazardId++;
    this.lastHazardId = hazardId;
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
    this._markHazardCostsDirty();
    return hazardId;
  },

  /** Registers a moving circular hazard that follows an object's position every
   *  tick, with no per-frame events needed. Costs re-bake only when the object
   *  actually moves (quarter-cell threshold), and the hazard removes itself
   *  when the object is destroyed. ID readable via LastHazardID; RemoveHazard
   *  removes it like any other hazard. */
  aceAddTrackedHazard(objectClass, radius, severity) {
    const inst = objectClass ? objectClass.getFirstPickedInstance() : null;
    if (!inst) {
      this._warn("Add tracked hazard: no picked instance found");
      return;
    }
    this.enableHazards = true;
    const hazardId = globalNavManager.nextHazardId++;
    this.lastHazardId = hazardId;
    this._getHazardsMap().set(hazardId, {
      id: hazardId,
      type: "circle",
      x: inst.x,
      y: inst.y,
      radius,
      severity,
      trackedUid: inst.uid, // documented IInstance.uid; looked up per tick
      bakedX: inst.x,       // position the costs were last baked at
      bakedY: inst.y,
    });
    this._markHazardCostsDirty();
  },

  /** Removes all tracked (object-following) hazards. Static hazards are untouched. */
  aceClearAllTrackedHazards() {
    const hazardsMap = this._getHazardsMap();
    let removed = false;
    for (const [id, hazard] of hazardsMap) {
      if (hazard.trackedUid) {
        hazardsMap.delete(id);
        removed = true;
      }
    }
    if (removed) this._markHazardCostsDirty();
  },

  /** Returns the number of tracked (object-following) hazards. */
  aceGetTrackedHazardCount() {
    let n = 0;
    for (const hazard of this._getHazardsMap().values()) {
      if (hazard.trackedUid) n++;
    }
    return n;
  },

  /** Per-tick tracked-hazard refresh, single-flight per map (gameTime stamp):
   *  updates each tracked hazard's position from its followed object, drops
   *  entries whose object was destroyed (documented getInstanceByUid returns
   *  null), and marks costs dirty only when something moved past the
   *  quarter-cell threshold — so frames where nothing moves cost one Map scan. */
  _updateTrackedHazardsIfOwner() {
    if (!this.enableHazards) return;
    const navKey = this._getNavKey();
    if (navKey === null) return;
    const runtime = this.instance.runtime;
    const now = runtime.gameTime;
    if (globalNavManager.trackedUpdateStamp.get(navKey) === now) return;
    globalNavManager.trackedUpdateStamp.set(navKey, now);

    const hazardsMap = this._getHazardsMap();
    if (hazardsMap.size === 0) return;
    const threshold = this.cellSize * 0.25;
    let dirty = false;
    let toDelete = null;
    for (const [id, hazard] of hazardsMap) {
      if (!hazard.trackedUid) continue;
      const inst = runtime.getInstanceByUid(hazard.trackedUid);
      if (!inst) {
        (toDelete ??= []).push(id);
        dirty = true;
        continue;
      }
      hazard.x = inst.x;
      hazard.y = inst.y;
      if (Math.abs(hazard.x - hazard.bakedX) > threshold ||
          Math.abs(hazard.y - hazard.bakedY) > threshold) {
        hazard.bakedX = hazard.x;
        hazard.bakedY = hazard.y;
        dirty = true;
      }
    }
    if (toDelete) for (const id of toDelete) hazardsMap.delete(id);
    if (dirty) this._markHazardCostsDirty();
  },

  /** Removes a hazard by ID. Node costs re-bake automatically before the next search. */
  aceRemoveHazard(hazardId) {
    const hazardsMap = this._getHazardsMap();
    hazardsMap.delete(hazardId);
    this._markHazardCostsDirty();
  },

  /** Removes all circle/rect hazards (tile hazards are cleared separately). */
  aceClearAllHazards() {
    const hazardsMap = this._getHazardsMap();
    hazardsMap.clear();
    this._markHazardCostsDirty();
  },

  /** Returns true if a world position falls within any registered circle or rect hazard. */
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
  },

  /** Returns the maximum hazard severity at a world position (1.0 = no hazard, higher = more dangerous). */
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
  },

  /** Re-bakes the hazardMultiplier on every node from current hazard zones and
   *  tile hazards. Cost-optimized for MANY hazards: nodes reset in one pass,
   *  then each hazard splats only the cells it can reach, so the total is
   *  O(nodes + summed hazard area) instead of O(nodes × hazards). With 100s of
   *  hazards on a few-thousand-node map this stays well under a millisecond. */
  _updateHazardCosts() {
    if (!this.enableHazards) return;

    const graph = this._getNavigationGraph();
    const cs = this.cellSize;

    for (const node of graph.values()) node.hazardMultiplier = 1.0;

    // Shape hazards: visit only the cells inside each hazard's bounds
    const hazardsMap = this._getHazardsMap();
    for (const hazard of hazardsMap.values()) {
      let left, top, right, bottom;
      if (hazard.type === "circle") {
        left = hazard.x - hazard.radius; right = hazard.x + hazard.radius;
        top = hazard.y - hazard.radius; bottom = hazard.y + hazard.radius;
      } else {
        left = hazard.x; right = hazard.x + hazard.width;
        top = hazard.y; bottom = hazard.y + hazard.height;
      }
      const gx1 = Math.floor(left / cs), gx2 = Math.floor(right / cs);
      const gy1 = Math.floor(top / cs), gy2 = Math.floor(bottom / cs);
      for (let gy = gy1; gy <= gy2; gy++) {
        for (let gx = gx1; gx <= gx2; gx++) {
          const node = this.getNode(gx, gy);
          if (!node || hazard.severity <= node.hazardMultiplier) continue;
          const inside = hazard.type === "circle"
            ? this.distance(node.x, node.y, hazard.x, hazard.y) <= hazard.radius
            : node.x >= hazard.x && node.x <= hazard.x + hazard.width &&
              node.y >= hazard.y && node.y <= hazard.y + hazard.height;
          if (inside) node.hazardMultiplier = hazard.severity;
        }
      }
    }

    // Tile hazards: splat each hazardous tile onto nodes within hazardRadius
    if (this.hazardMap) {
      const r = this.hazardRadius;
      for (let gy = 0; gy < this.gridHeight; gy++) {
        const rowBase = gy * this.gridWidth;
        for (let gx = 0; gx < this.gridWidth; gx++) {
          const tileSeverity = this.hazardMap[rowBase + gx];
          if (tileSeverity <= 0) continue;
          if (r > 0) {
            for (let dy = -r; dy <= r; dy++) {
              for (let dx = -r; dx <= r; dx++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > r) continue;
                const node = this.getNode(gx + dx, gy + dy);
                if (!node) continue;
                const falloff = 1 - dist / (r + 1);
                const effective = 1 + (tileSeverity - 1) * falloff;
                if (effective > node.hazardMultiplier) node.hazardMultiplier = effective;
              }
            }
          } else {
            const node = this.getNode(gx, gy);
            if (node && tileSeverity > node.hazardMultiplier) node.hazardMultiplier = tileSeverity;
          }
        }
      }
    }
  },

  /** Sets the hazard avoidance radius in tiles (how far to steer around hazardous areas). */
  aceSetHazardRadius(tiles) {
    this.hazardRadius = tiles;
    this._markHazardCostsDirty();
  },

  /** Returns whether the given world position falls within a hazardous area. */
  aceIsPositionHazardous(x, y) {
    return this._isPositionHazardous(x, y);
  },

  /** Returns the ID of the most recently added hazard (0 if none added yet). */
  aceGetLastHazardID() {
    return this.lastHazardId;
  },

  /** Returns the total number of registered hazard instances. */
  aceGetHazardCount() {
    return this._getHazardsMap().size;
  },

  /** Returns the hazard severity value at the given world position. */
  aceGetHazardSeverity(x, y) {
    return this._getHazardSeverity(x, y);
  },

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
  },

  /** Returns the configured hazard avoidance radius in tiles. */
  aceGetHazardRadius() {
    return this.hazardRadius;
  },
};
