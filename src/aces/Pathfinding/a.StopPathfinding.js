export const config = {
  listName: "Stop pathfinding",
  displayText: "{my}: Stop pathfinding",
  description: "Stop the character immediately and clear the current path. Use when you want to cancel AI navigation and regain manual control."
};

export const expose = true;

export default function () {
  this.aceStopPathfinding();
}
