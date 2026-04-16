export const config = {
  returnType: "number",
  description: "Get the current coyote timer value in seconds. This counts down after leaving the ground. Returns 0 when on ground or timer expired."
};

export const expose = true;

export default function () {
  return this.aceGetCoyoteTimer();
}
