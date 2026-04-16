export const config = {
  listName: "Is setting up Pathfinding",
  displayText: "Is setting up Pathfinding map",
  description: "Check if the behavior is currently waiting for the Pathfinding obstacle map to initialize. Returns true during async setup.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsSettingUpPathfinding();
}
