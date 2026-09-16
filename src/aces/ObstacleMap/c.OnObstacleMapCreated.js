export const config = {
  listName: "On obstacle map created",
  displayText: "{my}: On obstacle map created",
  description: "Triggered when a custom obstacle map is successfully created. Use this to start configuring tiles after map creation.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
