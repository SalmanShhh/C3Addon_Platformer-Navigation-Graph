export const config = {
  returnType: "number",
  description: "Returns 1 if the node at the given index is a right ledge, 0 otherwise.",
  params: [
    { id: "index", name: "Index", desc: "The zero-based index of the node.", type: "number" }
  ]
};

export const expose = true;

export default function (index) {
  return this.aceGetNodeAtIndexIsRightLedge(index);
}
