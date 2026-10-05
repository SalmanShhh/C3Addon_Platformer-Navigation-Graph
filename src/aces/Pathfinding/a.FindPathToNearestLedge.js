export const config = {
  listName: "Find path to nearest ledge",
  displayText: "{my}: Find path to nearest ledge ({0}) at distance {1}",
  description: "Calculate a path to the nearest platform edge in the given direction, stopping the given distance back from it. Triggers 'On failed to find path' if no ledge exists that way.",
  params: [
    {
      id: "direction",
      name: "Direction",
      desc: "Left: a left-facing edge to the character's left. Right: a right-facing edge to the right. Any: the nearest edge of either facing.",
      type: "combo",
      initialValue: "any",
      items: [
        { left: "Left" },
        { right: "Right" },
        { any: "Any" }
      ]
    },
    { id: "distance", name: "Distance", desc: "The distance to stop back from the edge, in pixels. 0 stands on the edge.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (direction, distance) {
  const key = this._combo(direction, ["left", "right", "any"]);
  this.aceFindPathToNearestLedge(key === "left" ? -1 : key === "right" ? 1 : 0, distance);
}
