import { globalNavManager } from "./navigationManager.js";

// Time-sliced scanning: per-tick work budget, and tilemap row-band size (one
// unit of work; the budget is checked between units).
const SCAN_BUDGET_MS = 4;
const SCAN_BAND_ROWS = 8;
// Streaming: maps grow in steps of this many cells, and never past this many
// cells in total (a stray object parked far away must not allocate a huge grid).
const GROW_STEP_CELLS = 16;
const MAX_GRID_CELLS = 4000000;

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
    this.gridOriginX = inst.gridOriginX || 0;
    this.gridOriginY = inst.gridOriginY || 0;
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
      const navKey = this._getNavKey();
      if (navKey !== null && globalNavManager.scanJobs.has(navKey)) {
        this._finishScanJobNow(); // the time-sliced startup scan, completed now
        if (this.obstacleMap) return;
      }
      this._autoBuildFromSolids();
    }
  },

  /** Builds a fresh obstacle map by scanning all object types that carry an
   *  enabled Solid or Jump-thru behavior, at their CURRENT positions, then
   *  re-applies remembered tile-ID / auto-detect slope registrations. Uses
   *  layout dimensions. Used by zero-event startup (inside _startGraphBuild) and
   *  by Regenerate obstacle map. Does not mark the graph dirty itself. */
  _autoBuildFromSolids() {
    const layout = this.instance.layout;
    const solidClasses = this._findObjectClassesWithBehavior("Solid");
    const jumpThruClasses = this._findObjectClassesWithBehavior("Jumpthru");

    if (solidClasses.length === 0 && jumpThruClasses.length === 0) {
      this._warn("Auto-build: no object types with an enabled Solid or Jump-thru behavior found — obstacle map will be empty");
    }

    // Scan actions run on top of an all-solids map are part of its recipe too
    const prev = this._getScanRule();
    const extra = prev && prev.allSolids ? prev.scans : [];

    const area = (prev && prev.area) || this._solidsExtent();
    this._createMapFromLayout(area.w, area.h, area.x, area.y);
    for (const cls of solidClasses) this._scanObjectsIntoObstacleMap(cls, 1);
    for (const cls of jumpThruClasses) this._scanObjectsIntoObstacleMap(cls, 2);
    for (const sc of extra) this._scanObjectsIntoObstacleMap(sc.cls, sc.value);
    this._applySlopeRules();
    this._setScanRule({ allSolids: true, width: area.w, height: area.h, scans: extra, area: (prev && prev.area) || null });
    this._log(`Built obstacle map from ${solidClasses.length} solid and ${jumpThruClasses.length} jump-thru object type(s)`);
  },

  // ---------------------------------------------------------------------------
  // Scan rules: how this map was built from objects, so it can be rebuilt the
  // same way (Regenerate obstacle map, and automatic regeneration when solids
  // move, appear or disappear). allSolids = every Solid/Jump-thru type (auto-
  // build or Regenerate obstacle map); otherwise Build obstacle map from layout
  // plus the Scan actions that followed. Custom / JSON maps have no rule.
  // ---------------------------------------------------------------------------

  _getScanRule() {
    const navKey = this._getNavKey();
    return navKey !== null ? (globalNavManager.scanRules.get(navKey) || null) : null;
  },

  _setScanRule(rule) {
    const navKey = this._getNavKey();
    if (navKey === null) return;
    if (rule) globalNavManager.scanRules.set(navKey, rule);
    else globalNavManager.scanRules.delete(navKey);
  },

  /** Savegame form of this map's scan rule and slope registrations, with
   *  object types stored by NAME (object classes are not serializable).
   *  null before this instance has a map. */
  _serializeMapRecipes() {
    const navKey = this.navKey;
    if (navKey === null) return null;
    const nameOf = (cls) => { try { return cls.name || null; } catch (e) { return null; } };
    const rule = globalNavManager.scanRules.get(navKey) || null;
    const slopes = globalNavManager.slopeRules.get(navKey) || [];
    return {
      scanRule: rule ? {
        allSolids: rule.allSolids,
        width: rule.width,
        height: rule.height,
        area: rule.area || null,
        scans: rule.scans.map(sc => ({ type: nameOf(sc.cls), value: sc.value })).filter(sc => sc.type),
      } : null,
      slopeRules: slopes.map(r => ({
        kind: r.kind,
        type: nameOf(r.cls),
        sets: r.sets ? {
          left: [...r.sets.left], right: [...r.sets.right],
          gentleLeft: [...r.sets.gentleLeft], gentleRight: [...r.sets.gentleRight],
        } : null,
      })).filter(r => r.type),
    };
  },

  /** Restores a map's recipes from a savegame. Object types are looked up by
   *  name; any that no longer exist in the project are skipped. */
  _restoreMapRecipes(data, navKey) {
    if (navKey === null) return;
    globalNavManager.scanRules.delete(navKey);
    globalNavManager.slopeRules.delete(navKey);
    if (!data) return;
    const objects = this.instance.runtime.objects;
    const classOf = (name) => (name && objects[name]) || null;
    if (data.scanRule) {
      const r = data.scanRule;
      globalNavManager.scanRules.set(navKey, {
        allSolids: !!r.allSolids,
        width: r.width,
        height: r.height,
        area: r.area || null,
        scans: (r.scans || [])
          .map(sc => ({ cls: classOf(sc.type), value: sc.value }))
          .filter(sc => sc.cls),
      });
    }
    const slopes = (data.slopeRules || [])
      .map(r => ({
        kind: r.kind,
        cls: classOf(r.type),
        sets: r.sets ? {
          left: new Set(r.sets.left), right: new Set(r.sets.right),
          gentleLeft: new Set(r.sets.gentleLeft), gentleRight: new Set(r.sets.gentleRight),
        } : undefined,
      }))
      .filter(r => r.cls && r.kind === "ids" && r.sets);
    if (slopes.length) globalNavManager.slopeRules.set(navKey, slopes);
  },

  /** World-pixel area a map built from ALL solids covers: the layout, grown
   *  to include every enabled Solid / Jump-thru object outside it (off-layout
   *  and streamed content, negative co-ordinates), snapped to whole cells.
   *  Capped at MAX_GRID_CELLS: beyond that only the layout is covered. */
  _solidsExtent() {
    if (!this._cellSizeResolved) {
      this._autoDetectCellSizeFromClasses(this._findObjectClassesWithBehavior("Solid"));
    }
    const cs = this.cellSize;
    const layout = this.instance.layout;
    const boxes = [];
    for (const [typeName, classes] of [["Solid", this._findObjectClassesWithBehavior("Solid")],
                                       ["Jumpthru", this._findObjectClassesWithBehavior("Jumpthru")]]) {
      for (const cls of classes) {
        let insts;
        try { insts = cls.getAllInstances(); } catch (e) { continue; }
        for (const inst of insts) {
          if (!this._findEnabledBehaviorOn(inst, typeName)) continue;
          if (typeof inst.isCollisionEnabled === "boolean" && !inst.isCollisionEnabled) continue;
          if (this._isDynamicSolid(inst)) continue; // moving platforms are not part of the map
          let bb;
          try { bb = inst.getBoundingBox(); } catch (e) { continue; }
          boxes.push(bb);
        }
      }
    }
    const extentOf = (list) => {
      let x1 = 0, y1 = 0, x2 = layout.width, y2 = layout.height;
      for (const bb of list) {
        if (bb.left < x1) x1 = bb.left;
        if (bb.top < y1) y1 = bb.top;
        if (bb.right > x2) x2 = bb.right;
        if (bb.bottom > y2) y2 = bb.bottom;
      }
      x1 = Math.floor(x1 / cs) * cs; y1 = Math.floor(y1 / cs) * cs;
      x2 = Math.ceil(x2 / cs) * cs; y2 = Math.ceil(y2 / cs) * cs;
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    };
    const fits = (e) => (e.w / cs) * (e.h / cs) <= MAX_GRID_CELLS;
    let area = extentOf(boxes);
    if (fits(area)) return area;
    // Too big: drop stray objects far from the layout (parked templates and
    // the like) before falling back to the layout alone
    const margin = 4 * Math.max(layout.width, layout.height);
    area = extentOf(boxes.filter(bb =>
      bb.right >= -margin && bb.bottom >= -margin && bb.left <= layout.width + margin && bb.top <= layout.height + margin));
    this._warn(`Obstacles spread over more than ${MAX_GRID_CELLS} cells; objects far outside the layout are left out of the navigation map.`);
    return fits(area) ? area : { x: 0, y: 0, w: layout.width, h: layout.height };
  },

  /** Streaming: grows an all-solids map so it includes a cell rectangle given
   *  in CURRENT grid co-ordinates (it may be negative or past the edge), in
   *  GROW_STEP_CELLS steps. Not when a navigation area is set (the area is the
   *  map then). Returns the shift { dx, dy } applied to existing cell
   *  co-ordinates, or null when no growth was needed or possible. */
  _growGridToInclude(rect) {
    const rule = this._getScanRule();
    if (!rule || !rule.allSolids || rule.area || !this.obstacleMap || !rect) return null;
    const gw = this.gridWidth, gh = this.gridHeight;
    const needX1 = Math.min(0, rect.x), needY1 = Math.min(0, rect.y);
    const needX2 = Math.max(gw, rect.x + rect.w), needY2 = Math.max(gh, rect.y + rect.h);
    if (needX1 === 0 && needY1 === 0 && needX2 === gw && needY2 === gh) return null;
    const step = GROW_STEP_CELLS;
    const nx1 = needX1 < 0 ? -Math.ceil(-needX1 / step) * step : 0;
    const ny1 = needY1 < 0 ? -Math.ceil(-needY1 / step) * step : 0;
    const nx2 = needX2 > gw ? gw + Math.ceil((needX2 - gw) / step) * step : gw;
    const ny2 = needY2 > gh ? gh + Math.ceil((needY2 - gh) / step) * step : gh;
    if ((nx2 - nx1) * (ny2 - ny1) > MAX_GRID_CELLS) {
      if (!this._growCapWarned) {
        this._growCapWarned = true;
        this._warn(`Navigation map would exceed ${MAX_GRID_CELLS} cells; obstacles further out are not added.`);
      }
      return null;
    }
    return this._reframeGrid(nx1, ny1, nx2, ny2);
  },

  /** Moves / resizes the grid to the cell rectangle [nx1, nx2) x [ny1, ny2),
   *  given in CURRENT grid co-ordinates. It can grow, shrink, or both (a
   *  window that slides). Everything inside the overlap is kept as it is:
   *  cells are copied, node grid co-ordinates shifted and the shared graph
   *  re-keyed, and nodes that fall outside are dropped. New cells start empty
   *  (the caller rescans them). Bands along every edge that moved are queued
   *  for a graph patch, because nodes there were linked with the old edge.
   *  Returns { dx, dy, lostJobRect }: the shift applied to old cell
   *  co-ordinates, and a region scan that had to be cancelled (in new
   *  co-ordinates) so the caller can redo it. */
  _reframeGrid(nx1, ny1, nx2, ny2) {
    const gw = this.gridWidth, gh = this.gridHeight, cs = this.cellSize;
    const nw = nx2 - nx1, nh = ny2 - ny1;
    if (nw <= 0 || nh <= 0) return null;
    const navKey = this._getNavKey();
    const shrinking = nx1 > 0 || ny1 > 0 || nx2 < gw || ny2 < gh;
    // Dropping nodes mid-build would leave links to them: land builds first
    if (shrinking) {
      if (this._graphBuild) this._finishGraphBuildNow();
      else globalNavManager.finishBuildFor(navKey);
    }
    const dx = -nx1, dy = -ny1; // old cell (x, y) becomes (x + dx, y + dy)

    // 1. Cell arrays
    const copy = (src, Ctor) => this._reframeArray(src, Ctor, gw, gh, nw, nh, dx, dy);
    this.obstacleMap = copy(this.obstacleMap, Uint8Array);
    this.slopeMap = copy(this.slopeMap, Uint8Array);
    this.hazardMap = copy(this.hazardMap, Float32Array);
    this.gridOriginX -= dx * cs;
    this.gridOriginY -= dy * cs;
    this.gridWidth = nw;
    this.gridHeight = nh;
    const rule = this._getScanRule();
    if (rule) { rule.width = nw * cs; rule.height = nh * cs; }

    // 2. Graph: shift, drop what fell outside, re-key (keys depend on width)
    const graph = this._getNavigationGraph();
    const nodes = Array.from(graph.values());
    graph.clear();
    const claims = globalNavManager.goalClaims.get(navKey);
    let dropped = 0;
    for (const n of nodes) {
      n.gx += dx; n.gy += dy;
      if (n.gx < 0 || n.gy < 0 || n.gx >= nw || n.gy >= nh) {
        dropped++;
        if (claims) claims.delete(n);
        continue;
      }
      graph.set(this.gridKey(n.gx, n.gy), n);
    }
    if (dropped) this.nodeIndexArray = Array.from(graph.values());

    // 3. Every cached cell co-ordinate
    const shift = (r) => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
    const pending = globalNavManager.pendingPatches.get(navKey);
    if (pending) {
      const moved = pending.map(shift).map(r => this._clampCellRect(r)).filter(Boolean);
      if (moved.length) globalNavManager.pendingPatches.set(navKey, moved);
      else globalNavManager.pendingPatches.delete(navKey);
    }
    const owner = globalNavManager.buildOwners.get(navKey);
    if (owner && owner._graphBuild && owner._graphBuild.patch) owner._graphBuild.patch = owner._graphBuild.patch.map(shift);
    let lostJobRect = null;
    const job = globalNavManager.scanJobs.get(navKey);
    if (job && job.rect) {
      const r = shift(job.rect);
      if (r.x >= 0 && r.y >= 0 && r.x + r.w <= nw && r.y + r.h <= nh) {
        job.rect = r;
        job.target.x += dx; job.target.y += dy;
        const geos = new Set();
        for (const u of job.units) {
          u.range = { ...u.range, x1: u.range.x1 + dx, x2: u.range.x2 + dx, y1: u.range.y1 + dy, y2: u.range.y2 + dy };
          u.rowFrom += dy; u.rowTo += dy;
          if (u.range.geo) geos.add(u.range.geo);
        }
        for (const g of geos) { g.cellOffX += dx; g.cellOffY += dy; }
      } else {
        // Partly outside the new grid: drop it, the caller rescans what is left
        globalNavManager.scanJobs.delete(navKey);
        lostJobRect = this._clampCellRect(r);
      }
    }
    // (The moving-solid watcher keeps its areas in world pixels: no shift.)
    for (const inst of globalNavManager.subscribers.get(navKey) || []) {
      inst.pathTargetGridX += dx;
      inst.pathTargetGridY += dy;
    }
    this._syncMapStateToSubscribers();
    this._log(`Navigation map is now ${nw}x${nh} cells from (${this.gridOriginX}, ${this.gridOriginY})${dropped ? `, ${dropped} node(s) outside dropped` : ""}`);

    // 4. Re-link nodes along every edge that moved: old edges that now border
    //    new cells, and new edges that cut through old cells
    const oldL = dx, oldT = dy, oldR = dx + gw, oldB = dy + gh;
    const rowsY1 = Math.max(0, oldT), rowsY2 = Math.min(nh, oldB);
    const colsX1 = Math.max(0, oldL), colsX2 = Math.min(nw, oldR);
    const band = (x1, y1, x2, y2) => { if (x2 > x1 && y2 > y1) this._markRegionChanged(x1, y1, x2, y2); };
    if (oldL > 0) band(oldL - 1, rowsY1, oldL + 1, rowsY2);   // grew left
    if (oldL < 0) band(0, rowsY1, 2, rowsY2);                 // cut on the left
    if (oldR < nw) band(oldR - 1, rowsY1, oldR + 1, rowsY2);  // grew right
    if (oldR > nw) band(nw - 2, rowsY1, nw, rowsY2);          // cut on the right
    if (oldT > 0) band(colsX1, oldT - 1, colsX2, oldT + 1);   // grew up
    if (oldT < 0) band(colsX1, 0, colsX2, 2);                 // cut at the top
    if (oldB < nh) band(colsX1, oldB - 1, colsX2, oldB + 1);  // grew down
    if (oldB > nh) band(colsX1, nh - 2, colsX2, nh);          // cut at the bottom
    return { dx, dy, lostJobRect };
  },

  /** Set navigation area: the map covers exactly this world rectangle (snapped
   *  to whole cells), for streamed and endless worlds that keep a window around
   *  the action. Calling it again moves or resizes the window: the overlap is
   *  kept, only newly covered cells are scanned, cells left behind are dropped,
   *  and the graph is updated along the edges that moved. An empty area (same
   *  value for both corners on either axis) goes back to automatic coverage. */
  aceSetNavigationArea(x1, y1, x2, y2) {
    if (!this._claimSharedSetup("navArea:" + [x1, y1, x2, y2].join(","))) return;
    const cs = this.cellSize;
    const rule = this._getScanRule();
    const clear = x1 === x2 || y1 === y2;
    if (clear) {
      if (rule && rule.area) {
        rule.area = null;
        if (this.obstacleMap) { this._startScanJob(null); this._markScanJobUrgent(); }
      }
      return;
    }
    const ax1 = Math.floor(Math.min(x1, x2) / cs) * cs, ay1 = Math.floor(Math.min(y1, y2) / cs) * cs;
    const ax2 = Math.ceil(Math.max(x1, x2) / cs) * cs, ay2 = Math.ceil(Math.max(y1, y2) / cs) * cs;
    if (((ax2 - ax1) / cs) * ((ay2 - ay1) / cs) > MAX_GRID_CELLS) {
      this._warn(`Set navigation area: the area is larger than ${MAX_GRID_CELLS} cells and was ignored.`);
      return;
    }
    const area = { x: ax1, y: ay1, w: ax2 - ax1, h: ay2 - ay1 };
    if (rule) rule.area = area;
    else if (this.obstacleMapSource !== "custom") {
      // Nothing built yet: remember the area for the first (auto) build
      this._setScanRule({ allSolids: true, width: area.w, height: area.h, scans: [], area });
    }
    if (!this.obstacleMap) return;
    // A full rescan in flight was sized for the old area: restart it
    const navKey = this._getNavKey();
    const job = globalNavManager.scanJobs.get(navKey);
    if (job && !job.rect) { this._startScanJob(null); this._markScanJobUrgent(); return; }
    // Same window as now: nothing to do
    const nx1 = Math.round((ax1 - this.gridOriginX) / cs), ny1 = Math.round((ay1 - this.gridOriginY) / cs);
    const nx2 = nx1 + area.w / cs, ny2 = ny1 + area.h / cs;
    const oldW = this.gridWidth, oldH = this.gridHeight;
    if (nx1 === 0 && ny1 === 0 && nx2 === oldW && ny2 === oldH) return;
    const res = this._reframeGrid(nx1, ny1, nx2, ny2);
    if (!res) return;
    if (!rule) return; // custom map: new cells stay empty
    // Rescan the newly covered cells (the part of the new grid the old one did not cover)
    const oldRect = { x: res.dx, y: res.dy, w: oldW, h: oldH };
    const all = { x: 0, y: 0, w: this.gridWidth, h: this.gridHeight };
    let scan = this._newCellsRect(all, oldRect);
    if (res.lostJobRect) scan = scan ? this._unionCellRect(scan, res.lostJobRect) : res.lostJobRect;
    if (scan) { this._startScanJob(scan); this._markScanJobUrgent(); }
  },

  /** Bounding rect of the cells in `all` that `old` does not cover (null if none). */
  _newCellsRect(all, old) {
    const ix1 = Math.max(all.x, old.x), iy1 = Math.max(all.y, old.y);
    const ix2 = Math.min(all.x + all.w, old.x + old.w), iy2 = Math.min(all.y + all.h, old.y + old.h);
    if (ix2 <= ix1 || iy2 <= iy1) return all; // no overlap: everything is new
    const strips = [];
    if (ix1 > all.x) strips.push({ x: all.x, y: all.y, w: ix1 - all.x, h: all.h });
    if (ix2 < all.x + all.w) strips.push({ x: ix2, y: all.y, w: all.x + all.w - ix2, h: all.h });
    if (iy1 > all.y) strips.push({ x: ix1, y: all.y, w: ix2 - ix1, h: iy1 - all.y });
    if (iy2 < all.y + all.h) strips.push({ x: ix1, y: iy2, w: ix2 - ix1, h: all.y + all.h - iy2 });
    return strips.length ? strips.reduce((a, b) => this._unionCellRect(a, b)) : null;
  },

  /** Copies a per-cell array into a grid of another size, where old cell
   *  (x, y) lands on new cell (x + dx, y + dy); cells that fall outside are
   *  dropped, new cells start at 0. */
  _reframeArray(src, Ctor, oldW, oldH, newW, newH, dx, dy) {
    if (!src) return null;
    const dst = new Ctor(newW * newH);
    const sx0 = Math.max(0, -dx), sx1 = Math.min(oldW, newW - dx);
    if (sx1 <= sx0) return dst;
    for (let y = 0; y < oldH; y++) {
      const ny = y + dy;
      if (ny < 0 || ny >= newH) continue;
      dst.set(src.subarray(y * oldW + sx0, y * oldW + sx1), ny * newW + sx0 + dx);
    }
    return dst;
  },

  /** Adds a Scan action to the map's rule (once per object type and value). */
  _rememberScan(cls, value) {
    let rule = this._getScanRule();
    if (!rule) {
      const cs = this.cellSize;
      rule = { allSolids: false, width: this.gridWidth * cs, height: this.gridHeight * cs, scans: [] };
      this._setScanRule(rule);
    }
    if (!rule.scans.some(sc => sc.cls === cls && sc.value === value)) rule.scans.push({ cls, value });
  },

  /** Automatic regeneration requested by the moving-solid watcher, over the
   *  cells that changed (null = everything). Only maps built from objects
   *  (with a scan rule) can rebuild themselves. Time-sliced. */
  _autoRegenerateObstacleMap(rect) {
    const rule = this._getScanRule();
    if (!rule || !this.obstacleMap) return;
    // A region covering most of the map is cheaper as one full rescan
    if (rect && rect.w * rect.h > this.gridWidth * this.gridHeight * 0.5) rect = null;
    this._log(rect
      ? `Obstacles moved, appeared or disappeared: regenerating ${rect.w}x${rect.h} cells at (${rect.x},${rect.y})`
      : "Obstacles moved, appeared or disappeared: regenerating the obstacle map");
    this._startScanJob(rect); // automatic: never forced by Find path
  },

  /** Regenerate region by object (mirrors the built-in Pathfinding action):
   *  regenerates the area covered by the picked instances' bounding boxes. */
  aceRegenerateRegionByObject(objClass) {
    if (!objClass) return;
    let insts;
    try { insts = objClass.getPickedInstances(); } catch (e) { return; }
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const inst of insts) {
      let bb;
      try { bb = inst.getBoundingBox(); } catch (e) { continue; }
      left = Math.min(left, bb.left); top = Math.min(top, bb.top);
      right = Math.max(right, bb.right); bottom = Math.max(bottom, bb.bottom);
    }
    if (left > right) return; // nothing picked
    this.aceRegenerateRegion(left, top, right, bottom);
  },

  /** Marks this map's scan job as requested by an action this tick, so a Find
   *  path in the same tick finishes it first and paths on the new map. */
  _markScanJobUrgent() {
    const navKey = this._getNavKey();
    const job = navKey !== null ? globalNavManager.scanJobs.get(navKey) : null;
    if (job) job.urgentStamp = this.instance.runtime.gameTime;
  },

  /** Single point for "the obstacle map changed, the graph must follow".
   *  Cancels any in-flight build for this map (own or another owner's, which
   *  would otherwise finish from stale data and clear the dirty flag), shares
   *  the new map arrays with every same-map subscriber (the rebuild may be run
   *  by ANY subscriber's tick, and it reads ITS OWN references), and marks the
   *  graph dirty. The rebuild runs time-sliced from the next tick; a Find path
   *  in the meantime completes it synchronously, so same-tick flows still work. */
  _markMapChanged() {
    this._cancelGraphBuild();
    const navKey = this._getNavKey();
    if (navKey !== null) {
      const owner = globalNavManager.buildOwners.get(navKey);
      if (owner && owner !== this && owner._graphBuild) owner._cancelGraphBuild();
    }
    this._syncMapStateToSubscribers();
    this.graphGenerated = false;
    // A full rebuild supersedes any pending regional patch
    if (navKey !== null) globalNavManager.pendingPatches.delete(navKey);
  },

  /** Regenerate obstacle map (mirrors the built-in Pathfinding action): rescans
   *  every Solid / Jump-thru object where it is NOW, clears stale cells and
   *  slopes, re-applies slope registrations, and rebuilds the graph. A custom
   *  map (Create custom / Load from JSON) has no objects to rescan, so it is
   *  kept and only the graph is regenerated. */
  aceRegenerateObstacleMap() {
    if (!this._claimSharedSetup("regenerateMap")) return;
    const rule = this._getScanRule();
    if (!rule && this.obstacleMapSource === "custom") {
      this._warn("Regenerate obstacle map: this map was made with Create custom obstacle map or Load obstacle map from JSON, so there are no objects to rescan. The map is kept and only the navigation graph is regenerated.");
      this._markMapChanged();
      return;
    }
    // Rebuild the way the map was built (all solids, or the scanned types),
    // spread across frames; the current map and graph stay in use meanwhile.
    this._startScanJob(null);
    this._markScanJobUrgent();
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
      // Behaviors are added per object TYPE, so one instance shows whether the
      // type carries it. Enabled/disabled is per INSTANCE and is checked per
      // instance when scanning: a type whose first instance has its Solid
      // switched off must still be scanned.
      const behaviors = inst.behaviors;
      let found = !!behaviors[typeName];
      if (!found) {
        for (const bKey in behaviors) {
          if (behaviors[bKey]?.behaviorType?.name === typeName) { found = true; break; }
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

  /** Creates an empty custom obstacle map (all clear) with the given tile dimensions.
   *  Source becomes "custom" so _scanObstacles never overwrites it. */
  aceCreateCustomObstacleMap(widthInTiles, heightInTiles) {
    if (!this._claimSharedSetup("createCustom")) return;
    this._cancelScanJob();
    this._setScanRule(null); // a hand-made map has no objects to rebuild from
    this.gridWidth = Math.ceil(widthInTiles);
    this.gridHeight = Math.ceil(heightInTiles);
    this.gridOriginX = 0;
    this.gridOriginY = 0;
    const cellCount = this.gridWidth * this.gridHeight;
    this.obstacleMap = new Uint8Array(cellCount);
    this.obstacleMapSource = "custom";
    this.slopeMap = null;
    this._markMapChanged();
    this._trigger("OnObstacleMapCreated");
  },

  /** Creates an empty obstacle map grid from layout pixel dimensions.
   *  Sets obstacleMapSource = "collision" so _scanObstacles won't overwrite it.
   *  Follow with ScanSolidObjectsIntoObstacleMap / ScanJumpThruObjectsIntoObstacleMap. */
  aceBuildObstacleMapFromLayout(layoutWidth, layoutHeight) {
    if (!this._claimSharedSetup("buildFromLayout")) return;
    this._cancelScanJob();
    this._createMapFromLayout(layoutWidth, layoutHeight);
    // A fresh recipe: the Scan actions that follow are recorded into it
    this._setScanRule({ allSolids: false, width: layoutWidth, height: layoutHeight, scans: [] });
    this._markMapChanged();
  },

  /** Allocates a FRESH, empty obstacle map of the given pixel size. Everything
   *  derived from the previous scan is discarded with it: old solid cells AND
   *  old slopes (stale slope cells read as walkable ground, so keeping them would
   *  leave phantom ramps where objects used to be). Tile hazards are kept when
   *  the grid size is unchanged (they are event-authored, not scanned), and
   *  dropped otherwise since their indices would no longer line up. */
  _createMapFromLayout(layoutWidth, layoutHeight, originX = 0, originY = 0) {
    // Auto Tile Size: derive from the first solid tilemap in the project
    if (!this._cellSizeResolved) {
      this._autoDetectCellSizeFromClasses(this._findObjectClassesWithBehavior("Solid"));
    }
    const cs = this.cellSize;
    const gw = Math.ceil(layoutWidth / cs);
    const gh = Math.ceil(layoutHeight / cs);
    if (this.hazardMap) {
      this.hazardMap = this._reframeArray(this.hazardMap, Float32Array, this.gridWidth, this.gridHeight, gw, gh,
        Math.round(((this.gridOriginX || 0) - originX) / cs), Math.round(((this.gridOriginY || 0) - originY) / cs));
    }
    this.gridWidth = gw;
    this.gridHeight = gh;
    this.gridOriginX = originX;
    this.gridOriginY = originY;
    this.obstacleMap = new Uint8Array(gw * gh);
    this.slopeMap = null;
    this.obstacleMapSource = "collision";
    this._log(`Built obstacle map: ${gw}x${gh} cells (${gw * gh}) from (${originX}, ${originY})`);
    this._trigger("OnObstacleMapCreated");
  },

  /** Scans objects with the Solid behavior into the obstacle map as solid cells (value=1). */
  aceScanSolidObjectsIntoObstacleMap(solidClass) {
    if (!this._claimSharedSetup("scanSolid")) return;
    this._scanObjectsIntoObstacleMap(solidClass, 1);
    this._rememberScan(solidClass, 1);
    // A scan overwrites cells it covers, slope cells included; re-apply
    // remembered slope registrations so slopes survive any scan order.
    this._applySlopeRules();
    this._markMapChanged();
  },

  /** Scans objects with the Jump-thru behavior into the obstacle map as jump-thru cells (value=2). */
  aceScanJumpThruObjectsIntoObstacleMap(jumpThruClass) {
    if (!this._claimSharedSetup("scanJumpThru")) return;
    this._scanObjectsIntoObstacleMap(jumpThruClass, 2);
    this._rememberScan(jumpThruClass, 2);
    this._applySlopeRules();
    this._markMapChanged();
  },

  /** Tests whether an instance's collision polygon covers any part of a grid cell,
   *  using a 3x3 grid of point samples against the documented containsPoint test
   *  (point-in-collision-polygon, honors rotation and per-tile tilemap polygons).
   *  Point sampling approximates polygon-vs-cell intersection: samples sit at 1/6,
   *  1/2, and 5/6 of the cell, so any feature wider than about a third of a cell
   *  is caught. Smaller slivers are treated as not blocking. */
  _cellCoveredByInstance(inst, gx, gy) {
    const cs = this.cellSize;
    const baseX = this._cellLeft(gx);
    const baseY = this._cellTop(gy);
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
    const baseX = this._cellLeft(gx);
    const baseY = this._cellTop(gy);
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
    const top = this._cellTop(gy);
    const left = this._cellLeft(gx);
    const h1 = this._probeColumnSurfaceHeight(inst, left + cs / 6, top);
    const h2 = this._probeColumnSurfaceHeight(inst, left + cs / 2, top);
    const h3 = this._probeColumnSurfaceHeight(inst, left + (5 * cs) / 6, top);

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

  /** World-space geometry of a tilemap instance, used to translate between the
   *  navigation grid (anchored at world 0,0, cellSize cells) and the tilemap's
   *  own tile coordinates (anchored at its top-left corner, tileWidth x tileHeight
   *  tiles). Tilemaps can sit anywhere and use any tile size, so getTileAt(gx, gy)
   *  must NEVER be called with navigation grid coordinates directly.
   *  `aligned` = every tile maps onto exactly one grid cell (tile size equals
   *  cellSize and the position is a whole number of cells), which allows the
   *  fast tile-for-cell scan with per-tile-ID caching. Returns null when the
   *  instance doesn't expose a usable tile size. */
  _getTilemapGeometry(inst) {
    const tw = inst.tileWidth;
    const th = inst.tileHeight;
    if (typeof tw !== "number" || typeof th !== "number" || !(tw > 0) || !(th > 0)) return null;
    let bbox;
    try { bbox = inst.getBoundingBox(); } catch (e) { return null; }
    const ox = bbox.left;
    const oy = bbox.top;
    const mw = typeof inst.mapWidth === "number" ? inst.mapWidth : Math.ceil(bbox.width / tw);
    const mh = typeof inst.mapHeight === "number" ? inst.mapHeight : Math.ceil(bbox.height / th);
    const cs = this.cellSize;
    const isWhole = (v) => Math.abs(v - Math.round(v)) < 1e-6;
    const relX = (ox - (this.gridOriginX || 0)) / cs;
    const relY = (oy - (this.gridOriginY || 0)) / cs;
    const aligned = tw === cs && th === cs && isWhole(relX) && isWhole(relY);
    return {
      ox, oy, tw, th, mw, mh, aligned,
      // Grid cell of tile (0,0); only meaningful when aligned
      cellOffX: Math.round(relX),
      cellOffY: Math.round(relY),
      // World extent of the tile area
      right: ox + mw * tw,
      bottom: oy + mh * th,
    };
  },

  /** Raw tile value at tilemap-local tile coords, or -1 when empty/out of range. */
  _tileAtLocal(inst, geo, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= geo.mw || ty >= geo.mh) return -1;
    try { return inst.getTileAt(tx, ty); } catch (e) { return -1; }
  },

  /** Raw tile value under a world point, or -1 when empty/outside the tilemap. */
  _tileAtWorld(inst, geo, wx, wy) {
    return this._tileAtLocal(inst, geo, Math.floor((wx - geo.ox) / geo.tw), Math.floor((wy - geo.oy) / geo.th));
  },

  /** Whether any of a grid cell's 3x3 sample points (same layout as
   *  _cellCoveredByInstance) lies on a non-empty tile. Cheap pre-filter for
   *  misaligned tilemaps: if no sample sits on a tile, no sample can be inside
   *  a tile collision polygon either. */
  _cellHasTileSample(inst, geo, gx, gy) {
    const cs = this.cellSize;
    const baseX = this._cellLeft(gx);
    const baseY = this._cellTop(gy);
    for (let sy = 1; sy <= 5; sy += 2) {
      const py = baseY + (cs * sy) / 6;
      for (let sx = 1; sx <= 5; sx += 2) {
        if (this._tileAtWorld(inst, geo, baseX + (cs * sx) / 6, py) !== -1) return true;
      }
    }
    return false;
  },

  /** Grid cell range [x1,x2) x [y1,y2) covered by a tilemap's tile area, clamped to the grid. */
  _tilemapCellRange(geo, clamp = true) {
    const cs = this.cellSize;
    const x1 = Math.floor((geo.ox - this.gridOriginX) / cs), y1 = Math.floor((geo.oy - this.gridOriginY) / cs);
    const x2 = Math.ceil((geo.right - this.gridOriginX) / cs), y2 = Math.ceil((geo.bottom - this.gridOriginY) / cs);
    if (!clamp) return { x1, y1, x2, y2 };
    return {
      x1: Math.max(0, x1), y1: Math.max(0, y1),
      x2: Math.min(this.gridWidth, x2), y2: Math.min(this.gridHeight, y2),
    };
  },

  // ---------------------------------------------------------------------------
  // Rasterizer: draws Solid / Jump-thru instances into a SCAN TARGET, either the
  // live map (synchronous Scan actions) or a buffer covering a cell rectangle
  // (time-sliced and region scan jobs, see the scan job section below).
  // Target: { x, y, w, h, map, slope, live, slopeWritten, count, slopeCount, moverCount }
  // where (x, y, w, h) is the covered cell rectangle in grid cells.
  // ---------------------------------------------------------------------------

  /** A target that writes straight into the live obstacle/slope maps. */
  _liveScanTarget() {
    return {
      x: 0, y: 0, w: this.gridWidth, h: this.gridHeight,
      map: this.obstacleMap, slope: this.slopeMap, live: true,
      slopeWritten: new Set(), count: 0, slopeCount: 0, moverCount: 0,
    };
  },

  /** A fresh, empty buffer target covering a cell rectangle. */
  _bufferScanTarget(x, y, w, h) {
    return {
      x, y, w, h,
      map: new Uint8Array(Math.max(0, w * h)), slope: null, live: false,
      slopeWritten: new Set(), count: 0, slopeCount: 0, moverCount: 0,
    };
  },

  /** Whether an instance takes part in a scan for the given cell value
   *  (Solid = 1, Jump-thru = 2). Counts moving platforms it leaves out. */
  _isScanEligible(inst, cellValue, t, warn) {
    const requiredBehavior = cellValue === 1 ? "Solid" : "Jumpthru";
    if (!this._findEnabledBehaviorOn(inst, requiredBehavior)) {
      if (warn) this._warn(`ScanObjectsIntoObstacleMap: "${inst.objectType?.name}" skipped — no enabled "${requiredBehavior}" behavior`);
      return false;
    }
    // Documented flag: collisions disabled means the instance never blocks anything
    if (typeof inst.isCollisionEnabled === "boolean" && !inst.isCollisionEnabled) return false;
    // Moving platforms stay out of the static map (movingPlatforms.js rides them)
    if (this._isDynamicSolid(inst)) { if (t) t.moverCount++; return false; }
    return true;
  },

  /** The cell rectangle an instance can touch: [x1, x2) x [y1, y2), clamped to
   *  the grid. Tilemaps use their tile area, everything else its bounding box. */
  _instanceCellRange(inst, clamp = true) {
    const geo = typeof inst.getTileAt === "function" ? this._getTilemapGeometry(inst) : null;
    if (geo) return { geo, ...this._tilemapCellRange(geo, clamp) };
    const cs = this.cellSize;
    const bbox = inst.getBoundingBox();
    const x1 = Math.floor((bbox.left - this.gridOriginX) / cs), y1 = Math.floor((bbox.top - this.gridOriginY) / cs);
    const x2 = Math.ceil((bbox.right - this.gridOriginX) / cs), y2 = Math.ceil((bbox.bottom - this.gridOriginY) / cs);
    if (!clamp) return { geo: null, x1, y1, x2, y2 };
    return {
      geo: null,
      x1: Math.max(0, x1), y1: Math.max(0, y1),
      x2: Math.min(this.gridWidth, x2), y2: Math.min(this.gridHeight, y2),
    };
  },

  /** Rasterizes one instance into a target. Only cells inside BOTH the
   *  instance's range and the target rectangle are touched, and, when given,
   *  only rows [rowFrom, rowTo) (time-sliced jobs split big tilemaps into row
   *  bands). `cache` (optional) carries the per-tile-ID coverage cache across
   *  the bands of one aligned tilemap.
   *  Rasterization is collision-polygon accurate via containsPoint sampling:
   *  - Sprites: only cells the collision polygon actually covers are marked, so
   *    rotated or irregular solids do not over-fill their bounding box.
   *  - Tilemaps: getTileAt pre-filters empty cells cheaply, then containsPoint
   *    refines against per-tile collision polygons (tiles with collisions
   *    disabled scan as clear, partial polygons only mark covered cells).
   *  Falls back to bounding-box / tile-presence rasterization when containsPoint
   *  is unavailable. */
  _rasterizeInstance(inst, cellValue, t, range, rowFrom = -Infinity, rowTo = Infinity, cache = null) {
    const x1 = Math.max(range.x1, t.x);
    const x2 = Math.min(range.x2, t.x + t.w);
    const y1 = Math.max(range.y1, t.y, rowFrom);
    const y2 = Math.min(range.y2, t.y + t.h, rowTo);
    if (x1 >= x2 || y1 >= y2) return;

    const canPolyTest = typeof inst.containsPoint === "function";
    // Detect Slopes: classify partially-covered Solid AND Jump-thru cells by
    // probing the collision shape. A sloped jump-thru tile becomes a slope
    // cell: walkable from above, and (like every slope cell) open air to jump
    // arcs, so characters can still jump up through it. Cells written as
    // slopes this scan are tracked so a later overlapping obstacle in the same
    // scan cleanly overwrites them.
    const wantSlopes = this.detectSlopes && canPolyTest;
    const tw = t.w;

    // Applies one covered cell: slope-classified cells become slope tiles,
    // everything else becomes cellValue.
    const applyCell = (gx, gy, slopeVal) => {
      const idx = (gy - t.y) * tw + (gx - t.x);
      if (slopeVal > 0) {
        if (!t.slope) {
          t.slope = new Uint8Array(t.w * t.h);
          if (t.live) this.slopeMap = t.slope;
        }
        t.slope[idx] = slopeVal;
        t.map[idx] = 0;
        t.slopeWritten.add(idx);
        t.slopeCount++;
      } else {
        t.map[idx] = cellValue;
        if (t.slopeWritten.has(idx)) {
          t.slope[idx] = 0;
          t.slopeWritten.delete(idx);
        }
        t.count++;
      }
    };
    const fillCell = (gx, gy) => { t.map[(gy - t.y) * tw + (gx - t.x)] = cellValue; t.count++; };

    // Per-cell polygon test in world space (sprites, and tilemaps that don't
    // line up with the grid). Slope classification runs per cell, so a rotated
    // 45-degree solid sprite's diagonal edge cells legitimately become ramps.
    const scanCellByPoly = (gx, gy) => {
      if (wantSlopes) {
        const n = this._countCoveredSamples(inst, gx, gy);
        if (n === 0) return;
        applyCell(gx, gy, n < 9 ? this._classifySlopeByProbe(inst, gx, gy) : 0);
      } else {
        if (!this._cellCoveredByInstance(inst, gx, gy)) return;
        applyCell(gx, gy, 0);
      }
    };

    const geo = range.geo;
    if (geo) {
      // Tilemap. getTileAt takes the tilemap's OWN tile coordinates (from its
      // top-left corner, in tileWidth x tileHeight units), never grid cells.
      // getTileAt returns -1 for empty tiles; flipped tiles return other
      // negative raw values, so compare against exactly -1.
      if (geo.aligned) {
        // Each tile is exactly one grid cell: test tile presence directly and
        // cache coverage/slope per raw tile value (the raw value includes flip
        // bits, and identical values have identical collision shapes).
        const tileCache = cache || new Map(); // rawTile -> { covered, slope }
        for (let gy = y1; gy < y2; gy++) {
          for (let gx = x1; gx < x2; gx++) {
            const tileId = this._tileAtLocal(inst, geo, gx - geo.cellOffX, gy - geo.cellOffY);
            if (tileId === -1) continue;
            if (!canPolyTest) { fillCell(gx, gy); continue; }
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
        // Misaligned position or tile size differs from cellSize: a grid cell can
        // overlap several tiles (and a tile several cells), so per-tile caching is
        // invalid. Pre-filter cells whose samples all sit on empty tiles, then
        // test the collision polygons at world positions like a sprite.
        for (let gy = y1; gy < y2; gy++) {
          for (let gx = x1; gx < x2; gx++) {
            if (!this._cellHasTileSample(inst, geo, gx, gy)) continue;
            if (!canPolyTest) { fillCell(gx, gy); continue; }
            scanCellByPoly(gx, gy);
          }
        }
      }
    } else {
      // Sprite (or any non-tile object): cells in the bounding box, marking only
      // polygon-covered cells (full bbox fill without containsPoint).
      for (let gy = y1; gy < y2; gy++) {
        for (let gx = x1; gx < x2; gx++) {
          if (!canPolyTest) { fillCell(gx, gy); continue; }
          scanCellByPoly(gx, gy);
        }
      }
    }
  },

  /** Synchronous scan of every instance of objClass into the live map with the
   *  given cellValue (Solid = 1, Jump-thru = 2). Used by the Scan actions and by
   *  synchronous full builds (On start of layout, Find path safety valve). */
  _scanObjectsIntoObstacleMap(objClass, cellValue) {
    if (!objClass) return;
    if (!this.obstacleMap) {
      this._warn("ScanObjectsIntoObstacleMap: no obstacle map exists — call BuildObstacleMapFromLayout first");
      return;
    }
    // Every instance of the class, read at its current position. (A collision
    // candidates query returns the same set, but it is served from the
    // engine's collision cells, which can lag behind an object moved earlier
    // this tick; each instance's own bounding box never does.)
    const t = this._liveScanTarget();
    const seen = new Set();
    for (const inst of objClass.getAllInstances()) {
      if (seen.has(inst)) continue;
      seen.add(inst);
      if (!this._isScanEligible(inst, cellValue, t, true)) continue;
      this._rasterizeInstance(inst, cellValue, t, this._instanceCellRange(inst));
    }
    const requiredBehavior = cellValue === 1 ? "Solid" : "Jumpthru";
    this._log(`Scanned ${t.count} cells (value=${cellValue})${t.slopeCount > 0 ? ` + ${t.slopeCount} slope cells` : ""} from "${requiredBehavior}" objects${t.moverCount > 0 ? ` (${t.moverCount} moving object(s) left out)` : ""}`);
  },

  // ---------------------------------------------------------------------------
  // Scan jobs: time-sliced (and region) rescans. The live map stays in use
  // while a job draws into its own buffer over several ticks; on completion the
  // buffer is swapped in (full job) or copied into the live map (region job),
  // then the graph rebuilds (full) or patches just the region. One job per map,
  // stored in globalNavManager.scanJobs and stepped by the first ticking
  // instance each tick. A Find path that needs the new map finishes the job
  // synchronously first (see _ensureGraphReadyNow).
  // ---------------------------------------------------------------------------

  /** The ordered list of (object class, cell value) scans a rule implies. */
  _scanListForRule(rule) {
    const list = [];
    if (!rule || rule.allSolids) {
      for (const cls of this._findObjectClassesWithBehavior("Solid")) list.push({ cls, value: 1 });
      for (const cls of this._findObjectClassesWithBehavior("Jumpthru")) list.push({ cls, value: 2 });
    }
    if (rule) for (const sc of rule.scans) list.push({ cls: sc.cls, value: sc.value });
    return list;
  },

  /** Starts a scan job. rect = null for a full rescan (fresh grid from the
   *  rule's size), or { x, y, w, h } in cells for a region rescan of the live
   *  grid. A full job replaces any pending job; a region job merges with a
   *  pending region job (union) and is absorbed by a pending full job. */
  _startScanJob(rect) {
    const navKey = this._getNavKey();
    if (navKey === null) return;
    const rule = this._getScanRule();
    const existing = globalNavManager.scanJobs.get(navKey);
    if (rect) {
      if (!this.obstacleMap) return;
      if (existing && !existing.rect) return; // a full job already covers it
      if (existing && existing.rect) rect = this._unionCellRect(existing.rect, rect);
      rect = this._clampCellRect(rect);
      if (!rect) return;
    }

    let full = null;
    let target;
    if (rect) {
      target = this._bufferScanTarget(rect.x, rect.y, rect.w, rect.h);
    } else {
      // Full rescan: the grid size comes from the rule (or the layout)
      if (!this._cellSizeResolved) {
        this._autoDetectCellSizeFromClasses(this._findObjectClassesWithBehavior("Solid"));
      }
      const area = rule && rule.area ? rule.area
        : rule && !rule.allSolids ? { x: 0, y: 0, w: rule.width, h: rule.height }
        : this._solidsExtent();
      const gw = Math.ceil(area.w / this.cellSize);
      const gh = Math.ceil(area.h / this.cellSize);
      full = { width: area.w, height: area.h, gw, gh, ox: area.x, oy: area.y };
      target = this._bufferScanTarget(0, 0, gw, gh);
    }

    // Work units, in scan order: one per sprite, row bands for tilemaps
    const units = [];
    const savedW = this.gridWidth, savedH = this.gridHeight;
    const savedOX = this.gridOriginX, savedOY = this.gridOriginY;
    if (full) { // ranges are computed against the NEW grid
      this.gridWidth = full.gw; this.gridHeight = full.gh;
      this.gridOriginX = full.ox; this.gridOriginY = full.oy;
    }
    try {
      for (const { cls, value } of this._scanListForRule(rule)) {
        let insts;
        try { insts = cls.getAllInstances(); } catch (e) { continue; }
        for (const inst of insts) {
          if (!this._isScanEligible(inst, value, target, false)) continue;
          const range = this._instanceCellRange(inst);
          const y1 = Math.max(range.y1, target.y), y2 = Math.min(range.y2, target.y + target.h);
          if (Math.max(range.x1, target.x) >= Math.min(range.x2, target.x + target.w) || y1 >= y2) continue;
          if (range.geo) {
            const cache = range.geo.aligned ? new Map() : null;
            for (let r = y1; r < y2; r += SCAN_BAND_ROWS) {
              units.push({ inst, value, range, rowFrom: r, rowTo: Math.min(y2, r + SCAN_BAND_ROWS), cache });
            }
          } else {
            units.push({ inst, value, range, rowFrom: -Infinity, rowTo: Infinity, cache: null });
          }
        }
      }
    } finally {
      this.gridWidth = savedW; this.gridHeight = savedH;
      this.gridOriginX = savedOX; this.gridOriginY = savedOY;
    }

    globalNavManager.scanJobs.set(navKey, {
      rect, full, rule, target, units, next: 0,
      startGameTime: this.instance.runtime.gameTime,
      startTime: performance.now(), workMs: 0, ticks: 0, stamp: -1,
    });
  },

  /** Runs the map's scan job for up to budgetMs (Infinity = finish now). The
   *  first instance to tick does the work for its map each tick. */
  _stepScanJob(budgetMs = SCAN_BUDGET_MS, force = false) {
    const navKey = this._getNavKey();
    const job = navKey !== null ? globalNavManager.scanJobs.get(navKey) : null;
    if (!job) return;
    const now = this.instance.runtime.gameTime;
    if (!force && job.stamp === now) return;
    job.stamp = now;
    job.ticks++;
    const start = performance.now();
    const deadline = start + budgetMs;
    const runtime = this.instance.runtime;
    const savedW = this.gridWidth, savedH = this.gridHeight;
    const savedOX = this.gridOriginX, savedOY = this.gridOriginY;
    if (job.full) { // coverage samples are taken in the NEW grid's cells
      this.gridWidth = job.full.gw; this.gridHeight = job.full.gh;
      this.gridOriginX = job.full.ox; this.gridOriginY = job.full.oy;
    }
    try {
      while (job.next < job.units.length) {
        const u = job.units[job.next++];
        try {
          // Skip instances destroyed since the job took its snapshot
          if (runtime.getInstanceByUid(u.inst.uid) !== u.inst) continue;
          this._rasterizeInstance(u.inst, u.value, job.target, u.range, u.rowFrom, u.rowTo, u.cache);
        } catch (e) { /* destroyed since the job started */ }
        if (performance.now() >= deadline) break;
      }
    } finally {
      this.gridWidth = savedW; this.gridHeight = savedH;
      this.gridOriginX = savedOX; this.gridOriginY = savedOY;
    }
    job.workMs += performance.now() - start;
    if (job.next >= job.units.length) this._completeScanJob(job, navKey);
  },

  /** Finishes any scan job of this map synchronously (Find path safety valve,
   *  synchronous builds). */
  _finishScanJobNow() {
    const navKey = this._getNavKey();
    if (navKey !== null && globalNavManager.scanJobs.has(navKey)) this._stepScanJob(Infinity, true);
  },

  /** Drops this map's scan job (the map was replaced by other means). */
  _cancelScanJob() {
    const navKey = this._getNavKey();
    if (navKey !== null) globalNavManager.scanJobs.delete(navKey);
  },

  _completeScanJob(job, navKey) {
    globalNavManager.scanJobs.delete(navKey);
    const t = job.target;
    if (job.full) {
      // Swap the fresh map in
      const { gw, gh, width, height } = job.full;
      if (this.hazardMap) {
        const cs = this.cellSize;
        this.hazardMap = this._reframeArray(this.hazardMap, Float32Array, this.gridWidth, this.gridHeight, gw, gh,
          Math.round((this.gridOriginX - job.full.ox) / cs), Math.round((this.gridOriginY - job.full.oy) / cs));
      }
      this.gridWidth = gw;
      this.gridHeight = gh;
      this.gridOriginX = job.full.ox;
      this.gridOriginY = job.full.oy;
      this.obstacleMap = t.map;
      this.slopeMap = t.slope;
      this.obstacleMapSource = "collision";
      if (!job.rule) this._setScanRule({ allSolids: true, width, height, scans: [] });
      this._applySlopeRules();
      this._log(`Obstacle map rebuilt (time-sliced): ${gw}x${gh} cells, ${t.count} obstacle + ${t.slopeCount} slope cells, ${job.workMs.toFixed(2)}ms over ${job.ticks} tick(s)${t.moverCount ? `, ${t.moverCount} moving object(s) left out` : ""}`);
      this._trigger("OnObstacleMapCreated");
      this._markMapChanged();
      // Obstacles that changed while this job ran are not in its snapshot
      this._resyncMoversAfterFullScan();
      return;
    }
    if (!this.obstacleMap) return;
    // Region: copy the buffer into the live map (cells outside are untouched)
    const { x, y, w, h } = job.rect;
    const gw = this.gridWidth;
    if (t.slope && !this.slopeMap) this.slopeMap = new Uint8Array(gw * this.gridHeight);
    for (let row = 0; row < h; row++) {
      const src = row * w;
      const dst = (y + row) * gw + x;
      this.obstacleMap.set(t.map.subarray(src, src + w), dst);
      if (this.slopeMap) {
        if (t.slope) this.slopeMap.set(t.slope.subarray(src, src + w), dst);
        else this.slopeMap.fill(0, dst, dst + w);
      }
    }
    this._applySlopeRules();
    this._log(`Obstacle region rebuilt: ${w}x${h} cells at (${x},${y}), ${job.workMs.toFixed(2)}ms over ${job.ticks} tick(s)`);
    this._syncMapStateToSubscribers(); // a slope map may have been created
    this._markRegionChanged(x, y, x + w, y + h);
  },

  /** Clamps a cell rectangle to the grid; null when nothing is left. */
  _clampCellRect(r) {
    const x1 = Math.max(0, Math.floor(r.x)), y1 = Math.max(0, Math.floor(r.y));
    const x2 = Math.min(this.gridWidth, Math.ceil(r.x + r.w)), y2 = Math.min(this.gridHeight, Math.ceil(r.y + r.h));
    return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
  },

  _unionCellRect(a, b) {
    const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.w, b.x + b.w), y2 = Math.max(a.y + a.h, b.y + b.h);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  },

  /** Cell rectangle covering a world rectangle (any corner order). */
  _worldRectToCells(x1, y1, x2, y2) {
    const cs = this.cellSize;
    const gx1 = this._toGX(Math.min(x1, x2)), gy1 = this._toGY(Math.min(y1, y2));
    const gx2 = this._toGX(Math.max(x1, x2)) + 1, gy2 = this._toGY(Math.max(y1, y2)) + 1;
    return { x: gx1, y: gy1, w: gx2 - gx1, h: gy2 - gy1 };
  },

  /** Regenerate region (mirrors the built-in Pathfinding action): rescans the
   *  obstacles inside a world rectangle and patches only the nearby part of the
   *  navigation graph. Time-sliced; a Find path that needs the result finishes
   *  it first. Maps without objects to rescan (custom / JSON) just re-patch the
   *  graph over the area. */
  aceRegenerateRegion(x1, y1, x2, y2) {
    if (!this._claimSharedSetup("regenerateRegion:" + [x1, y1, x2, y2].join(","))) return;
    if (!this.obstacleMap) { this.aceRegenerateObstacleMap(); return; }
    const rect = this._clampCellRect(this._worldRectToCells(x1, y1, x2, y2));
    if (!rect) return;
    if (this.obstacleMapSource === "custom" && !this._getScanRule()) {
      this._markRegionChanged(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
      return;
    }
    this._startScanJob(rect);
    this._markScanJobUrgent(); // a Find path in the same tick uses the result
  },

  /** Discards the obstacle map and marks the graph dirty. After this, auto-build
   *  (or a Use/Build action) can establish a fresh map source. */
  aceClearObstacleMap() {
    this._cancelGraphBuild();
    this._cancelScanJob();
    this._forgetSlopeRules();
    this._setScanRule(null);
    this.obstacleMap = null;
    this.obstacleMapSource = null;
    this.gridWidth = 0;
    this.gridHeight = 0;
    this.gridOriginX = 0;
    this.gridOriginY = 0;
    this.graphGenerated = false;
    this._trigger("OnObstacleMapRemoved");
  },

  /** Serializes the obstacle/slope/hazard maps to a JSON string (for export or storage). */
  aceSaveObstacleMapToJSON() {
    if (!this.obstacleMap) return "{}";
    return JSON.stringify({
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      gridOriginX: this.gridOriginX,
      gridOriginY: this.gridOriginY,
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
    this._cancelScanJob();
    this._setScanRule(null); // a loaded map has no objects to rebuild from
    try {
      const data = JSON.parse(json);
      this.gridWidth = data.gridWidth;
      this.gridHeight = data.gridHeight;
      this.gridOriginX = data.gridOriginX || 0;
      this.gridOriginY = data.gridOriginY || 0;
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
      this._markMapChanged();
    } catch (e) {
      this._error("Error loading obstacle map from JSON:", e);
    }
  },

  /** Sets a tile's state by name ("solid", "clear", "jump_thru", "avoid", or a
   *  slope type). Slope states clear the obstacle cell and write slopeMap. Marks
   *  the graph dirty for an automatic (batched, time-sliced) rebuild. */
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
    // Every tile change updates the graph automatically, patching only the
    // area around the edited cell. Many edits in one event merge into ONE
    // patch, applied on the next tick (or right away by a Find path).
    this._markRegionChanged(gx, gy, gx + 1, gy + 1);
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
    // Patch the graph over the slope's cells only
    this._markRegionChanged(
      Math.min(startGx, endGx), Math.min(startGy, endGy),
      Math.max(startGx, endGx) + 1, Math.max(startGy, endGy) + 1
    );
  },

  /** Remembers a slope registration for this map, so every later rebuild of the
   *  obstacle map from objects (scan actions, Regenerate obstacle map, startup
   *  auto-build) re-applies it on top of the fresh scan. Stored per nav key in
   *  the manager (shared by every agent on the map, dropped at layout end).
   *  One rule per (kind, tilemap object type): registering again replaces it. */
  _rememberSlopeRule(rule) {
    const navKey = this._getNavKey();
    if (navKey === null) return;
    let rules = globalNavManager.slopeRules.get(navKey);
    if (!rules) {
      rules = [];
      globalNavManager.slopeRules.set(navKey, rules);
    }
    const i = rules.findIndex(r => r.kind === rule.kind && r.cls === rule.cls);
    if (i >= 0) rules[i] = rule; else rules.push(rule);
  },

  /** Forgets every remembered slope registration for this map. */
  _forgetSlopeRules() {
    const navKey = this._getNavKey();
    if (navKey !== null) globalNavManager.slopeRules.delete(navKey);
  },

  /** Re-applies every remembered slope registration to the current map, against
   *  every instance of each registered tilemap type at its current position.
   *  Idempotent, so it is safe to run after each scan. Returns the slope count. */
  _applySlopeRules() {
    const navKey = this._getNavKey();
    const rules = navKey !== null ? globalNavManager.slopeRules.get(navKey) : null;
    if (!rules || !this.obstacleMap) return 0;
    let total = 0;
    for (const rule of rules) {
      let insts;
      try { insts = rule.cls.getAllInstances(); } catch (e) { continue; }
      for (const inst of insts) total += this._applySlopeTileIds(inst, rule.sets);
    }
    return total;
  },

  /** Map slope tiles from tilemap: marks tiles with the given tile IDs as slopes.
   *  The registration is remembered, so rebuilding the obstacle map later (even
   *  after the tilemap moves or its tiles change) re-applies it automatically.
   *  Called before the map exists (e.g. On start of layout with Auto-Build), it
   *  is applied as soon as the map is built. */
  aceMapSlopeTilesFromTilemap(tilemapClass, slopeLeftIds, slopeRightIds, gentleLeftIds, gentleRightIds) {
    if (!this._claimSharedSetup("mapSlopes")) return;
    if (!tilemapClass) return;

    const parseIds = (str) => {
      if (!str || str.trim() === "") return new Set();
      return new Set(str.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)));
    };
    const sets = {
      left: parseIds(slopeLeftIds),
      right: parseIds(slopeRightIds),
      gentleLeft: parseIds(gentleLeftIds),
      gentleRight: parseIds(gentleRightIds),
    };
    if (sets.left.size === 0 && sets.right.size === 0 && sets.gentleLeft.size === 0 && sets.gentleRight.size === 0) return;

    this._rememberSlopeRule({ kind: "ids", cls: tilemapClass, sets });
    if (!this.obstacleMap) {
      this._log("MapSlopeTilesFromTilemap: no obstacle map yet. The slope tiles are remembered and applied when the map is built.");
      return;
    }
    const insts = tilemapClass.getAllInstances();
    if (insts.length === 0) {
      this._warn("MapSlopeTilesFromTilemap: tilemap instance not found");
      return;
    }
    let count = 0;
    for (const inst of insts) count += this._applySlopeTileIds(inst, sets);
    if (count > 0) this._markMapChanged();
  },

  /** Writes tile-ID slopes from one tilemap instance into the current map.
   *  Returns the number of slope cells written. */
  _applySlopeTileIds(tilemapInst, sets) {
    if (typeof tilemapInst.getTileAt !== "function") return 0;
    // Tile-ID slopes only make sense when each tile is exactly one grid cell.
    // A misaligned tile straddles cells, so its ramp doesn't run edge to edge
    // across any single cell; probing the real collision shape handles that case.
    const geo = this._getTilemapGeometry(tilemapInst);
    if (!geo || !geo.aligned) {
      this._warn(
        `MapSlopeTilesFromTilemap: skipped. The tilemap is not aligned to the navigation grid ` +
        `(its position must be a multiple of ${this.cellSize}px and its tile size must equal the Tile Size property). ` +
        `Use the Detect Slopes property instead (on by default), which works at any position.`
      );
      return 0;
    }
    if (!this.slopeMap) this.slopeMap = new Uint8Array(this.gridWidth * this.gridHeight);

    let count = 0;
    // In debug mode: collect tile IDs that exist in the tilemap but aren't in any slope set.
    // These unregistered tiles may silently allow invalid jump connections through them.
    const unregisteredIds = this.enableDebug ? new Map() : null; // baseTileId -> example {gx, gy}

    // Tile values from getTileAt() are 32-bit integers: lower 29 bits = tile ID, upper 3 = flip flags.
    // Empty tiles return -1. Tiles placed H-flipped produce negative values, so check for
    // exactly -1 and use >>> 0 to treat as unsigned when extracting the base ID and flip flags.
    const TILE_ID_MASK = 0x1FFFFFFF;
    const TILE_H_FLIP  = 0x80000000;

    const range = this._tilemapCellRange(geo);
    for (let gy = range.y1; gy < range.y2; gy++) {
      for (let gx = range.x1; gx < range.x2; gx++) {
        // Translate the grid cell to the tilemap's own tile coordinates
        const rawTile = this._tileAtLocal(tilemapInst, geo, gx - geo.cellOffX, gy - geo.cellOffY);
        if (rawTile === -1) continue; // empty cell

        const baseTileId = (rawTile >>> 0) & TILE_ID_MASK;
        // Horizontal flip mirrors slope direction: left <-> right, gentle-left <-> gentle-right
        const hFlipped   = ((rawTile >>> 0) & TILE_H_FLIP) !== 0;

        const index = gy * this.gridWidth + gx;
        let slopeVal = 0;
        if      (sets.left.has(baseTileId))        slopeVal = hFlipped ? 2 : 1;
        else if (sets.right.has(baseTileId))       slopeVal = hFlipped ? 1 : 2;
        else if (sets.gentleLeft.has(baseTileId))  slopeVal = hFlipped ? 4 : 3;
        else if (sets.gentleRight.has(baseTileId)) slopeVal = hFlipped ? 3 : 4;

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
      this._log(`[Debug] Tilemap has ${unregisteredIds.size} unregistered tile ID(s). If any are slope tiles, add them to MapSlopeTilesFromTilemap: ${examples.join("; ")}`);
    }
    return count;
  },

  // -----------------------------------------------------------------------
  // Auto slope detection
  // -----------------------------------------------------------------------

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
    if (!this.hazardMap) {
      this.hazardMap = new Float32Array(this.gridWidth * this.gridHeight);
      this._syncMapStateToSubscribers(); // shared by reference with every agent on the map
    }
    this.hazardMap[gy * this.gridWidth + gx] = severity;
    this._markHazardCostsDirty();
  },

  /** Clears every slope marking (tiles revert to whatever the obstacle map says)
   *  and marks the graph dirty. */
  aceClearAllSlopes() {
    if (this.slopeMap) this.slopeMap.fill(0);
    // Also forget remembered slope registrations, or the next map rebuild
    // would bring the cleared slopes straight back.
    this._forgetSlopeRules();
    this._markMapChanged();
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

  /** Returns the grid tile size in pixels (alias for cell size). */
  aceGetGridTileSize() {
    return this.cellSize;
  },

  /** Converts a world X position (pixels) to the corresponding grid tile X coordinate. */
  aceWorldToGridX(x) {
    return this._toGX(x);
  },

  /** Converts a world Y position (pixels) to the corresponding grid tile Y coordinate. */
  aceWorldToGridY(y) {
    return this._toGY(y);
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
