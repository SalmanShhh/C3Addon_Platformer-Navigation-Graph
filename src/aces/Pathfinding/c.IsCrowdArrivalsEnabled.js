export const config = {
  listName: "Is crowd arrivals enabled",
  displayText: "{my}: Is crowd arrivals enabled",
  description: "True if crowd arrivals (goal reservation) is currently active.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsCrowdArrivalsEnabled() === 1;
}
