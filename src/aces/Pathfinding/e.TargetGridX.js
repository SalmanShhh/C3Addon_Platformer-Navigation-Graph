export const config = {
  returnType: "number",
  description: "The grid X coordinate of the requested path target (after ground correction snaps it to walkable ground)."
};

export const expose = true;

export default function () {
  return this.aceGetTargetGridX();
}
