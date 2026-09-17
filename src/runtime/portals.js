// Portal system: instant/gradual portals, elevator groups, tags, the portal
// execution state machine (entry → pause/traverse → complete), and portal
// expressions/conditions.
// Mixed into the instance class prototype — `this` is the behavior instance.
export default {
  /** Base portal registration: stores the portal record and, if the graph is
   *  already built, connects it immediately (otherwise _connectAllPortals runs
   *  at the end of the next graph build). direction "two_way" adds the reverse link. */
  aceAddPortal(direction, entryX, entryY, exitX, exitY, portalType, cost, speed, tag) {
    this.enablePortals = true;
    const portalsMap = this._getPortalsMap();
    const portalId = this.nextPortalId++;
    this.lastPortalId = portalId;

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

  /** Connects all registered portals to the navigation graph after node generation. */
  _connectAllPortals() {
    if (!this.enablePortals) return;

    const portalsMap = this._getPortalsMap();
    for (const [id, portal] of portalsMap) {
      this._connectPortalToGraph(portal);
    }
  },

  /** Base for the *FromObjects variants: reads entry/exit positions from the
   *  first picked instance of each object class. */
  aceAddPortalFromObjects(direction, entryObjectClass, exitObjectClass, portalType, cost, speed, tag) {
    const entryInst = entryObjectClass.getFirstPickedInstance();
    const exitInst = exitObjectClass.getFirstPickedInstance();
    if (!entryInst || !exitInst) {
      this._warn("Add portal from objects: could not find picked instances");
      return;
    }
    this.aceAddPortal(direction, entryInst.x, entryInst.y, exitInst.x, exitInst.y, portalType, cost, speed, tag);
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
   *  moving teleporters. */
  aceSetPortalPosition(portalId, entryX, entryY, exitX, exitY) {
    const portalsMap = this._getPortalsMap();
    const portal = portalsMap.get(portalId);
    if (!portal) return;
    this._removePortalConnections(portalId, portal);
    portal.entryX = entryX;
    portal.entryY = entryY;
    portal.exitX = exitX;
    portal.exitY = exitY;
    if (this.graphGenerated) {
      this._connectPortalToGraph(portal);
    }
  },

  /** Moves a portal to two objects' current positions (first picked instances). */
  aceSetPortalPositionFromObjects(portalId, entryObjectClass, exitObjectClass) {
    const entryInst = entryObjectClass.getFirstPickedInstance();
    const exitInst = exitObjectClass.getFirstPickedInstance();
    if (!entryInst || !exitInst) {
      this._warn("Set portal position from objects: could not find picked instances");
      return;
    }
    this.aceSetPortalPosition(portalId, entryInst.x, entryInst.y, exitInst.x, exitInst.y);
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
   *  and every existing stop in the group (full mesh, so any floor reaches any floor). */
  aceAddElevatorStop(groupId, x, y, speed, tag) {
    if (!this.elevatorGroups.has(groupId)) {
      this.elevatorGroups.set(groupId, []);
    }
    const stops = this.elevatorGroups.get(groupId);
    const newStop = { x, y, speed };

    // Create two-way gradual portals between this stop and all existing stops
    for (const stop of stops) {
      const dist = Math.sqrt((x - stop.x) ** 2 + (y - stop.y) ** 2);
      const portalSpeed = speed || stop.speed || 100;
      const cost = dist > 0 ? (dist / portalSpeed) * this.WALK_COST : 1;
      this.aceAddPortal("two_way", stop.x, stop.y, x, y, "gradual", cost, portalSpeed, tag);
    }

    stops.push(newStop);
  },

  /** Adds an elevator stop at the picked object's position. */
  aceAddElevatorStopFromObject(groupId, objectClass, speed, tag) {
    const inst = objectClass.getFirstPickedInstance();
    if (!inst) {
      this._warn("Add elevator stop from object: could not find picked instance");
      return;
    }
    this.aceAddElevatorStop(groupId, inst.x, inst.y, speed, tag);
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

  /** Returns the ID of the most recently added portal (legacy alias of aceGetLastPortalID). */
  aceGetLastPortalId() {
    return this.lastPortalId;
  },

  /** Returns the active portal ID during traversal/pause (legacy alias of aceGetCurrentPortalID). */
  aceGetCurrentPortalId() {
    return this.currentPortalId;
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
      this.portalTraverseTargetX = targetX;
      this.portalTraverseTargetY = targetY;

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

  /** Starts the portal behavior: instant portals teleport immediately; gradual portals begin linear movement and disable Platform. */
  _executePortalBehavior(waypoint) {
    const action = waypoint ? waypoint.action : "portal_instant";

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
      }
      this._completePortal();
      return;
    }

    this.instance.x = this.portalTraverseStartX + dx * this.portalTraverseProgress;
    this.instance.y = this.portalTraverseStartY + dy * this.portalTraverseProgress;
  },

  /** Finalizes portal traversal: resets portal state, advances waypoint, and triggers OnPortalComplete. */
  _completePortal() {
    this.justUsedPortal = true;
    this.portalPauseTimer = 0;
    this.portalPauseWarned = false;
    this._trigger("OnPortalComplete");
    this.portalState = "none";
    this.portalPaused = false;
    this.portalCurrentWaypoint = null;
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

  /** Returns the last portal ID that was added. */
  aceGetLastPortalID() {
    return this.lastPortalId;
  },

  /** Returns the portal ID during OnPortalEntry/OnPortalComplete triggers. */
  aceGetCurrentPortalID() {
    return this.currentPortalId;
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
