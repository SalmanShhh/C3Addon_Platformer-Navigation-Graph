export const config = {
  returnType: "number",
  description: "Get the world X position of the jump-at target. Returns 0 if not in jump-at mode."
};

export const expose = true;

export default function () {
  return this.aceGetJumpTowardTargetX();
}
