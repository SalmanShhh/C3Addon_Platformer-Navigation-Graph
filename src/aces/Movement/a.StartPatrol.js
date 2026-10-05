export const config = {
  listName: "Start patrol",
  displayText: "{my}: Start patrol (dwell {0} s, edge distance {1} px)",
  description: "Patrol the current platform: walk to one end, wait for the dwell time, turn, and repeat. The ends are found automatically from the graph's ledges and walls, slopes included. Any Find path call ends the patrol.",
  params: [
    { id: "dwell", name: "Dwell time", desc: "The wait time at each end, in seconds. 0 turns immediately.", type: "number", initialValue: "1" },
    { id: "range", name: "Edge distance", desc: "The distance to stop short of each platform edge, in pixels. 0 patrols edge to edge. A distance too big for the platform makes the character stand at its middle.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (dwell, range) {
  this.aceStartPatrol(dwell, range);
}
