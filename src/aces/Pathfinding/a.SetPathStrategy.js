export const config = {
  listName: "Set path strategy",
  displayText: "{my}: Set path strategy to {0}",
  description: "Change how the AI picks the best route when multiple paths exist. Balanced: weighs distance and difficulty equally. Shortest Distance: always takes the fastest route, using momentum jumps to skip platforms. Safest Route: prefers short hops and drops over long leaps and falls. Ground-Hugging: walks whenever possible, jumping or falling only when unavoidable.",
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
        { simplest: "Ground-Hugging" }
      ]
    }
  ]
};

export const expose = true;

export default function (strategy) {
  this.pathStrategy = this._combo(strategy, ["balanced", "shortest", "safest", "simplest"]);
}
