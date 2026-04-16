export const config = {
  listName: "On waypoint stuck",
  displayText: "On waypoint stuck",
  description: "Triggered when the character has been stuck at a waypoint for too long (exceeds Max Waypoint Time). The path is automatically cancelled. Use this to handle stuck situations or repath.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
