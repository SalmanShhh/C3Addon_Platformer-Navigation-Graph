export const config = {
  listName: "Remove hazard",
  displayText: "Remove hazard {0}",
  description: "Remove a hazard by its ID. Use this when a danger zone is no longer active. The graph will be regenerated if needed.",
  params: [
    { id: "id", name: "ID", desc: "Hazard ID to remove", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (id) {
  this.aceRemoveHazard(id);
}
