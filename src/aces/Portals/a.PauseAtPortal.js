export const config = {
  listName: "Pause at portal",
  displayText: "{my}: Pause at portal",
  description: "Call INSIDE 'On portal entry' to pause the AI before the portal executes. The character stops at the entry point and waits. Use this to play animations, open doors, trigger screen transitions, or run any custom events before the portal activates. Call 'Resume portal' to execute the built-in behavior, or 'Complete portal' if you moved the character yourself."
};

export const expose = true;

export default function () {
  this.acePauseAtPortal();
}
