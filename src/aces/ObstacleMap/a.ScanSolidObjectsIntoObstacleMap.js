export const config = {
  listName: "Scan solid objects into obstacle map",
  displayText: "{my}: Scan {0} (solid) into obstacle map",
  description: "Scan solid objects into the obstacle map. Requires an existing obstacle map (call BuildObstacleMapFromLayout first). Tilemaps are scanned cell-by-cell; sprites use bounding box. Objects must have the Solid behavior enabled.",
  params: [
    { id: "solidObjects", name: "Solid objects", desc: "The objects to scan: tilemaps or sprites with the Solid behavior enabled.", type: "object" }
  ]
};

export const expose = true;

export default function (solidObjects) {
  this.aceScanSolidObjectsIntoObstacleMap(solidObjects);
}
