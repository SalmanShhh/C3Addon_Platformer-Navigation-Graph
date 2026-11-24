export const config = {
  listName: "Regenerate region by object",
  displayText: "{my}: Regenerate region by {0}",
  description: "Rescan the area covered by the picked instances of an object and update only the nearby part of the navigation graph. Use after changing an obstacle without moving it, such as enabling or disabling its Solid behavior.",
  params: [
    { id: "object", name: "Object", desc: "The object whose picked instances' areas are regenerated.", type: "object" }
  ]
};

export const expose = true;

export default function (object) {
  this.aceRegenerateRegionByObject(object);
}
