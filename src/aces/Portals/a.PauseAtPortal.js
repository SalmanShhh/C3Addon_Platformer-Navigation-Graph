export const config = {
  listName: "Pause at portal",
  displayText: "{my}: Pause at portal",
  description: "Hold the character at the portal entry. Only valid inside 'On portal entry'. Call 'Resume portal' to run the built-in movement, or 'Complete portal' if your events moved the character."
};

export const expose = true;

export default function () {
  this.acePauseAtPortal();
}
