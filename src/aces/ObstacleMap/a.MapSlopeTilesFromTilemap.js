export const config = {
  listName: "Map slope tiles from tilemap",
  displayText: "{my}: Map slopes from {0}: left={1} right={2} gentle-left={3} gentle-right={4}",
  description: "Scan a Tilemap and mark tiles matching the given tile IDs as slopes. Pass tile IDs as comma-separated strings (e.g. '5,6,7'). Pass empty string to skip a slope type. Remembered and re-applied whenever the obstacle map is rebuilt.",
  params: [
    { id: "tilemap", name: "Tilemap", desc: "The Tilemap object to scan", type: "object" },
    { id: "slopeLeftIds", name: "Slope left IDs", desc: "The comma-separated tile IDs for 45° slope left (/)", type: "string", initialValue: '""' },
    { id: "slopeRightIds", name: "Slope right IDs", desc: "The comma-separated tile IDs for 45° slope right (\\)", type: "string", initialValue: '""' },
    { id: "gentleLeftIds", name: "Gentle left IDs", desc: "The comma-separated tile IDs for 22.5° gentle slope left (/)", type: "string", initialValue: '""' },
    { id: "gentleRightIds", name: "Gentle right IDs", desc: "The comma-separated tile IDs for 22.5° gentle slope right (\\)", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (tilemap, slopeLeftIds, slopeRightIds, gentleLeftIds, gentleRightIds) {
  this.aceMapSlopeTilesFromTilemap(tilemap, slopeLeftIds, slopeRightIds, gentleLeftIds, gentleRightIds);
}
