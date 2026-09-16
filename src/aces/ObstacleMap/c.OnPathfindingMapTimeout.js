export const config = {
  listName: "On Pathfinding map timeout",
  displayText: "{my}: On Pathfinding map timeout",
  description: "Triggered when waiting for the Pathfinding obstacle map times out. Use this to handle slow or stuck initialization.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
