export const config = {
  returnType: "number",
  description: "Get the world Y position of a waypoint by index. The waypoint position is centred within the tile. Returns 0 if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "The zero-based index of the waypoint.", type: "number" }
  ]
};

export const expose = true;

export default function (index) {
  return this.aceGetWaypointY(index);
}
