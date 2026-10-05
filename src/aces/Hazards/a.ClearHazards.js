export const config = {
  listName: "Clear hazards",
  displayText: "{my}: Clear {0} hazards",
  description: "Clear hazards by kind: Shapes (circles and rects, tracked included), Tiles, Tracked only, or Everything.",
  params: [
    {
      id: "which",
      name: "Which",
      desc: "Shapes: circles and rects, tracked included. Tiles: tile severities only. Tracked only: object-following hazards. Everything: all of them.",
      type: "combo",
      initialValue: "everything",
      items: [
        { shapes: "Shapes (circles and rects)" },
        { tiles: "Tiles" },
        { tracked: "Tracked only" },
        { everything: "Everything" }
      ]
    }
  ]
};

export const expose = true;

export default function (which) {
  const key = this._combo(which, ["shapes", "tiles", "tracked", "everything"]);
  if (key === "shapes" || key === "everything") this.aceClearAllHazards();
  if (key === "tiles" || key === "everything") this.aceClearAllHazardTiles();
  if (key === "tracked") this.aceClearAllTrackedHazards();
}
