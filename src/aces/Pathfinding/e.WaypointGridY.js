export const config = {
  returnType: "number",
  description: "Get the grid Y coordinate of a waypoint by index. Returns -1 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "The zero-based index of the waypoint.", type: "number" }
  ]
};

export const expose = true;

export default function (index) {
  return this.aceGetWaypointGridY(index);
}
