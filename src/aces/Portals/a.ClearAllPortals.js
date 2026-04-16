export const config = {
  listName: "Clear all portals",
  displayText: "Clear all portals",
  description: "Remove all portals from the navigation graph. Useful when resetting the level or switching layouts."
};

export const expose = true;

export default function () {
  this.aceClearAllPortals();
}
