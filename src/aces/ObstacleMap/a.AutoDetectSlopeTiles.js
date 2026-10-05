export const config = {
  listName: "Auto-detect slope tiles from tilemap",
  displayText: "{my}: Auto-detect slope tiles from {0} by collision shape",
  description: "Scan a Tilemap and register slope tiles by probing their collision shapes: 45° surfaces become slopes, 22.5° surfaces become gentle slopes, flipped placements are handled. Tiles need sloped collision polygons; unsupported angles stay solid.",
  params: [
    { id: "tilemap", name: "Tilemap", desc: "The Tilemap object to scan", type: "object" }
  ]
};

export const expose = true;

export default function (tilemap) {
  this.aceAutoDetectSlopeTiles(tilemap);
}
