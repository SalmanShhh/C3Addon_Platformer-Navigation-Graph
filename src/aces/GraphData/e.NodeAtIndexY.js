export const config = {
  returnType: "number",
  description: "Get the world Y position of the node at the given index.",
  params: [
    { id: "index", name: "Index", desc: "Node index", type: "number" }
  ]
};

export const expose = true;

export default function (index) {
  return this.aceGetNodeAtIndexY(index);
}
