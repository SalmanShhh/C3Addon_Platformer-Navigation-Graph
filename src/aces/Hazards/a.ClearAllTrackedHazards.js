export const config = {
  listName: "Clear all tracked hazards",
  displayText: "{my}: Clear all tracked hazards",
  description: "Remove every tracked (object-following) hazard. Static circle/rect hazards and tile hazards are untouched."
};

export const expose = true;

export default function () {
  this.aceClearAllTrackedHazards();
}
