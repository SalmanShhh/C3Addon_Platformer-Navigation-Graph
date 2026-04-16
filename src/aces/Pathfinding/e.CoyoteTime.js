export const config = {
  returnType: "number",
  description: "Get the current coyote time setting in seconds. This is the window after walking off a ledge where jumps are still allowed."
};

export const expose = true;

export default function () {
  return this.aceGetCoyoteTime();
}
