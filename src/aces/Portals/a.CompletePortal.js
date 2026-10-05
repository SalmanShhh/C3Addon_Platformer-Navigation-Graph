export const config = {
  listName: "Complete portal",
  displayText: "{my}: Complete portal",
  description: "Finish a paused portal without its built-in movement, when your events moved the character themselves. Also works mid-traverse to cut a gradual portal short."
};

export const expose = true;

export default function () {
  this.aceCompletePortal();
}
