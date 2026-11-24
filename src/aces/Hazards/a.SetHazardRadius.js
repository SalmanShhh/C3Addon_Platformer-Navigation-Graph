export const config = {
  listName: "Set hazard radius",
  displayText: "{my}: Set hazard radius to {0} tiles",
  description: "Set how far hazard costs spread around each hazard. The cost fades out over this many tiles.",
  params: [
    { id: "tiles", name: "Tiles", desc: "The radius, in tiles. 0 = hazard tiles only.", type: "number", initialValue: "1" }
  ]
};

export const expose = true;

export default function (tiles) {
  this.hazardRadius = Math.max(0, Math.floor(tiles) || 0);
  this._markHazardCostsDirty();
}
