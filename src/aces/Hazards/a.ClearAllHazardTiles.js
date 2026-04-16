export const config = {
  listName: "Clear all tile hazards",
  displayText: "Clear all tile hazards",
  description: "Reset all tile hazard severities to 0. This does NOT remove circle/rect hazards. Use when you want to clear static tile dangers."
};

export const expose = true;

export default function () {
  this.aceClearAllHazardTiles();
}
