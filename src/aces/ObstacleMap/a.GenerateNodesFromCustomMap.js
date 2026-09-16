export const config = {
  listName: "Generate navigation graph",
  displayText: "{my}: Generate navigation graph from obstacle map",
  description: "Generate the navigation graph from the current obstacle map. Call this after setting up all tiles and before pathfinding. This is an expensive operation."
};

export const expose = true;

export default function () {
  this.aceGenerateNodesFromCustomMap();
}
