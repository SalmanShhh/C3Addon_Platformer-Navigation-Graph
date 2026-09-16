export const config = {
  listName: "On Pathfinding map failed",
  displayText: "{my}: On Pathfinding map failed",
  description: "Triggered when the Pathfinding behavior's obstacle map fails to initialize. Use this to implement fallback error handling.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
