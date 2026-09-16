export const config = {
  listName: "On jump toward launched",
  displayText: "{my}: On jump toward launched",
  description: "Triggered when the 'Jump toward position' action launches the character. Use this to play attack animations, spawn effects, or apply damage. The target position is available via JumpTowardTargetX/Y expressions.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
