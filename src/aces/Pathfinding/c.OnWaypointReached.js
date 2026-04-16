export const config = {
  listName: "On waypoint reached",
  displayText: "On waypoint reached",
  description: "Triggered each time the character reaches a waypoint along the path. Use this to play footstep sounds, particle effects, or update animations.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
