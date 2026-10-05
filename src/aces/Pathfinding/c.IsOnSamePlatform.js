export const config = {
  listName: "Is on same platform as object",
  displayText: "{my}: Is on same platform as {0}",
  description: "True when the character can walk to the object without jumping or falling: both stand on the same connected stretch of ground, slopes included. Useful for picking a target to path to, or choosing between walking and lunging. Uses the first picked instance of the object.",
  isInvertible: true,
  params: [
    { id: "target", name: "Target object", desc: "The object to check (first picked instance)", type: "object" }
  ]
};

export const expose = true;

export default function (target) {
  return this.aceIsOnSamePlatform(target);
}
