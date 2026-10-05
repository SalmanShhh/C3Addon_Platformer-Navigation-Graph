export const config = {
  listName: "Find path to side of object",
  displayText: "{my}: Find path to {1} side of {0} at distance {2}",
  description: "Calculate a path to a position beside another object instead of on top of it, keeping the given distance (both widths are always cleared). 'Any' picks the nearer side, falling back if it has no ground. Uses the first picked instance.",
  params: [
    { id: "target", name: "Target object", desc: "The object to path beside (first picked instance)", type: "object" },
    {
      id: "side",
      name: "Side",
      desc: "Left / Right: stop on that side of the object. Any: the nearer side, falling back to the other if it has no ground.",
      type: "combo",
      initialValue: "any",
      items: [
        { left: "Left" },
        { right: "Right" },
        { any: "Any" }
      ]
    },
    { id: "distance", name: "Distance", desc: "The distance to keep from the object's edge, in pixels. 0 stands flush beside it.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (target, side, distance) {
  const key = this._combo(side, ["left", "right", "any"]);
  this.aceFindPathToObjectSide(target, key === "left" ? -1 : key === "right" ? 1 : 0, distance);
}
