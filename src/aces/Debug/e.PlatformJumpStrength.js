export const config = {
  returnType: "number",
  description: "Get the platform behavior's jump strength value. Useful for debugging jump parameter detection."
};

export const expose = true;

export default function () {
  return this.aceGetPlatformJumpStrength();
}
