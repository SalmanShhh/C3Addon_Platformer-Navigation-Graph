export const config = {
  listName: "Set path strategy",
  displayText: "Set path strategy to {0}",
  description: "Change how the AI picks the best route when multiple paths exist. Balanced: weighs distance and difficulty equally. Shortest Distance: always takes the fastest route. Safest Route: avoids jumps and falls. Simplest Path: fewest waypoints.",
  params: [
    {
      id: "strategy",
      name: "Strategy",
      desc: "The path selection strategy preset",
      type: "combo",
      initialValue: "balanced",
      items: [
        { balanced: "Balanced" },
        { shortest: "Shortest Distance" },
        { safest: "Safest Route" },
        { simplest: "Simplest Path" }
      ]
    }
  ]
};

export const expose = true;

export default function (strategy) {
  this.pathStrategy = this._combo(strategy, ["balanced", "shortest", "safest", "simplest"]);
}
