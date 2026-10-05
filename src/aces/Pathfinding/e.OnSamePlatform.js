export const config = {
  returnType: "number",
  description: "1 if the position is on the same walkable platform as the character (reachable by walking only, no jumps or falls), else 0.",
  params: [
    { id: "x", name: "X", desc: "The X co-ordinate, in pixels.", type: "number" },
    { id: "y", name: "Y", desc: "The Y co-ordinate, in pixels.", type: "number" }
  ]
};

export const expose = true;

export default function (x, y) {
  return this.aceGetOnSamePlatform(x, y);
}
