export const config = {
  listName: "Teleport to position",
  displayText: "{my}: Teleport to ({0}, {1})",
  description: "Instantly move the character to the given position. Suppresses drift re-pathing for one tick so the current path is not abandoned.",
  params: [
    { id: "x", name: "X", desc: "The target X co-ordinate, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The target Y co-ordinate, in pixels.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x, y) {
  this.aceTeleportToPosition(x, y);
}
