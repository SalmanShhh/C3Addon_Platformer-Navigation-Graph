export const config = {
  listName: "Regenerate obstacle map",
  displayText: "{my}: Regenerate obstacle map",
  description: "Rescan every object with the Solid or Jump-thru behavior where it is now, including slopes, then rebuild the navigation graph. Use after moving, adding or removing obstacles. Fires 'On navigation graph generated' when done."
};

export const expose = true;

export default function () {
  this.aceRegenerateObstacleMap();
}
