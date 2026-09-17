export const config = {
  listName: "Is at island",
  displayText: "{my}: Is at island",
  description: "Check if the character is standing on a single-tile platform (isolated platform). Use this to detect precarious positions or trigger special behaviors.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsAtIsland();
}
