export const config = {
  returnType: "number",
  description: "Convert a world X position to grid X coordinate. Returns the grid tile number at the given pixel position.",
  params: [
    { id: "x", name: "X", desc: "The X co-ordinate, in pixels.", type: "number" }
  ]
};

export const expose = true;

export default function (x) {
  return this.aceWorldToGridX(x);
}
