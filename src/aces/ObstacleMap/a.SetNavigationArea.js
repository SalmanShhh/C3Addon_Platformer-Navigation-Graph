export const config = {
  listName: "Set navigation area",
  displayText: "{my}: Set navigation area ({0}, {1}) to ({2}, {3})",
  description: "Limit the navigation map to a rectangle, for streamed and endless worlds: keep it around the action and memory stays flat. Calling it again moves the window: only newly covered cells are scanned and cells left behind are dropped. Characters outside the area cannot find paths. Use the same value for both corners to go back to covering everything automatically.",
  params: [
    { id: "x1", name: "X1", desc: "The X co-ordinate of one corner of the area, in pixels.", type: "number", initialValue: "0" },
    { id: "y1", name: "Y1", desc: "The Y co-ordinate of one corner of the area, in pixels.", type: "number", initialValue: "0" },
    { id: "x2", name: "X2", desc: "The X co-ordinate of the opposite corner of the area, in pixels.", type: "number", initialValue: "0" },
    { id: "y2", name: "Y2", desc: "The Y co-ordinate of the opposite corner of the area, in pixels.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x1, y1, x2, y2) {
  this.aceSetNavigationArea(x1, y1, x2, y2);
}
