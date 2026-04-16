export const config = {
  returnType: "number",
  description: "Get the grid X coordinate of a waypoint by index. Returns -1 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "Waypoint index (0-based)", type: "number" }
  ]
};

export const expose = true;

export default function (index) {
  return this.aceGetWaypointGridX(index);
}
