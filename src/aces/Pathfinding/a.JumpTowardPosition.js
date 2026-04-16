export const config = {
  listName: "Jump toward position",
  displayText: "Jump toward ({0}, {1})",
  description: "Immediately jump toward a target position. The character jumps from its current position with full strength, moving horizontally toward the target. No pathfinding is involved — the character simply lunges at the target. Use for: jump attacks, stomps, lunges. Triggers 'On jump toward executed' when the jump starts. The character must be on the floor to jump.",
  params: [
    { id: "x", name: "X", desc: "Target X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Target Y position in pixels", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x, y) {
  this.aceJumpTowardPosition(x, y);
}
