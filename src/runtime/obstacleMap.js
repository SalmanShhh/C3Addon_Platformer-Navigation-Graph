import { globalNavManager } from "./navigationManager.js";

// Obstacle map methods: building/scanning the tile grid, slopes, tile state
// queries, and the zero-event auto-build startup path.
// Mixed into the instance class prototype — `this` is the behavior instance.
export default {
  /** Adopts another instance's map state by REFERENCE — one copy of the map
   *  data per shared map, not one per instance. gridWidth is load-bearing:
   *  gridKey() depends on it, so an instance without it cannot even look up
   *  nodes in the shared graph. Mutating tile actions then write into the
   *  shared arrays, which is the correct shared-mode semantics. */
  _adoptMapStateFrom(inst) {
    this.obstacleMap = inst.obstacleMap;
    this.slopeMap = inst.slopeMap;
    this.hazardMap = inst.hazardMap;
    this.gridWidth = inst.gridWidth;
    this.gridHeight = inst.gridHeight;
    this.obstacleMapSource = inst.obstacleMapSource;
    if (this.cellSizeAuto && !this._cellSizeResolved && inst._cellSizeResolved) {
      this.cellSize = inst.cellSize;
      this._cellSizeResolved = true;
    }
  },

  /** Same-tick dedupe for map-setup actions. Event-sheet actions run once per
   *  picked instance, so a setup action on a type with N instances would redo
   *  the same work N times and keep N map copies. The first caller in a tick
   *  claims the work; later same-tick callers on the same map adopt the first
   *  caller's result instead. Returns true when the caller should do the work.
   *  (Same-tick detection uses gameTime, which is frozen while the game is
   *  paused — repeated setup calls during a hard pause coalesce, acceptable.) */
  _claimSharedSetup(actionKey) {
    const navKey = this._getNavKey();
    if (navKey === null) return true;
    const claim = this._claimSameTick(navKey + "#" + actionKey);
    if (claim.peer) {
      this._adoptMapStateFrom(claim.peer.owner);
      return false;
    }
    return true;
  },

  /** The same-tick ownership rule shared by every per-picked-instance dedupe
   *  (map setup, portal adds, portal removal): if ANOTHER live instance already
   *  stamped `key` this tick (and `isPeerValid`, when given, accepts its
   *  record), returns { peer: thatRecord }. Otherwise stamps this instance and
   *  returns { own: newRecord } so the caller can attach data (e.g. an ID).
   *  gameTime is frozen while paused, so repeats during a hard pause coalesce. */
  _claimSameTick(key, isPeerValid) {
    const now = this.instance.runtime.gameTime;
    const rec = globalNavManager.setupStamps.get(key);
    if (rec && rec.time === now && rec.owner !== this && rec.owner.instance &&
        (!isPeerValid || isPeerValid(rec))) {
      return { peer: rec };
    }
    const own = { time: now, owner: this };
    globalNavManager.setupStamps.set(key, own);
    return { own };
  },

  /** Builds the obstacle map by scanning Solid/Jump-thru objects when Auto-Build
   *  Graph is "auto". "off" does nothing here: the map is set up with actions. */
  _scanObstacles() {
    if (this.obstacleMapSource === "custom" || this.obstacleMapSource === "collision") {
      return; // Obstacle map was built externally — don't overwrite it
    }
    if (this.autoBuildMode === "auto") {
      this._autoBuildFromSolids();
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
    // Propagate per nav key: instances on OTHER map tags may legitimately
    // use a different cell size for their own map.
    const subs = globalNavManager.subscribers.get(this.navKey);
    if (subs) {
      for (const inst of subs) {
        if (inst !== this && inst.cellSizeAuto && !inst._cellSizeResolved) {
          inst.cellSize = px;
          inst._cellSizeResolved = true;
        }
      }
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
    if (!this._claimSharedSetup("createCustom")) return;
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
    if (!this._claimSharedSetup("buildFromLayout")) return;
    // Auto Tile Size: derive from the first solid tilemap in the project
    if (!this._cellSizeResolved) {
      this._autoDetectCellSizeFromClasses(this._findObjectClassesWithBehavior("Solid"));
    }
    const cs = this.cellSize;
    this.gridWidth = Math.ceil(layoutWidth / cs);
    this.gridHeight = Math.ceil(layoutHeight / cs);
    this.obstacleMap = new Uint8Array(this.gridWidth * this.gridHeight);
    this.obstacleMapSource = "collision";
    this._log(`Built obstacle map from layout: ${this.gridWidth}x${this.gridHeight} (${this.gridWidth * this.gridHeight} cells)`);
    this._trigger("OnObstacleMapCreated");
  },

  /** Scans objects with the Solid behavior into the obstacle map as solid cells (value=1). */
  aceScanSolidObjectsIntoObstacleMap(solidClass) {
    if (!this._claimSharedSetup("scanSolid")) return;
    this._scanObjectsIntoObstacleMap(solidClass, 1);
  },

  /** Scans objects with the Jump-thru behavior into the obstacle map as jump-thru cells (value=2). */
  aceScanJumpThruObjectsIntoObstacleMap(jumpThruClass) {
    if (!this._claimSharedSetup("scanJumpThru")) return;
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

  /** Counts how many of the 3x3 cell samples the instance's collision polygon
   *  covers (0..9). Same sample layout as _cellCoveredByInstance but without
   *  early exit — used when slope detection needs to know full vs partial. */
  _countCoveredSamples(inst, gx, gy) {
    const cs = this.cellSize;
    const baseX = gx * cs;
    const baseY = gy * cs;
    let n = 0;
    for (let sy = 1; sy <= 5; sy += 2) {
      const py = baseY + (cs * sy) / 6;
      for (let sx = 1; sx <= 5; sx += 2) {
        if (inst.containsPoint(baseX + (cs * sx) / 6, py)) n++;
      }
    }
    return n;
  },

  /** Probes one column of a cell downward with containsPoint and returns the
   *  height of the topmost solid surface above the cell bottom, in pixels
   *  (0 = the column has no solid). Resolution is cellSize/12. */
  _probeColumnSurfaceHeight(inst, worldX, cellTopY) {
    const cs = this.cellSize;
    const steps = 12;
    for (let k = 0; k < steps; k++) {
      const y = cellTopY + ((k + 0.5) * cs) / steps;
      if (inst.containsPoint(worldX, y)) {
        // Surface sits at or just above this probe point
        return cs - (y - cellTopY) + cs / (2 * steps);
      }
    }
    return 0;
  },

  /** Classifies a cell's collision shape as a slope by probing surface heights
   *  at three columns (x = 1/6, 1/2, 5/6 of the cell) — measured collision
   *  BEHAVIOR via the documented containsPoint, not polygon definitions, so it
   *  cannot disagree with what the Platform behavior physically collides with.
   *  Returns a slopeMap value: 1=slope_left(/), 2=slope_right(\),
   *  3=gentle_left, 4=gentle_right, 0=not a slope (flat, full, or an angle the
   *  movement system doesn't support — those stay solid, which is safe). */
  _classifySlopeByProbe(inst, gx, gy) {
    const cs = this.cellSize;
    const top = gy * cs;
    const h1 = this._probeColumnSurfaceHeight(inst, gx * cs + cs / 6, top);
    const h2 = this._probeColumnSurfaceHeight(inst, gx * cs + cs / 2, top);
    const h3 = this._probeColumnSurfaceHeight(inst, gx * cs + (5 * cs) / 6, top);

    // The middle column must sit on the line between the outer two, or the
    // shape isn't a straight ramp (steps, bumps, decorations stay solid)
    if (Math.abs(h2 - (h1 + h3) / 2) > cs / 6) return 0;

    // Positive gradient = surface rises to the right = "/"
    const gradient = (h3 - h1) / ((2 * cs) / 3);
    const mag = Math.abs(gradient);
    if (mag >= 0.75 && mag <= 1.25) return gradient > 0 ? 1 : 2; // 45 degrees
    if (mag >= 0.3 && mag <= 0.7) return gradient > 0 ? 3 : 4;   // 22.5 degrees
    return 0;
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
    let slopeCount = 0;
    const slopeWritten = new Set(); // cells written as slopes during THIS scan

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
      // Detect Slopes: classify partially-covered SOLID cells by probing the
      // collision shape. Cells written as slopes this scan are tracked so a
      // later overlapping solid in the same scan cleanly overwrites them.
      const wantSlopes = this.detectSlopes && cellValue === 1 && canPolyTest;

      // Applies one covered cell: slope-classified cells become slope tiles,
      // everything else becomes cellValue.
      const applyCell = (gx, gy, slopeVal) => {
        const idx = gy * gw + gx;
        if (slopeVal > 0) {
          if (!this.slopeMap) this.slopeMap = new Uint8Array(gw * gh);
          this.slopeMap[idx] = slopeVal;
          this.obstacleMap[idx] = 0;
          slopeWritten.add(idx);
          slopeCount++;
        } else {
          this.obstacleMap[idx] = cellValue;
          if (slopeWritten.has(idx)) {
            this.slopeMap[idx] = 0;
            slopeWritten.delete(idx);
          }
          count++;
        }
      };

      if (typeof inst.getTileAt === "function") {
        // Tilemap: cell-by-cell (tile size must match cellSize). getTileAt returns
        // -1 for empty cells; flipped tiles return other negative raw values, so
        // compare against exactly -1 (a `>= 0` check would skip flipped tiles).
        // Coverage/slope results are cached per raw tile value (the raw value
        // includes flip bits, and identical values have identical collision shapes).
        const tileCache = new Map(); // rawTile → { covered, slope }
        for (let gy = 0; gy < gh; gy++) {
          for (let gx = 0; gx < gw; gx++) {
            let tileId;
            try { tileId = inst.getTileAt(gx, gy); } catch (e) { continue; }
            if (tileId === -1) continue;
            if (!canPolyTest) { this.obstacleMap[gy * gw + gx] = cellValue; count++; continue; }
            let rec = tileCache.get(tileId);
            if (rec === undefined) {
              if (wantSlopes) {
                const n = this._countCoveredSamples(inst, gx, gy);
                rec = {
                  covered: n > 0,
                  slope: n > 0 && n < 9 ? this._classifySlopeByProbe(inst, gx, gy) : 0,
                };
              } else {
                rec = { covered: this._cellCoveredByInstance(inst, gx, gy), slope: 0 };
              }
              tileCache.set(tileId, rec);
            }
            if (rec.covered) applyCell(gx, gy, rec.slope);
          }
        }
      } else {
        // Sprite: iterate cells in the bounding box, marking only polygon-covered
        // cells (falls back to full bbox fill without containsPoint). Slope
        // classification runs per cell, so a rotated 45-degree solid sprite's
        // diagonal edge cells legitimately become walkable ramp tiles.
        const bbox = inst.getBoundingBox();
        const x1 = Math.floor(bbox.left / cs);
        const y1 = Math.floor(bbox.top / cs);
        const x2 = Math.ceil(bbox.right / cs);
        const y2 = Math.ceil(bbox.bottom / cs);
        for (let gy = Math.max(0, y1); gy < Math.min(gh, y2); gy++) {
          for (let gx = Math.max(0, x1); gx < Math.min(gw, x2); gx++) {
            if (!canPolyTest) { this.obstacleMap[gy * gw + gx] = cellValue; count++; continue; }
            if (wantSlopes) {
              const n = this._countCoveredSamples(inst, gx, gy);
              if (n === 0) continue;
              applyCell(gx, gy, n < 9 ? this._classifySlopeByProbe(inst, gx, gy) : 0);
            } else {
              if (!this._cellCoveredByInstance(inst, gx, gy)) continue;
              applyCell(gx, gy, 0);
            }
          }
        }
      }
    }
    this._log(`Scanned ${count} cells (value=${cellValue})${slopeCount > 0 ? ` + ${slopeCount} slope cells` : ""} from "${requiredBehavior}" objects`);
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
    if (!this._claimSharedSetup("loadJSON")) return;
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
    if (!this._claimSharedSetup("mapSlopes")) return;
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
  // Auto slope detection
  // -----------------------------------------------------------------------

  // Scan a tilemap and automatically classify slope tiles by PROBING their
  // collision shapes with the documented containsPoint API (see
  // _classifySlopeByProbe) — no tile-ID lists and no undocumented polygon
  // definition access. Results are cached per raw tile value (raw values
  // include flip bits, so flipped variants classify independently and
  // correctly). Tiles whose shape isn't a supported slope angle stay solid.
  aceAutoDetectSlopeTiles(tilemapClass) {
    if (!this._claimSharedSetup("autoDetectSlopes")) return;
    const tilemapInst = tilemapClass.getFirstPickedInstance();
    if (!tilemapInst) {
      this._warn("AutoDetectSlopeTiles: tilemap instance not found");
      return;
    }
    if (!this.obstacleMap) {
      this._warn("AutoDetectSlopeTiles: obstacle map not created yet");
      return;
    }
    if (typeof tilemapInst.containsPoint !== "function") {
      this._warn("AutoDetectSlopeTiles: containsPoint is not available on this tilemap. Use MapSlopeTilesFromTilemap with explicit tile IDs instead.");
      return;
    }
    if (!this.slopeMap) this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);

    const classificationCache = new Map(); // rawTile → slopeType (0-4)
    let count = 0;
    const typeCounts = [0, 0, 0, 0]; // [slope_left, slope_right, gentle_left, gentle_right]

    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        let rawTile;
        try { rawTile = tilemapInst.getTileAt(gx, gy); } catch (e) { continue; }
        if (rawTile === -1) continue;

        let slopeVal = classificationCache.get(rawTile);
        if (slopeVal === undefined) {
          slopeVal = this._classifySlopeByProbe(tilemapInst, gx, gy);
          classificationCache.set(rawTile, slopeVal);
        }
        if (slopeVal === 0) continue;

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
        "Ensure slope tiles have sloped collision polygons (45 or 22.5 degrees) set in the C3 editor."
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
    this._markHazardCostsDirty();
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
    this._markHazardCostsDirty();
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
    // Same row-aliasing hazard as getNode: out-of-range columns would read a
    // neighbouring row's slope value.
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) return false;
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

  /** Returns the source of the current obstacle map ("custom", "collision", or "none"). */
  aceGetObstacleMapSource() {
    return this.obstacleMapSource || "none";
  },

};
