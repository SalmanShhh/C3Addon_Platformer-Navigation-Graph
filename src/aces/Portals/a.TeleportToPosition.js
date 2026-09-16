export const config = {
  listName: "Teleport to position",
  displayText: "{my}: Teleport to ({0}, {1})",
  description: "Instantly move the character to the given position. Can be used anywhere — inside portal events, on button press, on collision, etc. Suppresses re-pathing for one tick to prevent the AI from thinking it's lost. Useful with 'Pause at portal' + 'Complete portal' for fully custom portal behavior.",
  params: [
    { id: "x", name: "X", desc: "Target world X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Target world Y position in pixels", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x, y) {
  this.aceTeleportToPosition(x, y);
}
