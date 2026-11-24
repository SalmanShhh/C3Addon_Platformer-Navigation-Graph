export const config = {
  listName: "Clear hazards",
  displayText: "{my}: Clear {0} hazards",
  description: "Remove hazards by kind.",
  params: [
    {
      id: "which",
      name: "Which",
      desc: "Areas: every hazard added with an action, including those from objects. Tiles: tile severities only. From objects: only hazards that follow objects. Everything: all of them.",
      type: "combo",
      initialValue: "everything",
      items: [
        { shapes: "Areas" },
        { tiles: "Tiles" },
        { tracked: "From objects" },
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
