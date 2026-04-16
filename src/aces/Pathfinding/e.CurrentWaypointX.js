export const config = {
  returnType: "number",
  description: "Get the world X position of the current waypoint. Returns 0 if no path is active."
};

export const expose = true;

export default function () {
  return this.aceGetCurrentWaypointX();
}
