export const config = {
  listName: "Set path strategy",
  displayText: "{my}: Set path strategy to {0}",
  description: "Change how routes are picked. Balanced: distance and difficulty weighed equally. Shortest Distance: fastest route, momentum jumps included. Safest Route: short hops and drops over long leaps. Ground-Hugging: walk whenever possible. No Falling: never descend by air; slopes and portals only. Walk Only: never jump or fall at all; stay on the platform.",
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
        { simplest: "Ground-Hugging" },
        { no_drop: "No Falling" },
        { walk_only: "Walk Only" }
      ]
    }
  ]
};

export const expose = true;

export default function (strategy) {
  this.pathStrategy = this._combo(strategy, ["balanced", "shortest", "safest", "simplest", "no_drop", "walk_only"]);
}
