export const config = {
  listName: "Regenerate region",
  displayText: "{my}: Regenerate region ({0}, {1}) to ({2}, {3})",
  description: "Rescan the obstacles inside a rectangle and update only the nearby part of the navigation graph. Much cheaper than Regenerate obstacle map for local changes. Spread across frames; a Find path in the same tick waits for it.",
  params: [
    { id: "x1", name: "X1", desc: "The X co-ordinate of one corner of the area, in pixels.", type: "number", initialValue: "0" },
    { id: "y1", name: "Y1", desc: "The Y co-ordinate of one corner of the area, in pixels.", type: "number", initialValue: "0" },
    { id: "x2", name: "X2", desc: "The X co-ordinate of the opposite corner of the area, in pixels.", type: "number", initialValue: "0" },
    { id: "y2", name: "Y2", desc: "The Y co-ordinate of the opposite corner of the area, in pixels.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x1, y1, x2, y2) {
  this.aceRegenerateRegion(x1, y1, x2, y2);
}
