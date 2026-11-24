export const config = {
  listName: "Scan solid objects into obstacle map",
  displayText: "{my}: Scan {0} (solid) into obstacle map",
  description: "Add solid objects to the obstacle map at their current positions, using their collision polygons. Requires an obstacle map (Build obstacle map from layout first). The navigation graph rebuilds automatically. Scans only add cells; after obstacles move, use Regenerate obstacle map.",
  params: [
    { id: "solidObjects", name: "Solid objects", desc: "The objects to scan: tilemaps or sprites with the Solid behavior enabled.", type: "object" }
  ]
};

export const expose = true;

export default function (solidObjects) {
  this.aceScanSolidObjectsIntoObstacleMap(solidObjects);
}
