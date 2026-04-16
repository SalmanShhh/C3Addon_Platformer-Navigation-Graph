export const config = {
  returnType: "number",
  description: "Get the calculated maximum jump height in pixels. This is the value used to build graph connections. Useful for debugging jump arc detection."
};

export const expose = true;

export default function () {
  return this.aceGetCalculatedJumpHeight();
}
