export const config = {
  listName: "Is traversing portal",
  displayText: "Is traversing portal",
  description: "True when the AI is currently moving through a gradual portal (elevator, ladder, etc.). Platform behavior is disabled during traversal.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsTraversingPortal();
}
