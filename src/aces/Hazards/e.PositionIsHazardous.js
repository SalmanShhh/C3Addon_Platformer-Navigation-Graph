export const config = {
  returnType: "number",
  description: "Check if a world position is hazardous. Returns 1 if hazardous, 0 if safe.",
  params: [
    { id: "x", name: "X", desc: "The X co-ordinate, in pixels.", type: "number" },
    { id: "y", name: "Y", desc: "The Y co-ordinate, in pixels.", type: "number" }
  ]
};

export const expose = true;

export default function (x, y) {
  return this.aceIsPositionHazardous(x, y) ? 1 : 0;
}
