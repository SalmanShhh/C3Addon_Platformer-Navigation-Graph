import { globalNavManager } from "./navigationManager.js";

// Hazards: places characters prefer to route around. A hazard raises the cost
// of the graph nodes it covers (node.hazardMultiplier, re-baked lazily by
// _updateHazardCosts); it never blocks a route outright.
//  - Area hazards (Add hazard): a fixed rectangle or circle.
//  - Object hazards (Add hazard from object): follow their object every tick
//    (_updateTrackedHazardsIfOwner). Standing still, one covers the object's
//    collision shape. Moving or rotating, it covers the whole space the object
//    travels or turns through, learned with the same envelope as moving
//    obstacles (movingPlatforms.js), and a character that has to walk through
//    waits for it to pass, like it does for a crusher.
//  - Tile hazards (Set tile hazard): a severity per grid cell (hazardMap).
//  - Danger areas: added automatically by the obstacle watcher over moving
//    obstacles (moverUid); not counted by HazardCount.
// Every cell a hazard reaches into counts as a hazard tile, and Hazard Radius
// spreads a fading cost around it (_splatHazard), the same for every kind.
// Mixed into the instance class prototype; `this` is the behavior instance.

// Seconds a moving object hazard must stand still (or one full cycle of its
// movement, if longer) before it shrinks back to its exact shape
const HAZARD_SETTLE = 1;

