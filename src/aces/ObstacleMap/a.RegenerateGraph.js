export const config = {
  listName: "Regenerate navigation graph",
  displayText: "{my}: Regenerate navigation graph",
  description: "Build or rebuild the navigation graph from the current obstacle map. Call after setting up tiles manually, and after modifying the level layout, adding/removing obstacles, or changing platform positions. Fires 'On navigation graph generated' when done."
};

export const expose = true;

export default function () {
  this.aceRegenerateGraph();
}
