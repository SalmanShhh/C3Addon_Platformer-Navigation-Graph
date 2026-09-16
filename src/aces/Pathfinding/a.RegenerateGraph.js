export const config = {
  listName: "Regenerate navigation graph",
  displayText: "{my}: Regenerate navigation graph",
  description: "Rebuild the navigation graph from scratch. Use after modifying the level layout, adding/removing obstacles, or changing platform positions."
};

export const expose = true;

export default function () {
  this.graphGenerated = false;
}
