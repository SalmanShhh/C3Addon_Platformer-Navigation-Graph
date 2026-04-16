export const config = {
  listName: "Clear all slope markings",
  displayText: "Clear all slope markings",
  description: "Remove all slope markings from the obstacle map. Slopes will be treated as regular solid tiles. Use this to reset slope data."
};

export const expose = true;

export default function () {
  this.aceClearAllSlopes();
}
