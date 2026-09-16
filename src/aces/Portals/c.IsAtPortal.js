export const config = {
  listName: "Is at portal",
  displayText: "{my}: Is at portal",
  description: "True when the AI is paused at a portal entry (after 'Pause at portal' was called but before 'Resume portal' or 'Complete portal'). Use to check if the character is waiting at a portal.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsAtPortal();
}
