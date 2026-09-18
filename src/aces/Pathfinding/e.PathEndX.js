export const config = {
  returnType: "number",
  description: "The world X of the calculated path's final position: the last waypoint, where the character will actually end up. In Nearest mode this can differ from the requested target (the path stops at the closest reachable spot). Returns 0 if no path has been calculated."
};

export const expose = true;

export default function () {
  return this.aceGetPathEndX();
}
