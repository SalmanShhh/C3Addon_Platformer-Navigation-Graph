export const config = {
  listName: "Clear obstacle map",
  displayText: "{my}: Clear obstacle map",
  description: "Remove the obstacle map and all associated data. Use this when switching levels or resetting the navigation system."
};

export const expose = true;

export default function () {
  this.aceClearObstacleMap();
}
