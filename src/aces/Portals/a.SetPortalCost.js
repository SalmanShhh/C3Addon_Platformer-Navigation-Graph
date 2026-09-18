export const config = {
  listName: "Set portal cost",
  displayText: "{my}: Set portal {0} cost to {1}",
  description: "Change how 'expensive' a portal is for the AI to use. Lower cost = preferred, higher cost = avoided.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to configure", type: "number", initialValue: "0" },
    { id: "cost", name: "Cost", desc: "The movement cost. Lower costs are preferred; the default is 1.", type: "number", initialValue: "1" }
  ]
};

export const expose = true;

export default function (portalId, cost) {
  this.aceSetPortalCost(portalId, cost);
}
