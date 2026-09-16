export const config = {
  listName: "Create custom obstacle map",
  displayText: "{my}: Create custom obstacle map [Width: {0} tiles] [Height: {1} tiles]",
  description: "Create a custom obstacle map with the specified dimensions in tiles. All tiles are initialized to 'clear' state. Use this when not using the Pathfinding behavior's obstacle map.",
  params: [
    { id: "width", name: "Width", desc: "Width in tiles", type: "number", initialValue: "32" },
    { id: "height", name: "Height", desc: "Height in tiles", type: "number", initialValue: "24" }
  ]
};

export const expose = true;

export default function (width, height) {
  this.aceCreateCustomObstacleMap(width, height);
}
