export const config = {
  listName: "Add hazard",
  displayText: "{my}: Add {0} hazard at ({1}, {2}) [Size: {3} x {4}] [Severity: {5}]",
  description: "Mark an area as dangerous, centred on a position. Characters prefer routes around it. For objects, use 'Add hazard from object' instead.",
  params: [
    {
      id: "shape", name: "Shape",
      desc: "Rectangle: the area fills Width x Height. Circle: a circle that fits inside Width x Height (its diameter is the smaller side), good for explosions.",
      type: "combo", initialValue: "rectangle",
      items: [
        { rectangle: "Rectangle" },
        { circle: "Circle" }
      ]
    },
    { id: "x", name: "X", desc: "The X co-ordinate of the centre, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The Y co-ordinate of the centre, in pixels.", type: "number", initialValue: "0" },
    { id: "width", name: "Width", desc: "The width, in pixels.", type: "number", initialValue: "64" },
    { id: "height", name: "Height", desc: "The height, in pixels.", type: "number", initialValue: "64" },
    { id: "severity", name: "Severity", desc: "The hazard severity. Higher values are more dangerous.", type: "number", initialValue: "10" }
  ]
};

export const expose = true;

export default function (shape, x, y, width, height, severity) {
  this.aceAddHazard(this._combo(shape, ["rectangle", "circle"]), x, y, width, height, severity);
}
