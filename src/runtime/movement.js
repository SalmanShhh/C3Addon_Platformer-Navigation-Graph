import { globalNavManager } from "./navigationManager.js";

// Movement execution: path following, waypoint arrival, jump/fall/walk/coyote
// handlers, jump-toward, and movement-related settings and expressions.
// Mixed into the instance class prototype — `this` is the behavior instance.
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
      this._trigger("OnPathComplete");
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
        dist > expectedMaxDist &&
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
          // Don't convert to walk if blocked by a wall or if there's a gap between here and the waypoint
          let canWalkDirectly = true;
          try {
            if (this.platformBehavior.isByWall(walkDir)) {
              canWalkDirectly = false;
            } else {
              // Check for continuous ground between character and waypoint
              const charGrid = this.worldToGrid(this.instance.x, this.instance.y);
              const wpGrid = this.worldToGrid(waypoint.x, waypoint.y);
              const minGx = Math.min(charGrid.gx, wpGrid.gx);
              const maxGx = Math.max(charGrid.gx, wpGrid.gx);
              for (let gx = minGx; gx <= maxGx; gx++) {
                if (!this._isGroundAt(gx, charGrid.gy + 1) && !this._isSlopeWalkable(gx, charGrid.gy)) {
                  canWalkDirectly = false;
                  break;
                }
              }
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

  /** Re-calculates the path to the current target; detects re-path loops and triggers OnWaypointStuck if stuck. */
  _rePath() {
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

    this.rePathCount++;

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
    if (!this.navEnabled) return;
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
    if (!enabled) {
      this._cancelGraphBuild();
      globalNavManager.removeQueuedRequest(this);
      // A disabled character shouldn't hold a reserved arrival spot.
      globalNavManager.releaseGoalClaim(this);
    }
  },

  /** Returns whether this behavior is currently enabled. */
  aceIsBehaviorEnabled() {
    return this.navEnabled;
  },

  /** Enables or disables automatic platform control (simulating input to follow the path). */
  aceSetAutoControl(enabled) {
    this.autoControl = enabled;
  },

  /** Sets the coyote time duration in seconds (grace period for jumping after leaving a ledge). */
  aceSetCoyoteTime(seconds) {
    this.coyoteTime = seconds;
  },

  /** Enables or disables strict jump positioning (careful tile alignment before jumps/falls). */
  aceSetStrictJumpPositioning(enabled) {
    this.strictPositioning = enabled;
  },

  /** Enables or disables ledge restriction (prevents the character from walking off platform edges). */
  aceSetLedgeRestriction(enabled) {
    this.ledgeRestriction = enabled;
  },

  /** Sets the ledge leniency distance in pixels (how close to a ledge before restriction kicks in). */
  aceSetLedgeLeniency(pixels) {
    this.ledgeLeniency = pixels;
  },

  /** Sets the re-path threshold in tiles (minimum deviation before automatically recalculating the path). */
  aceSetRePathThreshold(tiles) {
    this.rePathThreshold = tiles;
  },

  /** Sets the re-path cooldown duration in seconds (minimum time between re-path attempts). */
  aceSetRePathCooldown(seconds) {
    this.rePathCooldownDuration = Math.max(0, seconds);
  },

  /** Enables or disables multi-agent avoidance (agents try not to overlap each other). */
  aceSetMultiAgentAvoidance(enabled) {
    this.multiAgentAvoidance = enabled;
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

  /** Returns whether the pathfinding system is still initializing (waiting for obstacle map setup). */
  aceIsSettingUpPathfinding() {
    return this.isWaitingForPathfindingMap || false;
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
