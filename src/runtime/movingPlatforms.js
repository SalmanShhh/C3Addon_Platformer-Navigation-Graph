import { globalNavManager } from "./navigationManager.js";

// Moving platforms, fully automatic (no ACEs of its own):
//  1. A per-map WATCHER tracks every Solid / Jump-thru instance. Instances that
//     move (any cause: Sine, Tween, MoveTo, Bullet, Timeline, events), appear or
//     disappear are detected; movers are kept OUT of the static obstacle map,
//     one-shot movers (a drawbridge) are added back once they settle, and the
//     map regenerates itself (debounced) from the map's remembered scan rule.
//     Classification (_isDynamicSolid): something that moves once and then
//     stands still for SETTLE_TIME is added back; something that moves twice
//     or more stays dynamic. The watcher also catches resizes, animation
//     frames with a different collision footprint, Solid / Jump-thru /
//     collision switches (_checkMoverShape) and tilemap tile edits
//     (_sweepTilemaps).
//  2. A dynamic object WITHOUT a ride link (crusher, saw, moving spike block)
//     gets a DANGER AREA: a rect hazard tagged moverUid over its box plus its
//     travel range (_syncMoverDangerAreas). Routes avoid it, patrols turn
//     before it, HazardCount leaves it out.
//     A character that must walk through one waits at the edge until the
//     obstacle will stay out of its way long enough to cross
//     (_waitForCrossingWindow, "go when the crusher is up"). Moving hazard
//     objects (hazards.js) reuse the same envelope, swept area and timing.
//  3. Back-and-forth movers get an automatic RIDE LINK: a two-way portal of
//     type "ride" (tag "moving_platform") between the static ledges at the two
//     ends of the platform's travel, so the existing portal ACEs and triggers
//     (On portal entry, Pause at portal, PortalCountByTag...) work with it.
//  4. The RIDE state machine (_updateRide, portalState "riding") has four
//     phases: WAIT at the ledge for the platform, BOARD, RIDE (Platform physics
//     carries the character), ALIGHT at the far ledge. A Find path issued
//     during board / ride / alight is held in _deferredFindPath and runs once
//     the character is back on solid ground.
//     Platform surfaces come from the collision shape, not the image box
//     (_platformDeck: probed once per shape, cached on the watcher record).
// Mixed into the instance class prototype; `this` is the behavior instance.

const SETTLE_TIME = 0.75;        // s without motion before a one-shot mover counts as settled
const REGEN_DEBOUNCE = 0.15;     // s to coalesce map changes into one regeneration
const REGEN_MIN_INTERVAL = 0.25; // s minimum between automatic regenerations of one map
                                 // (regions are small and time-sliced, so this can be short)
const PASSIVE_SLICES = 8;        // plain solids (no other behaviors) are polled 1/8 per tick
// Tile-edit detection: tiles compared per tick, shared by every watched
// tilemap on the map (each gets an equal share, at least one row).
const TILE_CHECK_BUDGET = 2000;
const TILE_UNKNOWN = -2;         // snapshot cell not read yet (empty tiles read -1)
// Danger areas over moving obstacles you cannot ride (crushers, saws, moving
// spike blocks): hazard severity (a cost multiplier: routes avoid it, but still
// cross when there is no other way).
const MOVER_DANGER_SEVERITY = 8;
const RIDE_TAG = "moving_platform";
// Sine movements that never change the collision shape or position
const NON_GEOMETRIC_SINE = new Set(["opacity", "value-only", "z-elevation"]);

