import { globalNavManager } from "./navigationManager.js";

// Portal system: instant/gradual portals, elevator groups, tags, the portal
// execution state machine (entry → pause/traverse → complete), and portal
// expressions/conditions.
// Mixed into the instance class prototype — `this` is the behavior instance.
export default {
  /** Base portal registration: stores the portal record and, if the graph is
   *  already built, connects it immediately (otherwise _connectAllPortals runs
   *  at the end of the next graph build). direction "two_way" adds the reverse link.
   *  entryUid/exitUid (optional, from the *FromObjects actions) make that end of
   *  the portal FOLLOW the instance: see _updateTrackedPortalsIfOwner and
   *  _refreshTrackedPortalPositions. null = fixed co-ordinate (never 0, which
   *  is a valid UID). */
  aceAddPortal(direction, entryX, entryY, exitX, exitY, portalType, cost, speed, tag, entryUid = null, exitUid = null) {
    this.enablePortals = true;
    const portalsMap = this._getPortalsMap();

    // Same-tick dedupe: an add action on an object type with N picked
    // instances runs N times with identical parameters. Only the first run
    // registers the portal; the rest adopt its ID, so LastPortalID matches on
    // every instance and Set portal cost / Remove portal act on the ONE
    // portal instead of one of N copies. A different instance adding a
    // portal with different parameters, or the same instance repeating an
    // add, still registers normally.
    const signature = this._getNavKey() + "#portal:" + [
      portalType, direction, entryX, entryY, exitX, exitY, cost, speed, tag,
    ].join("|");
    const claim = this._claimSameTick(signature, (peer) => portalsMap.has(peer.id));
    if (claim.peer) {
      this.lastPortalId = claim.peer.id;
      return;
    }

    const portalId = globalNavManager.nextPortalId++;
    this.lastPortalId = portalId;
    claim.own.id = portalId;

    const portal = {
      id: portalId,
      entryX,
      entryY,
      exitX,
      exitY,
      type: portalType || "instant",
      cost: (cost != null && cost > 0) ? cost : 1,
      speed: speed || 0,
      ignoreHazards: false,
      twoWay: direction === "two_way",
      tag: tag || "",
      entryUid: entryUid ?? null,
      exitUid: exitUid ?? null,
    };
    portalsMap.set(portalId, portal);

    if (this.graphGenerated) {
      this._connectPortalToGraph(portal);
    }
  },

  /** Adds an instant (teleport) portal. */
  aceAddInstantPortal(direction, entryX, entryY, exitX, exitY, cost, tag) {
    this.aceAddPortal(direction, entryX, entryY, exitX, exitY, "instant", cost, 0, tag);
  },

  /** Adds a gradual portal (linear movement at speed — elevators, ziplines). */
  aceAddGradualPortal(direction, entryX, entryY, exitX, exitY, cost, speed, tag) {
    this.aceAddPortal(direction, entryX, entryY, exitX, exitY, "gradual", cost, speed, tag);
  },

  /** Removes a portal by ID, including its graph connections. */
  aceRemovePortal(portalId) {
    const portalsMap = this._getPortalsMap();
    const portal = portalsMap.get(portalId);
    if (portal) {
      this._removePortalConnections(portalId, portal);
      portalsMap.delete(portalId);
    }
  },

  /** Removes every portal and strips all portal connections from graph nodes. */
  aceClearAllPortals() {
    const portalsMap = this._getPortalsMap();
    const graph = this._getNavigationGraph();
    for (const [, node] of graph) {
      node.portalConnections = [];
    }
    portalsMap.clear();
    // Clear-all removes elevator groups too (as documented): with shared
    // groups, stale stops would otherwise re-link cleared floors on the next
    // Add elevator stop.
    this._getElevatorGroups().clear();
  },

  /** Adds portal connections from the nearest entry node to the nearest exit node (and reverse if two-way). */
  _connectPortalToGraph(portal) {
    const entryNode = this._findNearestNode(portal.entryX, portal.entryY);
    const exitNode = this._findNearestNode(portal.exitX, portal.exitY);

    if (!entryNode || !exitNode) {
      this._warn(`Portal ${portal.id} could not connect to graph — entry: ${!!entryNode}, exit: ${!!exitNode}`);
      return;
    }

    if (entryNode === exitNode) {
      this._warn(`Portal ${portal.id}: entry and exit resolved to the same node (${entryNode.gx},${entryNode.gy}). Make sure entry and exit positions are on different platforms/nodes.`);
    }

    let portalCost = portal.cost;
    if (portal.type === "gradual" && portal.speed > 0 && portalCost === 1) {
      const dist = Math.sqrt((portal.exitX - portal.entryX) ** 2 + (portal.exitY - portal.entryY) ** 2);
      portalCost = (dist / portal.speed) * this.WALK_COST;
    }

    entryNode.portalConnections.push({
      target: exitNode,
      action: `portal_${portal.type}`,
      cost: portalCost,
      portalId: portal.id,
      speed: portal.speed || 0,
      ignoreHazards: portal.ignoreHazards || false,
    });

    if (portal.twoWay) {
      exitNode.portalConnections.push({
        target: entryNode,
        action: `portal_${portal.type}`,
        cost: portalCost,
        portalId: portal.id,
        speed: portal.speed || 0,
        ignoreHazards: portal.ignoreHazards || false,
      });
    }
  },

  /** Connects all registered portals to the navigation graph after node generation.
   *  Object-following portals first re-read their objects' CURRENT positions, so a
   *  rebuild after obstacles moved never reconnects a portal at a stale spot. */
  _connectAllPortals() {
    if (!this.enablePortals) return;

    this._refreshTrackedPortalPositions();
    const portalsMap = this._getPortalsMap();
    for (const [id, portal] of portalsMap) {
      this._connectPortalToGraph(portal);
    }
  },

  /** Looks up the instance an object-following portal end follows. Returns null
   *  for a fixed co-ordinate end (uid null), or false when the followed instance
   *  no longer exists (destroyed). */
  _getTrackedPortalInst(uid) {
    if (uid == null) return null;
    const inst = this.instance.runtime.getInstanceByUid(uid);
    return inst || false;
  },

  /** Updates every object-following portal's co-ordinates in place WITHOUT
   *  touching graph connections (used right before connecting, when the graph
   *  holds no connections for them yet). Portals whose object was destroyed are
   *  removed, like tracked hazards. */
  _refreshTrackedPortalPositions() {
    const portalsMap = this._getPortalsMap();
    let toDelete = null;
    for (const [id, portal] of portalsMap) {
      if (portal.entryUid == null && portal.exitUid == null) continue;
      const entry = this._getTrackedPortalInst(portal.entryUid);
      const exit = this._getTrackedPortalInst(portal.exitUid);
      if (entry === false || exit === false) {
        (toDelete ??= []).push(id);
        continue;
      }
      if (entry) { portal.entryX = entry.x; portal.entryY = entry.y; }
      if (exit) { portal.exitX = exit.x; portal.exitY = exit.y; }
    }
    if (toDelete) {
      for (const id of toDelete) {
        portalsMap.delete(id);
        this._log(`Portal ${id} removed: an object it followed was destroyed`);
      }
    }
  },

  /** Per-tick follow for object-based portals, once per map per tick (the first
   *  ticking instance does it, gameTime stamp, same pattern as tracked hazards).
   *  A portal whose object moved at least half a pixel is re-wired in place
   *  (connections removed at the OLD position, then reconnected at the new one),
   *  keeping its ID, cost, speed and tags. A portal whose object was destroyed is
   *  removed. Characters already on a path keep their captured destination; the
   *  next path uses the new position. */
  _updateTrackedPortalsIfOwner() {
    const navKey = this._getNavKey();
    if (navKey === null) return;
    const portalsMap = this._peekMapStore(globalNavManager.sharedPortals);
    if (!portalsMap || portalsMap.size === 0) return;
    const now = this.instance.runtime.gameTime;
    if (globalNavManager.portalUpdateStamp.get(navKey) === now) return;
    globalNavManager.portalUpdateStamp.set(navKey, now);

    // Connections exist only on a fully built graph. Mid-build (or before the
    // first build) only co-ordinates are updated; finalize connects them.
    const wired = this.graphGenerated && !this._graphBuild && !globalNavManager.isBuildInProgress(navKey);
    let toDelete = null;
    for (const [id, portal] of portalsMap) {
      if (portal.entryUid == null && portal.exitUid == null) continue;
      const entry = this._getTrackedPortalInst(portal.entryUid);
      const exit = this._getTrackedPortalInst(portal.exitUid);
      if (entry === false || exit === false) {
        (toDelete ??= []).push(id);
        continue;
      }
      const ex = entry ? entry.x : portal.entryX;
      const ey = entry ? entry.y : portal.entryY;
      const xx = exit ? exit.x : portal.exitX;
      const xy = exit ? exit.y : portal.exitY;
      const moved = Math.abs(ex - portal.entryX) >= 0.5 || Math.abs(ey - portal.entryY) >= 0.5 ||
                    Math.abs(xx - portal.exitX) >= 0.5 || Math.abs(xy - portal.exitY) >= 0.5;
      if (!moved) continue;
      // Remove BEFORE changing co-ordinates: removal finds the nodes from them
      if (wired) this._removePortalConnections(id, portal);
      portal.entryX = ex; portal.entryY = ey;
      portal.exitX = xx; portal.exitY = xy;
      if (wired) this._connectPortalToGraph(portal);
    }
    if (toDelete) {
      for (const id of toDelete) {
        if (wired) this._removePortalConnections(id, portalsMap.get(id));
        portalsMap.delete(id);
        this._log(`Portal ${id} removed: an object it followed was destroyed`);
      }
    }
  },

  /** Base for the *FromObjects variants: reads entry/exit positions from the
   *  first picked instance of each object class, and keeps FOLLOWING those
   *  instances afterwards (their UIDs are stored on the portal). */
  aceAddPortalFromObjects(direction, entryObjectClass, exitObjectClass, portalType, cost, speed, tag) {
    const entryInst = entryObjectClass.getFirstPickedInstance();
    const exitInst = exitObjectClass.getFirstPickedInstance();
    if (!entryInst || !exitInst) {
      this._warn("Add portal from objects: could not find picked instances");
      return;
    }
    this.aceAddPortal(direction, entryInst.x, entryInst.y, exitInst.x, exitInst.y, portalType, cost, speed, tag, entryInst.uid, exitInst.uid);
  },

  /** Adds an instant portal between two objects' positions. */
  aceAddInstantPortalFromObjects(direction, entryObjectClass, exitObjectClass, cost, tag) {
    this.aceAddPortalFromObjects(direction, entryObjectClass, exitObjectClass, "instant", cost, 0, tag);
  },

  /** Adds a gradual portal between two objects' positions. */
  aceAddGradualPortalFromObjects(direction, entryObjectClass, exitObjectClass, cost, speed, tag) {
    this.aceAddPortalFromObjects(direction, entryObjectClass, exitObjectClass, "gradual", cost, speed, tag);
  },

  /** Removes the portal whose entry or exit is closest to the picked object. */
  aceRemovePortalAtObject(objectClass) {
    const inst = objectClass.getFirstPickedInstance();
    if (!inst) return;
    const portalsMap = this._getPortalsMap();
    // With several instances of this behavior's type picked, the action runs
    // once per instance and each run would remove the NEXT closest portal.
    // Only the first run per object per tick removes one; a repeat from the
    // same instance still does.
    if (this._claimSameTick(this._getNavKey() + "#removePortalAt:" + inst.uid).peer) return;
    let closestId = -1;
    let closestDist = Infinity;
    for (const [id, portal] of portalsMap) {
      const entryDist = this.distance(inst.x, inst.y, portal.entryX, portal.entryY);
      const exitDist = this.distance(inst.x, inst.y, portal.exitX, portal.exitY);
      const dist = Math.min(entryDist, exitDist);
      if (dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    }
    if (closestId >= 0) {
      this.aceRemovePortal(closestId);
    }
  },

  /** Moves a portal in place, preserving its ID, type, cost, speed, and tags.
   *  Old graph connections are removed (resolved from the OLD coordinates)
   *  before the coordinates change, then fresh connections are wired at the
   *  new position. A character mid-traversal keeps its captured exit target;
   *  the move never teleports anyone. Cheap enough to call on a timer for
   *  moving teleporters. Explicit co-ordinates win: a portal that was following
   *  objects stops following them (Set portal position from objects re-attaches). */
  aceSetPortalPosition(portalId, entryX, entryY, exitX, exitY, entryUid = null, exitUid = null) {
    const portalsMap = this._getPortalsMap();
    const portal = portalsMap.get(portalId);
    if (!portal) return;
    this._removePortalConnections(portalId, portal);
    portal.entryUid = entryUid ?? null;
    portal.exitUid = exitUid ?? null;
    portal.entryX = entryX;
    portal.entryY = entryY;
    portal.exitX = exitX;
    portal.exitY = exitY;
    if (this.graphGenerated) {
      this._connectPortalToGraph(portal);
    }
  },

  /** Moves a portal to two objects' current positions (first picked instances)
   *  and makes it follow those objects from now on. */
  aceSetPortalPositionFromObjects(portalId, entryObjectClass, exitObjectClass) {
    const entryInst = entryObjectClass.getFirstPickedInstance();
    const exitInst = exitObjectClass.getFirstPickedInstance();
    if (!entryInst || !exitInst) {
      this._warn("Set portal position from objects: could not find picked instances");
      return;
    }
    this.aceSetPortalPosition(portalId, entryInst.x, entryInst.y, exitInst.x, exitInst.y, entryInst.uid, exitInst.uid);
  },

  /** Updates a portal's pathfinding cost and reconnects it to the graph. */
  aceSetPortalCost(portalId, cost) {
    const portalsMap = this._getPortalsMap();
    const portal = portalsMap.get(portalId);
    if (!portal) return;
    portal.cost = cost;
    if (this.graphGenerated) {
      this._removePortalConnections(portalId, portal);
      this._connectPortalToGraph(portal);
    }
  },

  /** Sets whether a portal's connection bypasses hazard cost multipliers, then reconnects it. */
  aceSetPortalIgnoreHazards(portalId, ignoreHazards) {
    const portalsMap = this._getPortalsMap();
    const portal = portalsMap.get(portalId);
    if (!portal) return;
    portal.ignoreHazards = ignoreHazards;
    if (this.graphGenerated) {
      this._removePortalConnections(portalId, portal);
      this._connectPortalToGraph(portal);
    }
  },

  /** Updates a gradual portal's traversal speed, then reconnects it. */
  aceSetPortalSpeed(portalId, speed) {
    const portalsMap = this._getPortalsMap();
    const portal = portalsMap.get(portalId);
    if (!portal) return;
    portal.speed = speed;
    if (this.graphGenerated) {
      this._removePortalConnections(portalId, portal);
      this._connectPortalToGraph(portal);
    }
  },

  /** Returns true if the portal's comma-separated tag string contains the given tag token. */
  _portalHasTag(portal, tag) {
    if (!portal || !tag) return false;
    const needle = tag.trim();
    if (!needle) return false;
    return portal.tag.split(",").some(t => t.trim() === needle);
  },

  /** Sets the tag string on a portal (comma-separated for multiple tags, e.g. "door,room_A"). Replaces any existing tag. */
  aceSetPortalTag(portalId, tag) {
    const portalsMap = this._getPortalsMap();
    const portal = portalsMap.get(portalId);
    if (!portal) return;
    portal.tag = tag;
  },

  /** Removes all portals that contain the given tag token (checked within comma-separated tag string). */
  aceRemovePortalsByTag(tag) {
    // Empty tag = remove ALL portals, matching the "empty tag searches all"
    // convention of NearestPortalID / PortalCountByTag (absorbed the old
    // ClearAllPortals action in 0.9.0.0).
    if (!tag || !tag.trim()) {
      this.aceClearAllPortals();
      return;
    }
    const portalsMap = this._getPortalsMap();
    for (const [id, portal] of portalsMap) {
      if (this._portalHasTag(portal, tag)) {
        this._removePortalConnections(id, portal);
        portalsMap.delete(id);
      }
    }
  },

  /** Returns the tag string of a portal, or empty string if the portal doesn't exist. */
  aceGetPortalTag(portalId) {
    const portalsMap = this._getPortalsMap();
    const portal = portalsMap.get(portalId);
    return portal ? (portal.tag || "") : "";
  },

  /** Returns the number of portals that contain the given tag token. */
  aceGetPortalCountByTag(tag) {
    const portalsMap = this._getPortalsMap();
    let count = 0;
    for (const [, portal] of portalsMap) {
      if (this._portalHasTag(portal, tag)) count++;
    }
    return count;
  },

  /** Returns the portal ID at the given index within the set of portals that contain the given tag. Returns -1 if out of range. */
  aceGetPortalIDByTag(tag, index) {
    const portalsMap = this._getPortalsMap();
    let i = 0;
    for (const [id, portal] of portalsMap) {
      if (this._portalHasTag(portal, tag)) {
        if (i === index) return id;
        i++;
      }
    }
    return -1;
  },

  /** Returns the ID of the portal whose entry point is nearest to (x, y). Filters by tag if tag is non-empty. Returns -1 if no matching portals exist. */
  aceFindNearestPortalID(x, y, tag) {
    const portalsMap = this._getPortalsMap();
    let bestId = -1;
    let bestDist = Infinity;
    for (const [id, portal] of portalsMap) {
      if (tag && !this._portalHasTag(portal, tag)) continue;
      const dist = this.distance(x, y, portal.entryX, portal.entryY);
      if (dist < bestDist) { bestDist = dist; bestId = id; }
    }
    return bestId;
  },

  /** Returns the ID of the portal whose entry point is furthest from (x, y). Filters by tag if tag is non-empty. Returns -1 if no matching portals exist. */
  aceFindFurthestPortalID(x, y, tag) {
    const portalsMap = this._getPortalsMap();
    let bestId = -1;
    let bestDist = -1;
    for (const [id, portal] of portalsMap) {
      if (tag && !this._portalHasTag(portal, tag)) continue;
      const dist = this.distance(x, y, portal.entryX, portal.entryY);
      if (dist > bestDist) { bestDist = dist; bestId = id; }
    }
    return bestId;
  },

  /** Adds an elevator stop: creates two-way gradual portals between the new stop
   *  and every existing stop in the group (full mesh, so any floor reaches any floor).
   *  Groups are shared per map, so any character on the map can add stops.
   *  uid: the object an object-based stop follows (null = fixed position). */
  aceAddElevatorStop(groupId, x, y, speed, tag, uid = null) {
    const groups = this._getElevatorGroups();
    if (!groups.has(groupId)) {
      groups.set(groupId, []);
    }
    let stops = groups.get(groupId);

    // Prune stops whose linking portals were ALL removed (Remove portal,
    // Remove portals by tag, Remove portal at object): otherwise the position
    // dedupe below would block re-adding them (a "power restored" lift could
    // never be rebuilt) and new stops would re-link removed floors. A lone
    // first stop has no portals yet (portalIds empty) and is kept.
    const portalsMap = this._getPortalsMap();
    stops = stops.filter(s => {
      const ids = s.portalIds || [];
      return ids.length === 0 || ids.some(id => portalsMap.has(id));
    });
    groups.set(groupId, stops);

    // A stop already at this position is the same floor. This is also how a
    // multi-pick action (one run per picked instance) registers the stop once:
    // later runs adopt the first run's LastPortalID instead of linking the
    // floor to itself.
    // An object-based stop is identified by its object (its position may have
    // moved since it was added); a co-ordinate stop by its position.
    const existing = stops.find(s => uid != null ? s.uid === uid : (s.uid == null && s.x === x && s.y === y));
    if (existing) {
      if (existing.lastPortalId) this.lastPortalId = existing.lastPortalId;
      return;
    }

    // Create two-way gradual portals between this stop and all existing stops,
    // recording each link's ID on BOTH stops for the pruning above.
    const newIds = [];
    for (const stop of stops) {
      // Object-based stops link from their object's CURRENT position
      if (stop.uid != null) {
        const inst = this.instance.runtime.getInstanceByUid(stop.uid);
        if (inst) { stop.x = inst.x; stop.y = inst.y; }
      }
      const dist = Math.sqrt((x - stop.x) ** 2 + (y - stop.y) ** 2);
      const portalSpeed = speed || stop.speed || 100;
      const cost = dist > 0 ? (dist / portalSpeed) * this.WALK_COST : 1;
      this.aceAddPortal("two_way", stop.x, stop.y, x, y, "gradual", cost, portalSpeed, tag, stop.uid, uid);
      (stop.portalIds = stop.portalIds || []).push(this.lastPortalId);
      newIds.push(this.lastPortalId);
    }

    stops.push({ x, y, speed, uid, portalIds: newIds, lastPortalId: stops.length > 0 ? this.lastPortalId : 0 });
  },

  /** Adds an elevator stop at the picked object's position. */
  aceAddElevatorStopFromObject(groupId, objectClass, speed, tag) {
    const inst = objectClass.getFirstPickedInstance();
    if (!inst) {
      this._warn("Add elevator stop from object: could not find picked instance");
      return;
    }
    this.aceAddElevatorStop(groupId, inst.x, inst.y, speed, tag, inst.uid);
  },

  /** Removes all portal connections for a specific portal ID from graph nodes. */
  _removePortalConnections(portalId, portal) {
    const entryNode = this._findNearestNode(portal.entryX, portal.entryY);
    if (entryNode) {
      entryNode.portalConnections = entryNode.portalConnections.filter(
        c => c.portalId !== portalId
      );
    }
    if (portal.twoWay) {
      const exitNode = this._findNearestNode(portal.exitX, portal.exitY);
      if (exitNode) {
        exitNode.portalConnections = exitNode.portalConnections.filter(
          c => c.portalId !== portalId
        );
      }
    }
  },

  // ============================================================================
  // PORTALS - Execution state machine
  // ============================================================================

  /** Handles portal waypoint execution: triggers OnPortalEntry, applies pause if requested, or executes the portal behavior. */
  _executePortal(targetX, targetY, waypoint) {
    if (this.portalState === "none") {
      this.portalPaused = false;
      this.currentPortalId = (waypoint && waypoint.portalId) || 0;
      this.portalCurrentWaypoint = waypoint;
      const landing = this._portalLandingPoint(waypoint, targetX, targetY);
      this.portalTraverseTargetX = landing.x;
      this.portalTraverseTargetY = landing.y;

      this._inPortalEntryTrigger = true;
      this._trigger("OnPortalEntry");
      this._inPortalEntryTrigger = false;

      if (this.portalPaused) {
        this.portalState = "paused";
        this.portalPauseTimer = 0;
        this.portalPauseWarned = false;
        return;
      }
      this._executePortalBehavior(waypoint);
      return;
    }

    if (this.portalState === "paused") return;
    if (this.portalState === "traversing") {
      this._updatePortalTraverse();
      return;
    }
  },

  /** Where a portal puts the character: the portal end it arrives at (the
   *  exit object or co-ordinate) is the target. The character's FEET land
   *  exactly at that point, whatever the character's origin: put a stop's
   *  origin on the floor and the character arrives standing there; move the
   *  stop and the arrival moves with it.
   *
   *  One safety rule: feet are never put inside a floor. If the point lies in
   *  or right on a Solid / Jump-thru (_floorSurfaceNear reads the objects
   *  themselves), the feet go 1 px above its top instead, so Platform lands
   *  on it. Platform falls through a Jump-thru it overlaps, and even exact
   *  contact can count as overlap, hence the pixel of clearance.
   *
   *  Without a portal record (should not happen) the exit node is used: its
   *  centre column, feet on the cell line under it. */
  _portalLandingPoint(waypoint, fallbackX, fallbackY) {
    const node = waypoint && waypoint.node;
    if (!node) return { x: fallbackX, y: fallbackY };
    let footOffset = 0, offL = -this.characterWidth / 2, offR = this.characterWidth / 2;
    try {
      const bb = this.instance.getBoundingBox();
      footOffset = bb.bottom - this.instance.y;
      offL = bb.left - this.instance.x;
      offR = bb.right - this.instance.x;
    } catch (e) {}

    let x = node.x;
    let feetY = node.isSlope ? this._cellTop(node.gy) : this._cellTop(node.gy + 1);
    const portal = waypoint.portalId ? this._getPortalsMap().get(waypoint.portalId) : null;
    if (portal) {
      // Two-way portals can be used backwards: the arriving end is the one
      // nearer the target node.
      const dExit = (portal.exitX - node.x) ** 2 + (portal.exitY - node.y) ** 2;
      const dEntry = (portal.entryX - node.x) ** 2 + (portal.entryY - node.y) ** 2;
      const exit = dExit <= dEntry;
      x = exit ? portal.exitX : portal.entryX;
      feetY = exit ? portal.exitY : portal.entryY;
    }

    // Never inside a floor: at most 1 px above the first floor row near the
    // target (surface = last clear row above it).
    const surface = this._floorSurfaceNear(x + offL, x + offR, feetY, true);
    if (surface !== null && feetY > surface - 1) feetY = surface - 1;
    this._log(`Portal landing: feet at y ${feetY.toFixed(2)} (target ${portal ? "the portal end" : "the exit node"}${surface !== null ? `, floor top ${surface + 1}` : ""})`);
    return { x, y: feetY - footOffset };
  },

  /** The real top of the floor under a landing spot, read from the Solid and
   *  Jump-thru objects themselves (documented containsPoint), not the grid.
   *
   *  Hand-placed sprites are rarely exactly on the grid line. A Jump-thru one
   *  pixel above it put the feet INSIDE it, and the Platform behavior falls
   *  through any Jump-thru it overlaps (that is how jumping up through one
   *  works), so characters dropped straight through the floor they arrived on.
   *
   *  Probes three columns across the character's width, from half a cell
   *  above the grid guess to half a cell below, and returns the highest
   *  surface found (the guess when there is none). A column that is already
   *  inside something at the first probe row is skipped (that is a wall or
   *  ceiling, not the floor). Runs once per portal use, so the scan over the
   *  obstacle objects costs nothing per frame. */
  _floorSurfaceNear(left, right, guessY, quiet = false) {
    const half = this.cellSize / 2;
    const top = Math.floor(guessY - half), bottom = Math.ceil(guessY + half);
    const candidates = [];
    for (const typeName of ["Solid", "Jumpthru"]) {
      for (const cls of this._findObjectClassesWithBehavior(typeName)) {
        for (const inst of cls.getAllInstances()) {
          if (!this._findEnabledBehaviorOn(inst, typeName)) continue;
          if (inst.isCollisionEnabled === false) continue;
          let bb;
          try { bb = inst.getBoundingBox(); } catch (e) { continue; }
          if (bb.right < left || bb.left > right || bb.bottom < top || bb.top > bottom) continue;
          candidates.push(inst);
        }
      }
    }
    if (candidates.length === 0) return quiet ? null : guessY;
    const solidAt = (x, y) => {
      for (const inst of candidates) {
        try { if (inst.containsPoint(x, y)) return true; } catch (e) {}
      }
      return false;
    };
    let best = Infinity;
    for (const x of [left + 2, (left + right) / 2, right - 2]) {
      if (solidAt(x, top)) continue; // wall or ceiling at this column
      for (let y = top + 1; y <= bottom && y < best; y++) {
        if (solidAt(x, y)) { best = y; break; }
      }
    }
    // best is the first row inside the floor; stand on the last clear row
    // above it, so a rounding pixel can never put the feet inside a Jump-thru
    // (at worst the character drops one pixel).
    if (quiet) return best === Infinity ? null : best - 1;
    return best === Infinity ? guessY : best - 1;
  },

  /** Starts the portal behavior: instant portals teleport immediately; gradual portals begin linear movement and disable Platform. */
  _executePortalBehavior(waypoint) {
    const action = waypoint ? waypoint.action : "portal_instant";

    if (action === "portal_ride") {
      // Moving platform: wait, board, ride, alight (movingPlatforms.js)
      this._startRide(waypoint);
      return;
    }

    if (action === "portal_gradual") {
      this.portalState = "traversing";
      this.portalTraverseStartX = this.instance.x;
      this.portalTraverseStartY = this.instance.y;
      this.portalTraverseProgress = 0;
      this.portalTraverseSpeed = (waypoint && waypoint.speed) || 100;

      if (this.platformBehavior) {
        this.platformWasEnabled = this.platformBehavior.isEnabled;
        this.platformBehavior.isEnabled = false;
      }
      return;
    }

    // Instant: teleport and complete
    this.instance.x = this.portalTraverseTargetX;
    this.instance.y = this.portalTraverseTargetY;
    this._completePortal();
  },

  /** Tick update for gradual portal traversal: linearly interpolates position toward exit at the portal's speed. */
  _updatePortalTraverse() {
    const dt = this.instance.dt;
    const dx = this.portalTraverseTargetX - this.portalTraverseStartX;
    const dy = this.portalTraverseTargetY - this.portalTraverseStartY;
    const totalDist = Math.sqrt(dx * dx + dy * dy);

    if (totalDist === 0) {
      this.portalTraverseProgress = 1;
    } else {
      this.portalTraverseProgress += (this.portalTraverseSpeed * dt) / totalDist;
    }

    if (this.portalTraverseProgress >= 1) {
      this.portalTraverseProgress = 1;
      this.instance.x = this.portalTraverseTargetX;
      this.instance.y = this.portalTraverseTargetY;
      if (this.platformBehavior && this.platformWasEnabled) {
        this.platformBehavior.isEnabled = true;
        // Arrive at rest: no speed left over from before the ride
        try { this.platformBehavior.vectorX = 0; this.platformBehavior.vectorY = 0; } catch (e) {}
      }
      this._completePortal();
      return;
    }

    this.instance.x = this.portalTraverseStartX + dx * this.portalTraverseProgress;
    this.instance.y = this.portalTraverseStartY + dy * this.portalTraverseProgress;
  },

  /** Finalizes a portal (instant, gradual, ride, or Complete portal): resets
   *  portal state, triggers OnPortalComplete, and marks the portal step of the
   *  path as done.
   *
   *  The step is advanced HERE rather than left to the normal arrival check:
   *  the character lands standing on the floor (_portalLandingPoint), half a
   *  tile below the node centre the arrival check measures against, so that
   *  check would never pass and the portal would run again every tick. Skipped
   *  when an On portal complete handler or a deferred Find path replaced the
   *  path. */
  _completePortal() {
    const portalWaypoint = this.portalCurrentWaypoint;
    this.justUsedPortal = true;
    this.portalPauseTimer = 0;
    this.portalPauseWarned = false;
    this._trigger("OnPortalComplete");
    this.portalState = "none";
    this.portalPaused = false;
    this.portalCurrentWaypoint = null;
    this._runDeferredFindPath();
    if (portalWaypoint && this.hasPath && this.currentPath[this.currentWaypoint] === portalWaypoint) {
      this._log(`Waypoint ${this.currentWaypoint} reached (action=${portalWaypoint.action})`);
      this.currentWaypoint++;
      this.timeAtWaypoint = 0;
      this._trigger("OnWaypointReached");
    }
  },

  /** Runs a Find path that arrived while the character was mid-portal or on a
   *  moving platform (see aceFindPath), now that it is back on solid ground. */
  _runDeferredFindPath() {
    const d = this._deferredFindPath;
    if (!d) return;
    this._deferredFindPath = null;
    this.aceFindPath(d[0], d[1], d[2], d[3], d[4]);
  },

  // ============================================================================
  // PORTALS - Conditions, control actions, expressions
  // ============================================================================

  /** Condition: character is paused at a portal entry awaiting Resume/Complete. */
  aceIsAtPortal() {
    return this.portalState === "paused";
  },

  /** Condition: character is mid gradual-portal traversal (Platform disabled). */
  aceIsTraversingPortal() {
    return this.portalState === "traversing";
  },

  /** Pauses portal execution — only valid inside the OnPortalEntry trigger
   *  (guarded by _inPortalEntryTrigger so it can't wedge the state machine). */
  acePauseAtPortal() {
    if (this._inPortalEntryTrigger) {
      this.portalPaused = true;
    }
  },

  /** Resumes a paused portal: executes the portal behavior that was deferred. */
  aceResumePortal() {
    if (this.portalState !== "paused") return;
    this.portalPaused = false;
    this._executePortalBehavior(this.portalCurrentWaypoint);
  },

  /** Skips straight to portal completion from paused or traversing state
   *  (used when user events handle the transition themselves, e.g. a cutscene). */
  aceCompletePortal() {
    if (this.portalState !== "paused" && this.portalState !== "traversing") return;
    if (this.portalState === "traversing" && this.platformBehavior && this.platformWasEnabled) {
      this.platformBehavior.isEnabled = true;
    }
    this._completePortal();
  },

  /** Instantly moves the character; sets justUsedPortal so re-path drift
   *  detection doesn't fire on the sudden position change. */
  aceTeleportToPosition(x, y) {
    this.instance.x = x;
    this.instance.y = y;
    this.justUsedPortal = true;
  },

  /** Returns the total number of registered portal instances. */
  aceGetPortalCount() {
    return this._getPortalsMap().size;
  },

  /** Returns 0-1 traversal progress for gradual portals (0 if not traversing). */
  aceGetPortalProgress() {
    return this.portalTraverseProgress;
  },

  /** Returns exit X position of the current portal. */
  aceGetPortalExitX() {
    return this.portalTraverseTargetX;
  },

  /** Returns exit Y position of the current portal. */
  aceGetPortalExitY() {
    return this.portalTraverseTargetY;
  },

  /** Returns "instant" or "gradual" for the given portal ID. */
  aceGetPortalType(portalId) {
    const portalsMap = this._getPortalsMap();
    const portal = portalsMap.get(portalId);
    return portal ? portal.type : "";
  },
};
