export const config = {
  listName: "Scan jump-thru objects into obstacle map",
  displayText: "{my}: Scan {0} (jump-thru) into obstacle map",
  description: "Scan one-way platform objects into the obstacle map as jump-thru cells. Requires an existing obstacle map (call BuildObstacleMapFromLayout first). Objects must have the Jump-thru behavior enabled.",
  params: [
    { id: "jumpThruObjects", name: "Jump-thru objects", desc: "The objects to scan: those with the Jump-thru behavior enabled.", type: "object" }
  ]
};

export const expose = true;

export default function (jumpThruObjects) {
  this.aceScanJumpThruObjectsIntoObstacleMap(jumpThruObjects);
}
