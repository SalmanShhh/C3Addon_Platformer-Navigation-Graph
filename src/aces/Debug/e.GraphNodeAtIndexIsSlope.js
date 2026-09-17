export const config = {
  returnType: "number",
  description: "Returns 1 if the node at the given index is a slope node, 0 otherwise.",
  params: [
    { id: "index", name: "Index", desc: "Node index", type: "number" }
  ]
};

export const expose = true;

export default function (index) {
  return this.aceGetNodeAtIndexIsSlope(index);
}
