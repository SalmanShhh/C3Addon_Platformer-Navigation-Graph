export const config = {
  listName: "Resume portal",
  displayText: "Resume portal",
  description: "Continue portal execution after pausing with 'Pause at portal'. For instant portals: teleports the character to the exit. For gradual portals: begins moving the character toward the exit. Use this when you want the portal's built-in movement to handle the transition."
};

export const expose = true;

export default function () {
  this.aceResumePortal();
}
