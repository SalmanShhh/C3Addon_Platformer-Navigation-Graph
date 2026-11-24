export const config = {
  listName: "Start patrol between objects",
  displayText: "{my}: Start patrol between {0} ({1}, dwell {2} s)",
  description: "Patrol a route: visit the picked instances of an object in order and wait at each, pathing between them with walks, jumps, falls, portals and moving platforms. Starts at the nearest marker. Any Find path call ends the patrol.",
  params: [
    { id: "markers", name: "Markers", desc: "The marker objects to visit. Their picked instances are visited in instance order (the order they were created). Markers that move are followed; destroyed ones are skipped.", type: "object" },
    { id: "order", name: "Order", desc: "Ping-pong: visit the markers in order, then back in reverse (1, 2, 3, 2, 1). Loop: start again from the first marker after the last (1, 2, 3, 1, 2, 3).", type: "combo", initialValue: "ping_pong",
      // Item order is immutable (combo values stored by index).
      items: [{ ping_pong: "Ping-pong" }, { loop: "Loop" }]
    },
    { id: "dwell", name: "Dwell time", desc: "The wait time at each marker, in seconds. 0 moves on immediately.", type: "number", initialValue: "1" }
  ]
};

export const expose = true;

export default function (markers, order, dwell) {
  this.aceStartPatrolBetweenObjects(markers, this._combo(order, ["ping_pong", "loop"]), dwell);
}
