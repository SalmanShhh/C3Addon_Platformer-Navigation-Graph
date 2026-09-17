export const config = {
  listName: "Auto-detect slope tiles from tilemap",
  displayText: "{my}: Auto-detect slope tiles from {0} by collision shape",
  description: "Scan a Tilemap and automatically register slope tiles by probing their collision shapes: surfaces at 45° become slopes, surfaces at 22.5° become gentle slopes, and flipped tile placements are handled automatically. Uses the documented collision API, so it works wherever collisions work. Requires slope tiles to have sloped collision polygons set in the C3 editor; tiles that don't match a supported angle stay solid. For fully hands-off slope detection during scanning, enable the 'Detect Slopes' property instead.",
  params: [
    { id: "tilemap", name: "Tilemap", desc: "The Tilemap object to scan", type: "object" }
  ]
};

export const expose = true;

export default function (tilemap) {
  this.aceAutoDetectSlopeTiles(tilemap);
}
