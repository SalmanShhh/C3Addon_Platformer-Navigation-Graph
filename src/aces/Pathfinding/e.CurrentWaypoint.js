export const config = {
  returnType: "number",
  description: "Get the index of the current waypoint the character is moving toward. Returns -1 if no path is active."
};

export const expose = true;

export default function () {
  return this.aceGetCurrentWaypoint();
}
