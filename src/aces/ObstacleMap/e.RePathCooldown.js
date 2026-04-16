export const config = {
  returnType: "number",
  description: "Get the current re-path cooldown in seconds. This is the minimum time between automatic re-path attempts."
};

export const expose = true;

export default function () {
  return this.aceGetRePathCooldown();
}
