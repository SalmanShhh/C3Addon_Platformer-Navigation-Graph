export const config = {
  listName: "Find object on same platform",
  displayText: "{my}: Find {1} {0} on same platform",
  description: "Search the object's picked instances for the nearest or furthest one reachable by walking alone, no jumps or falls. Read the result with PlatformObjectUID and pick it with the System 'Pick by unique ID' condition (-1 = none).",
  params: [
    { id: "target", name: "Target object", desc: "The object to search (its picked instances)", type: "object" },
    {
      id: "which",
      name: "Which",
      desc: "Nearest: the instance closest to the character. Furthest: the one farthest away, for retreat targets.",
      type: "combo",
      initialValue: "nearest",
      items: [
        { nearest: "Nearest" },
        { furthest: "Furthest" }
      ]
    }
  ]
};

export const expose = true;

export default function (target, which) {
  this.aceFindObjectOnPlatform(target, this._combo(which, ["nearest", "furthest"]) === "furthest");
}