export default {
  // ==========================================================================
  // Classification helpers
  // ==========================================================================

  /** Enabled behavior instance of a plugin type on ANY world instance,
   *  handling editor-renamed behaviors (same lookup as _GetBehaviorByType). */
  _findEnabledBehaviorOn(inst, typeName) {
    const behaviors = inst && inst.behaviors;
    if (!behaviors) return null;
    const direct = behaviors[typeName];
    if (direct) return direct.isEnabled ? direct : null;
    for (const key in behaviors) {
      const b = behaviors[key];
      if (b?.behaviorType?.name === typeName) return b.isEnabled ? b : null;
    }
    return null;
  },

  /** Cheap first-sight guess that an instance moves continuously, from its
   *  movement behaviors, so a platform that is already moving on the first
   *  frame never lands in the map (avoids a scan-then-rescan at startup).
   *  Only a guess: the watcher corrects it either way (a guessed mover that
   *  never moves is added back after SETTLE_TIME). Tween and event movement
   *  are left to the watcher, since tweens are mostly one-shot. */
  _looksLikeMover(inst) {
    const sine = this._findEnabledBehaviorOn(inst, "Sine");
    if (sine) {
      const m = sine.movement;
      if (typeof m !== "string" || !NON_GEOMETRIC_SINE.has(m)) return true;
    }
    const bullet = this._findEnabledBehaviorOn(inst, "Bullet");
    if (bullet && bullet.speed !== 0) return true;
    if (this._findEnabledBehaviorOn(inst, "Orbit")) return true;
    const moveTo = this._findEnabledBehaviorOn(inst, "MoveTo");
    if (moveTo && moveTo.isMoving) return true;
    const rotate = this._findEnabledBehaviorOn(inst, "Rotate");
    if (rotate && rotate.speed !== 0) return true;
    return false;
  },

  /** Whether an instance is currently treated as a moving obstacle, so the
   *  obstacle scan must skip it. Watched instances use the watcher's verdict;
   *  unknown ones (first scan, just created) use the behavior guess. */
  _isDynamicSolid(inst) {
    const navKey = this._getNavKey();
    const st = navKey !== null ? globalNavManager.movers.get(navKey) : null;
    const rec = st ? st.recs.get(inst.uid) : null;
    if (rec) return rec.dynamic;
    return this._looksLikeMover(inst);
  },

  /** True when the instance has any behavior besides Solid / Jump-thru, i.e.
   *  something that could move it: such instances are polled every tick. */
  _hasOtherBehavior(inst) {
    const behaviors = inst.behaviors;
    if (!behaviors) return false;
    for (const key in behaviors) {
      const typeName = behaviors[key]?.behaviorType?.name || key;
      if (typeName !== "Solid" && typeName !== "Jumpthru") return true;
    }
    return false;
  },

  // ==========================================================================
  // Watcher
  // ==========================================================================

  _getMoverState(navKey) {
    let st = globalNavManager.movers.get(navKey);
    if (!st) {
      st = {
        stamp: -1,
        populated: false,
        recs: new Map(),        // uid -> rec
        active: [],             // polled every tick
        passive: [],            // polled in slices
        listsDirty: true,
        passiveCursor: 0,
        created: [],            // filled by the manager's instancecreate hook
        destroyed: [],          // uids, filled by the instancedestroy hook
        regenDue: -1,
        lastRegen: -Infinity,
        dirtyBox: null,         // union of changed WORLD rects (pixels) awaiting a region rescan
        graphVersion: -1,
      };
      globalNavManager.movers.set(navKey, st);
    }
    return st;
  },

  _makeMoverRec(inst, now) {
    let x = 0, y = 0, angle = 0, w = 0, h = 0;
    try { x = inst.x; y = inst.y; angle = inst.angle; w = inst.width; h = inst.height; } catch (e) {}
    return {
      uid: inst.uid,
      inst,
      x, y, angle, w, h,
      hasOther: this._hasOtherBehavior(inst),
      dynamic: this._looksLikeMover(inst),
      moving: false,
      lastMove: -Infinity,
      lastPoll: -1,        // game time of the last poll (speed measurement)
      moveCount: 0,
      since: now,
      env: null,
      linkDirty: false,
      ridePortalId: 0,
      box: this._moverBox(inst),     // world bounding box while it was last static
      // Shape/state tracking for obstacles that change WITHOUT moving
      solidB: this._behaviorOn(inst, "Solid"),
      jtB: this._behaviorOn(inst, "Jumpthru"),
      flags: 0,
      anim: typeof inst.animationFrame === "number" ? `${inst.animationName}:${inst.animationFrame}` : null,
      sig: undefined,                // collision footprint of the current frame (lazy)
      shapeShifter: false,
      shapeChanges: 0,
      shapeWindowStart: now,
      lastShapeChange: -Infinity,
    };
  },

  /** A behavior instance of a plugin type on an instance, enabled or not. */
  _behaviorOn(inst, typeName) {
    const behaviors = inst && inst.behaviors;
    if (!behaviors) return null;
    if (behaviors[typeName]) return behaviors[typeName];
    for (const key in behaviors) {
      if (behaviors[key]?.behaviorType?.name === typeName) return behaviors[key];
    }
    return null;
  },

  /** Bit flags of the switches that decide whether an obstacle blocks:
   *  Solid enabled, Jump-thru enabled, collisions enabled. */
  _obstacleFlags(rec) {
    let f = 0;
    if (rec.solidB && rec.solidB.isEnabled) f |= 1;
    if (rec.jtB && rec.jtB.isEnabled) f |= 2;
    try { if (rec.inst.isCollisionEnabled !== false) f |= 4; } catch (e) {} // destroyed: reads as off
    return f;
  },

  /** Collision footprint of an instance as it is now: the covered-sample
   *  count (0-9) of every cell it touches. null when too big to fingerprint
   *  cheaply (every frame change then counts as a shape change). */
  _footprintSignature(inst) {
    let r;
    try { r = this._instanceCellRange(inst); } catch (e) { return null; }
    const cells = (r.x2 - r.x1) * (r.y2 - r.y1);
    if (cells <= 0) return "";
    if (cells > 400 || r.geo) return null;
    let sig = "";
    for (let gy = r.y1; gy < r.y2; gy++) {
      for (let gx = r.x1; gx < r.x2; gx++) sig += this._countCoveredSamples(inst, gx, gy);
    }
    return sig;
  },

  /** Static obstacles can change WITHOUT moving: an animation frame with a
   *  different collision polygon (crumbling floors, opening doors), or Solid /
   *  Jump-thru / collisions switched on or off. Their area is rescanned; the
   *  object stays static. Animation frames with the same polygon cost nothing
   *  after the first change. An object that changes shape constantly (8+ times
   *  in 2 seconds) is left out of the map like a moving platform until its
   *  shape holds still for 2 seconds. Returns true when the map is affected. */
  _checkMoverShape(st, rec, now) {
    const inst = rec.inst;
    let changed = false;
    const flags = this._obstacleFlags(rec);
    if (flags !== rec.flags) { rec.flags = flags; changed = true; }
    const anim = typeof inst.animationFrame === "number" ? `${inst.animationName}:${inst.animationFrame}` : null;
    if (anim !== rec.anim) {
      rec.anim = anim;
      const sig = this._footprintSignature(inst);
      if (sig === null || sig !== rec.sig) {
        rec.sig = sig;
        changed = true;
        if (now - rec.shapeWindowStart > 2) { rec.shapeWindowStart = now; rec.shapeChanges = 0; }
        rec.shapeChanges++;
        rec.lastShapeChange = now;
      }
    }
    if (rec.shapeShifter) {
      if (now - rec.lastShapeChange <= 2) return false; // still changing: stays out of the map
      rec.shapeShifter = false;
      rec.dynamic = false;
      rec.box = this._moverBox(inst);
      this._markMoverDirty(st, rec.box);
      st.listsDirty = true;
      return true;
    }
    if (!changed) return false;
    if (rec.shapeChanges >= 8) {
      rec.shapeShifter = true;
      rec.dynamic = true;
      st.listsDirty = true;
    }
    this._markMoverDirty(st, rec.box);
    return true;
  },

  /** World bounding box of an instance in pixels, or null. */
  _moverBox(inst) {
    try {
      const bb = inst.getBoundingBox();
      return { l: bb.left, t: bb.top, r: bb.right, b: bb.bottom };
    } catch (e) { return null; }
  },

  /** Adds a changed area to the map's pending region rescan. Kept in WORLD
   *  pixels, not cells: before the rescan runs the grid may be replaced (full
   *  rescan, Build obstacle map) or grow (streaming), and a world rect stays
   *  valid through all of that. */
  _markMoverDirty(st, box) {
    if (!box) return;
    const d = st.dirtyBox;
    st.dirtyBox = d
      ? { l: Math.min(d.l, box.l), t: Math.min(d.t, box.t), r: Math.max(d.r, box.r), b: Math.max(d.b, box.b) }
      : { l: box.l, t: box.t, r: box.r, b: box.b };
  },

  /** Rescans a changed world area. Grows the map first when the area itself
   *  (not its safety margin) reaches past an edge, then rescans its cells
   *  plus a 1-cell margin (polygon edges, slope probes). */
  _regenerateDirtyBox(box) {
    const cellsOf = (pad) => {
      const x1 = this._toGX(box.l) - pad, y1 = this._toGY(box.t) - pad;
      const x2 = this._toGX(box.r - 0.001) + 1 + pad, y2 = this._toGY(box.b - 0.001) + 1 + pad;
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    };
    const core = cellsOf(0);
    if (core.w <= 0 || core.h <= 0) return;
    if (core.x < 0 || core.y < 0 || core.x + core.w > this.gridWidth || core.y + core.h > this.gridHeight) {
      this._growGridToInclude(core); // streaming (all-solids maps only)
    }
    this._autoRegenerateObstacleMap(cellsOf(1)); // cells in the (possibly grown) grid
  },

  /** Called when a FULL rescan lands: changes made while it ran were kept as
   *  world areas, so apply them now (the rescan's object snapshot predates them). */
  _resyncMoversAfterFullScan() {
    const navKey = this._getNavKey();
    const st = navKey !== null ? globalNavManager.movers.get(navKey) : null;
    if (st && st.dirtyBox && st.regenDue < 0) st.regenDue = this.instance.runtime.gameTime;
  },

  /** Starts watching a map's obstacles right away (startup scan), so objects
   *  created, destroyed or moved while the first scan runs are caught. */
  _ensureMoversPopulated() {
    const navKey = this._getNavKey();
    if (navKey === null) return;
    const st = this._getMoverState(navKey);
    if (!st.populated) this._populateMovers(st, this.instance.runtime.gameTime);
  },

  /** First run for a map: start watching every Solid / Jump-thru instance. */
  _populateMovers(st, now) {
    st.populated = true;
    // Danger areas restored from a savegame are rebuilt by this watcher
    const hazards = this._peekMapStore(globalNavManager.sharedHazards);
    if (hazards) for (const [id, h] of hazards) if (h.moverUid != null) hazards.delete(id);
    const classes = new Set([
      ...this._findObjectClassesWithBehavior("Solid"),
      ...this._findObjectClassesWithBehavior("Jumpthru"),
    ]);
    for (const cls of classes) {
      let insts;
      try { insts = cls.getAllInstances(); } catch (e) { continue; }
      for (const inst of insts) {
        if (!st.recs.has(inst.uid)) st.recs.set(inst.uid, this._makeMoverRec(inst, now));
      }
    }
    // Ride links that already exist (restored from a savegame) are adopted by
    // their platform, so the watcher updates them instead of adding a second
    // link; links whose platform no longer exists are removed.
    const portalsMap = this._peekMapStore(globalNavManager.sharedPortals);
    if (portalsMap) {
      let orphans = null;
      for (const [id, portal] of portalsMap) {
        if (!portal.ride) continue;
        const rec = st.recs.get(portal.ride.platUid);
        if (rec && !rec.ridePortalId) rec.ridePortalId = id;
        else (orphans ??= []).push(id);
      }
      if (orphans) {
        const wired = this.graphGenerated && !this._graphBuild;
        for (const id of orphans) {
          if (wired) this._removePortalConnections(id, portalsMap.get(id));
          portalsMap.delete(id);
        }
      }
    }
    st.listsDirty = true;
  },

  _rebuildMoverLists(st) {
    st.active.length = 0;
    st.passive.length = 0;
    for (const rec of st.recs.values()) {
      if (rec.flags === 0) rec.flags = this._obstacleFlags(rec); // first sight
      if (rec.hasOther || rec.dynamic || rec.moveCount > 0) st.active.push(rec);
      else st.passive.push(rec);
    }
    st.passiveCursor = 0;
    st.listsDirty = false;
    this._syncTileWatches(st);
  },

  // ---------------------------------------------------------------------------
  // Tile-edit detection. Construct raises no event when a tile is set or
  // erased, so every Solid / Jump-thru tilemap keeps a snapshot of its raw
  // tile values and a few rows are compared each tick (TILE_CHECK_BUDGET
  // tiles per tick across all tilemaps). The snapshot fills in during the
  // first sweep without reporting changes, so there is no startup spike.
  // Changed tiles are rescanned as a world-space region like any other change.
  // ---------------------------------------------------------------------------

  /** Keeps one watch per tilemap record (added on first sight, dropped when
   *  the tilemap is destroyed). */
  _syncTileWatches(st) {
    if (!st.tileWatches) { st.tileWatches = new Map(); st.tileWatchList = []; st.tileWatchCursor = 0; }
    let changed = false;
    for (const [uid, rec] of st.recs) {
      if (st.tileWatches.has(uid) || typeof rec.inst.getTileAt !== "function") continue;
      st.tileWatches.set(uid, { rec, mw: 0, mh: 0, snap: null, row: 0 });
      changed = true;
    }
    for (const uid of st.tileWatches.keys()) {
      if (!st.recs.has(uid)) { st.tileWatches.delete(uid); changed = true; }
    }
    if (changed) {
      st.tileWatchList = Array.from(st.tileWatches.values());
      st.tileWatchCursor = 0;
    }
  },

  /** Compares the next rows of every watched tilemap with its snapshot.
   *  Returns true when a tile edit was found (its area is marked dirty). */
  _sweepTilemaps(st) {
    const list = st.tileWatchList;
    if (!list || list.length === 0) return false;
    const n = list.length;
    const share = Math.max(1, Math.floor(TILE_CHECK_BUDGET / n));
    let budget = TILE_CHECK_BUDGET;
    let found = false;
    let visited = 0;
    let i = st.tileWatchCursor % n;
    while (budget > 0 && visited < n) {
      const res = this._sweepTilemap(st, list[i], Math.min(share, budget));
      budget -= Math.max(1, res.checked);
      if (res.changed) found = true;
      visited++;
      i = (i + 1) % n;
    }
    st.tileWatchCursor = i;
    return found;
  },

  /** Sweeps rows of one tilemap. Moving tilemaps are skipped (left out of the
   *  map anyway); a resized tile area restarts its snapshot. */
  _sweepTilemap(st, w, maxTiles) {
    const rec = w.rec;
    if (rec.dynamic) return { checked: 0, changed: false };
    const inst = rec.inst;
    const geo = this._getTilemapGeometry(inst);
    if (!geo || geo.mw <= 0 || geo.mh <= 0) return { checked: 0, changed: false };
    if (!w.snap || geo.mw !== w.mw || geo.mh !== w.mh) {
      w.mw = geo.mw;
      w.mh = geo.mh;
      w.snap = new Int32Array(w.mw * w.mh).fill(TILE_UNKNOWN);
      w.row = 0;
    }
    const rows = Math.min(w.mh, Math.max(1, Math.floor(maxTiles / w.mw)));
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let k = 0; k < rows; k++) {
      const ty = w.row;
      const base = ty * w.mw;
      for (let tx = 0; tx < w.mw; tx++) {
        let v;
        try { v = inst.getTileAt(tx, ty); } catch (e) { v = -1; }
        const old = w.snap[base + tx];
        if (old !== v) {
          w.snap[base + tx] = v;
          if (old !== TILE_UNKNOWN) {
            if (tx < minX) minX = tx;
            if (tx > maxX) maxX = tx;
            if (ty < minY) minY = ty;
            if (ty > maxY) maxY = ty;
          }
        }
      }
      w.row = (w.row + 1) % w.mh;
    }
    const checked = rows * w.mw;
    if (maxX < 0) return { checked, changed: false };
    this._markMoverDirty(st, {
      l: geo.ox + minX * geo.tw, t: geo.oy + minY * geo.th,
      r: geo.ox + (maxX + 1) * geo.tw, b: geo.oy + (maxY + 1) * geo.th,
    });
    return { checked, changed: true };
  },

  /** Polls one watched instance. Returns true when the STATIC map is affected
   *  (an obstacle started moving, or a one-shot mover settled somewhere new). */
  _pollMover(st, rec, now) {
    // Game time since this record was last polled. Passive solids are polled
    // every few ticks, so this (not one tick of dt) matches the distance
    // moved. It is game time, not the owning character's dt: a character
    // with its own time scale must not skew a platform's measured speed.
    const elapsed = rec.lastPoll >= 0 ? now - rec.lastPoll : 0;
    rec.lastPoll = now;
    let x, y, angle, w, h;
    try {
      x = rec.inst.x; y = rec.inst.y; angle = rec.inst.angle; w = rec.inst.width; h = rec.inst.height;
    } catch (e) {
      st.destroyed.push(rec.uid); // destroyed without an event reaching us
      return false;
    }
    let affected = false;
    const moved = x !== rec.x || y !== rec.y || angle !== rec.angle || w !== rec.w || h !== rec.h;
    if (moved) {
      const dx = x - rec.x, dy = y - rec.y, turned = angle !== rec.angle;
      if (!rec.moving) {
        rec.moving = true;
        rec.moveCount++;
        if (!rec.hasOther && !rec.dynamic) st.listsDirty = true; // promote to active polling
      }
      rec.lastMove = now;
      if (!rec.dynamic) {
        // Leaves the static map: its old cells must be cleared
        rec.dynamic = true;
        this._markMoverDirty(st, rec.box);
        affected = true;
      }
      rec.x = x; rec.y = y; rec.angle = angle; rec.w = w; rec.h = h;
      this._trackMoverEnvelope(rec, dx, dy, elapsed, now, turned);
    } else if (rec.moving && now - rec.lastMove >= SETTLE_TIME) {
      rec.moving = false;
    }
    // One-shot movers (moved at most once, now still) and guessed movers that
    // never moved go back into the static map. Recurring movers stay out.
    if (rec.dynamic && !rec.moving && rec.moveCount <= 1 && !rec.shapeShifter &&
        now - Math.max(rec.lastMove, rec.since) >= SETTLE_TIME) {
      rec.dynamic = false;
      rec.env = null;
      this._removeRideLink(rec);
      st.listsDirty = true;
      // Joins the static map where it settled
      rec.box = this._moverBox(rec.inst);
      this._markMoverDirty(st, rec.box);
      affected = true;
    }
    // Shape and on/off changes of obstacles that did not move
    if (!moved && (!rec.dynamic || rec.shapeShifter)) {
      if (this._checkMoverShape(st, rec, now)) affected = true;
    }
    return affected;
  },

  /** Completes a new envelope at once for an object moved by an enabled
   *  horizontal or vertical Sine behavior, from its documented scripting
   *  properties (ISineBehaviorInstance): the centre is the current position
   *  minus `value` (the offset Sine applies now), the ends are centre ±
   *  `magnitude` for every wave type, and `period` is the cycle. So a Sine
   *  platform gets its ride link (or a Sine hazard its full swept area) on
   *  its first move instead of after one full trip. Returns false for any
   *  other movement, which is learned by watching as before. */
  _seedSineEnvelope(rec, env, pose) {
    const sine = this._findEnabledBehaviorOn(rec.inst, "Sine");
    if (!sine) return false;
    const horizontal = sine.movement === "horizontal";
    if (!horizontal && sine.movement !== "vertical") return false;
    const magnitude = Math.abs(sine.magnitude), period = sine.period, offset = sine.value;
    if (!(magnitude > 0) || !(period > 0) || !Number.isFinite(offset)) return false;
    const end = (d) => {
      const dx = horizontal ? d : 0, dy = horizontal ? 0 : d;
      return { x: pose.x + dx, y: pose.y + dy, left: pose.left + dx, right: pose.right + dx, top: pose.top + dy, bottom: pose.bottom + dy };
    };
    const lo = end(-magnitude - offset), hi = end(magnitude - offset);
    if (horizontal) { env.minX = lo; env.maxX = hi; } else { env.minY = lo; env.maxY = hi; }
    env.cycle = period;
    env.speed = (4 * magnitude) / period; // average speed over a cycle
    env.established = true;
    env.sine = { movement: sine.movement, magnitude: sine.magnitude, period: sine.period };
    rec.linkDirty = true;
    return true;
  },

  /** Whether the Sine behind a seeded envelope changed since (an event set
   *  its movement, magnitude or period, or disabled it). Checked on every
   *  move, so a shrunk range is caught too (watching only notices growth). */
  _sineChanged(rec, seen) {
    const sine = this._findEnabledBehaviorOn(rec.inst, "Sine");
    return !sine || sine.movement !== seen.movement ||
      sine.magnitude !== seen.magnitude || sine.period !== seen.period;
  },

  /** Records the travel envelope of a moving object (rec.x / rec.y already
   *  hold its new position): its poses at the extremes of each axis, direction
   *  reversals, average speed, cycle time and, while it rotates (turned), how
   *  far its box reaches around its origin at every angle seen (spin). The
   *  envelope is "established" once the dominant axis has reversed twice
   *  (both ends visited), which is when a ride link can be made. Shared by
   *  the watcher and moving hazard objects (hazards.js). */
  _trackMoverEnvelope(rec, dx, dy, elapsed, now, turned = false) {
    const x = rec.x, y = rec.y;
    // A pose (with bounding box) is only captured at a NEW extreme, so a
    // platform cycling inside its known range allocates nothing per tick.
    const capture = () => {
      let bb;
      try { bb = rec.inst.getBoundingBox(); } catch (e) { return null; }
      return { x, y, left: bb.left, right: bb.right, top: bb.top, bottom: bb.bottom };
    };
    let env = rec.env;
    // A Sine that was changed: start over (re-seeded from its new settings,
    // or learned by watching if it no longer moves the object back and forth)
    const sineChanged = !!(env && env.sine && this._sineChanged(rec, env.sine));
    if (sineChanged) env = rec.env = null;
    const fresh = !env;
    if (fresh) {
      const pose = capture();
      if (!pose) return;
      env = rec.env = {
        minX: pose, maxX: pose, minY: pose, maxY: pose,
        sx: 0, sy: 0, revX: 0, revY: 0,
        lastRevT: -1, cycle: 0, speed: 0, established: false,
        spin: null, // box reach around the origin while rotating (relative l/t/r/b)
      };
      // A Sine platform states its range up front: no full trip to watch
      if (this._seedSineEnvelope(rec, env, pose)) return;
      // No longer a Sine back-and-forth: drop its ride link until watching
      // learns the new range (hazard records have none)
      if (sineChanged) this._removeRideLink(rec);
    }
    if (turned) {
      let bb;
      try { bb = rec.inst.getBoundingBox(); } catch (e) { bb = null; }
      if (bb) {
        const s = env.spin;
        if (!s) {
          env.spin = { l: bb.left - x, t: bb.top - y, r: bb.right - x, b: bb.bottom - y };
        } else {
          if (bb.left - x < s.l) s.l = bb.left - x;
          if (bb.top - y < s.t) s.t = bb.top - y;
          if (bb.right - x > s.r) s.r = bb.right - x;
          if (bb.bottom - y > s.b) s.b = bb.bottom - y;
        }
      }
    }
    if (fresh) return;
    const grew =
      (x < env.minX.x - 1) || (x > env.maxX.x + 1) ||
      (y < env.minY.y - 1) || (y > env.maxY.y + 1);
    if (x < env.minX.x || x > env.maxX.x || y < env.minY.y || y > env.maxY.y) {
      const pose = capture();
      if (pose) {
        if (x < env.minX.x) env.minX = pose;
        if (x > env.maxX.x) env.maxX = pose;
        if (y < env.minY.y) env.minY = pose;
        if (y > env.maxY.y) env.maxY = pose;
      }
    }

    const horizontal = (env.maxX.x - env.minX.x) >= (env.maxY.y - env.minY.y);
    const sgnX = Math.abs(dx) > 0.01 ? Math.sign(dx) : 0;
    const sgnY = Math.abs(dy) > 0.01 ? Math.sign(dy) : 0;
    let domReversed = false;
    if (sgnX) {
      if (env.sx && sgnX !== env.sx) { env.revX++; if (horizontal) domReversed = true; }
      env.sx = sgnX;
    }
    if (sgnY) {
      if (env.sy && sgnY !== env.sy) { env.revY++; if (!horizontal) domReversed = true; }
      env.sy = sgnY;
    }
    if (domReversed) {
      if (env.lastRevT >= 0) {
        const full = 2 * (now - env.lastRevT);
        env.cycle = env.cycle ? env.cycle * 0.7 + full * 0.3 : full;
      }
      env.lastRevT = now;
    }
    if (elapsed > 0) {
      const v = Math.hypot(dx, dy) / elapsed;
      env.speed = env.speed ? env.speed * 0.9 + v * 0.1 : v;
    }
    const revs = horizontal ? env.revX : env.revY;
    if (!env.established && revs >= 2) {
      env.established = true;
      rec.linkDirty = true;
    } else if (env.established && grew) {
      rec.linkDirty = true;
    }
  },

  /** Per-tick watcher, once per map per tick (first ticking instance does it). */
  _updateMoversIfOwner() {
    const navKey = this.navKey;
    if (navKey === null || !this.obstacleMap) return;
    const now = this.instance.runtime.gameTime;
    const st = this._getMoverState(navKey);
    if (st.stamp === now) return;
    st.stamp = now;
    if (!st.populated) this._populateMovers(st, now);

    let mapChanged = false;

    // Instances created since last tick (pre-filtered to Solid/Jump-thru types)
    if (st.created.length) {
      for (const inst of st.created) {
        let uid;
        try { uid = inst.uid; } catch (e) { continue; }
        if (st.recs.has(uid)) continue;
        const rec = this._makeMoverRec(inst, now);
        st.recs.set(uid, rec);
        st.listsDirty = true;
        if (!rec.dynamic) { mapChanged = true; this._markMoverDirty(st, rec.box); } // a new static obstacle
      }
      st.created.length = 0;
    }
    // Destroyed instances
    if (st.destroyed.length) {
      for (const uid of st.destroyed) {
        const rec = st.recs.get(uid);
        if (!rec) continue;
        if (!rec.dynamic) { mapChanged = true; this._markMoverDirty(st, rec.box); } // a static obstacle vanished
        this._removeRideLink(rec);
        st.recs.delete(uid);
        st.listsDirty = true;
      }
      st.destroyed.length = 0;
    }

    if (st.listsDirty) this._rebuildMoverLists(st);
    for (const rec of st.active) {
      if (this._pollMover(st, rec, now)) mapChanged = true;
    }
    const pn = st.passive.length;
    if (pn > 0) {
      const slice = Math.ceil(pn / PASSIVE_SLICES);
      for (let i = 0; i < slice; i++) {
        const rec = st.passive[(st.passiveCursor + i) % pn];
        if (this._pollMover(st, rec, now)) mapChanged = true;
      }
      st.passiveCursor = (st.passiveCursor + slice) % pn;
    }
    // Tile edits on Solid / Jump-thru tilemaps (Set tile, Erase tile)
    if (this._sweepTilemaps(st)) mapChanged = true;

    // Debounced automatic regeneration of the static map
    if (mapChanged && st.regenDue < 0) {
      st.regenDue = Math.max(now + REGEN_DEBOUNCE, st.lastRegen + REGEN_MIN_INTERVAL);
    }
    if (st.regenDue >= 0 && now >= st.regenDue) {
      // Changes made during a FULL rescan wait for it to land (it may replace
      // the grid); their world areas stay valid meanwhile.
      const job = globalNavManager.scanJobs.get(navKey);
      if (!job || job.rect) {
        st.regenDue = -1;
        st.lastRegen = now;
        const box = st.dirtyBox;
        st.dirtyBox = null;
        if (box) this._regenerateDirtyBox(box); // region rescan + graph patch
      }
    }

    // Danger areas over moving obstacles that cannot be ridden
    this._syncMoverDangerAreas(st);

    // Ride links: (re)place after every graph rebuild and whenever an
    // envelope changes. Only on a fully built graph.
    if (!this.graphGenerated || this._graphBuild || globalNavManager.isBuildInProgress(navKey)) return;
    const version = globalNavManager.graphVersion.get(navKey) || 0;
    const rebuilt = version !== st.graphVersion;
    st.graphVersion = version;
    for (const rec of (rebuilt ? st.recs.values() : st.active)) {
      if (rebuilt || rec.linkDirty) {
        rec.linkDirty = false;
        if (rec.dynamic && rec.env && rec.env.established) this._syncRideLink(rec);
      }
    }
  },

  // ==========================================================================
  // Danger areas: a moving Solid / Jump-thru object that has no ride link
  // (a crusher, a swinging block, a patrolling spike block, a rotating saw)
  // gets a rect hazard over the space it sweeps through: its travel range once
  // known, otherwise where it is now (following it). Characters then prefer
  // other routes, and patrolling guards turn before it. Managed automatically:
  // removed when the object stops, gets a ride link, or is destroyed. Marked
  // with moverUid so HazardCount leaves them out.
  // ==========================================================================

  _syncMoverDangerAreas(st) {
    const hazards = this._getHazardsMap();
    if (!st.zones) st.zones = new Map(); // object uid -> hazard id
    // Records with a danger area, with their boxes cached for this tick
    // (rec.dangerBox, rec.curBox), so walking characters read numbers
    // instead of each querying every obstacle (crossing timing).
    if (!st.zoneRecs) st.zoneRecs = [];
    st.zoneRecs.length = 0;
    const cs = this.cellSize;
    for (const [uid, hid] of st.zones) {
      const rec = st.recs.get(uid);
      if (!rec || !rec.dynamic || rec.ridePortalId) {
        if (hazards.delete(hid)) this._markHazardCostsDirty();
        st.zones.delete(uid);
      }
    }
    for (const rec of st.active) {
      if (!rec.dynamic || rec.ridePortalId) continue;
      const box = this._moverDangerBox(rec);
      if (!box) continue;
      st.zoneRecs.push(rec);
      const w = box.r - box.l, h = box.b - box.t;
      let zone = hazards.get(st.zones.get(rec.uid));
      if (!zone) {
        const id = globalNavManager.nextHazardId++;
        zone = { id, type: "rect", x: box.l, y: box.t, width: w, height: h, severity: MOVER_DANGER_SEVERITY, moverUid: rec.uid };
        hazards.set(id, zone);
        st.zones.set(rec.uid, id);
        this._markHazardCostsDirty();
      } else if (Math.abs(zone.x - box.l) > cs / 4 || Math.abs(zone.y - box.t) > cs / 4 ||
                 Math.abs(zone.width - w) > cs / 4 || Math.abs(zone.height - h) > cs / 4) {
        zone.x = box.l; zone.y = box.t; zone.width = w; zone.height = h;
        this._markHazardCostsDirty();
      }
    }
    // Moving hazard objects (Add hazard from object) get the same crossing
    // timing; hazards.js keeps their records and boxes current
    if (st.hazardMovers) for (const rec of st.hazardMovers) st.zoneRecs.push(rec);
  },

  /** The world area a moving object sweeps: its bounding box, plus its
   *  travel range once that is known, plus every angle it turns through, with
   *  a quarter-cell margin. Also caches the object's current box. Both are
   *  stored on the record and reused (no allocation per tick); called once
   *  per map per tick, for obstacles here and for hazard objects (hazards.js). */
  _moverDangerBox(rec) {
    let bb;
    try { bb = rec.inst.getBoundingBox(); } catch (e) { rec.dangerBox = null; return null; }
    const cur = rec.curBox || (rec.curBox = { l: 0, t: 0, r: 0, b: 0 });
    cur.l = bb.left; cur.t = bb.top; cur.r = bb.right; cur.b = bb.bottom;
    let l = bb.left, t = bb.top, r = bb.right, b = bb.bottom;
    const env = rec.env;
    const known = env && env.established;
    if (known) {
      const grow = (p) => {
        if (p.left < l) l = p.left;
        if (p.top < t) t = p.top;
        if (p.right > r) r = p.right;
        const pb = p.bottom ?? p.top;
        if (pb > b) b = pb;
      };
      grow(env.minX); grow(env.maxX); grow(env.minY); grow(env.maxY);
    }
    const s = env && env.spin;
    if (s) {
      // Rotating (a saw, a swinging bar): its reach at every angle seen,
      // around each end of its travel
      l = Math.min(l, (known ? env.minX.x : rec.x) + s.l);
      t = Math.min(t, (known ? env.minY.y : rec.y) + s.t);
      r = Math.max(r, (known ? env.maxX.x : rec.x) + s.r);
      b = Math.max(b, (known ? env.maxY.y : rec.y) + s.b);
    }
    const m = this.cellSize * 0.25;
    const box = rec.dangerBox || (rec.dangerBox = { l: 0, t: 0, r: 0, b: 0 });
    box.l = l - m; box.t = t - m; box.r = r + m; box.b = b + m;
    return box;
  },

  // ==========================================================================
  // Crossing timing ("go when the crusher is up"). A walking character about
  // to enter a danger area stops at its edge until the obstacle will stay out
  // of its body's way long enough to get across, then walks through.
  //
  // Two sources of timing, best first:
  //  1. MEASURED: while waiting, the character times how long the way stays
  //     open (_crossObs). From then on it goes when the remaining open time
  //     covers the crossing, or, if the window is always too short, right as
  //     the way opens (the best moment there is). Works for any movement:
  //     Sine, Tween, Timeline pauses, events.
  //  2. PREDICTED (before anything is measured): the obstacle moves back and
  //     forth between the measured ends of its travel (env) at a high-side
  //     speed. Deliberately cautious; if it says no, the character simply
  //     waits one cycle and uses the measurement.
  // ==========================================================================

  /** Called every tick by the walk executor. Returns true while the character
   *  should stand still and wait for a crossing window. walkEndX: where the
   *  current stretch of walking ends (_walkRunEndX), not just the next tile. */
  _waitForCrossingWindow(direction, walkEndX) {
    // Cost: nothing on maps without moving obstacles; otherwise a few
    // comparisons per obstacle on cached boxes, and the timing check only for
    // an obstacle right ahead.
    const st = globalNavManager.movers.get(this.navKey);
    const recs = st && st.zoneRecs;
    if (!recs || recs.length === 0) { this._crossWait = 0; this._crossObs = null; return false; }
    let bb;
    try { bb = this.instance.getBoundingBox(); } catch (e) { return false; }
    const right = direction === "right";
    const speedNow = Math.abs(this.platformBehavior.vectorX || 0);
    const decel = this.platformProps.deceleration || 1500;
    // Start checking early enough to stop before the area's edge
    const lookahead = (speedNow * speedNow) / (2 * decel) + this.cellSize * 0.5;
    const now = this.instance.runtime.gameTime;
    // _crossGo: the obstacle this character already decided to cross. Not
    // re-checked until it is inside the area, so a "go" cannot flip back to
    // "wait" while it speeds up (the check assumes a standing start).
    // _crossObs.uid: the obstacle it is waiting for. Kept in view whatever the
    // distance, so a character that stopped a little early does not creep
    // forward (and reset its measurement) every time the lookahead shrinks.
    let blocker = null, goSeen = false;
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      const zone = rec.dangerBox;
      if (!zone || !rec.env) continue;
      if (zone.b <= bb.top || zone.t >= bb.bottom) continue;          // not at body height
      const gap = right ? zone.l - bb.right : bb.left - zone.r;
      const watching = this._crossObs && this._crossObs.uid === rec.uid;
      // Inside (keep going) or still far. The area has a quarter-cell safety
      // margin: standing in it is still "at the edge", not crossing.
      if (gap < -this.cellSize * 0.25 || (gap > lookahead && !watching)) continue;
      if (right ? walkEndX < zone.l : walkEndX > zone.r) continue;        // the path stops before it
      if (rec.uid === this._crossGo) { goSeen = true; continue; }       // already going
      if (this._crossingIsSafe(rec, bb, zone, right, now)) {
        this._crossGo = rec.uid; goSeen = true;
        this._crossObs = null;
      } else {
        blocker = rec;
        break;
      }
    }
    if (!goSeen || blocker) this._crossGo = null; // null, not 0: 0 is a valid UID
    if (!blocker) { this._crossWait = 0; if (!goSeen) this._crossObs = null; return false; }

    const dt = this.instance.dt;
    if (!this._crossWait) this._log(`Waiting for a moving obstacle (UID ${blocker.uid}) to leave the way before crossing`);
    this._crossWait = (this._crossWait || 0) + dt;
    if (this._crossWait > this.maxWaypointTime * 3) {
      // Never opens (it stopped in the way, or never moves far enough)
      this._crossWait = 0;
      this._crossObs = null;
      this._log("Moving obstacle never left the way: repathing");
      this._rePath();
      return true;
    }
    this.timeAtWaypoint = Math.max(0, this.timeAtWaypoint - dt); // waiting is not stuck
    this._walkStuckCount = 0;
    return true;
  },

  /** Whether the character (bounding box bb) can walk across `zone` starting
   *  now without the obstacle reaching its body. Also times the obstacle's
   *  open windows while the character waits (see the section comment). */
  _crossingIsSafe(rec, bb, zone, right, now) {
    const env = rec.env;
    const horizontal = (env.maxX.x - env.minX.x) >= (env.maxY.y - env.minY.y);
    const lo = horizontal ? env.minX.x : env.minY.y;
    const hi = horizontal ? env.maxX.x : env.maxY.y;
    if (hi - lo < 2) return true; // only rotates or resizes in place: nothing to time
    const mb = rec.curBox; // cached this tick by _moverDangerBox
    if (!mb) return true;
    let p;
    try { p = horizontal ? rec.inst.x : rec.inst.y; } catch (e) { return true; }

    // The space the body sweeps while crossing: from where it stands to past
    // the area's far edge; from just above its head down to (not including)
    // the floor it walks on, so a block level with the floor does not count.
    const w = bb.right - bb.left;
    const cx1 = right ? bb.left : zone.l - w, cx2 = right ? zone.r + w : bb.right;
    const cy1 = bb.top - 2, cy2 = bb.bottom - 1;

    // Positions p' (along the axis) at which the obstacle overlaps that space
    let bLo, bHi;
    if (horizontal) {
      if (mb.b <= cy1 || mb.t >= cy2) return true; // never at body height
      bLo = p + (cx1 - mb.r); bHi = p + (cx2 - mb.l);
    } else {
      if (mb.r <= cx1 || mb.l >= cx2) return true; // never over the path
      bLo = p + (cy1 - mb.b); bHi = p + (cy2 - mb.t);
    }
    // A hazard (passable, unlike a solid) whose whole travel stays in the way
    // never leaves a gap: waiting cannot help, so go (its cost already made
    // this the route of last resort)
    if (rec.passable && env.established && lo > bLo && hi < bHi) return true;

    // Time to get across from a standstill, with a margin
    const dist = right ? zone.r - bb.left : bb.right - zone.l;
    const maxSpeed = this.platformProps.maxSpeed || 200;
    const accel = this.platformProps.acceleration || 1500;
    const crossTime = (dist / maxSpeed + maxSpeed / (2 * accel)) * 1.15 + 0.1;

    // Window timing for this obstacle. openSince: when the way last opened
    // (-1 while blocked). window: the length of the last open window seen
    // (-1 = none yet; one that was already open on arrival is shorter than
    // the real one, which only errs on the safe side).
    let obs = this._crossObs;
    if (!obs || obs.uid !== rec.uid) obs = this._crossObs = { uid: rec.uid, openSince: -1, window: -1 };
    if (p > bLo && p < bHi) {
      // In the way right now
      if (obs.openSince >= 0) { obs.window = now - obs.openSince; obs.openSince = -1; }
      return false;
    }
    const justOpened = obs.openSince < 0 && obs.window >= 0;
    if (obs.openSince < 0) obs.openSince = now;

    if (obs.window >= 0) {
      const openFor = now - obs.openSince;
      if (obs.window - openFor > crossTime) return true; // enough of the window left
      // The window is too short to cross with margin: go right as it opens,
      // the best moment there is (a character standing there forever helps
      // nobody, and the cost of the area already made the route a last resort).
      return justOpened && obs.window < crossTime;
    }

    // Nothing measured yet: cautious prediction. Speed on the high side: 1.6x
    // the average (Sine peaks at ~1.57x), at least what the cycle implies.
    const dir = (horizontal ? env.sx : env.sy) || 1;
    let v = (env.speed || 0) * 1.6;
    if (env.cycle > 0) v = Math.max(v, (2 * (hi - lo) / env.cycle) * 1.6);
    if (v < 1) return true;
    const t = env.established
      ? this._timeUntilInRange(p, dir, lo, hi, bLo, bHi, v)
      : (p >= bHi ? p - bHi : bLo - p) / v; // ends not known yet: assume it heads our way now
    return t > crossTime;
  },

  /** Seconds until a point moving back and forth between lo and hi at speed v
   *  (now at p, heading dir) enters the open range (bLo, bHi). Infinity when
   *  the range lies outside its travel. */
  _timeUntilInRange(p, dir, lo, hi, bLo, bHi, v) {
    if (bHi <= lo || bLo >= hi) return Infinity;
    let t = 0, pos = Math.min(hi, Math.max(lo, p)), d = dir > 0 ? 1 : -1;
    for (let leg = 0; leg < 3; leg++) {
      if (d > 0) {
        if (bLo >= pos) return t + (bLo - pos) / v; // ahead: reaches it on this leg
        t += (hi - pos) / v; pos = hi; d = -1;      // behind: on the way back
      } else {
        if (bHi <= pos) return t + (pos - bHi) / v;
        t += (pos - lo) / v; pos = lo; d = 1;
      }
    }
    return Infinity;
  },

  // ==========================================================================
  // Ride links
  // ==========================================================================

  /** The walkable deck of a moving platform: `box` (its bounding box, now or
   *  at a recorded pose) trimmed to its collision shape, so empty image
   *  padding above or beside the deck is ignored. Returns `box` itself when
   *  the shape fills it (the common case). */
  _platformDeck(rec, box) {
    const d = rec ? this._deckInsets(rec) : null;
    if (!d) return box;
    return { left: box.left + d.l, top: box.top + d.t, right: box.right - d.r, bottom: box.bottom };
  },

  /** How far a platform's collision shape sits inside its bounding box on
   *  the top, left and right ({ t, l, r } in pixels, or null when it fills
   *  the box). Probed with the documented containsPoint, then cached on the
   *  watcher record until the size, angle or animation frame changes, so a
   *  ride frame costs a few property reads. */
  _deckInsets(rec) {
    const inst = rec.inst;
    let w, h, a, anim, frame;
    try {
      w = inst.width; h = inst.height; a = inst.angle;
      anim = inst.animationName; frame = inst.animationFrame;
    } catch (e) { return null; }
    const c = rec.deck;
    if (c && c.w === w && c.h === h && c.a === a && c.anim === anim && c.frame === frame) return c.insets;
    let insets = null;
    try { insets = this._probeDeckInsets(inst, inst.getBoundingBox()); } catch (e) {}
    rec.deck = { w, h, a, anim, frame, insets };
    return insets;
  },

  /** Finds the deck inside a bounding box: the highest solid point over the
   *  middle of the platform (three columns), then the solid extent of the
   *  row just below it. Coarse 4 px steps refined to 1 px: a few dozen
   *  point tests, once per shape. */
  _probeDeckInsets(inst, bb) {
    const w = bb.right - bb.left, h = bb.bottom - bb.top;
    if (!(w >= 2) || !(h >= 2)) return null;
    const solid = (x, y) => inst.containsPoint(x, y);
    // Index (0..n-1) of the first solid pixel, where at(i) tests pixel i:
    // every 4th pixel, then back to the exact first one (-1 = none)
    const firstSolid = (n, at) => {
      for (let i = 0; i < n; i += 4) {
        if (at(i)) {
          while (i > 0 && at(i - 1)) i--;
          return i;
        }
      }
      return -1;
    };
    let t = Infinity;
    for (const f of [0.25, 0.5, 0.75]) {
      const x = bb.left + w * f;
      const k = firstSolid(h, (i) => solid(x, bb.top + i + 0.5));
      if (k >= 0 && k < t) t = k;
    }
    if (t === Infinity) return null; // no shape found: keep the box
    const y = bb.top + Math.min(t + 2, h - 1) + 0.5;
    const l = Math.max(0, firstSolid(w, (i) => solid(bb.left + i + 0.5, y)));
    const r = Math.max(0, firstSolid(w, (i) => solid(bb.right - i - 0.5, y)));
    if (t === 0 && l === 0 && r === 0) return null;
    return { t, l, r };
  },

  /** Nearest static graph node a character can step between and the platform
   *  when the platform sits at `pose`: same height as the platform surface
   *  (within half a tile), beside the platform within two tiles. side "left" /
   *  "right" restricts which side (horizontal movers board from the ledge they
   *  approach); "any" picks the closer side (lifts). */
  _findBoardingNode(pose, side) {
    const cs = this.cellSize;
    const top = pose.top;
    let best = null;
    let bestScore = Infinity;
    const gyMin = this._toGY(top - cs * 0.5) - 1;
    const gyMax = this._toGY(top + cs * 0.5) - 1;
    for (let gy = gyMin; gy <= gyMax; gy++) {
      const groundY = this._cellTop(gy + 1);
      const dh = Math.abs(groundY - top);
      if (dh > cs * 0.5) continue;
      if (side !== "right") {
        const gxStart = this._toGX(pose.left - 1);
        for (let gx = gxStart; gx >= gxStart - 2; gx--) {
          const node = this.getNode(gx, gy);
          if (!node) continue;
          const score = Math.abs(pose.left - this._cellLeft(gx + 1)) + dh * 0.5;
          if (score < bestScore) { best = node; bestScore = score; }
          break; // nearest node in this row on this side
        }
      }
      if (side !== "left") {
        const gxStart = this._toGX(pose.right + 1);
        for (let gx = gxStart; gx <= gxStart + 2; gx++) {
          const node = this.getNode(gx, gy);
          if (!node) continue;
          const score = Math.abs(this._cellLeft(gx) - pose.right) + dh * 0.5;
          if (score < bestScore) { best = node; bestScore = score; }
          break;
        }
      }
    }
    return best;
  },

  /** Creates, moves, or removes the ride link of one moving platform so it
   *  joins the static ledges at the two ends of its travel. The portal keeps
   *  its ID across updates; its geometry and cost are managed automatically. */
  _syncRideLink(rec) {
    const env = rec.env;
    const cs = this.cellSize;
    const rangeX = env.maxX.x - env.minX.x;
    const rangeY = env.maxY.y - env.minY.y;
    if (Math.max(rangeX, rangeY) < cs) { this._removeRideLink(rec); return; }
    const horizontal = rangeX >= rangeY;
    const endA = horizontal ? env.minX : env.minY;
    const endB = horizontal ? env.maxX : env.maxY;
    // Board from the deck (collision shape), not the image's box
    const nodeA = this._findBoardingNode(this._platformDeck(rec, endA), horizontal ? "left" : "any");
    const nodeB = this._findBoardingNode(this._platformDeck(rec, endB), horizontal ? "right" : "any");
    if (!nodeA || !nodeB || nodeA === nodeB) { this._removeRideLink(rec); return; }

    const speed = env.speed > 1 ? env.speed : 60;
    const dist = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
    // Expected time = ride + average wait (half a cycle). Converted to the
    // graph's walk-cost units through the walking speed, so A* weighs waiting
    // for a platform honestly against walking around.
    const seconds = dist / speed + (env.cycle > 0 ? env.cycle / 2 : 2);
    const walkCellsPerSecond = (this.platformProps.maxSpeed || 200) / cs;
    const cost = Math.max(1, seconds * walkCellsPerSecond * this.WALK_COST);

    const portalsMap = this._getPortalsMap();
    const wired = this.graphGenerated && !this._graphBuild && !globalNavManager.isBuildInProgress(this.navKey);
    let portal = rec.ridePortalId ? portalsMap.get(rec.ridePortalId) : null;
    const isNew = !portal;
    if (portal) {
      if (wired) this._removePortalConnections(portal.id, portal);
    } else {
      portal = {
        id: globalNavManager.nextPortalId++,
        type: "ride",
        twoWay: true,
        tag: RIDE_TAG,
        ignoreHazards: false,
        entryUid: null, // fixed ledge points, moved by this watcher
        exitUid: null,
      };
      portalsMap.set(portal.id, portal);
      rec.ridePortalId = portal.id;
    }
    Object.assign(portal, {
      entryX: nodeA.x, entryY: nodeA.y,
      exitX: nodeB.x, exitY: nodeB.y,
      cost, speed,
      ride: {
        platUid: rec.uid,
        endA: { x: endA.x, y: endA.y },
        endB: { x: endB.x, y: endB.y },
        groundA: this._cellTop(nodeA.gy + 1),
        groundB: this._cellTop(nodeB.gy + 1),
        cycle: env.cycle || 0,
      },
    });
    if (wired) this._connectPortalToGraph(portal);
    if (isNew) {
      this._log(`Moving platform ${rec.uid}: ride link ${portal.id} between (${nodeA.gx},${nodeA.gy}) and (${nodeB.gx},${nodeB.gy})`);
    }
  },

  /** Removes a platform's ride link (platform destroyed, settled, or its ends
   *  no longer meet a ledge). */
  _removeRideLink(rec) {
    if (!rec.ridePortalId) return;
    const portalsMap = this._peekMapStore(globalNavManager.sharedPortals);
    const portal = portalsMap ? portalsMap.get(rec.ridePortalId) : null;
    if (portal) {
      if (this.graphGenerated && !this._graphBuild) this._removePortalConnections(portal.id, portal);
      portalsMap.delete(portal.id);
    }
    rec.ridePortalId = 0;
  },

  // ==========================================================================
  // Ride execution (portalState "riding")
  // ==========================================================================

  /** Starts riding: called by _executePortalBehavior for a "portal_ride" waypoint. */
  _startRide(waypoint) {
    const portal = waypoint ? this._getPortalsMap().get(waypoint.portalId) : null;
    if (!portal || !portal.ride) {
      this._abortRide("the ride link no longer exists");
      return;
    }
    const r = portal.ride;
    const tx = this.portalTraverseTargetX;
    const ty = this.portalTraverseTargetY;
    const towardB =
      Math.hypot(tx - portal.exitX, ty - portal.exitY) <= Math.hypot(tx - portal.entryX, ty - portal.entryY);
    this._ride = {
      waypoint,                 // the path step being ridden (marked done on arrival)
      portalId: portal.id,
      platUid: r.platUid,
      phase: "wait",
      t: 0,
      phaseT: 0,
      boardEnd: towardB ? r.endA : r.endB,
      boardGround: towardB ? r.groundA : r.groundB,
      boardX: towardB ? portal.entryX : portal.exitX, // centre of the boarding ledge cell
      platSpeed: portal.speed || 60,                  // measured average speed
      prevPlat: null,                                 // platform position last tick (speed)
      exitEnd: towardB ? r.endB : r.endA,
      exitGround: towardB ? r.groundB : r.groundA,
      exitX: tx,
      exitY: ty,
      limit: Math.max(15, (r.cycle || 0) * 3 + 5),
    };
    this.portalState = "riding";
  },

  /** Ends a ride early and re-paths from wherever the character is. */
  _abortRide(reason) {
    this._log(`Ride aborted: ${reason}; repathing`);
    this._ride = null;
    this.portalState = "none";
    this.portalPaused = false;
    this.portalCurrentWaypoint = null;
    this.justUsedPortal = true;
    // A Find path issued during the ride wins over re-pathing the old route
    if (this._deferredFindPath) this._runDeferredFindPath();
    else if (this.hasPath) this._rePath();
  },

  /** Ride state machine, one step per tick while portalState is "riding":
   *  wait (stand at the ledge until the platform arrives), board (step or hop
   *  on, then move toward its middle), ride (stand still, Platform physics
   *  carries the character), alight (step off at the far ledge). */
  /** Where the platform is heading, relative to the boarding ledge, measured
   *  from its movement since last tick (works for any movement: Sine waves,
   *  Tween, Move To, events). side: +1 when the platform lies right of the
   *  ledge. closing: it is moving toward the ledge (or toward level with it,
   *  for lifts). approaching: it is closing the horizontal gap. tReach: seconds until it is close and level enough to step
   *  on, Infinity when it is not on its way. Snaps (square / sawtooth waves,
   *  events that teleport it) are not anticipated. */
  _ridePlatformMotion(ride, pbb, dt) {
    const cs = this.cellSize;
    const cx = (pbb.left + pbb.right) / 2;
    const prev = ride.prevPlat;
    ride.prevPlat = { x: cx, y: pbb.top };
    const side = Math.sign(ride.boardEnd.x - ride.boardX) || (cx >= ride.boardX ? 1 : -1);
    const ledgeEdge = ride.boardX + side * cs / 2;
    const out = { side, ledgeEdge, closing: false, approaching: false, measured: false, speedToward: 0, tReach: Infinity };
    if (!prev || !(dt > 0)) return out;
    const vx = (cx - prev.x) / dt, vy = (pbb.top - prev.y) / dt;
    if (Math.hypot(vx, vy) > ride.platSpeed * 4 + 50) return out; // a snap, not motion
    // Horizontal: gap between the ledge edge and the platform's near edge
    const gap = side > 0 ? pbb.left - ledgeEdge : ledgeEdge - pbb.right;
    const towardH = side > 0 ? -vx : vx;
    // Vertical: how far the platform top is from level with the ledge
    const level = pbb.top - ride.boardGround;
    const towardV = level > 0 ? -vy : vy;
    const needH = Math.max(0, gap - cs * 0.5), needV = Math.max(0, Math.abs(level) - cs * 0.5);
    const tH = needH === 0 ? 0 : (towardH > 1 ? needH / towardH : Infinity);
    const tV = needV === 0 ? 0 : (towardV > 1 ? needV / towardV : Infinity);
    out.tReach = Math.max(tH, tV);
    out.approaching = towardH > 1;
    out.measured = true;
    out.speedToward = towardH; // px/s toward the ledge (negative: moving away)
    out.closing = towardH > 1 || towardV > 1 || (Math.abs(vx) < 1 && Math.abs(vy) < 1);
    return out;
  },

  /** While waiting at the ledge: start walking to its edge early enough to
   *  get there just as the platform does, so the character steps on moving
   *  instead of from a standstill. Never walks off: it releases the controls
   *  in time to stop at the edge (Platform's own deceleration) unless the
   *  platform is already reachable, which the wait phase turns into boarding. */
  _anticipateBoarding(ride, m, abb) {
    const pb = this.platformBehavior;
    if (!pb.isOnFloor || m.tReach === Infinity) return;
    const toEdge = m.side > 0 ? m.ledgeEdge - abb.right : abb.left - m.ledgeEdge;
    if (toEdge <= 1) return; // already at the edge
    const maxSpeed = this.platformProps.maxSpeed || 200;
    const accel = this.platformProps.acceleration || 1500;
    const decel = this.platformProps.deceleration || 1500;
    const v = Math.abs(pb.vectorX || 0);
    // Time to reach the edge from here (accelerating to full speed)
    const tWalk = toEdge / maxSpeed + Math.max(0, maxSpeed - v) / (2 * accel);
    if (m.tReach > tWalk) return; // too early: keep standing
    // Go, but leave room to stop at the edge
    const stopDist = (v * v) / (2 * decel);
    if (toEdge - stopDist > 1) pb.simulateControl(m.side > 0 ? "right" : "left");
  },

  /** Jumps onto a platform that is not at the ledge, when a jump from where
   *  the character stands lands on its deck: the deck is level with the
   *  ledge, and when a full jump comes down (flight time from the jump
   *  height and gravity) the deck's near edge is within the jump's reach.
   *  Works whichever way the platform moves (coming, leaving, or paused at
   *  its far end); one that would arrive before the jump lands is simply
   *  walked onto. Not for Walk Only (never jumps) or Ground-Hugging (walks
   *  whenever it can). Returns true when it jumped. */
  _jumpBoard(m, pbb, abb) {
    if (this.pathStrategy === "walk_only" || this.pathStrategy === "simplest") return false;
    const pb = this.platformBehavior;
    if (!pb.isOnFloor || !m.measured) return false; // its speed must be known
    const cs = this.cellSize;
    if (Math.abs(pbb.top - abb.bottom) > cs * 0.25) return false; // deck not level with the ledge
    const toEdge = Math.max(0, m.side > 0 ? m.ledgeEdge - abb.right : abb.left - m.ledgeEdge);
    const halfW = (abb.right - abb.left) / 2;
    const gap = m.side > 0 ? pbb.left - m.ledgeEdge : m.ledgeEdge - pbb.right;
    if (gap <= halfW) return false; // near enough to step on
    const g = this.platformProps.gravity || 1500;
    const maxSpeed = this.platformProps.maxSpeed || 200;
    const height = this.platformProps.isDoubleJumpEnabled ? this.singleJumpHeight : this.maxJumpHeight;
    const flight = 2 * Math.sqrt((2 * height) / g); // one jump, up and back down
    const reach = maxSpeed * flight * 0.8; // standstill launch, as the graph assumes
    const gapAtLanding = gap - m.speedToward * flight;
    if (gapAtLanding <= 0) return false; // it gets here first: walk on
    // The body centre must travel from here to a few pixels onto the deck
    if (toEdge + halfW + gapAtLanding + 4 > reach) return false;
    pb.simulateControl(m.side > 0 ? "right" : "left");
    pb.simulateControl("jump");
    this._log("Ride: jumping onto the platform (gap " + Math.round(gap) + "px, " + Math.round(gapAtLanding) + "px at landing)");
    return true;
  },

  _updateRide(dt) {
    const ride = this._ride;
    const pb = this.platformBehavior;
    if (!ride || !pb) { this._abortRide("no Platform behavior"); return; }
    const plat = this.instance.runtime.getInstanceByUid(ride.platUid);
    if (!plat) { this._abortRide("the platform was destroyed"); return; }
    ride.t += dt;
    ride.phaseT += dt;
    if (ride.t > ride.limit) { this._abortRide("timed out waiting for the platform"); return; }

    const cs = this.cellSize;
    // The deck the character stands on (collision shape, not the image box)
    const st = globalNavManager.movers.get(this.navKey);
    const pbb = this._platformDeck(st ? st.recs.get(ride.platUid) : null, plat.getBoundingBox());
    const abb = this.instance.getBoundingBox();
    const ax = this.instance.x;
    const feet = abb.bottom;
    const platCX = (pbb.left + pbb.right) / 2;
    const platW = pbb.right - pbb.left;
    const halfW = (abb.right - abb.left) / 2;
    const onFloor = pb.isOnFloor;
    const onPlat = onFloor && Math.abs(feet - pbb.top) <= 4 && ax >= pbb.left && ax <= pbb.right;
    const tol = Math.max(4, cs * 0.35);
    const nearEnd = (e) => Math.abs(plat.x - e.x) <= tol && Math.abs(plat.y - e.y) <= tol;
    // Horizontal gap between the character and the platform edge facing it
    const gapTo = () => (platCX > ax ? pbb.left - abb.right : abb.left - pbb.right);
    const setPhase = (p) => {
      this._log(`Ride: ${ride.phase} -> ${p} after ${ride.phaseT.toFixed(2)}s (${ride.t.toFixed(2)}s since reaching the ledge)`);
      ride.phase = p;
      ride.phaseT = 0;
    };
    const walkToward = (x) => { pb.simulateControl(x < ax ? "left" : "right"); };

    // Platform motion: read once per tick (it measures speed from last tick)
    const m = ride.phase === "wait" || ride.phase === "board" ? this._ridePlatformMotion(ride, pbb, dt) : null;

    switch (ride.phase) {
      case "wait": {
        if (onPlat) { setPhase("ride"); return; }
        const reachable = Math.abs(pbb.top - feet) <= cs * 0.5 && gapTo() <= cs * 0.75;
        if (!(reachable && (nearEnd(ride.boardEnd) || gapTo() <= 2 || m.closing))) {
          if (this._jumpBoard(m, pbb, abb)) {
            ride.jumped = true;
            setPhase("board");
            return;
          }
          this._anticipateBoarding(ride, m, abb);
          return; // keep waiting (possibly walking to the edge to meet it)
        }
        setPhase("board");
      }
      // falls through: start boarding this tick
      case "board": {
        if (onPlat) {
          if (Math.abs(ax - platCX) <= Math.max(4, platW * 0.2)) setPhase("ride");
          else walkToward(platCX);
          return;
        }
        if (onFloor) {
          // Still on the ledge: if the platform pulled away, wait for the next pass
          const reachable = Math.abs(pbb.top - feet) <= cs * 0.5 && gapTo() <= cs * 0.75;
          if (!reachable) {
            // Out of reach (it pulled away): stop pressing at once (the
            // character may arrive at full speed now), back to waiting soon.
            if (ride.phaseT > 0.1) setPhase("wait");
            return;
          }
          // A gap too wide to step across while the platform is still coming:
          // wait at the edge rather than hop over it. Any narrower gap is
          // walked straight away (waiting for it to close fully stalled
          // boarding whenever the platform stops a few pixels short).
          const gap = gapTo();
          if (gap > halfW && m.approaching) { this._anticipateBoarding(ride, m, abb); return; }
          walkToward(platCX);
          // Platform surface above our feet, or a wide gap it is not closing: hop on
          if (pbb.top < feet - 4 || gap > halfW) pb.simulateControl("jump");
        } else {
          walkToward(platCX); // steer in the air
          // A jump onto an approaching platform: hold for full height (Jump Sustain)
          if (ride.jumped && (pb.vectorY || 0) < 0) pb.simulateControl("jump");
          if (feet > ride.boardGround + cs) this._abortRide("missed the platform");
        }
        return;
      }
      case "ride": {
        if (!onPlat) {
          // Briefly airborne on a bumpy ride is fine; well below the deck is a fall
          if (feet > pbb.top + cs || (onFloor && ride.phaseT > 0.2)) this._abortRide("fell off the platform");
          return;
        }
        ride.phaseT = 0;
        if (Math.abs(ax - platCX) > platW * 0.3) walkToward(platCX); // stay near the middle
        if (nearEnd(ride.exitEnd) && Math.abs(pbb.top - ride.exitGround) <= cs * 0.5) setPhase("alight");
        return;
      }
      case "alight": {
        const overPlat = ax >= pbb.left && ax <= pbb.right && Math.abs(feet - pbb.top) <= 4;
        if (onFloor && !overPlat && Math.abs(ax - ride.exitX) <= cs * 0.4) {
          this._ride = null;
          // Runs a Find path deferred during the ride, and marks the ride step
          // of the path done (the arrival check alone misses it for characters
          // taller than a tile, whose centre stands above the node).
          this._completePortal();
          return;
        }
        if (onPlat && !nearEnd(ride.exitEnd) && ride.phaseT > 0.1) {
          // The platform left before we got off: ride the next pass
          const ledgeGap = ride.exitX > ax ? (ride.exitX - cs / 2) - pbb.right : pbb.left - (ride.exitX + cs / 2);
          if (ledgeGap > cs * 0.75) { setPhase("ride"); return; }
        }
        const dir = ride.exitX < ax ? "left" : "right";
        if (Math.abs(ax - ride.exitX) > cs * 0.15) pb.simulateControl(dir);
        if (onFloor && ride.exitGround < feet - 4 && pb.isByWall(dir)) pb.simulateControl("jump");
        if (!onFloor && !overPlat && feet > ride.exitGround + cs) this._abortRide("missed the exit ledge");
        return;
      }
    }
  },
};
