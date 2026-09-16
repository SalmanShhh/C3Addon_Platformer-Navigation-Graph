export const config = {
  listName: "Is at ledge",
  displayText: "{my}: Is at ledge",
  description: "Check if the character is currently standing on a ledge node (edge of a platform). Use this to trigger ledge-specific behaviors or animations.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsAtLedge();
}
