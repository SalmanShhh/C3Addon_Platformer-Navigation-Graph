export const config = {
  listName: "Set hazard radius",
  displayText: "{my}: Set hazard radius to {0} tiles",
  description: "Set the radius in tiles for circular/rectangular hazard influence. Tiles within this radius of a hazard will have their pathfinding cost increased.",
  params: [
    { id: "tiles", name: "Tiles", desc: "Radius in tiles", type: "number", initialValue: "1" }
  ]
};

export const expose = true;

export default function (tiles) {
  this.hazardRadius = tiles;
}
