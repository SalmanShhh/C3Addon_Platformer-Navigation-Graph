export const config = {
  listName: "Clear all hazards",
  displayText: "Clear all circle and rectangle hazards",
  description: "Remove all circular and rectangular hazards. This does NOT clear tile-based hazards. Use when resetting a level or clearing all dynamic dangers."
};

export const expose = true;

export default function () {
  this.aceClearAllHazards();
}
