export const config = {
  returnType: "string",
  description: "Get the action name for a waypoint by index (e.g., 'walk', 'jump', 'fall', 'portal'). Returns empty string if index is out of bounds.",
  params: [
    { id: "index", name: "Index", desc: "The zero-based index of the waypoint.", type: "number" }
  ]
};

export const expose = true;

export default function (index) {
  return this.aceGetCurrentPathAction(index);
}
