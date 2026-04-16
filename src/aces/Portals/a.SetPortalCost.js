export const config = {
  listName: "Set portal cost",
  displayText: "Set portal {0} cost to {1}",
  description: "Change how 'expensive' a portal is for the AI to use. Lower cost = preferred, higher cost = avoided.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to configure", type: "number", initialValue: "0" },
    { id: "cost", name: "Cost", desc: "Movement cost (lower = preferred, default is 1)", type: "number", initialValue: "1" }
  ]
};

export const expose = true;

export default function (portalId, cost) {
  this.aceSetPortalCost(portalId, cost);
}
