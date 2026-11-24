export const config = {
  listName: "Scan jump-thru objects into obstacle map",
  displayText: "{my}: Scan {0} (jump-thru) into obstacle map",
  description: "Add one-way platform objects to the obstacle map as jump-thru cells, at their current positions. Requires an obstacle map (Build obstacle map from layout first). The navigation graph rebuilds automatically. Objects must have the Jump-thru behavior enabled.",
  params: [
    { id: "jumpThruObjects", name: "Jump-thru objects", desc: "The objects to scan: those with the Jump-thru behavior enabled.", type: "object" }
  ]
};

export const expose = true;

export default function (jumpThruObjects) {
  this.aceScanJumpThruObjectsIntoObstacleMap(jumpThruObjects);
}
