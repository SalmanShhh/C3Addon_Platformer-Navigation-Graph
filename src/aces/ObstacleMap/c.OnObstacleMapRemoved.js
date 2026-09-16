export const config = {
  listName: "On obstacle map removed",
  displayText: "{my}: On obstacle map removed",
  description: "Triggered when the obstacle map is cleared or removed. Use this to clean up related data or reset systems.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
