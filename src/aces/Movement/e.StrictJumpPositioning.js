export const config = {
  returnType: "number",
  description: "Get whether strict jump positioning is currently active for this character. Returns 1 if enabled, 0 if disabled. Useful for conditional logic, e.g. switching between careful and aggressive pathfinding modes."
};

export const expose = true;

export default function () {
  return this.aceGetStrictJumpPositioning();
}