export default {
  /** Marks this map's baked node hazard costs stale. They re-bake lazily
   *  before the next path follow / A* search (coalescing a burst of hazard
   *  changes in one tick into a single update). */
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

  // ==========================================================================
  // Adding and removing hazards
  // ==========================================================================

  /** Stores a new hazard record. Every character on the map avoids it from
   *  the next search on (costs re-bake lazily). Returns its ID (also
   *  readable via LastHazardID). */
  _addHazard(fields) {
    const id = globalNavManager.nextHazardId++;
    this.lastHazardId = id;
    this._getHazardsMap().set(id, { id, ...fields });
    this._markHazardCostsDirty();
    return id;
  },

  /** Adds a circular hazard centred on (x, y). */
  aceAddCircleHazard(x, y, radius, severity) {
    return this._addHazard({ type: "circle", x, y, radius, severity });
  },

  /** Adds a rectangular hazard (x, y = top-left). */
  aceAddRectHazard(x, y, width, height, severity) {
    return this._addHazard({ type: "rect", x, y, width, height, severity });
  },

  /** Add hazard: one action for any area, centred on (x, y). A rectangle
   *  fills width x height; a circle fits inside it (diameter = the smaller
   *  side). Returns the hazard ID (also LastHazardID). */
  aceAddHazard(shape, x, y, width, height, severity) {
    if (shape === "circle") {
      return this.aceAddCircleHazard(x, y, Math.min(width, height) / 2, severity);
    }
    return this.aceAddRectHazard(x - width / 2, y - height / 2, width, height, severity);
  },

  /** Add hazard from object: every picked instance becomes a hazard that
   *  follows it until it is destroyed (see _followHazardObject for what it
   *  covers). One hazard per object: calling it again only updates the
   *  severity. LastHazardID = the last instance's hazard. */
  aceAddHazardFromObject(objectClass, severity) {
    const insts = this._pickedInstancesOf(objectClass);
    if (insts.length === 0) {
      this._warn("Add hazard from object: no instances picked");
      return;
    }
    const byUid = new Map(); // existing object hazards, so repeats update instead of duplicating
    for (const h of this._getHazardsMap().values()) if (h.trackedUid != null) byUid.set(h.trackedUid, h);
    let added = 0, updated = 0;
    for (const inst of insts) {
      let uid, bb;
      try { uid = inst.uid; bb = inst.getBoundingBox(); } catch (e) { continue; }
      const existing = byUid.get(uid);
      if (existing) {
        existing.severity = severity;
        this.lastHazardId = existing.id;
        this._markHazardCostsDirty();
        updated++;
        continue;
      }
      this._addHazard({
        type: "rect", // bounds of what it covers (top-left), kept current per tick
        x: bb.left, y: bb.top, width: bb.right - bb.left, height: bb.bottom - bb.top,
        severity,
        trackedUid: uid, // the object it follows
        exact: true,     // bake from its collision shape (true while it stands still)
      });
      added++;
    }
    this._log(`Add hazard from object: ${added} new hazard(s), ${updated} updated (severity ${severity})`);
  },

  /** Remove hazard from object: removes the hazards of every picked instance
   *  without destroying the objects, e.g. spikes that retract. Add hazard
   *  from object brings them back. */
  aceRemoveHazardFromObject(objectClass) {
    const uids = new Set();
    for (const inst of this._pickedInstancesOf(objectClass)) {
      try { uids.add(inst.uid); } catch (e) {}
    }
    if (uids.size === 0) return;
    this._removeHazardsWhere((h) => uids.has(h.trackedUid));
  },

  /** The picked instances of an object parameter (empty when none). */
  _pickedInstancesOf(objectClass) {
    if (!objectClass) return [];
    try {
      const insts = objectClass.getPickedInstances();
      if (insts && insts.length) return insts;
      const one = objectClass.getFirstPickedInstance();
      return one ? [one] : [];
    } catch (e) {
      return [];
    }
  },

  /** Removes every hazard matching the test; re-bakes only if any went. */
  _removeHazardsWhere(test) {
    const hazardsMap = this._getHazardsMap();
    let removed = false;
    for (const [id, h] of hazardsMap) {
      if (test(h)) { hazardsMap.delete(id); removed = true; }
    }
    if (removed) this._markHazardCostsDirty();
  },

  /** Removes all object hazards. Area and tile hazards are untouched. */
  aceClearAllTrackedHazards() {
    this._removeHazardsWhere((h) => h.trackedUid != null);
  },

  /** Returns the number of object hazards. */
  aceGetTrackedHazardCount() {
    let n = 0;
    for (const h of this._getHazardsMap().values()) if (h.trackedUid != null) n++;
    return n;
  },

  /** Removes a hazard by ID. Node costs re-bake automatically before the next search. */
  aceRemoveHazard(hazardId) {
    if (this._getHazardsMap().delete(hazardId)) this._markHazardCostsDirty();
  },

  /** Removes all area and object hazards (tile hazards are cleared separately). */
  aceClearAllHazards() {
    this._getHazardsMap().clear();
    this._markHazardCostsDirty();
  },

  // ==========================================================================
  // Object hazards: following their objects
  // ==========================================================================

  /** Per-tick update of object hazards, once per map (gameTime stamp): each
   *  follows its object, hazards whose object was destroyed are removed
   *  (documented getInstanceByUid returns null), and costs are marked for a
   *  re-bake only when something changed, so frames where nothing moves
   *  cost one Map scan. Moving ones are listed in st.hazardMovers, which the
   *  obstacle watcher adds to its crossing-timing list (_syncMoverDangerAreas
   *  runs later in the same tick). */
  _updateTrackedHazardsIfOwner() {
    const navKey = this._getNavKey();
    if (navKey === null) return;
    const now = this.instance.runtime.gameTime;
    if (globalNavManager.trackedUpdateStamp.get(navKey) === now) return;
    globalNavManager.trackedUpdateStamp.set(navKey, now);

    // Motion records live with the map's watcher state (runtime only: never
    // saved, dropped on layout end and on load, rebuilt as objects move)
    const st = this._getMoverState(navKey);
    const recs = st.hazardRecs || (st.hazardRecs = new Map()); // object uid -> record
    const movers = st.hazardMovers || (st.hazardMovers = []);
    movers.length = 0;
    const hazardsMap = this._getHazardsMap();
    let dirty = false, followed = 0;
    for (const [id, hazard] of hazardsMap) {
      if (hazard.trackedUid == null) continue;
      const rec = this._followHazardObject(recs, hazard, now);
      if (!rec) {
        hazardsMap.delete(id);
        recs.delete(hazard.trackedUid);
        dirty = true;
        continue;
      }
      followed++;
      rec.seen = now;
      if (rec.env) movers.push(rec);
      if (rec.changed) dirty = true;
    }
    // Forget objects whose hazard was removed
    if (recs.size > followed) {
      for (const [uid, rec] of recs) if (rec.seen !== now) recs.delete(uid);
    }
    if (dirty) this._markHazardCostsDirty();
  },

  /** Updates one object hazard from its object and returns the object's
   *  motion record, or null once the object is gone. What the hazard covers:
   *   - standing still: its collision shape (exact; sampled when costs bake);
   *   - moving or rotating: the whole space it travels or turns through
   *     (_trackMoverEnvelope / _moverDangerBox, shared with moving obstacles),
   *     so routes avoid that space instead of chasing the object, and the
   *     area stops changing once its range is known. It shrinks back to the
   *     exact shape after standing still for HAZARD_SETTLE (or one cycle).
   *  rec.changed: the covered area moved by more than a quarter cell, so
   *  costs need a re-bake. */
  _followHazardObject(recs, hazard, now) {
    const uid = hazard.trackedUid;
    const inst = this.instance.runtime.getInstanceByUid(uid);
    if (!inst) return null;
    let x, y, angle, bb;
    try { x = inst.x; y = inst.y; angle = inst.angle; bb = inst.getBoundingBox(); } catch (e) { return null; }
    let rec = recs.get(uid);
    if (!rec) {
      rec = {
        uid, inst, x, y, angle, env: null, lastPoll: now, lastMove: now,
        passable: true, // crossing timing: walking through it is possible, unlike a solid
        baked: null, changed: false, seen: now,
      };
      recs.set(uid, rec);
    }

    const dx = x - rec.x, dy = y - rec.y, turned = angle !== rec.angle;
    if (dx !== 0 || dy !== 0 || turned) {
      rec.x = x; rec.y = y; rec.angle = angle;
      rec.lastMove = now;
      this._trackMoverEnvelope(rec, dx, dy, now - rec.lastPoll, now, turned);
    } else if (rec.env && now - rec.lastMove > Math.max(HAZARD_SETTLE, rec.env.cycle)) {
      rec.env = null; // it stopped
    }
    rec.lastPoll = now;

    const area = rec.env ? this._moverDangerBox(rec) : null;
    const l = area ? area.l : bb.left, t = area ? area.t : bb.top;
    const w = (area ? area.r : bb.right) - l, h = (area ? area.b : bb.bottom) - t;
    const exact = !area;
    hazard.x = l; hazard.y = t; hazard.width = w; hazard.height = h;
    hazard.exact = exact;

    const q = this.cellSize * 0.25;
    const k = rec.baked || (rec.baked = { exact: null, l: 0, t: 0, w: 0, h: 0 });
    rec.changed = k.exact !== exact || Math.abs(k.l - l) > q || Math.abs(k.t - t) > q ||
                  Math.abs(k.w - w) > q || Math.abs(k.h - h) > q;
    if (rec.changed) { k.exact = exact; k.l = l; k.t = t; k.w = w; k.h = h; }
    return rec;
  },

  // ==========================================================================
  // Queries and cost baking
  // ==========================================================================

  /** Whether a world point lies inside an area / object hazard (an object
   *  hazard standing still: inside the object's collision shape). */
  _hazardContainsPoint(h, x, y) {
    if (h.type === "circle") return this.distance(x, y, h.x, h.y) <= h.radius;
    if (x < h.x || x > h.x + h.width || y < h.y || y > h.y + h.height) return false;
    if (!h.exact) return true;
    const inst = this.instance.runtime.getInstanceByUid(h.trackedUid);
    try { return !inst || inst.containsPoint(x, y); } catch (e) { return true; }
  },

  /** Returns true if a world position falls within any area or object hazard. */
  _isPositionHazardous(x, y) {
    for (const h of this._getHazardsMap().values()) {
      if (this._hazardContainsPoint(h, x, y)) return true;
    }
    return false;
  },

  /** Returns the maximum hazard severity at a world position (1.0 = no hazard, higher = more dangerous). */
  _getHazardSeverity(x, y) {
    let maxSeverity = 1.0;
    for (const h of this._getHazardsMap().values()) {
      if (h.severity > maxSeverity && this._hazardContainsPoint(h, x, y)) maxSeverity = h.severity;
    }
    return maxSeverity;
  },

  /** Whether a hazard reaches into the cell (cl, ct)-(cr, cb); the caller
   *  only visits cells its bounds overlap, so a rectangle always does.
   *  Circles test the cell's nearest point. An exact object hazard (`shape`
   *  = its instance) tests its collision shape at 3 x 3 points across the
   *  part of the cell inside its box. */
  _hazardTouchesCell(h, shape, cl, ct, cr, cb) {
    if (h.type === "circle") {
      const nx = Math.min(Math.max(h.x, cl), cr), ny = Math.min(Math.max(h.y, ct), cb);
      return this.distance(nx, ny, h.x, h.y) < h.radius;
    }
    if (!shape) return true;
    const x1 = Math.max(cl, h.x), w = Math.min(cr, h.x + h.width) - x1;
    const y1 = Math.max(ct, h.y), hh = Math.min(cb, h.y + h.height) - y1;
    try {
      for (let i = 1; i <= 5; i += 2) {
        for (let j = 1; j <= 5; j += 2) {
          if (shape.containsPoint(x1 + (w * j) / 6, y1 + (hh * i) / 6)) return true;
        }
      }
    } catch (e) {
      return true;
    }
    return false;
  },

  /** Raises the hazard cost around one hazard cell: the full severity on
   *  the cell itself, fading out over r cells (Hazard Radius) around it. */
  _splatHazard(gx, gy, severity, r) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;
        const node = this.getNode(gx + dx, gy + dy);
        if (!node) continue;
        const effective = 1 + (severity - 1) * (1 - dist / (r + 1));
        if (effective > node.hazardMultiplier) node.hazardMultiplier = effective;
      }
    }
  },

  /** Marks isHazard on every node where a character standing there would
   *  touch the area (left, top)-(right, bottom): its body (plus the few
   *  pixels a walk can stop past a node) overlaps it. No character enters
   *  such a node (_isEdgeAllowed): it jumps over the hazard or stops short
   *  of it instead of touching it. */
  _markHazardFootprint(left, top, right, bottom) {
    const cs = this.cellSize;
    const reach = (this.characterWidth || cs) / 2 + cs * 0.3; // half body + arrival slack
    const height = this.characterHeight || cs;
    const gx1 = this._toGX(left - reach), gx2 = this._toGX(right + reach);
    const gy1 = this._toGY(top) - 1, gy2 = this._toGY(bottom + height);
    for (let gy = gy1; gy <= gy2; gy++) {
      const feet = this._cellTop(gy) + cs;
      if (feet <= top || feet - height >= bottom) continue; // body above or below it
      for (let gx = gx1; gx <= gx2; gx++) {
        const node = this.getNode(gx, gy);
        if (node && node.x + reach > left && node.x - reach < right) node.isHazard = true;
      }
    }
  },

  /** Re-bakes the hazardMultiplier on every node from the current hazards.
   *  Nodes reset in one pass, then each hazard visits only the cells it can
   *  reach, so the total is O(nodes + summed hazard area) instead of
   *  O(nodes x hazards). */
  _updateHazardCosts() {
    const graph = this._getNavigationGraph();
    for (const node of graph.values()) {
      node.hazardMultiplier = 1.0;
      node.isHazard = false;
    }
    const r = Math.max(0, Math.floor(this.hazardRadius) || 0);
    const cs = this.cellSize;
    const runtime = this.instance.runtime;

    // Area and object hazards: every cell one reaches into is a hazard cell
    // (a spike smaller than a tile, or off the grid, still marks its tile)
    for (const h of this._getHazardsMap().values()) {
      const circle = h.type === "circle";
      const left = circle ? h.x - h.radius : h.x, right = circle ? h.x + h.radius : h.x + h.width;
      const top = circle ? h.y - h.radius : h.y, bottom = circle ? h.y + h.radius : h.y + h.height;
      if (!(right > left) || !(bottom > top)) continue;
      const shape = h.exact ? runtime.getInstanceByUid(h.trackedUid) : null;
      // Standing hazards (an area, or an object holding still) get a
      // footprint Walk Only keeps out of. Not danger areas over moving
      // obstacles or moving hazard objects: those are crossed with timing.
      if (h.moverUid == null && (h.trackedUid == null || h.exact)) this._markHazardFootprint(left, top, right, bottom);
      // Cells just off the grid have no nodes, but their spread can reach it
      const gx1 = Math.max(this._toGX(left), -r), gx2 = Math.min(this._toGX(right - 0.001), this.gridWidth - 1 + r);
      const gy1 = Math.max(this._toGY(top), -r), gy2 = Math.min(this._toGY(bottom - 0.001), this.gridHeight - 1 + r);
      for (let gy = gy1; gy <= gy2; gy++) {
        const ct = this._cellTop(gy);
        for (let gx = gx1; gx <= gx2; gx++) {
          const cl = this._cellLeft(gx);
          if (this._hazardTouchesCell(h, shape, cl, ct, cl + cs, ct + cs)) {
            this._splatHazard(gx, gy, h.severity, r);
          }
        }
      }
    }

    // Tile hazards
    const tiles = this.hazardMap;
    if (tiles) {
      for (let gy = 0; gy < this.gridHeight; gy++) {
        const rowBase = gy * this.gridWidth;
        for (let gx = 0; gx < this.gridWidth; gx++) {
          const severity = tiles[rowBase + gx];
          if (severity > 0) {
            this._splatHazard(gx, gy, severity, r);
            const cl = this._cellLeft(gx), ct = this._cellTop(gy);
            this._markHazardFootprint(cl, ct, cl + cs, ct + cs);
          }
        }
      }
    }

    // Does any node touch a standing hazard? (Searches treat such maps as
    // restricted: see _isTraversalRestricted)
    let blocked = false;
    for (const node of graph.values()) if (node.isHazard) { blocked = true; break; }
    if (blocked) globalNavManager.hazardBlockedMaps.add(this.navKey);
    else globalNavManager.hazardBlockedMaps.delete(this.navKey);

    // Debug summary, only when hazards exist (so no line = no hazards) and
    // only when it changed (moving hazards re-bake often while learning)
    const count = this._getHazardsMap().size;
    if (this.enableDebug && (count > 0 || tiles)) {
      let costly = 0;
      for (const node of graph.values()) if (node.hazardMultiplier > 1) costly++;
      const line = `Hazard costs: ${count} hazard(s) on the map, ${costly} tile(s) cost more (Hazard Radius ${r})`;
      if (line !== this._lastHazardLog) { this._lastHazardLog = line; this._log(line); }
    }
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
    // Automatic danger areas over moving obstacles are not the user's hazards
    let n = 0;
    for (const h of this._getHazardsMap().values()) if (h.moverUid == null) n++;
    return n;
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
