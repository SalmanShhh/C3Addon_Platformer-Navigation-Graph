export const config = {
  returnType: "number",
  description: "Get the grid X coordinate of the nearest navigation node to a given world position.",
  params: [
    { id: "x", name: "X", desc: "World X position", type: "number" },
    { id: "y", name: "Y", desc: "World Y position", type: "number" }
  ]
};

export const expose = true;

export default function (x, y) {
  return this.aceGetNearestNodeGridX(x, y);
}
