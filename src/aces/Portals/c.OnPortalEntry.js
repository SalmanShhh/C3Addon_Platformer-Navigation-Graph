export const config = {
  listName: "On portal entry",
  displayText: "{my}: On portal entry",
  description: "Triggered when the character arrives at a portal entry, before the portal executes. Call 'Pause at portal' here to run your own events first. CurrentPortalID identifies the portal.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
