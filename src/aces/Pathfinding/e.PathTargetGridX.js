export const config = {
  returnType: "number",
  description: "Get the grid X coordinate of the path target. Returns -1 if no path is active."
};

export const expose = true;

export default function () {
  return this.aceGetPathTargetGridX();
}
