import { globalNavManager } from "./navigationManager.js";

// Movement execution: path following, waypoint arrival, jump/fall/walk/coyote
// handlers, jump-toward, and movement-related settings and expressions.
// Mixed into the instance class prototype — `this` is the behavior instance.
//
// Patrols (one of them runs per tick when the character has no path):
//   - Platform patrol (_updatePatrol): walks between the platform's ends,
//     found by following walk connections (_findPatrolBound). Turns at ledges,
//     walls, danger ahead (_patrolDangerAhead) and other characters
//     (_patrolBlockedByAgent). Re-measures its ends when graphVersion changes.
//   - Route patrol (_updatePatrolRoute, state in this._route): phases go,
//     moving, dwell, retry. Each leg is a normal Find path, so it uses every
//     move type (jumps, falls, portals, rides).
//   - Settings (aceSetPatrolSetting / aceSetPatrolOption): dwell variation,
//     speed (scales the Platform max speed only while walking a patrol), and
//     resume after (_patrolMemory, restarted by _tickPatrolResume).
export default {
  /** Main path-following loop: checks waypoint arrival, handles stuck detection, converts actions, and dispatches movement. */
  _followPath(dt) {
    if (this.currentWaypoint >= this.currentPath.length) {
      // Centre within the final tile before completing the path
      const lastWp = this.currentPath[this.currentPath.length - 1];
      if (lastWp && this.autoControl && this.platformBehavior) {
        try {
          // Wait for landing before centering or completing
          if (!this.platformBehavior.isOnFloor) {
            return;
          }
          const distToCenter = Math.abs(this.instance.x - lastWp.x);
          if (distToCenter > this.cellSize * 0.15) {
            const dir = lastWp.x < this.instance.x ? "left" : "right";
            if (!this.platformBehavior.isByWall(dir)) {
              this.platformBehavior.simulateControl(dir);
              return; // Wait until centered
            }
          }
        } catch (e) {}
      }
      this.hasPath = false;
      this.departureCommitted = false;
      // Snapshot the side goal BEFORE the trigger: an On arrived handler
      // issuing a fresh Find path would otherwise clear or re-arm it.
      const sideGoal = this._takeSideGoal();
      this._trigger("OnPathComplete");
      this._checkSideGoalReached(sideGoal);
      return;
    }

    // Portal state machine — block path advancement during portal execution
    if (this.portalState !== "none") {
      if (this.portalState === "paused") {
        this.portalPauseTimer = (this.portalPauseTimer || 0) + dt;
        if (this.portalPauseTimer > 5 && !this.portalPauseWarned) {
          this.portalPauseWarned = true;
          this._warn("Portal paused for 5+ seconds. Call 'Resume portal' or 'Complete portal' to continue pathfinding.");
        }
        return;
      }
      if (this.portalState === "traversing") {
        this._updatePortalTraverse();
      } else if (this.portalState === "riding") {
        this._updateRide(dt);
      }
      return;
    }

    const waypoint = this.currentPath[this.currentWaypoint];
    this.timeAtWaypoint += dt;

    // Debug: compact arc trace during jump/fall waypoints — one line at
    // departure and one at the first wall contact, the two moments that
    // diagnose a missed arc. Landing outcomes are already covered by the
    // "Waypoint reached" / "Landed off-course" lines.
    if (
      this.enableDebug && waypoint.action &&
      (waypoint.action.includes("fall") || waypoint.action.includes("jump"))
    ) {
      try {
        const airborne = !this.platformBehavior.isOnFloor;
        if (airborne && !(this._arcTraceState & 1)) {
          this._arcTraceState |= 1;
          this._log(
            `Arc [${waypoint.action}] departed: ` +
            `pos=(${Math.round(this.instance.x)},${Math.round(this.instance.y)}) ` +
            `vx=${Math.round(this.platformBehavior.vectorX)}`
          );
        }
        if (
          airborne && !(this._arcTraceState & 2) &&
          (this.platformBehavior.isByWall("left") || this.platformBehavior.isByWall("right"))
        ) {
          this._arcTraceState |= 2;
          this._log(
            `Arc [${waypoint.action}] wall contact: ` +
            `pos=(${Math.round(this.instance.x)},${Math.round(this.instance.y)})`
          );
        }
      } catch (e) {}
    }

    // Off-course landing detection for airborne waypoints: if the character
    // was airborne for this jump/fall and lands far from the target, the arc
    // failed (bumped a wall, clipped a corner). Re-path immediately from
    // wherever it landed instead of waiting out the stuck timer.
    const isAirWaypoint =
      waypoint.action === "jump" || waypoint.action === "coyote_jump" ||
      waypoint.action.includes("fall");
    if (isAirWaypoint && this.platformBehavior) {
      try {
        if (!this.platformBehavior.isOnFloor) {
          this._wpWasAirborne = true;
        } else if (this._wpWasAirborne) {
          this._wpWasAirborne = false;
          this._arcTraceState = 0;
          const landDist = this.distance(
            this.instance.x, this.instance.y, waypoint.x, waypoint.y
          );
          if (landDist > this.cellSize * 1.5) {
            this._log(
              `Landed off-course after ${waypoint.action} ` +
              `(${Math.round(landDist)}px from waypoint) — repathing`
            );
            this._rePath();
            return;
          }
        }
      } catch (e) {}
    }

    if (this.timeAtWaypoint > this.maxWaypointTime) {
      this.hasPath = false;
      this.departureCommitted = false;
      this._wpWasAirborne = false;
      this._arcTraceState = 0;
      this._momentumArmed = false;
      this.timeAtWaypoint = 0;
      this._log(`Stuck at waypoint ${this.currentWaypoint} action=${waypoint.action} target=(${Math.round(waypoint.x)},${Math.round(waypoint.y)}) pos=(${Math.round(this.instance.x)},${Math.round(this.instance.y)}) (exceeded ${this.maxWaypointTime}s)`);
      this._trigger("OnWaypointStuck");
      return;
    }

    // Walk/fall/landed-jump arrivals: use X-only distance when the Y offset is
    // slope-plausible (< cellSize). For slope targets during walk/fall, also bypass
    // the Y check — slope surfaces can be offset from the node center.
    // IMPORTANT: Do NOT apply the slope bypass for jump-action waypoints. A vertical
    // jump (dx≈0) to a slope target would immediately read dist=0 at the launch
    // position (same X, different Y), triggering false arrival before the jump fires.
    // IMPORTANT: Do NOT apply the slope bypass while airborne (e.g. fall_right to a
    // slope node). The character may be at the right X but still far above the target Y.
    // Only bypass when isOnFloor — the character is actually standing on the slope.
    let dist;
    const dy = Math.abs(this.instance.y - waypoint.y);
    const isOnFloor = this.platformBehavior && this.platformBehavior.isOnFloor;
    const isGroundArrival = waypoint.action.includes("walk") || waypoint.action.includes("fall") ||
      (waypoint.action === "jump" && isOnFloor);
    const isSlopeTarget = waypoint.node && waypoint.node.isSlope;
    // Slope bypass: X-only distance ONLY when walking along the slope surface.
    // Fall/jump actions approach the slope from above — the character may be at the
    // right X but still above the target Y, so Y must be checked normally.
    const isWalkAction = waypoint.action === "walk_left" || waypoint.action === "walk_right";
    const applySlopeBypass = isSlopeTarget && isWalkAction && isOnFloor;
    if (isGroundArrival && (dy < this.cellSize || applySlopeBypass)) {
      dist = Math.abs(this.instance.x - waypoint.x);
    } else {
      dist = this.distance(this.instance.x, this.instance.y, waypoint.x, waypoint.y);
    }

    let arrivalThreshold;
    if (waypoint.node && waypoint.node.isIsland) {
      // If walls on both sides, character can't overshoot — use a relaxed threshold
      let walledBothSides = false;
      try {
        if (this.platformBehavior) {
          walledBothSides = this.platformBehavior.isByWall("left") && this.platformBehavior.isByWall("right");
        }
      } catch (e) {}
      arrivalThreshold = walledBothSides ? this.cellSize * 0.45 : this.cellSize * 0.15;
    } else if (waypoint.action.includes("walk")) {
      // Strict positioning: tighten arrival when the next action is a departure (jump/fall)
      if (this.currentPathStrict) {
        const nextIdx = this.currentWaypoint + 1;
        const nextWp = nextIdx < this.currentPath.length ? this.currentPath[nextIdx] : null;
        const nextIsDeparture = nextWp && (
          nextWp.action === "jump" || nextWp.action === "coyote_jump" ||
          nextWp.action === "fall" ||
          nextWp.action === "fall_left" || nextWp.action === "fall_right"
        );
        arrivalThreshold = nextIsDeparture ? this.cellSize * 0.15 : this.cellSize * 0.3;
      } else {
        arrivalThreshold = this.cellSize * 0.3;
      }
    } else if (
      waypoint.action === "jump" ||
      waypoint.action === "coyote_jump"
    ) {
      const landingNode = waypoint.node;
      arrivalThreshold =
        landingNode && landingNode.isIsland
          ? this.cellSize * 0.2
          : this.cellSize * 0.75;
    } else {
      arrivalThreshold = this.cellSize * 0.5;
    }

    if (dist < arrivalThreshold) {
      // Before advancing, check if the next waypoint requires ground contact (jump, fall, etc.)
      // If so, the character must land first — don't advance while still airborne
      const nextIdx = this.currentWaypoint + 1;
      const nextWp = nextIdx < this.currentPath.length ? this.currentPath[nextIdx] : null;
      if (nextWp && this.platformBehavior) {
        const nextNeedsGround = nextWp.action === "jump" || nextWp.action === "coyote_jump" ||
          nextWp.action === "fall" ||
          nextWp.action === "fall_left" || nextWp.action === "fall_right" ||
          nextWp.action === "fall_through";
        try {
          if (nextNeedsGround && !this.platformBehavior.isOnFloor) {
            // Close to waypoint but still airborne — wait for landing before advancing
            return;
          }
        } catch (e) {}
      }

      this._log(`Waypoint ${this.currentWaypoint} reached (action=${waypoint.action})`);
      this.currentWaypoint++;
      this.timeAtWaypoint = 0;
      // Reset per-action state so the NEXT waypoint starts clean.
      // departureCommitted is set during jump pre-centering; if the waypoint arrival
      // fires mid-air (e.g. double jump still descending), the flag stays true and
      // blocks walk input on the following waypoint.
      // doubleJumpPhase/isHoldingJump must also be cleared so the next action doesn't
      // inherit stale jump state from the previous waypoint's trajectory.
      this.departureCommitted = false;
      this.doubleJumpPhase = 0;
      this.isHoldingJump = false;
      this._wpWasAirborne = false;
      this._arcTraceState = 0;
      this._momentumArmed = false;
      this._moverWaitTime = 0;
      // _crossObs (measured open windows) is kept: it belongs to the obstacle,
      // and paths near one have a waypoint per tile, reached while waiting
      this._crossWait = 0;
      this._trigger("OnWaypointReached");
      return;
    }

    if (
      this.rePathThreshold > 0 &&
      this.rePathCooldown <= 0 &&
      !this.justUsedPortal
    ) {
      const expectedMaxDist = this.cellSize * this.rePathThreshold;
      // Only trigger repath when grounded AND performing a ground-based action.
      // During jumps/falls the character is expected to be far from the waypoint
      // temporarily — repathing mid-air would trigger false positives.
      const isGroundAction = waypoint.action.includes("walk") ||
        waypoint.action === "fall_through" || waypoint.action === "start";
      if (
        this._driftFromPath(waypoint) > expectedMaxDist &&
        isGroundAction &&
        this.platformBehavior &&
        this.platformBehavior.isOnFloor
      ) {
        this._rePath();
        return;
      }
    }

    if (this.autoControl) {
      let effectiveAction = waypoint.action;

      // Convert jump to fall when the target is below, character is on the floor,
      // and not on an island. Only when grounded — mid-air conversion disrupts the jump arc.
      if (effectiveAction === "jump" && !waypoint.requiresMomentum && this.platformBehavior.isOnFloor && waypoint.y > this.instance.y + this.cellSize * 0.3) {
        const prevWpIdx = this.currentWaypoint - 1;
        const prevWp = prevWpIdx >= 0 ? this.currentPath[prevWpIdx] : null;
        const prevNode = prevWp ? prevWp.node : null;
        const isOnIsland = prevNode && prevNode.isIsland;
        if (!isOnIsland) {
          const xDiff = waypoint.x - this.instance.x;
          // Only downgrade the jump when plain fall physics can actually cover
          // the horizontal distance: drift range = maxSpeed × fall time, with a
          // 20% margin for the edge departure and end-of-fall braking. A long
          // flat jump to a lower platform (e.g. 6 tiles across, 2 down) needs
          // the jump arc's extra airtime — converted to a fall, the character
          // walks off the ledge into a drop that can never reach the landing.
          const dy = waypoint.y - this.instance.y;
          const gravity = this.platformProps.gravity || 1500;
          const maxSpeed = this.platformProps.maxSpeed || 330;
          const fallDriftRange = maxSpeed * Math.sqrt((2 * dy) / gravity) * 0.8;
          if (Math.abs(xDiff) < this.cellSize * 0.3) {
            effectiveAction = "fall";
          } else if (Math.abs(xDiff) <= fallDriftRange) {
            effectiveAction = xDiff < 0 ? "fall_left" : "fall_right";
          }
          // else: keep the jump — the arc is required to cover the distance.
        }
      }

      if (
        (effectiveAction === "jump" || effectiveAction === "coyote_jump" ||
         effectiveAction === "fall" || effectiveAction === "fall_left" ||
         effectiveAction === "fall_right") &&
        this.platformBehavior?.isOnFloor
      ) {
        const yDist = Math.abs(this.instance.y - waypoint.y);
        if (yDist < this.cellSize * 0.75) {
          const walkDir = waypoint.x < this.instance.x ? "left" : "right";
          // Walk it instead only when that is a plain walk: no wall, gap or
          // hazard between (a jump over spikes must stay a jump)
          let canWalkDirectly = false;
          try {
            if (!this.platformBehavior.isByWall(walkDir)) {
              const charGrid = this.worldToGrid(this.instance.x, this.instance.y);
              const wpGrid = this.worldToGrid(waypoint.x, waypoint.y);
              canWalkDirectly = this._isPlainWalk(charGrid.gy, charGrid.gx, wpGrid.gx);
            }
          } catch (e) {}
          if (canWalkDirectly) {
            effectiveAction = walkDir === "left" ? "walk_left" : "walk_right";
          }
        }
      }

      this._executeAction(effectiveAction, waypoint.x, waypoint.y, waypoint);
    }
  },

  /** X where the current stretch of walking ends: the last of the following
   *  waypoints that keep walking the same way. Paths keep a waypoint per tile
   *  near hazards and moving obstacles, so the next waypoint alone can stop
   *  short of an obstacle the walk is about to cross. */
  _walkRunEndX() {
    const path = this.currentPath;
    let i = this.currentWaypoint;
    const action = path[i].action;
    while (i + 1 < path.length && path[i + 1].action === action) i++;
    return path[i].x;
  },

  /** How far the character is from the path it is following: its distance to
   *  the segment between the previous waypoint and the current one. This is
   *  what Re-Path Threshold measures ("tiles of drift from the path").
   *
   *  The distance to the next waypoint alone is not drift: smoothed walks put
   *  waypoints 20+ tiles apart, so that read every long walk as drift and
   *  re-pathed every half second (wasted searches), and a character waiting
   *  at a crusher re-pathed until the loop detector dropped its path. */
  _driftFromPath(waypoint) {
    const px = this.instance.x, py = this.instance.y;
    const prev = this.currentWaypoint > 0 ? this.currentPath[this.currentWaypoint - 1] : null;
    if (!prev) return this.distance(px, py, waypoint.x, waypoint.y);
    const ax = prev.x, ay = prev.y;
    const dx = waypoint.x - ax, dy = waypoint.y - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return this.distance(px, py, ax + t * dx, ay + t * dy);
  },

  /** Re-calculates the path to the current target; detects re-path loops and triggers OnWaypointStuck if stuck. */
  _rePath(fromMapChange = false) {
    if (this.portalState !== "none") return;
    // Remove any queued request — re-paths always run immediately (edge case #4)
    globalNavManager.removeQueuedRequest(this);
    this.rePathCooldown = this.rePathCooldownDuration;

    // Track distance to goal to detect re-path loops
    const distToGoal = this.distance(
      this.instance.x, this.instance.y,
      this.pathTargetX, this.pathTargetY
    );

    if (distToGoal < this.rePathBestDist - this.cellSize) {
      // Making progress — reset counter
      this.rePathBestDist = distToGoal;
      this.rePathCount = 0;
    }

    // Re-paths caused by the LEVEL changing (graph patches) are not the
    // character failing, so they do not count toward loop detection.
    if (!fromMapChange) this.rePathCount++;

    if (this.rePathCount >= 5) {
      // Re-pathed 5 times without getting closer — stuck in a loop
      this._warn(`Re-path loop detected (${this.rePathCount} re-paths without progress)`);
      this.hasPath = false;
      this.departureCommitted = false;
      this.rePathCount = 0;
      this.rePathBestDist = Infinity;
      this._trigger("OnWaypointStuck");
      return;
    }

    this.aceFindPath(
      this.pathTargetX,
      this.pathTargetY,
      true,
      this.lastPathMode,
      undefined,
      true // isRePath — always immediate, bypass queue
    );
    this._trigger("OnRePathTriggered");
  },

  /** Top-level action dispatcher: routes portal, fall-through, and physics-based actions to their handlers. */
  _executeAction(action, targetX, targetY, waypoint) {
    if (!this.platformBehavior) return;
    if (!this.platformBehavior.isEnabled) return;

    if (action.includes("portal")) {
      this._executePortal(targetX, targetY, waypoint);
      return;
    }

    if (action === "fall_through") {
      this._executeFallThrough(targetX, targetY);
      return;
    }

    this._executePhysicsAware(action, targetX, targetY, waypoint);
  },

  /** Simulates pressing "down" to fall through a jump-thru platform. */
  _executeFallThrough(targetX, targetY) {
    if (this.platformBehavior.isOnFloor) {
      this.platformBehavior.fallThrough();
      if (targetX < this.instance.x) {
        this.platformBehavior.simulateControl("left");
      } else if (targetX > this.instance.x) {
        this.platformBehavior.simulateControl("right");
      }
    }
  },

  /** Routes physics-based actions (walk, jump, coyote_jump, fall) to their specific movement handlers. */
  _executePhysicsAware(action, targetX, targetY, waypoint) {
    if (action === "walk_left" || action === "walk_right") {
      // Committed departure: skip walk input so character doesn't overshoot before jump fires
      if (this.departureCommitted) return;

      const movingLeft = action === "walk_left";
      const wallSide = movingLeft ? "left" : "right";

      // A moving obstacle (crusher, sliding block) is in the way. The route is
      // still right, it is only blocked for now: stand still and wait for it
      // to move, instead of pushing into it (which used to set off the
      // stuck-walk hop below, even with Walk Only).
      if (this._waitForMovingObstacle(wallSide)) return;
      // About to walk into a moving obstacle's danger area: wait at its edge
      // until it will stay out of the way long enough to get across
      // (movingPlatforms.js, crossing timing).
      if (this._waitForCrossingWindow(wallSide, this._walkRunEndX())) return;

      try {
        if (
          this.platformBehavior.isByWall(wallSide) &&
          this.platformBehavior.isOnFloor
        ) {
          // Check if character still has room to move within this tile toward the target
          const halfCell = this.cellSize / 2;
          const stillHasRoom = movingLeft
            ? this.instance.x - targetX > halfCell * 0.1
            : targetX - this.instance.x > halfCell * 0.1;

          if (stillHasRoom) {
            // Character hit the wall but hasn't reached the waypoint yet —
            // don't try to jump, just let the walk handler move within the tile
            this._handleWalkAction(targetX, movingLeft ? "left" : "right", waypoint);
            return;
          }

          // Truly blocked by wall while grounded — path is invalid, repath
          this._warn(`Walk blocked by wall (${wallSide}) while grounded — repathing`);
          this._rePath();
          return;
        }
      } catch (e) {}

      this._handleWalkAction(targetX, movingLeft ? "left" : "right", waypoint);
      return;
    }

    if (action === "jump") {
      this._handleJumpAction(targetX, targetY, waypoint);
      return;
    }

    if (action === "coyote_jump") {
      this._handleCoyoteJumpAction(targetX, targetY, waypoint);
      return;
    }

    if (
      action === "fall" ||
      action === "fall_left" ||
      action === "fall_right"
    ) {
      // Strict positioning: edge-align before diagonal falls
      if (this.currentPathStrict && (action === "fall_left" || action === "fall_right")) {
        try {
          if (this.platformBehavior.isOnFloor) {
            const prevIdx = this.currentWaypoint - 1;
            const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
            if (prevWp && prevWp.node) {
              const dir = action === "fall_right" ? "right" : "left";
              const edgeX = prevWp.node.x + (dir === "right" ? 1 : -1) * (this.cellSize / 2 - this.cellSize * 0.1);
              const distToEdge = Math.abs(this.instance.x - edgeX);
              const pastEdge = dir === "right" ? this.instance.x >= edgeX : this.instance.x <= edgeX;
              if (!pastEdge && distToEdge > this.cellSize * 0.15) {
                if (!this.platformBehavior.isByWall(dir)) {
                  this.platformBehavior.simulateControl(dir);
                }
                return; // Wait until at edge
              }
            }
          }
        } catch (e) {}
      }
      this._handleFallAction(targetX);
      return;
    }
  },

  /** Whether a walk is blocked by a moving obstacle, and if so, waits.
   *
   *  "Moving obstacle" = the character is grounded and pressed against a wall
   *  that is NOT in the obstacle map. The watcher (movingPlatforms.js) keeps
   *  moving Solid objects out of the map, so a wall that only Platform
   *  physics can see is one of them (or a brand-new obstacle the watcher has
   *  not scanned yet, which turns into a re-path a few frames later).
   *
   *  While waiting, the waypoint timer is held so the wait does not count as
   *  being stuck. After 3 x Max Waypoint Time the character gives up and
   *  re-paths, so an obstacle that stops in the way for good
   *  cannot hold it forever. */
  _waitForMovingObstacle(direction) {
    const pb = this.platformBehavior;
    let blocked = false;
    try {
      // Cheapest test first: a character that is still moving is not blocked,
      // so the wall query (a collision test) only runs once it has stopped.
      blocked = Math.abs(pb.vectorX) < 1 && pb.isOnFloor && pb.isByWall(direction) &&
        !this._staticWallAhead(direction);
    } catch (e) {}
    if (!blocked) {
      this._moverWaitTime = 0;
      return false;
    }
    const dt = this.instance.dt;
    if (!this._moverWaitTime) this._log(`Waiting for a moving obstacle to clear (${direction})`);
    this._moverWaitTime = (this._moverWaitTime || 0) + dt;
    if (this._moverWaitTime > this.maxWaypointTime * 3) {
      this._moverWaitTime = 0;
      this._log("Moving obstacle did not clear: repathing");
      this._rePath();
      return true;
    }
    this.timeAtWaypoint = Math.max(0, this.timeAtWaypoint - dt); // waiting is not stuck
    this._walkStuckCount = 0;
    return true;
  },

  /** Whether the obstacle map has a solid or slope cell right beside the
   *  character's bounding box in the given direction (any row the body
   *  covers). Outside the grid counts as a static wall. */
  _staticWallAhead(direction) {
    if (!this.obstacleMap) return true;
    const bb = this.instance.getBoundingBox();
    const gx = this._toGX(direction === "right" ? bb.right + 1 : bb.left - 1);
    if (gx < 0 || gx >= this.gridWidth) return true;
    const gyTop = Math.max(0, this._toGY(bb.top));
    const gyBottom = Math.min(this.gridHeight - 1, this._toGY(bb.bottom - 1));
    for (let gy = gyTop; gy <= gyBottom; gy++) {
      const i = gy * this.gridWidth + gx;
      if (this.obstacleMap[i] === 1 || (this.slopeMap && this.slopeMap[i] > 0)) return true;
    }
    return false;
  },

  /** Applies horizontal simulateControl toward a walk waypoint; handles ledge restriction and arrival centering. */
  _handleWalkAction(targetX, direction, waypoint) {
    // Horizontal braking must use the horizontal velocity only: .speed is the
    // overall velocity magnitude, which includes any vertical component.
    const speed =
      Math.abs(this.platformBehavior.vectorX) || Math.abs(this.estimatedVelocityX);
    const decel = this.platformProps.deceleration;
    const distToTarget = Math.abs(targetX - this.instance.x);
    const stoppingDist = (speed * speed) / (2 * decel);

    if (this.ledgeRestriction && waypoint && waypoint.node) {
      const node = waypoint.node;
      if (
        (direction === "left" && node.isLeftLedge) ||
        (direction === "right" && node.isRightLedge)
      ) {
        const nextIdx = this.currentWaypoint + 1;
        const nextWaypoint = nextIdx < this.currentPath.length ? this.currentPath[nextIdx] : null;
        const nextNeedsDeparture = nextWaypoint && (
          nextWaypoint.action === "fall" || nextWaypoint.action === "fall_left" ||
          nextWaypoint.action === "fall_right" || nextWaypoint.action === "jump" ||
          nextWaypoint.action === "coyote_jump"          );

        if (!nextNeedsDeparture) {
          const edgeX =
            node.x +
            (direction === "right" ? 1 : -1) *
              (this.cellSize / 2 + this.ledgeLeniency);
          const pastEdge =
            direction === "right"
              ? this.instance.x >= edgeX
              : this.instance.x <= edgeX;
          if (pastEdge) return;
        }
      }
    }

    if (waypoint && waypoint.node && waypoint.node.isIsland) {
      // Check if walls on both sides — if so, character can't overshoot, no speed cap needed
      let walledBothSides = false;
      try {
        walledBothSides = this.platformBehavior.isByWall("left") && this.platformBehavior.isByWall("right");
      } catch (e) {}

      if (!walledBothSides) {
        const maxSafeSpeed = Math.sqrt(2 * decel * (this.cellSize * 0.4));
        if (speed > maxSafeSpeed) return;
      }
    }

    // Strict positioning: cap speed when approaching a ledge before a departure action.
    // Only applies when grounded — mid-air speed capping is counterproductive (e.g. after micro-jumps).
    if (this.currentPathStrict && this.platformBehavior.isOnFloor && waypoint && waypoint.node) {
      const node = waypoint.node;
      if (node.isLeftLedge || node.isRightLedge || node.isIsland) {
        const nextIdx = this.currentWaypoint + 1;
        const nextWp = nextIdx < this.currentPath.length ? this.currentPath[nextIdx] : null;
        if (nextWp && (
          nextWp.action === "jump" || nextWp.action === "coyote_jump" ||
          nextWp.action === "fall" ||
          nextWp.action === "fall_left" || nextWp.action === "fall_right"
        )) {
          const maxDepartureSpeed = Math.sqrt(2 * decel * (this.cellSize * 0.35));
          if (speed > maxDepartureSpeed) return;
        }
      }
    }

    if (distToTarget > stoppingDist + this.cellSize * 0.1) {
      this.platformBehavior.simulateControl(direction);

      // Slope micro-jump: if the character hasn't moved for several ticks while
      // walk input is being applied, a gentle slope tile boundary is likely blocking.
      // A small jump dislodges the character without disrupting the walk path.
      if (this._walkStuckX === undefined) { this._walkStuckX = -1; this._walkStuckCount = 0; }
      const roundedX = Math.round(this.instance.x * 10);
      if (roundedX === this._walkStuckX) {
        this._walkStuckCount++;
        if (this._walkStuckCount >= 5 && this.platformBehavior.isOnFloor) {
          this.platformBehavior.simulateControl("jump");
          this._walkStuckCount = 0;
        }
      } else {
        this._walkStuckX = roundedX;
        this._walkStuckCount = 0;
      }
    } else {
      this._walkStuckCount = 0;
    }
  },

  /** Checks if the cell adjacent to the character (in the given direction) is clear at the current height, accounting for character head cells. Used per-frame during double jump to gate horizontal input. */
  _isDoubleJumpHorizontalClear(dir) {
    const cs = this.cellSize;
    const headCells = Math.max(0, Math.ceil(this.characterHeight / cs) - 1);
    const grid = this.worldToGrid(this.instance.x, this.instance.y);
    const checkGx = grid.gx + (dir === "right" ? 1 : -1);
    if (checkGx < 0 || checkGx >= this.gridWidth) return false;

    for (let h = 0; h <= headCells; h++) {
      const checkGy = grid.gy - h;
      if (checkGy < 0 || checkGy >= this.gridHeight) continue;
      const val = this.obstacleMap[checkGy * this.gridWidth + checkGx];
      if (val === 1 || val === 3) return false;
    }
    return true;
  },

  /** Handles jump execution: double-jump state machine (5 phases with release frame), pre-positioning (center or slide-off), and variable jump hold. */
  _handleJumpAction(targetX, targetY, waypoint) {
    const dt = this.instance.dt;

    if (waypoint && waypoint.requiresDoubleJump) {
      const dir = targetX < this.instance.x ? "left" : "right";
      const atOrAboveTarget = this.instance.y <= targetY + this.cellSize;
      // Phase 0-1 (first jump): only horizontal when at/above target — gain height first.
      // Phase 2-4 (second jump): horizontal when at/above target OR adjacent cell clear —
      // move toward target during second jump and landing.
      const firstJumpHorizontal = atOrAboveTarget;
      const secondJumpHorizontal = atOrAboveTarget || this._isDoubleJumpHorizontalClear(dir);

      // Pre-position for double jump: center on launch node before phase 0.
      // Without this, the character launches from wherever it landed (possibly
      // off-center), causing the first vertical phase to pass through different
      // grid cells than _canDoubleJump() validated — hitting ceilings.
      if (this.doubleJumpPhase === 0 && this.platformBehavior.isOnFloor) {
        const prevIdx = this.currentWaypoint - 1;
        const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
        if (prevWp && prevWp.node) {
          const tileCenterX = prevWp.node.x;
          const distToCenter = Math.abs(this.instance.x - tileCenterX);
          // Same slope tolerance as single-jump: slope surface shifts Y while walking X,
          // so half-tile precision is sufficient for arc correctness.
          const centerTolerance = prevWp.node.isSlope ? this.cellSize * 0.5 : this.cellSize * 0.15;
          if (distToCenter > centerTolerance) {
            const centerDir = tileCenterX < this.instance.x ? "left" : "right";
            try {
              if (!this.platformBehavior.isByWall(centerDir)) {
                this.platformBehavior.simulateControl(centerDir);
              }
            } catch (e) {}
            return; // Wait until centered
          }
          if (this.currentPathStrict) {
            this.departureCommitted = true;
          }
        }
      }

      if (this.doubleJumpPhase === 0) {
        // Phase 0: Initiate first jump from the ground
        this._log(`Double jump initiated toward (${Math.round(targetX)}, ${Math.round(targetY)})`);
        if (firstJumpHorizontal) this.platformBehavior.simulateControl(dir);
        this.platformBehavior.simulateControl("jump");
        this.doubleJumpPhase = 1;
        this.jumpStartTime = 0;
        this._doubleJumpGrace = 0.1; // 100ms grace before checking isFalling
        this._doubleJumpLastY = this.instance.y;
      } else if (this.doubleJumpPhase === 1) {
        // Phase 1: Sustain first jump, wait for isFalling (apex reached)
        if (firstJumpHorizontal) this.platformBehavior.simulateControl(dir);

        if (this.platformProps.jumpSustain > 0) {
          this.jumpStartTime += dt * 1000;
          if (this.jumpStartTime < this.platformProps.jumpSustain) {
            this.platformBehavior.simulateControl("jump");
          }
        }

        // Wait for grace period, then detect apex
        this._doubleJumpGrace -= dt;
        if (this._doubleJumpGrace <= 0) {
          // Ceiling hit detection: if character moved downward during first jump
          // (y increased), a ceiling stopped the ascent — repath immediately
          if (this.instance.y > this._doubleJumpLastY + 1) {
            this._warn(`Double jump: ceiling hit during phase 1 — repathing`);
            this.doubleJumpPhase = 0;
            this._rePath();
            return;
          }
          this._doubleJumpLastY = this.instance.y;
          // If character fell back to floor, first jump failed entirely — repath
          if (this.platformBehavior.isOnFloor && !this.platformBehavior.isJumping) {
            this._warn(`Double jump: back on floor before second jump — repathing`);
            this.doubleJumpPhase = 0;
            this._rePath();
            return;
          }
          // Once falling (past apex), proceed to second jump
          if (this.platformBehavior.isFalling) {
            this.doubleJumpPhase = 2;
          }
        }
      } else if (this.doubleJumpPhase === 2) {
        // Phase 2: Release frame — no jump input so Platform behavior sees a "release"
        this._log(`Double jump: release frame`);
        if (secondJumpHorizontal) this.platformBehavior.simulateControl(dir);
        this.doubleJumpPhase = 3;
      } else if (this.doubleJumpPhase === 3) {
        // Phase 3: Fire second jump (fresh press after release)
        this._log(`Double jump: second jump fired`);
        if (secondJumpHorizontal) this.platformBehavior.simulateControl(dir);
        this.platformBehavior.simulateControl("jump");
        this.doubleJumpPhase = 4;
        this.jumpStartTime = 0;
        this._doubleJumpLastY = this.instance.y;
      } else if (this.doubleJumpPhase === 4) {
        // Phase 4: Sustain second jump
        if (secondJumpHorizontal) this.platformBehavior.simulateControl(dir);

        if (this.platformProps.jumpSustain > 0) {
          this.jumpStartTime += dt * 1000;
          if (this.jumpStartTime < this.platformProps.jumpSustain) {
            this.platformBehavior.simulateControl("jump");
          }
        }

        // Ceiling hit detection for second jump — only check during ascent.
        // platformBehavior.isFalling is true once the character has passed the
        // apex and is descending. Checking without this guard causes a false
        // positive with jumpSustain=0: the character reaches the apex and starts
        // falling normally, but the per-tick y delta exceeds 1px a few frames
        // into the descent, triggering a spurious repath.
        if (!this.platformBehavior.isFalling && this.instance.y > this._doubleJumpLastY + 1) {
          this._warn(`Double jump: ceiling hit during phase 4 — repathing`);
          this.doubleJumpPhase = 0;
          this._rePath();
          return;
        }
        this._doubleJumpLastY = this.instance.y;
      }

      // Wall collision detection for phases 2-4: if moving horizontally and
      // hitting a wall, the character can't reach the target — repath immediately
      // instead of waiting for the 5s waypoint timeout.
      if (this.doubleJumpPhase >= 2) {
        let hitWall = false;
        try { hitWall = this.platformBehavior.isByWall(dir); } catch (e) {}
        if (hitWall) {
          this._warn(`Double jump: hit wall during phase ${this.doubleJumpPhase} — repathing`);
          this.doubleJumpPhase = 0;
          this._rePath();
          return;
        }
      }

      // Floor landing detection for phases 3-4: if the character has landed
      // after the second jump, the double jump is complete (success or fail).
      // Normal waypoint arrival handles success; this catches failures where
      // the character landed but didn't reach the target.
      if (this.doubleJumpPhase >= 3 && this.platformBehavior.isOnFloor && !this.platformBehavior.isJumping) {
        this.doubleJumpPhase = 0;
        this.departureCommitted = false;
        // Don't repath here — let normal waypoint arrival check handle it.
        // The character may have landed close enough to the target.
      }
      return;
    }

    const xDist = Math.abs(targetX - this.instance.x);
    const isVerticalJump = xDist < this.cellSize * 0.5;

    // Detect if the character has fallen off the expected launch platform.
    // After reaching a walk waypoint, momentum can carry the character past the
    // edge, landing on a lower platform. Jumping from here is futile — repath.
    if (this.platformBehavior.isOnFloor) {
      const prevIdx = this.currentWaypoint - 1;
      const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
      if (prevWp && prevWp.node) {
        const expectedY = prevWp.node.y;
        const actualY = this.instance.y;
        if (actualY > expectedY + this.cellSize * 1.5) {
          this._warn(`Fell off launch platform (expected y=${Math.round(expectedY)}, actual y=${Math.round(actualY)}) — repathing`);
          this._rePath();
          return;
        }
      }
    }

    // Momentum (run-up) jump departure: this connection was validated for an
    // edge launch at speed, not a standstill launch from the tile center. Do
    // what a player does on a small stone: back up across the launch tile,
    // sprint toward the gap, and leap from the edge (~24px of runway reaches
    // ~0.8 maxSpeed, matching _canJump's momentum launch model).
    if (waypoint && waypoint.requiresMomentum && this.platformBehavior.isOnFloor) {
      const prevIdx = this.currentWaypoint - 1;
      const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
      const baseX = prevWp && prevWp.node ? prevWp.node.x : this.instance.x;
      const D = targetX < this.instance.x ? -1 : 1;
      const dirName = D < 0 ? "left" : "right";
      const backName = D < 0 ? "right" : "left";
      const backX = baseX - D * this.cellSize * 0.3;
      const launchX = baseX + D * this.cellSize * 0.44;

      if (!this._momentumArmed) {
        // Phase A: back up to the far side of the launch tile for runway.
        let wallBehind = false;
        try { wallBehind = this.platformBehavior.isByWall(backName); } catch (e) {}
        if (!wallBehind && (this.instance.x - backX) * D > 0) {
          this.platformBehavior.simulateControl(backName);
          return;
        }
        this._momentumArmed = true;
      }

      // Phase B: sprint across the tile; leap the moment the edge is reached.
      this.platformBehavior.simulateControl(dirName);
      if ((this.instance.x - launchX) * D >= 0) {
        this._momentumArmed = false;
        this.platformBehavior.simulateControl("jump");
        this.isHoldingJump = true;
        this.jumpHoldTimer = 0;
        this.jumpStartY = this.instance.y;
      }
      return;
    }

    // Pre-position before jumping.
    // When ledge restriction is OFF, a wall blocks the jump direction, AND the
    // node has a ledge on that side (overhang scenario), walk to the platform edge
    // to get horizontal clearance before jumping.
    // Otherwise, centre within the current tile for an optimal arc start position.
    if (this.platformBehavior.isOnFloor) {
      const prevIdx = this.currentWaypoint - 1;
      const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
      if (prevWp && prevWp.node) {
        const jumpDir = targetX < this.instance.x ? "left" : "right";
        let wallBlocksJump = false;
        try { wallBlocksJump = this.platformBehavior.isByWall(jumpDir); } catch (e) {}

        // Slide-off: only when ledge restriction is OFF, a wall blocks the jump,
        // AND the node has a ledge on the jump side (overhang, not a corner).
        // If the node is NOT a ledge on that side, the character is in a corner
        // with solid ground — can't slide off, fall through to normal centering.
        // Skip slide-off for primarily upward jumps — centering gives a cleaner arc
        // and avoids hitting the underside of adjacent blocks.
        const node = prevWp.node;
        const hasLedge = (jumpDir === "right" && node.isRightLedge) ||
                         (jumpDir === "left" && node.isLeftLedge);
        const targetSignificantlyAbove = targetY < this.instance.y - this.cellSize * 1.5;

        if (!this.ledgeRestriction && wallBlocksJump && !isVerticalJump && hasLedge && !targetSignificantlyAbove) {
          const edgeLimitX = node.x + (jumpDir === "right" ? 1 : -1) * (this.cellSize * 0.45);
          const pastEdge = jumpDir === "right"
            ? this.instance.x >= edgeLimitX
            : this.instance.x <= edgeLimitX;
          if (!pastEdge) {
            this.platformBehavior.simulateControl(jumpDir);
            return; // Walk toward edge before jumping
          }
          // At edge — commit and proceed to jump
          if (this.currentPathStrict) {
            this.departureCommitted = true;
          }
        } else {
          const tileCenterX = node.x;
          const distToCenter = Math.abs(this.instance.x - tileCenterX);
          // Slope departure: the slope surface shifts the character's Y as they walk X,
          // making it hard to settle within a tight X tolerance. Half a tile is enough
          // since arc validation uses grid-cell precision, not sub-cell precision.
          const centerTolerance = node.isSlope ? this.cellSize * 0.5 : this.cellSize * 0.15;
          if (distToCenter > centerTolerance) {
            // Walk toward tile center before jumping
            const centerDir = tileCenterX < this.instance.x ? "left" : "right";
            try {
              if (!this.platformBehavior.isByWall(centerDir)) {
                this.platformBehavior.simulateControl(centerDir);
              }
            } catch (e) {}
            return; // Wait until centered
          }
          // Centering complete — commit to departure (prevents walk input on this frame)
          if (this.currentPathStrict) {
            this.departureCommitted = true;
          }
        }
      }
    }

    // Apply horizontal input toward the target during the jump. Mid-air the
    // input uses the same deceleration-based braking as falls: without it the
    // drift bang-bangs around the target X (input direction flips sign every
    // tick once past it), and that ±stopping-distance oscillation is wider
    // than a one-tile island — the character can cross the landing height
    // during an outward swing and miss the platform entirely.
    if (!isVerticalJump) {
      const dir = targetX < this.instance.x ? "left" : "right";
      let airborne = false;
      try { airborne = !this.platformBehavior.isOnFloor; } catch (e) {}
      if (!airborne) {
        // Launch frame(s): full input for maximum departure speed.
        this.platformBehavior.simulateControl(dir);
      } else {
        const vx =
          Math.abs(this.platformBehavior.vectorX) || Math.abs(this.estimatedVelocityX);
        const stopDist = (vx * vx) / (2 * this.platformProps.deceleration);
        const distToTarget = Math.abs(targetX - this.instance.x);
        if (
          distToTarget > this.cellSize * 0.2 &&
          distToTarget > stopDist + this.cellSize * 0.1
        ) {
          this.platformBehavior.simulateControl(dir);
        }
      }
    }

    try {
      if (this.platformBehavior.isOnFloor) {
        this.platformBehavior.simulateControl("jump");
        this.isHoldingJump = true;
        this.jumpHoldTimer = 0;
        this.jumpStartY = this.instance.y;
        this.departureCommitted = false;
      } else if (
        this.isHoldingJump &&
        this.platformProps.jumpSustain > 0
      ) {
        this.jumpHoldTimer += dt * 1000;
        // Release jump when we've reached the needed peak height,
        // or when the sustain timer expires — whichever comes first.
        const currentHeight = this.jumpStartY - this.instance.y;
        const neededPeak = (waypoint && waypoint.peakHeight) ? waypoint.peakHeight : this.maxJumpHeight;

        if (currentHeight >= neededPeak) {
          this.isHoldingJump = false;
        } else if (this.jumpHoldTimer < this.platformProps.jumpSustain) {
          this.platformBehavior.simulateControl("jump");
        } else {
          this.isHoldingJump = false;
        }
      }
    } catch (e) {
      this.platformBehavior.simulateControl("jump");
    }
  },

  /** Handles coyote jump: walks off the ledge edge, then jumps during the coyote time window while applying horizontal input. */
  _handleCoyoteJumpAction(targetX, targetY, waypoint) {
    const xDist = Math.abs(targetX - this.instance.x);
    const isVerticalJump = xDist < this.cellSize * 0.5;

    // Strict positioning: edge-align before stepping off for coyote jump
    if (this.currentPathStrict && this.platformBehavior.isOnFloor) {
      const prevIdx = this.currentWaypoint - 1;
      const prevWp = prevIdx >= 0 ? this.currentPath[prevIdx] : null;
      if (prevWp && prevWp.node) {
        const dir = targetX < this.instance.x ? "left" : "right";
        // Target edge position: just inside the tile edge (90% from center to edge)
        const edgeX = prevWp.node.x + (dir === "right" ? 1 : -1) * (this.cellSize / 2 - this.cellSize * 0.1);
        const distToEdge = Math.abs(this.instance.x - edgeX);
        const pastEdge = dir === "right" ? this.instance.x >= edgeX : this.instance.x <= edgeX;
        if (!pastEdge && distToEdge > this.cellSize * 0.15) {
          // Walk toward edge before stepping off
          try {
            if (!this.platformBehavior.isByWall(dir)) {
              this.platformBehavior.simulateControl(dir);
            }
          } catch (e) {}
          return; // Wait until at edge
        }
      }
    }

    if (!isVerticalJump) {
      const dir = targetX < this.instance.x ? "left" : "right";
      try {
        if (!this.platformBehavior.isByWall(dir)) {
          this.platformBehavior.simulateControl(dir);
        }
      } catch (e) {
        this.platformBehavior.simulateControl(dir);
      }
    }

    try {
      if (!this.platformBehavior.isOnFloor && this.coyoteTimer > 0) {
        this.coyoteJumpPending = true;
      } else if (this.platformBehavior.isOnFloor) {
        const dir = targetX < this.instance.x ? "left" : "right";
        if (!isVerticalJump) {
          this.platformBehavior.simulateControl(dir);
        }
      }
    } catch (e) {}
  },

  /** Handles fall/fall_left/fall_right by applying directional input to drift toward the landing target.
   *  Uses deceleration-based braking to avoid overshooting the target X. */
  _handleFallAction(targetX) {
    // Horizontal braking must use the horizontal velocity ONLY. The Platform
    // behavior's .speed is the overall velocity magnitude, so mid-fall the
    // vertical component (up to maxFallSpeed) inflated the stopping distance
    // and cut drift input the moment the character left the edge — long
    // diagonal falls then undershot their landing platform and dropped past it.
    const speed =
      Math.abs(this.platformBehavior.vectorX) || Math.abs(this.estimatedVelocityX);
    const decel = this.platformProps.deceleration;
    const distToTarget = Math.abs(targetX - this.instance.x);
    const stoppingDist = (speed * speed) / (2 * decel);

    let onFloor = false;
    try { onFloor = this.platformBehavior.isOnFloor; } catch (e) {}
    const dir = targetX < this.instance.x ? "left" : "right";

    if (distToTarget > this.cellSize * 0.2) {
      if (distToTarget > stoppingDist + this.cellSize * 0.1) {
        this.platformBehavior.simulateControl(dir);
        this._fallBrakeLogged = false;
      } else if (onFloor && speed < 60) {
        // Braked to a crawl but still STANDING short of the drop: keep creeping
        // toward the edge. Without this, the deceleration-based braking parks
        // the character on the ledge corner (floor still under a few pixels of
        // its base) and the fall never starts. Mid-air braking is untouched —
        // this only fires while grounded at near-zero speed.
        this.platformBehavior.simulateControl(dir);
      } else if (!this._fallBrakeLogged) {
        // One-shot debug marker per braking phase: records where drift input was
        // released so undershoot/overshoot can be diagnosed from the console.
        this._fallBrakeLogged = true;
        this._log(
          `Fall braking: pos=(${Math.round(this.instance.x)},${Math.round(this.instance.y)}) ` +
          `vx=${Math.round(speed)} distX=${Math.round(distToTarget)} stopDist=${Math.round(stoppingDist)}`
        );
      }
    } else if (onFloor) {
      // At the landing X but still standing ABOVE the drop (teetering on the
      // ledge corner within the dead zone): the fall has not happened yet.
      // Nudge toward the target until the floor is actually left behind.
      this.platformBehavior.simulateControl(dir);
    }
  },

  /** Tracks the coyote timer: counts up when the character walks off a ledge, resets when grounded or jumping. */
  _updateCoyoteTime(dt) {
    if (this.coyoteTime <= 0) return;

    try {
      const isOnFloor = this.platformBehavior.isOnFloor;
      const isJumping = this.platformBehavior.isJumping;
      const isFalling = this.platformBehavior.isFalling;

      if (this.wasOnFloor && !isOnFloor && !isJumping) {
        this.coyoteTimer = this.coyoteTime;
      }

      if (this.coyoteTimer > 0) {
        this.coyoteTimer -= dt;
        if (this.coyoteJumpPending && this.coyoteTimer > 0 && isFalling) {
          this.platformBehavior.vectorY = -this.platformProps.jumpStrength;
          this.coyoteJumpPending = false;
          this.coyoteTimer = 0;
        }
      }

      this.wasOnFloor = isOnFloor;
    } catch (e) {}
  },

  /** Immediately jump toward a target position from the current position. No pathfinding involved. */
  aceJumpTowardPosition(targetX, targetY) {
    if (!this._isNavActive()) return;
    this._ensureInitialized(); // acquires the Platform behavior pre-first-tick
    if (!this.platformBehavior) return;

    const onFloor = this.platformBehavior.isOnFloor;
    const canDoubleJump = !onFloor && this.platformProps.isDoubleJumpEnabled;

    // Must be on the floor OR able to double jump
    if (!onFloor && !canDoubleJump) return;

    this.hasPath = false;
    this.currentPath = [];
    this.currentWaypoint = 0;
    this.jumpTowardTargetX = targetX;
    this.jumpTowardTargetY = targetY;
    this._jumpTowardActive = true;
    this._jumpTowardGrace = 0.1; // 100ms grace before checking isOnFloor (jump hasn't left ground yet)

    // Initial horizontal push + jump on the launch frame
    const xDist = Math.abs(targetX - this.instance.x);
    const dir = targetX < this.instance.x ? "left" : "right";
    if (xDist >= this.cellSize * 0.5) {
      this.platformBehavior.simulateControl(dir);
    }
    this.platformBehavior.simulateControl("jump");
    if (this.platformProps.jumpSustain > 0) {
      this.platformBehavior.simulateControl("jump");
    }
    this._trigger("OnJumpTowardLaunched");
  },

  // ============================================================================
  // MOVEMENT - Settings Actions
  // ============================================================================

  /** Enables or disables this behavior. Disabling freezes navigation (the
   *  current path, graph, and settings are kept; re-enabling resumes), cancels
   *  any in-flight graph build this instance owns so another instance can take
   *  over, and drops this instance's queued path request. */
  aceSetBehaviorEnabled(enabled) {
    if (this.navEnabled === enabled) return;
    this.navEnabled = enabled;
    if (!enabled) this._releaseNavWork();
  },

  /** Returns whether this behavior is currently enabled (the user's switch;
   *  a multiplayer peer pause does not change it). */
  aceIsBehaviorEnabled() {
    return this.navEnabled;
  },

  /** Hands off shared work when navigation stops here (Set enabled "Disabled",
   *  or paused as a multiplayer peer): cancels an owned graph build so another
   *  instance can take over, drops the queued path request, and frees the
   *  reserved arrival spot. Path and settings are kept for a resume. */
  _releaseNavWork() {
    this._cancelGraphBuild();
    globalNavManager.removeQueuedRequest(this);
    globalNavManager.releaseGoalClaim(this);
  },

  /** Whether navigation actually runs on this machine: the user's Enabled
   *  switch is on and this is not a paused multiplayer peer. Use this (not
   *  navEnabled) wherever work is gated. */
  _isNavActive() {
    return this.navEnabled && !this._isPausedAsPeer();
  },

  /** Multiplayer: paused because this machine is a peer in a room (the host
   *  runs the AI and syncs positions to peers). "Run everywhere" opts out,
   *  e.g. for local-only characters that are never synced. */
  _isPausedAsPeer() {
    return this.multiplayerMode !== "everywhere" &&
      globalNavManager.isMultiplayerPeer(this.instance.runtime);
  },

  /** Set multiplayer mode: "host_only" (automatic pause on peers) or "everywhere". */
  aceSetMultiplayerMode(mode) {
    this.multiplayerMode = mode === "everywhere" ? "everywhere" : "host_only";
  },

  /** Enables or disables crowd arrivals (goal reservation). */
  aceSetCrowdArrivals(enabled) {
    this.crowdArrivals = enabled;
    if (!enabled) globalNavManager.releaseGoalClaim(this);
  },

  /** Returns 1 if crowd arrivals is enabled, 0 otherwise. */
  aceIsCrowdArrivalsEnabled() {
    return this.crowdArrivals ? 1 : 0;
  },

  /** Sets the idle separation distance in pixels (0 disables it). */
  aceSetIdleSeparation(pixels) {
    this.idleSeparation = Math.max(0, pixels || 0);
  },

  /** Returns the idle separation distance in pixels. */
  aceGetIdleSeparation() {
    return this.idleSeparation;
  },

  /** Sets the separation cooldown in seconds (0 = never rest, keep trying). */
  aceSetSeparationCooldown(seconds) {
    this.separationCooldown = Math.max(0, seconds || 0);
  },

  /** Returns the separation cooldown in seconds. */
  aceGetSeparationCooldown() {
    return this.separationCooldown;
  },

  // ============================================================================
  // MOVEMENT - Ledge-to-Ledge Patrol
  // ============================================================================

  /** Follows walk connections from a node to the platform's end in one
   *  direction: stops at the matching ledge flag or a missing walk connection
   *  (wall). Slope runs continue naturally because slope traversals are walk
   *  connections. */
  _findPatrolBound(startNode, dir) {
    let node = startNode;
    let steps = 0;
    const maxSteps = 100000;
    const action = dir < 0 ? "walk_left" : "walk_right";
    while (steps < maxSteps) {
      if (dir < 0 && node.isLeftLedge) break;
      if (dir > 0 && node.isRightLedge) break;
      let next = null;
      for (const c of node.connections) {
        if (c.action === action) { next = c.target; break; }
      }
      if (!next) break;
      node = next;
      steps++;
    }
    return node;
  },

  /** Discovers patrol bounds from the character's current standing position:
   *  the platform's ends, pulled inward by the edge distance (_patrolRange,
   *  in pixels) so the character turns that far short of each edge. The
   *  bounds always lie INSIDE the platform: when the margins would cross on
   *  a short platform, both collapse to the platform's midpoint and the
   *  degenerate-width check in _updatePatrol has the character stand, like
   *  on an island — an oversized distance can never walk it off a ledge.
   *  Returns true when a platform was found. */
  _discoverPatrolBounds() {
    let grid = this.worldToGrid(this.instance.x, this.instance.y);
    let node = this.getNode(grid.gx, grid.gy);
    if (!node) {
      const corrected = this._correctToGround(this.instance.x, this.instance.y);
      grid = this.worldToGrid(corrected.x, corrected.y);
      node = this.getNode(grid.gx, grid.gy);
    }
    if (!node) return false;
    const left = this._findPatrolBound(node, -1);
    const right = this._findPatrolBound(node, 1);
    const margin = this._patrolRange;
    let leftX = left.x + margin;
    let rightX = right.x - margin;
    if (leftX > rightX) {
      const mid = (left.x + right.x) / 2;
      leftX = mid;
      rightX = mid;
    }
    this._patrolLeftX = leftX;
    this._patrolRightX = rightX;
    this._patrolY = node.y;
    return true;
  },

  /** Starts a ledge-to-ledge patrol on the current platform: walk to one end,
   *  dwell, turn, walk to the other. Cancels any active path. */
  aceStartPatrol(dwellSeconds, edgeDistancePx) {
    this._ensureGraphReadyNow(); // safe in On start of layout
    if (!this.platformBehavior) return;
    if (!this.graphGenerated) {
      this._warn("Start patrol: the navigation graph is not generated yet");
      return;
    }
    this._patrolDwell = Math.max(0, dwellSeconds || 0);
    this._patrolRange = Math.max(0, edgeDistancePx || 0);
    if (!this._discoverPatrolBounds()) {
      this._warn("Start patrol: no walkable node at the character's position");
      return;
    }
    if (this.hasPath) this.aceClearPath();
    // Head for the farther end first so the opening leg is meaningful.
    const toLeft = Math.abs(this.instance.x - this._patrolLeftX);
    const toRight = Math.abs(this.instance.x - this._patrolRightX);
    this._patrolDir = toRight >= toLeft ? 1 : -1;
    this._patrolDwellTimer = 0;
    this._patrolBumpCooldown = 0;
    this._patrolGraphVersion = globalNavManager.graphVersion.get(this._getNavKey()) || 0;
    this._route = null; // one patrol at a time
    this._patrolMemory = null;
    this._patrolActive = true;
    this._log(`Patrol started: ${Math.round(this._patrolLeftX)} to ${Math.round(this._patrolRightX)}, dwell ${this._patrolDwell}s`);
  },

  /** Stops the patrol, platform or route (the character simply stands). */
  aceStopPatrol() {
    this._patrolActive = false;
    this._patrolMemory = null;
    if (this._route) {
      this._route = null;
      if (this.hasPath) this.aceClearPath(); // stop walking to the next marker
    }
  },

  /** Returns whether a patrol (platform or route) is active. */
  aceIsPatrolling() {
    return !!this._patrolActive || !!this._route;
  },

  /** Returns the patrol walk direction: -1 left, 1 right, 0 when not patrolling
   *  or waiting. On a route it follows the current path step. */
  aceGetPatrolDirection() {
    const r = this._route;
    if (r) {
      if (r.phase !== "moving" || !this.hasPath) return 0;
      const wp = this.currentPath[this.currentWaypoint];
      if (!wp) return 0;
      const dx = wp.x - this.instance.x;
      return Math.abs(dx) < 1 ? 0 : Math.sign(dx);
    }
    return this._patrolActive && this._patrolDwellTimer <= 0 ? this._patrolDir : 0;
  },

  // ---------------------------------------------------------------------------
  // Route patrol ("Start patrol between objects"): visit marker objects in
  // order, pathing between them with every move the graph knows (walks,
  // jumps, falls, portals, moving-platform rides), waiting at each. Reuses the
  // patrol triggers: On patrol end reached = reached a marker; the dwell
  // triggers bracket the wait. State lives in this._route (null = inactive).
  // ---------------------------------------------------------------------------

  /** Starts a route patrol over the picked instances of markerClass, in
   *  instance order. order: "ping_pong" (1,2,3,2,1...) or "loop" (1,2,3,1...).
   *  Begins at the nearest marker. Markers are followed live (they may move);
   *  destroyed ones are dropped. Any Find path call ends it. */
  aceStartPatrolBetweenObjects(markerClass, order, dwellSeconds) {
    this._ensureGraphReadyNow(); // safe in On start of layout
    if (!this.platformBehavior || !markerClass) return;
    let insts;
    try { insts = markerClass.getPickedInstances(); } catch (e) { return; }
    insts = insts.filter(i => i !== this.instance);
    if (insts.length === 0) {
      this._warn("Start patrol between objects: no marker instances are picked");
      return;
    }
    this._patrolMemory = null; // a fresh command replaces any remembered patrol
    this._startRoute(insts.map(m => m.uid), order === "loop", dwellSeconds);
  },

  /** Starts a route over marker UIDs (shared by the action and "Resume after"),
   *  beginning at the nearest marker that still exists. */
  _startRoute(uids, loop, dwellSeconds) {
    const runtime = this.instance.runtime;
    const live = uids.filter(uid => !!runtime.getInstanceByUid(uid));
    if (live.length === 0) return false;
    let nearest = 0, best = Infinity;
    live.forEach((uid, i) => {
      const m = runtime.getInstanceByUid(uid);
      const d = this.distance(this.instance.x, this.instance.y, m.x, m.y);
      if (d < best) { best = d; nearest = i; }
    });
    this._patrolActive = false; // one patrol at a time
    if (this.hasPath) this.aceClearPath();
    this._route = {
      uids: live,
      loop,
      dwell: Math.max(0, dwellSeconds || 0),
      wait: 0,         // this stop's wait (dwell +/- Dwell variation)
      index: nearest,
      // Ping-pong heads toward the end of the list with more markers left
      step: !loop && nearest >= live.length - 1 - nearest && nearest > 0 ? -1 : 1,
      phase: "go",     // go -> moving -> (dwell) -> go ...; "retry" after a failed path
      timer: 0,
      fails: 0,
      goalX: 0,
      goalY: 0,
    };
    this._log(`Route patrol started: ${live.length} marker(s), ${loop ? "loop" : "ping-pong"}, dwell ${this._route.dwell}s`);
    return true;
  },

  /** Moves the route to the next marker index (wrapping or bouncing). */
  _advanceRoute(r) {
    const n = r.uids.length;
    if (n <= 1) return;
    if (r.loop) {
      r.index = (r.index + 1) % n;
    } else {
      if (r.index + r.step < 0 || r.index + r.step >= n) r.step = -r.step;
      r.index += r.step;
    }
  },

  /** Per-tick route drive (runs while the character has no active path). */
  _updatePatrolRoute(dt) {
    const r = this._route;
    if (!r || this.pathPending) return;
    const cs = this.cellSize;

    if (r.phase === "moving") {
      // The path ended: arrived, or stopped (stuck, or as close as it could get)
      // Near the planned path end, or (when the request was queued and the
      // end was not known yet) near the marker itself
      const marker = this.instance.runtime.getInstanceByUid(r.uids[r.index]);
      const nearGoal = r.goalKnown &&
        this.distance(this.instance.x, this.instance.y, r.goalX, r.goalY) <= cs * 1.5;
      const nearMarker = !!marker && Math.abs(marker.x - this.instance.x) <= cs * 1.5 &&
        Math.abs(marker.y - this.instance.y) <= (this.characterHeight || cs) + cs * 2;
      const reached = nearGoal || nearMarker;
      if (!reached) {
        // Try the same marker again shortly, then move on if it keeps failing
        r.fails++;
        r.phase = "retry";
        r.timer = 0;
        return;
      }
      r.fails = 0;
      this._trigger("OnPatrolEndReached");
      if (this._route !== r) return; // the trigger's events changed the patrol
      r.wait = this._rollPatrolDwell(r.dwell);
      if (r.wait > 0) {
        r.phase = "dwell";
        r.timer = 0;
        this._trigger("OnPatrolDwellStarted");
        return;
      }
      this._advanceRoute(r);
      r.phase = "go";
    }

    if (r.phase === "dwell") {
      r.timer += dt;
      if (r.timer < (r.wait ?? r.dwell)) return;
      this._advanceRoute(r);
      r.phase = "go";
      this._trigger("OnPatrolDwellFinished"); // PatrolPointIndex = the NEXT marker here
      if (this._route !== r) return;
    }

    if (r.phase === "retry") {
      r.timer += dt;
      if (r.timer < 0.5) return;
      if (r.fails >= 2 * Math.max(1, r.uids.length)) {
        this._warn("Route patrol stopped: none of the markers can be reached");
        this._route = null;
        return;
      }
      if (r.fails % 2 === 0) this._advanceRoute(r); // second failure on a marker: skip it
      r.phase = "go";
    }

    if (r.phase === "go") {
      // Drop destroyed markers, keeping the index on the same marker
      const runtime = this.instance.runtime;
      const target = r.uids[r.index];
      r.uids = r.uids.filter(uid => !!runtime.getInstanceByUid(uid));
      if (r.uids.length === 0) {
        this._route = null;
        return;
      }
      const keep = r.uids.indexOf(target);
      r.index = keep >= 0 ? keep : Math.min(r.index, r.uids.length - 1);
      const marker = runtime.getInstanceByUid(r.uids[r.index]);

      this._routeFindingPath = true;
      let ok;
      try {
        ok = this.aceFindPath(marker.x, marker.y, true, "nearest", "default");
      } finally {
        this._routeFindingPath = false;
      }
      if (this._route !== r) return; // a failure trigger's events took over
      if (ok) {
        r.phase = "moving";
        // A queued request (Max paths per tick) has no path yet: arrival is
        // then judged against the marker itself
        r.goalKnown = !this.pathPending;
        const end = this.hasPath ? this.currentPath[this.currentPath.length - 1] : null;
        r.goalX = end ? end.x : this.instance.x; // no path: already standing there
        r.goalY = end ? end.y : this.instance.y;
      } else {
        r.fails++;
        r.phase = "retry";
        r.timer = 0;
      }
    }
  },

  /** Per-tick patrol drive: brake into each end, dwell, turn. */
  _updatePatrol(dt) {
    if (!this.platformBehavior) return;
    try {
      if (!this.platformBehavior.isOnFloor) return; // knocked airborne: wait

      // Landed on a different platform (knockback, fall): re-anchor there.
      if (Math.abs(this.instance.y - this._patrolY) > this.cellSize * 1.5) {
        if (!this._discoverPatrolBounds()) {
          this.aceStopPatrol();
          return;
        }
      }

      // The level changed (blocks placed or removed, a drawbridge, a platform
      // resized): re-measure the platform's ends. Keeps the old ends when the
      // spot has no node right now.
      const graphVersion = globalNavManager.graphVersion.get(this.navKey) || 0;
      if (graphVersion !== this._patrolGraphVersion) {
        this._patrolGraphVersion = graphVersion;
        this._discoverPatrolBounds();
      }
      if (this._patrolBumpCooldown > 0) this._patrolBumpCooldown -= dt;

      // Degenerate bounds (island, or edge margins that crossed on a short
      // platform): walk to the single stand point, then hold there. This is
      // what the docs promise ("stands at the platform's middle").
      if (this._patrolRightX - this._patrolLeftX < this.cellSize * 0.5) {
        const standX = (this._patrolLeftX + this._patrolRightX) / 2;
        const delta = standX - this.instance.x;
        if (Math.abs(delta) > this.cellSize * 0.2) {
          const dirName = delta > 0 ? "right" : "left";
          let blocked = false;
          try { blocked = this.platformBehavior.isByWall(dirName); } catch (e) {}
          const v = Math.abs(this.platformBehavior.vectorX) || Math.abs(this.estimatedVelocityX);
          const brake = (v * v) / (2 * this.platformProps.deceleration);
          if (!blocked && Math.abs(delta) > brake + this.cellSize * 0.1) {
            this.platformBehavior.simulateControl(dirName);
          }
        }
        return;
      }

      if (this._patrolDwellTimer > 0) {
        this._patrolDwellTimer -= dt;
        if (this._patrolDwellTimer <= 0) {
          // Flip BEFORE the trigger so PatrolDirection reports the new walk
          // direction inside 'On patrol dwell finished' (sprite mirroring).
          this._patrolDir *= -1;
          this._trigger("OnPatrolDwellFinished");
        }
        return;
      }

      const targetX = this._patrolDir > 0 ? this._patrolRightX : this._patrolLeftX;
      const dirName = this._patrolDir > 0 ? "right" : "left";
      const dist = (targetX - this.instance.x) * this._patrolDir;
      let walled = false;
      try { walled = this.platformBehavior.isByWall(dirName); } catch (e) {}

      // Danger ahead (the next step is more hazardous than this one) or another
      // character in the way counts as the end of the patrol. Danger on BOTH
      // sides: stand still rather than pace in place.
      const danger = this._patrolTurnDanger && this._patrolDangerAhead(this._patrolDir);
      if (danger && this._patrolDangerAhead(-this._patrolDir)) return;
      const bumped = !danger && this._patrolTurnAtChars && this._patrolBlockedByAgent(this._patrolDir);
      if (bumped) this._patrolBumpCooldown = 0.75;

      if (dist <= this.cellSize * 0.2 || walled || danger || bumped) {
        // End reached: dwell (or turn immediately with no dwell). The dwell
        // start/finished pair fires only for real waits (dwell > 0); with
        // dwell 0 the turn is instantaneous and end reached IS that moment.
        this._trigger("OnPatrolEndReached");
        // The trigger's user events run synchronously and may end the patrol
        // (Stop patrol, or any Find path): no dwell for a dead patrol.
        if (!this._patrolActive) return;
        const wait = this._rollPatrolDwell(this._patrolDwell);
        if (wait > 0) {
          this._patrolDwellTimer = wait;
          this._trigger("OnPatrolDwellStarted");
        } else {
          this._patrolDir *= -1;
        }
        return;
      }

      // Deceleration-based braking so momentum never carries the character
      // past the bound and off the ledge.
      const vx =
        Math.abs(this.platformBehavior.vectorX) || Math.abs(this.estimatedVelocityX);
      const stopDist = (vx * vx) / (2 * this.platformProps.deceleration);
      if (dist > stopDist + this.cellSize * 0.1) {
        this.platformBehavior.simulateControl(dirName);
      }
    } catch (e) {}
  },

  // ---------------------------------------------------------------------------
  // Patrol settings (Set patrol setting / Set patrol option). Settings belong
  // to the character and persist across Start patrol calls.
  // ---------------------------------------------------------------------------

  /** Set patrol setting: "dwell" (s), "edge_distance" (px), "dwell_variation"
   *  (s), "speed" (% of max speed), "resume_after" (s, 0 = never). */
  aceSetPatrolSetting(setting, value) {
    const v = Number(value) || 0;
    switch (setting) {
      case "dwell":
        this._patrolDwell = Math.max(0, v);
        if (this._route) this._route.dwell = this._patrolDwell;
        break;
      case "edge_distance":
        this._patrolRange = Math.max(0, v);
        if (this._patrolActive) this._discoverPatrolBounds(); // re-measure now
        break;
      case "dwell_variation":
        this._patrolDwellVar = Math.max(0, v);
        break;
      case "speed":
        this._patrolSpeedPct = Math.max(1, v);
        break;
      case "resume_after":
        this._patrolResumeAfter = Math.max(0, v);
        if (this._patrolResumeAfter === 0) this._patrolMemory = null;
        break;
    }
  },

  /** Set patrol option: "turn_at_characters" / "turn_before_danger". */
  aceSetPatrolOption(option, enabled) {
    if (option === "turn_at_characters") this._patrolTurnAtChars = !!enabled;
    else if (option === "turn_before_danger") this._patrolTurnDanger = !!enabled;
  },

  /** A stop's wait: the dwell time +/- a random amount up to Dwell variation. */
  _rollPatrolDwell(base) {
    const v = this._patrolDwellVar || 0;
    if (v <= 0) return base;
    return Math.max(0, base + (Math.random() * 2 - 1) * v);
  },

  /** Remembers a patrol that a Find path is about to cancel, for "Resume after". */
  _rememberPatrolForResume() {
    if (!(this._patrolResumeAfter > 0)) return;
    if (this._route) {
      this._patrolMemory = { kind: "route", uids: this._route.uids.slice(), loop: this._route.loop, dwell: this._route.dwell };
    } else if (this._patrolActive) {
      this._patrolMemory = { kind: "platform", dwell: this._patrolDwell, range: this._patrolRange };
    }
    this._patrolResumeTimer = 0;
  },

  /** "Resume after": once the path that cancelled a patrol has ended and the
   *  character has stood idle for the set time, the patrol restarts (a platform
   *  patrol on the platform it is on now, a route from the nearest marker).
   *  Returns true while a resume is pending (the character counts as busy). */
  _tickPatrolResume(dt) {
    const mem = this._patrolMemory;
    if (!mem || !(this._patrolResumeAfter > 0)) { this._patrolMemory = null; return false; }
    if (this.portalState !== "none") return true;
    this._patrolResumeTimer += dt;
    if (this._patrolResumeTimer < this._patrolResumeAfter) return true;
    this._patrolMemory = null;
    if (mem.kind === "route") {
      this._startRoute(mem.uids, mem.loop, mem.dwell);
    } else {
      this.aceStartPatrol(mem.dwell, mem.range);
    }
    return false;
  },

  /** Patrol speed: while patrolling (and, on a route, while WALKING), the
   *  Platform behavior's max speed is scaled to the Speed setting; it is put
   *  back for chases, jumps and when the patrol ends. Jumps keep full speed
   *  because their arcs were planned with it. */
  _updatePatrolSpeed() {
    const pb = this.platformBehavior;
    if (!pb) return;
    let want = false;
    if (this._patrolSpeedPct !== 100) {
      if (this._patrolActive && !this.hasPath) {
        want = true;
      } else if (this._route && this._route.phase === "moving" && this.hasPath && this.portalState === "none") {
        const wp = this.currentPath[this.currentWaypoint];
        want = !!wp && (wp.action === "walk_left" || wp.action === "walk_right" || wp.action === "start");
      }
    }
    if (want) {
      if (this._patrolSpeedBase === null) this._patrolSpeedBase = pb.maxSpeed;
      const target = this._patrolSpeedBase * this._patrolSpeedPct / 100;
      if (pb.maxSpeed !== target) pb.maxSpeed = target;
    } else if (this._patrolSpeedBase !== null) {
      pb.maxSpeed = this._patrolSpeedBase;
      this._patrolSpeedBase = null;
    }
  },

  /** Patrol: true when the next step in direction dir is more dangerous than
   *  the current spot (hazard tiles, area and tracked hazards, including their
   *  falloff radius). A guard already standing in danger may walk out of it. */
  _patrolDangerAhead(dir) {
    const cs = this.cellSize;
    const gy = this._toGY(this._patrolY);
    const halfW = (this.characterWidth || cs) / 2;
    const ahead = this.getNode(this._toGX(this.instance.x + dir * (halfW + cs * 0.5)), gy);
    if (!ahead) return false; // no ground there: the ledge and wall checks handle it
    const here = this.getNode(this._toGX(this.instance.x), gy);
    const hereCost = here ? here.hazardMultiplier : 1;
    return ahead.hazardMultiplier > Math.max(1, hereCost) + 0.01;
  },

  /** Patrol: true when another character on the same map stands in the way,
   *  just ahead at the same height. Both of two patrollers meeting head-on
   *  turn around. A short cooldown stops repeated turns while they separate. */
  _patrolBlockedByAgent(dir) {
    if (this._patrolBumpCooldown > 0) return false;
    const subs = globalNavManager.subscribers.get(this.navKey);
    if (!subs || subs.size < 2) return false;
    const cs = this.cellSize;
    const me = this.instance;
    let mb = null;
    for (const other of subs) {
      if (other === this || !other.instance || !other._isNavActive()) continue;
      const o = other.instance;
      const dx = o.x - me.x;
      // Cheap reject before touching bounding boxes
      if (dx * dir <= 0 || Math.abs(dx) > cs * 4 || Math.abs(o.y - me.y) > cs * 4) continue;
      let ob;
      try { ob = o.getBoundingBox(); } catch (e) { continue; }
      if (!mb) mb = me.getBoundingBox();
      if (ob.bottom <= mb.top || ob.top >= mb.bottom) continue; // different height
      const gap = dir > 0 ? ob.left - mb.right : mb.left - ob.right;
      if (gap <= cs * 0.25) return true;
    }
    return false;
  },

  /** Sets how long a character keeps trying to separate before giving up. */
  aceSetSeparationGiveUpTime(seconds) {
    this.separationGiveUpTime = Math.max(0, seconds || 0);
  },

  /** Returns the separation give-up time in seconds. */
  aceGetSeparationGiveUpTime() {
    return this.separationGiveUpTime;
  },

  /** Idle separation: gentle grounded drift apart when idle agents are closer
   *  than the Idle Separation distance (pixels; 0 = off — independent of
   *  Crowd Arrivals). Runs only when there is NO active path (never fights
   *  the path follower), the character is grounded, and no portal is in
   *  progress. Handles knockback/spawn overlap and shoulder-brushing between
   *  adjacent goal claimants. */
  _applyIdleSeparation(dt) {
    if (!(this.idleSeparation > 0) || !this.platformBehavior) return;
    if (this.hasPath || this.pathPending || this.portalState !== "none") return;

    // Situation change: teleports, portals, spawn placement, event-sheet
    // repositioning, and ARRIVING FROM A PATH all invalidate previous give-up
    // state — retry fresh. Separation doesn't run while a path is active, so
    // its last-seen position goes stale during any path; "moved more than a
    // tile since separation last looked" therefore catches every one of those
    // events with a single check, while the slow per-tick separation drift
    // itself never triggers it.
    const sepX = this.instance.x;
    const sepY = this.instance.y;
    if (
      this._sepLastX === undefined ||
      Math.abs(sepX - this._sepLastX) > this.cellSize * 1.5 ||
      Math.abs(sepY - this._sepLastY) > this.cellSize * 1.5
    ) {
      this._sepActiveTime = 0;
      this._sepCooldown = 0;
    }
    this._sepLastX = sepX;
    this._sepLastY = sepY;

    // Give-up cooldown: when the crowd is too dense for the spacing to ever
    // be satisfied (e.g. four characters on a three-tile platform), endless
    // shuffling looks broken. After ~1.2s of continuous trying without
    // reaching the spacing, stand still for a few seconds before retrying.
    // Any tick where the spacing IS satisfied resets the effort timer, so
    // solvable cases still resolve instantly.
    if (this._sepCooldown > 0) {
      this._sepCooldown -= dt;
      return;
    }

    try {
      if (!this.platformBehavior.isOnFloor) return;
      const subs = globalNavManager.subscribers.get(this._getNavKey());
      if (!subs || subs.size < 2) return;

      // Nearest same-map agent at roughly the same height.
      const minDist = this.idleSeparation;
      let nearest = null;
      let nearestD = minDist;
      for (const other of subs) {
        if (other === this || !other.instance) continue;
        if (Math.abs(other.instance.y - this.instance.y) > this.characterHeight) continue;
        const d = Math.abs(other.instance.x - this.instance.x);
        if (d < nearestD) { nearestD = d; nearest = other; }
      }
      if (!nearest) {
        this._sepActiveTime = 0; // spacing satisfied — fresh start next time
        return;
      }

      this._sepActiveTime = (this._sepActiveTime || 0) + dt;
      if (this._sepActiveTime > this.separationGiveUpTime) {
        this._sepActiveTime = 0;
        // 0 = never rest: keep trying continuously (the pre-give-up behavior).
        if (this.separationCooldown > 0) {
          this._sepCooldown = this.separationCooldown;
          return;
        }
      }

      // Between two IDLE agents the higher UID yields (moves); the lower one
      // stands still, so pairs drift apart once instead of mirror-pushing.
      // Against a MOVING agent the idler always steps aside.
      if (!nearest.hasPath && this.instance.uid < nearest.instance.uid) return;

      const dir = nearest.instance.x >= this.instance.x ? "left" : "right";

      // Never nudge into a wall or off a ledge — on a one-tile island this
      // simply doesn't fire (stacked beats shoved into a pit).
      if (this.platformBehavior.isByWall(dir)) return;
      const step = dir === "left" ? -1 : 1;
      const ahead = this.worldToGrid(
        this.instance.x + step * this.cellSize * 0.6,
        this.instance.y
      );
      if (!this._isGroundAt(ahead.gx, ahead.gy + 1) && !this._isSlopeWalkable(ahead.gx, ahead.gy)) {
        return;
      }

      this.platformBehavior.simulateControl(dir);
    } catch (e) {}
  },

  // ============================================================================
  // MOVEMENT - State Queries
  // ============================================================================

  /** Returns whether the platform behavior is currently enabled on this instance. */
  aceIsPlatformEnabled() {
    return this.platformBehavior ? this.platformBehavior.isEnabled : false;
  },

  /** Returns whether the character is currently standing on a ledge node (left or right platform edge). */
  aceIsAtLedge() {
    const grid = this.worldToGrid(this.instance.x, this.instance.y);
    const node = this.getNode(grid.gx, grid.gy);
    return node ? node.isLeftLedge || node.isRightLedge : false;
  },

  /** Returns whether the character is currently standing on an island node (a single isolated platform tile). */
  aceIsAtIsland() {
    const grid = this.worldToGrid(this.instance.x, this.instance.y);
    const node = this.getNode(grid.gx, grid.gy);
    return node ? node.isIsland : false;
  },

  /** Returns whether multi-agent avoidance is currently enabled. */
  aceIsMultiAgentAvoidanceEnabled() {
    return this.multiAgentAvoidance || false;
  },

  /** Returns the map tag this instance navigates with ("" = the default shared map). */
  aceGetMapTag() {
    return this.mapTag || "";
  },

  /** Returns the number of other pathfinding agents within 3 cells of this character. Returns 0 if avoidance is disabled. */
  aceGetNearbyAgentCount() {
    if (!this.multiAgentAvoidance) return 0;
    const others = globalNavManager.getOtherInstancePositions(
      this.navKey,
      this
    );
    let count = 0;
    for (const agent of others) {
      if (
        this.distance(this.instance.x, this.instance.y, agent.x, agent.y) <
        this.cellSize * 3
      )
        count++;
    }
    return count;
  },

  // ============================================================================
  // MOVEMENT - Physics & Movement Expressions
  // ============================================================================

  /** Returns the estimated horizontal velocity based on position delta between ticks. */
  aceGetEstimatedVelocityX() {
    return this.estimatedVelocityX;
  },

  /** Returns the estimated stopping distance in pixels based on current horizontal speed and deceleration. */
  aceGetStoppingDistance() {
    const speed = this.platformBehavior
      ? Math.abs(this.platformBehavior.vectorX) || Math.abs(this.estimatedVelocityX)
      : 0;
    const decel = this.platformProps.deceleration;
    return decel > 0 ? (speed * speed) / (2 * decel) : 0;
  },

  /** Returns the configured coyote time in seconds. */
  aceGetCoyoteTime() {
    return this.coyoteTime;
  },

  /** Returns the current coyote timer value (counts down from coyoteTime when leaving ground). */
  aceGetCoyoteTimer() {
    return this.coyoteTimer;
  },

  /** Returns 1 if strict jump positioning is enabled, 0 otherwise. */
  aceGetStrictJumpPositioning() {
    return this.strictPositioning ? 1 : 0;
  },

  /** Returns 1 if ledge restriction is enabled, 0 otherwise. */
  aceGetLedgeRestriction() {
    return this.ledgeRestriction ? 1 : 0;
  },

  /** Returns the ledge leniency distance in pixels. */
  aceGetLedgeLeniency() {
    return this.ledgeLeniency;
  },

  /** Returns the re-path threshold in tiles. */
  aceGetRePathThreshold() {
    return this.rePathThreshold;
  },

  /** Returns the re-path cooldown duration in seconds. */
  aceGetRePathCooldown() {
    return this.rePathCooldownDuration;
  },

  /** Returns the world X position of the jump-toward target (the final unreachable destination). */
  aceGetJumpTowardTargetX() {
    return this.jumpTowardTargetX;
  },

  /** Returns the world Y position of the jump-toward target (the final unreachable destination). */
  aceGetJumpTowardTargetY() {
    return this.jumpTowardTargetY;
  },

  // ============================================================================
  // DEBUG - Platform Behavior Expressions
  // ============================================================================

  /** Returns the platform behavior's configured max speed. */
  aceGetPlatformMaxSpeed() {
    return this.platformProps ? this.platformProps.maxSpeed : 0;
  },

  /** Returns the platform behavior's configured jump strength. */
  aceGetPlatformJumpStrength() {
    return this.platformProps ? this.platformProps.jumpStrength : 0;
  },

  /** Returns the calculated maximum jump height in pixels based on physics properties. */
  aceGetCalculatedJumpHeight() {
    return this.maxJumpHeight || 0;
  },

  /** Returns the calculated maximum jump distance in pixels based on physics properties. */
  aceGetCalculatedJumpDistance() {
    return this.maxJumpDistance || 0;
  },
};
