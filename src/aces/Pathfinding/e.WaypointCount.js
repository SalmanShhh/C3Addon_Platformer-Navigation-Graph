export const config = {
  returnType: "number",
  description: "Get the total number of waypoints in the current path. Returns 0 if no path is active."
};

export const expose = true;

export default function () {
  return this.aceGetWaypointCount();
}
