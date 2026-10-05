export const config = {
  listName: "Create custom obstacle map",
  displayText: "{my}: Create custom obstacle map [Width: {0} tiles] [Height: {1} tiles]",
  description: "Create a custom obstacle map with the specified dimensions in tiles. All tiles are initialized to 'clear' state. Use this for fully manual tile setup.",
  params: [
    { id: "width", name: "Width", desc: "The width, in tiles.", type: "number", initialValue: "32" },
    { id: "height", name: "Height", desc: "The height, in tiles.", type: "number", initialValue: "24" }
  ]
};

export const expose = true;

export default function (width, height) {
  this.aceCreateCustomObstacleMap(width, height);
}
