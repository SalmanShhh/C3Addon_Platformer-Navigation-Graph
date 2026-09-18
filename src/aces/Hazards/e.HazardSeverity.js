export const config = {
  returnType: "number",
  description: "Get the total hazard severity at a world position from all sources (circles, rects, tiles). Higher values = more dangerous.",
  params: [
    { id: "x", name: "X", desc: "The X co-ordinate, in pixels.", type: "number" },
    { id: "y", name: "Y", desc: "The Y co-ordinate, in pixels.", type: "number" }
  ]
};

export const expose = true;

export default function (x, y) {
  return this.aceGetHazardSeverity(x, y);
}
