// Hazard system: circle/rect hazard zones, tile hazards, severity queries,
// and per-node hazard cost application.
// Mixed into the instance class prototype — `this` is the behavior instance.
export default {
  /** Adds a circular hazard zone and auto-enables hazard avoidance. Returns the hazard ID. */
  aceAddCircleHazard(x, y, radius, severity) {
    this.enableHazards = true;
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
  },

  /** Adds a rectangular hazard zone (x,y = top-left) and auto-enables hazard avoidance. Returns the hazard ID. */
  aceAddRectHazard(x, y, width, height, severity) {
    this.enableHazards = true;
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
  },

  /** Removes a hazard by ID. Node costs refresh on the next graph build/hazard update. */
  aceRemoveHazard(hazardId) {
    const hazardsMap = this._getHazardsMap();
    hazardsMap.delete(hazardId);
  },

  /** Removes all circle/rect hazards (tile hazards are cleared separately). */
  aceClearAllHazards() {
    const hazardsMap = this._getHazardsMap();
    hazardsMap.clear();
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

  /** Recalculates the hazardMultiplier on every node in the graph based on current hazard zones and tile hazards. */
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
  },

  /** Sets the hazard avoidance radius in tiles (how far to steer around hazardous areas). */
  aceSetHazardRadius(tiles) {
    this.hazardRadius = tiles;
  },

  /** Returns whether the given world position falls within a hazardous area. */
  aceIsPositionHazardous(x, y) {
    return this._isPositionHazardous(x, y);
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
