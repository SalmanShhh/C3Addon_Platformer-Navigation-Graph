export const config = {
  returnType: "number",
  description: "Convert a world Y position to grid Y coordinate. Returns the grid tile number at the given pixel position.",
  params: [
    { id: "y", name: "Y", desc: "The Y co-ordinate, in pixels.", type: "number" }
  ]
};

export const expose = true;

export default function (y) {
  return this.aceWorldToGridY(y);
}
