export const config = {
  listName: "Is position hazardous",
  displayText: "{my}: Is position ({0}, {1}) hazardous",
  description: "Check if a specific world position is within any hazard area (circle, rect, or tile). Returns true if any hazard affects this position.",
  isInvertible: true,
  params: [
    { id: "x", name: "X", desc: "The X co-ordinate, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The Y co-ordinate, in pixels.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x, y) {
  return this.aceIsPositionHazardous(x, y);
}
