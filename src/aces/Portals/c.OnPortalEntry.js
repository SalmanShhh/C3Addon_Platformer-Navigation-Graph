export const config = {
  listName: "On portal entry",
  displayText: "{my}: On portal entry",
  description: "Triggered when the AI arrives at a portal entry point, BEFORE the portal executes. Use 'Pause at portal' inside this event to delay execution and run your own events first (animations, sounds, screen effects). If you don't pause, the portal executes immediately. Use CurrentPortalID to identify which portal was reached.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
