export const config = {
  returnType: "number",
  description: "The maximum downward drop this character will traverse by air, in pixels. -1 means no limit."
};

export const expose = true;

export default function () {
  return typeof this.maxTraversalDrop === "number" ? this.maxTraversalDrop : -1;
}
