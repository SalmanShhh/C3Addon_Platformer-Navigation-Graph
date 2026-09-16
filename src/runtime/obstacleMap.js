import { globalNavManager } from "./navigationManager.js";

// Obstacle map methods: building/scanning the tile grid, slopes, tile state
// queries, and the zero-event auto-build startup path.
// Mixed into the instance class prototype — `this` is the behavior instance.
export default {
  /** Attempts to copy the obstacle map from the Pathfinding behavior, or starts polling if not ready.
   *  When Auto-Build Graph is set to "solids" (or "auto" with no Pathfinding behavior attached),
   *  builds the obstacle map by scanning Solid/Jump-thru objects instead. */
  _scanObstacles() {
    if (this.obstacleMapSource === "custom" || this.obstacleMapSource === "collision") {
      return; // Obstacle map was built externally — don't overwrite with Pathfinding copy
    }

    // Zero-event startup: build the map from Solid/Jump-thru objects when the
    // Auto-Build Graph property asks for it. "auto" prefers the Pathfinding
    // behavior when one is attached to this object, else falls back to solids.
    if (this.autoBuildMode === "solids" ||
        (this.autoBuildMode === "auto" && !this.pathfindingBehavior)) {
      this._autoBuildFromSolids();
      return;
    }

    if (this.pathfindingBehavior) {
      const success = this._copyObstacleMapFromPathfinding();
      if (!success) {
        this.isWaitingForPathfindingMap = true;
        this.waitTickCount = 0;
        this._log("Pathfinding behavior found but map not ready, starting poll...");
      } else if (this.slopeMap) {
        // Re-apply slope overrides: slope cells must be clear in obstacleMap
        // (the pathfinding copy may have set them as solid)
        for (let i = 0; i < this.slopeMap.length && i < this.obstacleMap.length; i++) {
          if (this.slopeMap[i] > 0) this.obstacleMap[i] = 0;
        }
      }
    } else {
      this.isWaitingForPathfindingMap = true;
      this.waitTickCount = 0;
    }
  },

  /** Zero-event startup: builds the obstacle map by scanning all object types
   *  that carry an enabled Solid or Jump-thru behavior. Uses layout dimensions. */
  _autoBuildFromSolids() {
    const layout = this.instance.layout;
    const solidClasses = this._findObjectClassesWithBehavior("Solid");
    const jumpThruClasses = this._findObjectClassesWithBehavior("Jumpthru");

    if (solidClasses.length === 0 && jumpThruClasses.length === 0) {
      this._warn("Auto-build: no object types with an enabled Solid or Jump-thru behavior found — obstacle map will be empty");
    }

    this.aceBuildObstacleMapFromLayout(layout.width, layout.height);
    for (const cls of solidClasses) this._scanObjectsIntoObstacleMap(cls, 1);
    for (const cls of jumpThruClasses) this._scanObjectsIntoObstacleMap(cls, 2);
    this._log(`Auto-built obstacle map from ${solidClasses.length} solid and ${jumpThruClasses.length} jump-thru object type(s)`);
  },

  /** Returns all object classes whose instances carry an enabled behavior of the
   *  given C3 plugin type name (e.g. "Solid", "Jumpthru"). Behaviors are added at
   *  the object-type level, so checking one instance per class is sufficient. */
  _findObjectClassesWithBehavior(typeName) {
    const result = [];
    const objects = this.instance.runtime.objects;
    for (const key in objects) {
      const cls = objects[key];
      if (!cls || typeof cls.getFirstInstance !== "function") continue;
      let inst = null;
      try { inst = cls.getFirstInstance(); } catch (e) { continue; }
      if (!inst || !inst.behaviors) continue;
      const behaviors = inst.behaviors;
      let found = null;
      const direct = behaviors[typeName];
      if (direct?.isEnabled) {
        found = direct;
      } else {
        for (const bKey in behaviors) {
          const b = behaviors[bKey];
          if (b?.behaviorType?.name === typeName && b.isEnabled) { found = b; break; }
        }
      }
      if (found) result.push(cls);
    }
    return result;
  },

  /** Auto Tile Size: reads the tile size from the first solid tilemap among the given classes. */
  _autoDetectCellSizeFromClasses(classes) {
    for (const cls of classes) {
      let inst = null;
      try { inst = cls.getFirstInstance(); } catch (e) { continue; }
      if (inst && typeof inst.getTileAt === "function" &&
          typeof inst.tileWidth === "number" && inst.tileWidth > 0) {
        this._resolveCellSize(inst.tileWidth, `tilemap "${cls.name || "?"}"`);
        return;
      }
    }
    this._cellSizeResolved = true;
    this._warn(`Tile Size auto-detect: no solid tilemap found — using ${this.cellSize}px. Set the Tile Size property if your level grid differs.`);
  },

  /** Resolves an auto (0) Tile Size property from a detected source value.
   *  Propagates to shared-graph subscribers so their world↔grid math matches. */
  _resolveCellSize(px, sourceDesc) {
    if (this._cellSizeResolved) return;
    if (typeof px !== "number" || !isFinite(px) || px <= 0) return;
    this.cellSize = px;
    this._cellSizeResolved = true;
    this._log(`Tile Size auto-detected: ${px}px (from ${sourceDesc})`);
    // Jump/fall limits derived from cellSize were computed with the provisional
    // value — recompute now that the real tile size is known.
    if (this.platformBehavior && !this._jumpParamsOverridden) {
      this._calculateJumpParametersFromPlatform();
    }
    if (this.useSharedGraph) {
      const subs = globalNavManager.subscribers.get(this.layoutUID);
      if (subs) {
        for (const inst of subs) {
          if (inst !== this && inst.cellSizeAuto && !inst._cellSizeResolved) {
            inst.cellSize = px;
            inst._cellSizeResolved = true;
          }
        }
      }
    }
  },

  /** Polls each tick to check if the Pathfinding behavior's obstacle map is ready; triggers graph generation when it is. */
  _checkPathfindingMapReady() {
    this.waitTickCount++;
    if (this.waitTickCount >= this.maxWaitTicks) {
      this._warn(
        "Pathfinding map not ready after max wait time (" + this.maxWaitTicks + " ticks)."
      );
      this.isWaitingForPathfindingMap = false;
      this._trigger("OnPathfindingMapTimeout");
      return;
    }

    if (!this.pathfindingBehavior) {
      this.pathfindingBehavior = this._getPathfindingBehavior();
    }

    if (!this.pathfindingBehavior) return;

    // Check if the map data is actually ready via .map interface
    const pfMap = this.pathfindingBehavior.map;
    if (!pfMap) return;
    const w = pfMap.widthInCells;
    const h = pfMap.heightInCells;
    if (!w || !h || w <= 0 || h <= 0) return;

    // Map is ready — copy obstacle data FIRST so the map is available
    // when OnPathfindingMapReady fires (user may add slopes in that trigger)
    this.isWaitingForPathfindingMap = false;
    this.waitTickCount = 0;

    const success = this._copyObstacleMapFromPathfinding();
    if (!success) {
      this._trigger("OnPathfindingMapFailed");
      return;
    }

    this._trigger("OnPathfindingMapReady");

    if (this.autoRegenOnReady) {
      this._restartGraphBuild();
    }
  },

  /** Copies the cell-by-cell obstacle data from the C3 Pathfinding behavior's map into our obstacleMap array. */
  _copyObstacleMapFromPathfinding() {
    if (!this.pathfindingBehavior) return false;

    try {
      const pfMap = this.pathfindingBehavior.map;
      if (!pfMap) {
        this._log("Pathfinding .map interface not available");
        return false;
      }

      const w = pfMap.widthInCells;
      const h = pfMap.heightInCells;

      if (!w || !h || w <= 0 || h <= 0) {
        this._log("Pathfinding map not ready yet (widthInCells=" + w + ", heightInCells=" + h + ")");
        return false;
      }

      // Auto Tile Size: the Pathfinding map's cell size IS the grid size we must use
      if (!this._cellSizeResolved) {
        this._resolveCellSize(pfMap.cellSize, "Pathfinding behavior cell size");
      }

      this.gridWidth = w;
      this.gridHeight = h;

      const cellCount = w * h;
      this.obstacleMap = new Uint8Array(cellCount);

      for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
          if (pfMap.isCellObstacle(gx, gy)) {
            this.obstacleMap[gy * w + gx] = 1;
          }
        }
      }

      this.obstacleMapSource = "pathfinding";
      this._log(`Copied obstacle map from Pathfinding: ${w}x${h} (${cellCount} cells)`);
      return true;
    } catch (e) {
      this._error("Error copying obstacle map from Pathfinding:", e);
      return false;
    }
  },

  /** Sets a single cell solid (blocked=true) or clear. Bounds-checked no-op otherwise. */
  aceSetObstacleCell(gx, gy, blocked) {
    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    ) {
      return;
    }
    if (!this.obstacleMap) return;

    const index = gy * this.gridWidth + gx;
    this.obstacleMap[index] = blocked ? 1 : 0;
  },

  /** Creates an empty custom obstacle map (all clear) with the given tile dimensions.
   *  Source becomes "custom" so _scanObstacles never overwrites it. */
  aceCreateCustomObstacleMap(widthInTiles, heightInTiles) {
    this.gridWidth = Math.ceil(widthInTiles);
    this.gridHeight = Math.ceil(heightInTiles);
    const cellCount = this.gridWidth * this.gridHeight;
    this.obstacleMap = new Uint8Array(cellCount);
    this.obstacleMapSource = "custom";
    this._trigger("OnObstacleMapCreated");
  },

  /** Creates an empty obstacle map grid from layout pixel dimensions.
   *  Sets obstacleMapSource = "collision" so _scanObstacles won't overwrite it.
   *  Follow with ScanSolidObjectsIntoObstacleMap / ScanJumpThruObjectsIntoObstacleMap. */
  aceBuildObstacleMapFromLayout(layoutWidth, layoutHeight) {
    // Auto Tile Size: derive from the first solid tilemap in the project
    if (!this._cellSizeResolved) {
      this._autoDetectCellSizeFromClasses(this._findObjectClassesWithBehavior("Solid"));
    }
    const cs = this.cellSize;
    this.gridWidth = Math.ceil(layoutWidth / cs);
    this.gridHeight = Math.ceil(layoutHeight / cs);
    this.obstacleMap = new Uint8Array(this.gridWidth * this.gridHeight);
    this.obstacleMapSource = "collision";
    this.isWaitingForPathfindingMap = false;
    this._log(`Built obstacle map from layout: ${this.gridWidth}x${this.gridHeight} (${this.gridWidth * this.gridHeight} cells)`);
    this._trigger("OnObstacleMapCreated");
  },

  /** Scans objects with the Solid behavior into the obstacle map as solid cells (value=1). */
  aceScanSolidObjectsIntoObstacleMap(solidClass) {
    this._scanObjectsIntoObstacleMap(solidClass, 1);
  },

  /** Scans objects with the Jump-thru behavior into the obstacle map as jump-thru cells (value=2). */
  aceScanJumpThruObjectsIntoObstacleMap(jumpThruClass) {
    this._scanObjectsIntoObstacleMap(jumpThruClass, 2);
  },

  /** Tests whether an instance's collision polygon covers any part of a grid cell,
   *  using a 3x3 grid of point samples against the documented containsPoint test
   *  (point-in-collision-polygon, honors rotation and per-tile tilemap polygons).
   *  Point sampling approximates polygon-vs-cell intersection: samples sit at 1/6,
   *  1/2, and 5/6 of the cell, so any feature wider than about a third of a cell
   *  is caught. Smaller slivers are treated as not blocking. */
  _cellCoveredByInstance(inst, gx, gy) {
    const cs = this.cellSize;
    const baseX = gx * cs;
    const baseY = gy * cs;
    for (let sy = 1; sy <= 5; sy += 2) {
      const py = baseY + (cs * sy) / 6;
      for (let sx = 1; sx <= 5; sx += 2) {
        if (inst.containsPoint(baseX + (cs * sx) / 6, py)) return true;
      }
    }
    return false;
  },

  /** Shared helper: scans instances of objClass into the obstacle map with the given cellValue.
   *  Validates that each instance has the required C3 behavior enabled (Solid=1, Jumpthru=2).
   *  Rasterization is collision-polygon accurate via containsPoint sampling:
   *  - Sprites: only cells the collision polygon actually covers are marked, so
   *    rotated or irregular solids no longer over-fill their bounding box.
   *  - Tilemaps: getTileAt pre-filters empty cells cheaply, then containsPoint
   *    refines against per-tile collision polygons — tiles with collisions
   *    disabled scan as clear, partial polygons only mark covered cells.
   *  Falls back to bounding-box / tile-presence rasterization when containsPoint
   *  is unavailable, so behavior degrades to the previous (coarser) scan. */
  _scanObjectsIntoObstacleMap(objClass, cellValue) {
    if (!objClass) return;
    if (!this.obstacleMap) {
      this._warn("ScanObjectsIntoObstacleMap: no obstacle map exists — call BuildObstacleMapFromLayout first");
      return;
    }
    const requiredBehavior = cellValue === 1 ? "Solid" : "Jumpthru";

    // Find an enabled behavior by plugin type name, handling editor-renamed behaviors.
    const getEnabledBehavior = (inst, typeName) => {
      const behaviors = inst.behaviors;
      if (!behaviors) return null;
      const direct = behaviors[typeName];
      if (direct?.isEnabled) return direct;
      for (const key in behaviors) {
        const b = behaviors[key];
        if (b?.behaviorType?.name === typeName && b.isEnabled) return b;
      }
      return null;
    };

    const gw = this.gridWidth;
    const gh = this.gridHeight;
    const cs = this.cellSize;
    const fullRect = new DOMRect(0, 0, gw * cs, gh * cs);
    const candidates = this.instance.runtime.collisions.getCollisionCandidates([objClass], fullRect);
    const seen = new Set();
    let count = 0;

    for (const inst of candidates) {
      if (seen.has(inst)) continue;
      seen.add(inst);
      if (!getEnabledBehavior(inst, requiredBehavior)) {
        this._warn(`ScanObjectsIntoObstacleMap: "${inst.objectType?.name}" skipped — no enabled "${requiredBehavior}" behavior`);
        continue;
      }
      // Documented flag: collisions disabled means the instance never blocks anything
      if (typeof inst.isCollisionEnabled === "boolean" && !inst.isCollisionEnabled) continue;

      const canPolyTest = typeof inst.containsPoint === "function";

      if (typeof inst.getTileAt === "function") {
        // Tilemap: cell-by-cell (tile size must match cellSize). getTileAt returns
        // -1 for empty cells; flipped tiles return other negative raw values, so
        // compare against exactly -1 (a `>= 0` check would skip flipped tiles).
        for (let gy = 0; gy < gh; gy++) {
          for (let gx = 0; gx < gw; gx++) {
            let tileId;
            try { tileId = inst.getTileAt(gx, gy); } catch (e) { continue; }
            if (tileId === -1) continue;
            if (!canPolyTest || this._cellCoveredByInstance(inst, gx, gy)) {
              this.obstacleMap[gy * gw + gx] = cellValue; count++;
            }
          }
        }
      } else {
        // Sprite: iterate cells in the bounding box, marking only polygon-covered
        // cells (falls back to full bbox fill without containsPoint)
        const bbox = inst.getBoundingBox();
        const x1 = Math.floor(bbox.left / cs);
        const y1 = Math.floor(bbox.top / cs);
        const x2 = Math.ceil(bbox.right / cs);
        const y2 = Math.ceil(bbox.bottom / cs);
        for (let gy = Math.max(0, y1); gy < Math.min(gh, y2); gy++) {
          for (let gx = Math.max(0, x1); gx < Math.min(gw, x2); gx++) {
            if (!canPolyTest || this._cellCoveredByInstance(inst, gx, gy)) {
              this.obstacleMap[gy * gw + gx] = cellValue; count++;
            }
          }
        }
      }
    }
    this._log(`Scanned ${count} cells (value=${cellValue}) from "${requiredBehavior}" objects`);
  },

  /** Discards the obstacle map and marks the graph dirty. After this, auto-build
   *  (or a Use/Build action) can establish a fresh map source. */
  aceClearObstacleMap() {
    this._cancelGraphBuild();
    this.obstacleMap = null;
    this.obstacleMapSource = null;
    this.gridWidth = 0;
    this.gridHeight = 0;
    this.graphGenerated = false;
    this._trigger("OnObstacleMapRemoved");
  },

  /** Serializes the obstacle/slope/hazard maps to a JSON string (for export or storage). */
  aceSaveObstacleMapToJSON() {
    if (!this.obstacleMap) return "{}";
    return JSON.stringify({
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      cellSize: this.cellSize,
      map: this.obstacleMap,
      slopeMap: this.slopeMap ? Array.from(this.slopeMap) : null,
      hazardMap: this.hazardMap ? Array.from(this.hazardMap) : null,
    });
  },

  /** Restores obstacle/slope/hazard maps from a JSON string produced by
   *  aceSaveObstacleMapToJSON. Also restores cellSize (marks it resolved). */
  aceLoadObstacleMapFromJSON(json) {
    try {
      const data = JSON.parse(json);
      this.gridWidth = data.gridWidth;
      this.gridHeight = data.gridHeight;
      this.cellSize = data.cellSize;
      this._cellSizeResolved = true;
      this.obstacleMap = data.map;
      this.obstacleMapSource = "custom";

      if (data.slopeMap) {
        this.slopeMap = new Uint8Array(data.slopeMap);
      }
      if (data.hazardMap) {
        this.hazardMap = new Float32Array(data.hazardMap);
      }
    } catch (e) {
      this._error("Error loading obstacle map from JSON:", e);
    }
  },

  /** "Generate navigation graph" action: marks the graph dirty so the next tick
   *  starts a (time-sliced) build. OnGraphGenerated fires when it completes. */
  aceGenerateNodesFromCustomMap() {
    this._cancelGraphBuild();
    this.graphGenerated = false;
  },

  /** Switches the map source to the Pathfinding behavior: copies its map now if
   *  ready (then builds the graph), otherwise polls each tick until it is
   *  (OnPathfindingMapReady / OnPathfindingMapTimeout fire accordingly). */
  aceUsePathfindingObstacleMap(autoRegen) {
    this._cancelGraphBuild();
    this.obstacleMapSource = null;
    this.obstacleMap = null;
    this.graphGenerated = false;
    this.autoRegenOnReady = autoRegen !== false;

    // Try to copy immediately if pathfinding behavior is already available and ready
    if (this.pathfindingBehavior) {
      const success = this._copyObstacleMapFromPathfinding();
      if (success) {
        this._trigger("OnPathfindingMapReady");
        if (this.autoRegenOnReady) {
          this._restartGraphBuild();
        }
        return;
      }
    }

    // Not ready yet — start polling
    this.isWaitingForPathfindingMap = true;
    this.waitTickCount = 0;
    this._log("Waiting for Pathfinding obstacle map...");
  },

  /** Sets a tile's state by name ("solid", "clear", "jump_thru", "avoid", or a
   *  slope type). Slope states clear the obstacle cell, write slopeMap, and mark
   *  the graph dirty (slope changes alter node/connection layout). */
  aceSetTileState(gx, gy, state) {
    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    ) {
      return;
    }
    if (!this.obstacleMap) return;

    const index = gy * this.gridWidth + gx;

    if (state === "solid") {
      this.obstacleMap[index] = 1;
      if (this.slopeMap) this.slopeMap[index] = 0;
    } else if (state === "clear") {
      this.obstacleMap[index] = 0;
      if (this.slopeMap) this.slopeMap[index] = 0;
    } else if (state === "jump_thru") {
      this.obstacleMap[index] = 2;
    } else if (state === "avoid") {
      this.obstacleMap[index] = 3;
    } else if (state === "slope_left") {
      this.obstacleMap[index] = 0;
      if (!this.slopeMap) {
        this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);
      }
      this.slopeMap[index] = 1;
    } else if (state === "slope_right") {
      this.obstacleMap[index] = 0;
      if (!this.slopeMap) {
        this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);
      }
      this.slopeMap[index] = 2;
    } else if (state === "gentle_slope_left") {
      this.obstacleMap[index] = 0;
      if (!this.slopeMap) {
        this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);
      }
      this.slopeMap[index] = 3;
    } else if (state === "gentle_slope_right") {
      this.obstacleMap[index] = 0;
      if (!this.slopeMap) {
        this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);
      }
      this.slopeMap[index] = 4;
    }
    // Auto-regenerate graph when slope tiles change
    if (state.includes("slope")) {
      this._cancelGraphBuild();
      this.graphGenerated = false;
    }
  },

  /** World-position variant of aceSetTileState. */
  aceSetTileStateWorld(x, y, state) {
    const grid = this.worldToGrid(x, y);
    this.aceSetTileState(grid.gx, grid.gy, state);
  },

  /** Marks a diagonal line of tiles as slope from (startGx,startGy) to (endGx,endGy). */
  aceMarkSlopeRegion(startGx, startGy, endGx, endGy, direction) {
    if (!this.obstacleMap) return;
    if (!this.slopeMap) this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);

    const slopeVal = direction === "slope_left" ? 1
      : direction === "slope_right" ? 2
      : direction === "gentle_slope_left" ? 3
      : direction === "gentle_slope_right" ? 4 : 0;
    if (slopeVal === 0) return;

    const isGentle = slopeVal >= 3;
    const dx = endGx > startGx ? 1 : -1;
    const dy = endGy > startGy ? 1 : -1;

    let gx = startGx;
    let gy = startGy;

    while (true) {
      if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight) {
        const index = gy * this.gridWidth + gx;
        this.obstacleMap[index] = 0;
        this.slopeMap[index] = slopeVal;
      }

      if (gx === endGx && gy === endGy) break;

      if (isGentle) {
        // Gentle slope: mark intermediate horizontal cell too
        gx += dx;
        if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight) {
          const index = gy * this.gridWidth + gx;
          this.obstacleMap[index] = 0;
          this.slopeMap[index] = slopeVal;
        }
        gx += dx;
        gy += dy;
      } else {
        gx += dx;
        gy += dy;
      }

      // Safety: prevent infinite loop
      if (Math.abs(gx - startGx) > 500 || Math.abs(gy - startGy) > 500) break;
    }
    this._cancelGraphBuild();
    this.graphGenerated = false;
  },

  /** Scans a Tilemap and marks tiles matching the given tile IDs as slopes. */
  aceMapSlopeTilesFromTilemap(tilemapClass, slopeLeftIds, slopeRightIds, gentleLeftIds, gentleRightIds) {
    const tilemapInst = tilemapClass.getFirstPickedInstance();
    if (!tilemapInst) {
      this._warn("MapSlopeTilesFromTilemap: tilemap instance not found");
      return;
    }
    if (!this.obstacleMap) {
      this._warn("MapSlopeTilesFromTilemap: obstacle map not created yet");
      return;
    }

    const parseIds = (str) => {
      if (!str || str.trim() === "") return new Set();
      return new Set(str.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)));
    };

    const leftSet = parseIds(slopeLeftIds);
    const rightSet = parseIds(slopeRightIds);
    const gentleLeftSet = parseIds(gentleLeftIds);
    const gentleRightSet = parseIds(gentleRightIds);

    if (leftSet.size === 0 && rightSet.size === 0 && gentleLeftSet.size === 0 && gentleRightSet.size === 0) return;

    if (!this.slopeMap) this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);

    let count = 0;
    // In debug mode: collect tile IDs that exist in the tilemap but aren't in any slope set.
    // These unregistered tiles may silently allow invalid jump connections through them.
    const unregisteredIds = this.enableDebug ? new Map() : null; // baseTileId → example {gx, gy}

    // Tile values from getTileAt() are 32-bit integers: lower 29 bits = tile ID, upper 3 = flip flags.
    // Empty tiles return -1. Tiles placed H-flipped produce negative values that the old `< 0`
    // guard incorrectly skipped — check for exactly -1 instead and use >>> 0 to treat as
    // unsigned when extracting the base ID and flip flags.
    const TILE_ID_MASK = 0x1FFFFFFF;
    const TILE_H_FLIP  = 0x80000000;

    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        let rawTile;
        try {
          rawTile = tilemapInst.getTileAt(gx, gy);
        } catch (e) {
          continue;
        }
        if (rawTile === -1) continue; // empty cell

        const baseTileId = (rawTile >>> 0) & TILE_ID_MASK;
        // Horizontal flip mirrors slope direction: left ↔ right, gentle-left ↔ gentle-right
        const hFlipped   = ((rawTile >>> 0) & TILE_H_FLIP) !== 0;

        const index = gy * this.gridWidth + gx;
        let slopeVal = 0;
        if      (leftSet.has(baseTileId))        slopeVal = hFlipped ? 2 : 1;
        else if (rightSet.has(baseTileId))       slopeVal = hFlipped ? 1 : 2;
        else if (gentleLeftSet.has(baseTileId))  slopeVal = hFlipped ? 4 : 3;
        else if (gentleRightSet.has(baseTileId)) slopeVal = hFlipped ? 3 : 4;

        if (slopeVal > 0) {
          this.obstacleMap[index] = 0;
          this.slopeMap[index] = slopeVal;
          count++;
        } else if (unregisteredIds && !unregisteredIds.has(baseTileId)) {
          // Record one example position per unregistered tile ID (for debug output)
          unregisteredIds.set(baseTileId, { gx, gy });
        }
      }
    }
    this._log(`Mapped ${count} slope tiles from tilemap`);
    if (unregisteredIds && unregisteredIds.size > 0) {
      const examples = [];
      for (const [id, pos] of unregisteredIds) {
        examples.push(`tileId=${id} (e.g. gx=${pos.gx},gy=${pos.gy})`);
      }
      this._log(`[Debug] Tilemap has ${unregisteredIds.size} unregistered tile ID(s) — if any are slope tiles, add them to MapSlopesFromTilemaps: ${examples.join("; ")}`);
    }
    if (count > 0) {
      if ((this.graphGenerated || this._graphBuild) && this.obstacleMap) {
        // Graph was built (or is building) before slopes were registered (common on
        // scene restart when the Pathfinding map is immediately available, so graph
        // generation starts before MapSlopeTilesFromTilemap runs). Rebuild now so
        // that any FindPath call on the same tick uses the correct slope-aware graph.
        this._log("Slopes registered after graph build started — rebuilding with slope data");
        this._restartGraphBuild();
      } else {
        // Graph not yet built — mark dirty so the next build picks up the slope data.
        this.graphGenerated = false;
      }
    }
  },

  // -----------------------------------------------------------------------
  // Auto slope detection helpers
  // -----------------------------------------------------------------------

  // Try to retrieve the IAnimationFrame for a base tile ID from the tilemap.
  // C3 tilemaps store their tileset as animation frames (one animation whose
  // frames correspond to tile IDs 0, 1, 2, …). The public ITilemapInstance
  // scripting interface does not document this path, so we try it and return
  // null on any failure so callers can fall back gracefully.
  _tryGetTileFrame(baseTileId, tilemapInst) {
    try {
      const animations = tilemapInst.animations;
      if (!animations) return null;
      for (const anim of animations) {
        let idx = 0;
        for (const frame of anim.frames) {
          if (idx === baseTileId) return frame;
          idx++;
        }
        break; // only check the first animation (the tileset)
      }
    } catch (e) {
      // Animation frame API is not accessible on this object / C3 version
    }
    return null;
  },

  // Classify the collision polygon of a single tile ID as a slope type.
  // Returns: 1 = slope_left (/), 2 = slope_right (\),
  //          3 = gentle_slope_left, 4 = gentle_slope_right, 0 = not a slope.
  // Polygon points are read in normalized coordinates relative to the frame
  // origin (IAnimationFrame.getPolyPointX/Y). We convert to 0-1 tile space
  // by adding originX/originY so corner detection is consistent.
  _classifyTilePolygon(baseTileId, tilemapInst) {
    const frame = this._tryGetTileFrame(baseTileId, tilemapInst);
    if (!frame) return 0;

    let count;
    try {
      count = frame.getPolyPointCount();
    } catch (e) {
      return 0;
    }
    if (count < 3) return 0;

    // Convert origin-relative coords to 0-1 tile space
    const originX = frame.originX ?? 0.5;
    const originY = frame.originY ?? 0.5;
    const pts = [];
    for (let i = 0; i < count; i++) {
      pts.push([frame.getPolyPointX(i) + originX, frame.getPolyPointY(i) + originY]);
    }

    const eps = 0.1;
    const hasCorner = (cx, cy) => pts.some(([px, py]) => Math.abs(px - cx) < eps && Math.abs(py - cy) < eps);
    const hasTL = hasCorner(0, 0);
    const hasTR = hasCorner(1, 0);
    const hasBL = hasCorner(0, 1);
    const hasBR = hasCorner(1, 1);

    if (count === 3) {
      // 45° slope triangle — the absent corner reveals the cut direction.
      // slope_left  (/): solid fills bottom-right triangle → top-left corner absent
      // slope_right (\): solid fills bottom-left triangle → top-right corner absent
      if (!hasTL && hasTR && hasBL && hasBR) return 1; // slope_left
      if ( hasTL && !hasTR && hasBL && hasBR) return 2; // slope_right
    } else if (count === 4) {
      // 22.5° gentle-slope trapezoid — three real corners plus one midpoint
      // on a vertical edge. The side with the midpoint is the cut side.
      // gentle_slope_left  (/): top-right cut → extra point on right edge  (x≈1, 0<y<1)
      // gentle_slope_right (\): top-left  cut → extra point on left edge   (x≈0, 0<y<1)
      if (hasTL && !hasTR && hasBL && hasBR) {
        const mid = pts.find(([px, py]) => Math.abs(px - 1) < eps && py > eps && py < 1 - eps);
        if (mid) return 3; // gentle_slope_left
      }
      if (!hasTL && hasTR && hasBL && hasBR) {
        const mid = pts.find(([px, py]) => Math.abs(px) < eps && py > eps && py < 1 - eps);
        if (mid) return 4; // gentle_slope_right
      }
    }
    return 0; // flat/solid or unrecognised shape
  },

  // Scan a tilemap and automatically classify every tile that has a triangular
  // or trapezoidal collision polygon as a slope, without requiring explicit
  // tile-ID lists. Each unique base tile ID is classified only once for
  // efficiency. Horizontal-flip variants are handled automatically.
  aceAutoDetectSlopeTiles(tilemapClass) {
    const tilemapInst = tilemapClass.getFirstPickedInstance();
    if (!tilemapInst) {
      this._warn("AutoDetectSlopeTiles: tilemap instance not found");
      return;
    }
    if (!this.obstacleMap) {
      this._warn("AutoDetectSlopeTiles: obstacle map not created yet");
      return;
    }
    if (!this.slopeMap) this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);

    const TILE_ID_MASK = 0x1FFFFFFF;
    const TILE_H_FLIP  = 0x80000000;

    // Pass 1 — collect all unique base tile IDs and classify each once.
    // We classify per unique ID rather than per cell to avoid redundant
    // (and potentially expensive) polygon API lookups for repeated tiles.
    const classificationCache = new Map(); // baseTileId → slopeType (0-4)
    let polyApiWorked = false;

    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        let rawTile;
        try { rawTile = tilemapInst.getTileAt(gx, gy); } catch (e) { continue; }
        if (rawTile === -1) continue;

        const baseTileId = (rawTile >>> 0) & TILE_ID_MASK;
        if (classificationCache.has(baseTileId)) continue;

        // Attempt polygon classification; cache result even if 0 (not a slope)
        // so we don't re-query the same tile ID in subsequent cells.
        const slopeType = this._classifyTilePolygon(baseTileId, tilemapInst);
        classificationCache.set(baseTileId, slopeType);

        // If _tryGetTileFrame returned a frame (not null), the polygon API is
        // accessible even when the tile isn't a slope — check via a helper probe.
        if (!polyApiWorked && this._tryGetTileFrame(baseTileId, tilemapInst) !== null) {
          polyApiWorked = true;
        }
      }
    }

    if (!polyApiWorked) {
      this._warn(
        "AutoDetectSlopeTiles: tile collision polygon data is not accessible at runtime on this C3 version. " +
        "Use MapSlopeTilesFromTilemap with explicit tile IDs instead."
      );
      return;
    }

    // Pass 2 — write slope values into slopeMap, applying H-flip mirroring.
    let count = 0;
    const typeCounts = [0, 0, 0, 0]; // [slope_left, slope_right, gentle_left, gentle_right]

    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        let rawTile;
        try { rawTile = tilemapInst.getTileAt(gx, gy); } catch (e) { continue; }
        if (rawTile === -1) continue;

        const baseTileId = (rawTile >>> 0) & TILE_ID_MASK;
        const hFlipped   = ((rawTile >>> 0) & TILE_H_FLIP) !== 0;
        const baseType   = classificationCache.get(baseTileId) ?? 0;
        if (baseType === 0) continue;

        // H-flip mirrors left ↔ right
        const slopeVal = hFlipped
          ? (baseType === 1 ? 2 : baseType === 2 ? 1 : baseType === 3 ? 4 : 3)
          : baseType;

        const index = gy * this.gridWidth + gx;
        this.obstacleMap[index] = 0;
        this.slopeMap[index] = slopeVal;
        typeCounts[slopeVal - 1]++;
        count++;
      }
    }

    if (count > 0) {
      this._log(
        `AutoDetectSlopeTiles: detected ${count} slope tile(s) — ` +
        `left:${typeCounts[0]} right:${typeCounts[1]} ` +
        `gentle-left:${typeCounts[2]} gentle-right:${typeCounts[3]}`
      );
      if ((this.graphGenerated || this._graphBuild) && this.obstacleMap) {
        this._log("Rebuilding navigation graph with auto-detected slope data");
        this._restartGraphBuild();
      } else {
        this.graphGenerated = false;
      }
    } else {
      this._log(
        "AutoDetectSlopeTiles: no slope tiles detected. " +
        "Ensure tiles have triangular or trapezoidal collision polygons set in the C3 editor."
      );
    }
  },

  // -----------------------------------------------------------------------

  aceSetTileHazard(gx, gy, severity) {
    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    ) {
      return;
    }
    if (severity > 0) this.enableHazards = true;
    if (!this.hazardMap) {
      this.hazardMap = new Float32Array(this.gridWidth * this.gridHeight);
    }
    this.hazardMap[gy * this.gridWidth + gx] = severity;
  },

  /** Clears every slope marking (tiles revert to whatever the obstacle map says)
   *  and marks the graph dirty. */
  aceClearAllSlopes() {
    if (this.slopeMap) this.slopeMap.fill(0);
    this._cancelGraphBuild();
    this.graphGenerated = false;
  },

  /** Resets all tile hazard severities to 0 (circle/rect hazards are separate). */
  aceClearAllHazardTiles() {
    if (this.hazardMap) this.hazardMap.fill(0);
  },

  /** Returns true if a cell is impassable (solid or jump-thru). Out-of-bounds counts as blocked. */
  isCellBlocked(gx, gy) {
    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    ) {
      return true;
    }
    const index = gy * this.gridWidth + gx;
    if (!this.obstacleMap) return false;
    const val = this.obstacleMap[index];
    return val === 1 || val === 2;
  },

  /** Returns true if a cell is solid (obstacle value 1). Out-of-bounds counts as solid. */
  isCellSolid(gx, gy) {
    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    ) {
      return true;
    }
    const index = gy * this.gridWidth + gx;
    if (!this.obstacleMap) return false;
    return this.obstacleMap[index] === 1;
  },

  /** Returns true if a cell is a jump-thru platform (obstacle value 2). */
  isCellJumpThru(gx, gy) {
    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    ) {
      return false;
    }
    const index = gy * this.gridWidth + gx;
    if (!this.obstacleMap) return false;
    return this.obstacleMap[index] === 2;
  },

  /** Returns true if a cell is marked as "avoid" (obstacle value 3). */
  isCellAvoid(gx, gy) {
    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    ) {
      return false;
    }
    const index = gy * this.gridWidth + gx;
    if (!this.obstacleMap) return false;
    return this.obstacleMap[index] === 3;
  },

  /** Returns true if a cell is clear (value 0) with solid or jump-thru ground directly below it. */
  _isWalkable(gx, gy) {
    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    ) {
      return false;
    }
    const index = gy * this.gridWidth + gx;
    const val = this.obstacleMap ? this.obstacleMap[index] : 0;

    if (val !== 0) return false;

    const belowIndex = (gy + 1) * this.gridWidth + gx;
    if (gy + 1 >= this.gridHeight) return false;
    const belowVal = this.obstacleMap ? this.obstacleMap[belowIndex] : 0;

    return belowVal === 1 || belowVal === 2;
  },

  /** Returns true if a cell is a walkable slope tile (has a non-zero slopeMap value). */
  _isSlopeWalkable(gx, gy) {
    if (!this.slopeMap) return false;
    const index = gy * this.gridWidth + gx;
    return this.slopeMap[index] > 0;
  },

  /** Returns true if a cell contains ground (solid or jump-thru). Used for ledge detection. */
  _isGroundAt(gx, gy) {
    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    ) {
      return false;
    }
    const index = gy * this.gridWidth + gx;
    if (!this.obstacleMap) return false;
    const val = this.obstacleMap[index];
    return val === 1 || val === 2;
  },

  // ============================================================================
  // OBSTACLE MAP - Grid & Map Expressions
  // ============================================================================

  /** Returns the width of the obstacle grid in tiles. */
  aceGetGridWidth() {
    return this.gridWidth;
  },

  /** Returns the height of the obstacle grid in tiles. */
  aceGetGridHeight() {
    return this.gridHeight;
  },

  /** Returns the cell size (tile size) in pixels used by the obstacle map. */
  aceGetCellSize() {
    return this.cellSize;
  },

  /** Returns the grid tile size in pixels (alias for cell size). */
  aceGetGridTileSize() {
    return this.cellSize;
  },

  /** Converts a world X position (pixels) to the corresponding grid tile X coordinate. */
  aceWorldToGridX(x) {
    return Math.floor(x / this.cellSize);
  },

  /** Converts a world Y position (pixels) to the corresponding grid tile Y coordinate. */
  aceWorldToGridY(y) {
    return Math.floor(y / this.cellSize);
  },

  /** Returns the tile state at grid coordinates as a string: "solid", "clear", "slope", "jump_thru", or "avoid". */
  aceGetTileState(gx, gy) {
    if (
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    )
      return "solid";
    if (!this.obstacleMap) return "clear";
    const val = this.obstacleMap[gy * this.gridWidth + gx];
    if (val === 0) {
      if (this.slopeMap) {
        const sv = this.slopeMap[gy * this.gridWidth + gx];
        if (sv === 1) return "slope_left";
        if (sv === 2) return "slope_right";
        if (sv === 3) return "gentle_slope_left";
        if (sv === 4) return "gentle_slope_right";
      }
      return "clear";
    }
    if (val === 1) return "solid";
    if (val === 2) return "jump_thru";
    if (val === 3) return "avoid";
    return "clear";
  },

  /** Returns the tile state at world coordinates by converting to grid first. */
  aceGetTileStateWorld(x, y) {
    const grid = this.worldToGrid(x, y);
    return this.aceGetTileState(grid.gx, grid.gy);
  },

  /** Returns the slope direction at the given grid position: "left", "right", or "none". */
  aceGetSlopeDirection(gx, gy) {
    if (
      !this.slopeMap ||
      gx < 0 ||
      gx >= this.gridWidth ||
      gy < 0 ||
      gy >= this.gridHeight
    )
      return "none";
    const val = this.slopeMap[gy * this.gridWidth + gx];
    if (val === 1) return "left";
    if (val === 2) return "right";
    if (val === 3) return "gentle_left";
    if (val === 4) return "gentle_right";
    return "none";
  },

  /** Returns the obstacle map as a JSON string for serialization/debugging. */
  aceGetObstacleMapJSON() {
    return this.aceSaveObstacleMapToJSON();
  },

  /** Returns the source of the current obstacle map (e.g. "pathfinding", "custom", "collision", or "none"). */
  aceGetObstacleMapSource() {
    return this.obstacleMapSource || "none";
  },

  /** Returns the number of ticks spent waiting during pathfinding setup. */
  aceGetWaitTickCount() {
    return this.waitTickCount || 0;
  },
};
