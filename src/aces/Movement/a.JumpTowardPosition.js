export const config = {
  listName: "Jump toward position",
  displayText: "{my}: Jump toward ({0}, {1})",
  description: "Jump directly toward a position with full strength, no pathfinding. Works from the floor, or mid-air when double jump is enabled. Triggers 'On jump toward launched' when the jump starts.",
  params: [
    { id: "x", name: "X", desc: "The target X co-ordinate, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The target Y co-ordinate, in pixels.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x, y) {
  this.aceJumpTowardPosition(x, y);
}
