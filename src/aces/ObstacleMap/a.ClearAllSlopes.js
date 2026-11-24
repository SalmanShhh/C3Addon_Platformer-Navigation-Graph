export const config = {
  listName: "Clear all slope markings",
  displayText: "{my}: Clear all slope markings",
  description: "Remove all slope markings from the obstacle map. Slopes will be treated as regular solid tiles. Also forgets slope tiles registered with the Map and Auto-detect slope actions."
};

export const expose = true;

export default function () {
  this.aceClearAllSlopes();
}
