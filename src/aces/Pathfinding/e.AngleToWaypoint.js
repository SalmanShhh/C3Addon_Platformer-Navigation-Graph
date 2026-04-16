export const config = {
  returnType: "number",
  description: "Get the angle in degrees from the character to the current waypoint. Returns 0 if no path is active."
};

export const expose = true;

export default function () {
  return this.aceGetAngleToWaypoint();
}
