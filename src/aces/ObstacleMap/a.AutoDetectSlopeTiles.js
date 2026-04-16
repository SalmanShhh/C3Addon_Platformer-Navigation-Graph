export const config = {
  listName: "Auto-detect slope tiles from tilemap",
  displayText: "Auto-detect slope tiles from {0} by collision polygon shape",
  description: "Scan a Tilemap and automatically classify slope tiles by reading their per-tile collision polygon shapes. Triangular collision polygons (3 points) are classified as 45° slopes; trapezoidal polygons (4 non-rectangular points) are classified as 22.5° gentle slopes. Horizontally-flipped tile variants are detected and their slope direction is automatically mirrored.",
  params: [
    { id: "tilemap", name: "Tilemap", desc: "The Tilemap object to scan", type: "object" }
  ]
};

export const expose = true;

export default function (tilemap) {
  this.aceAutoDetectSlopeTiles(tilemap);
}
