export const config = {
  listName: "Set re-path threshold",
  displayText: "Set re-path threshold to {0} tiles",
  description: "Set how many tiles the character can drift from the path before automatic re-pathing triggers. Higher values = more tolerance for deviation.",
  params: [
    { id: "tiles", name: "Tiles", desc: "Threshold in tiles", type: "number", initialValue: "2" }
  ]
};

export const expose = true;

export default function (tiles) {
  this.rePathThreshold = tiles;
}
