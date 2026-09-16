export const config = {
  listName: "Complete portal",
  displayText: "{my}: Complete portal",
  description: "Finish a paused portal without executing its built-in movement. Use this when you've already moved the character yourself (e.g., custom animation, physics launch, manual position set). The AI will continue pathfinding from wherever the character is now. Also works mid-traverse to cut a gradual portal short."
};

export const expose = true;

export default function () {
  this.aceCompletePortal();
}
