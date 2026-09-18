export const config = {
  returnType: "number",
  description: "Get the number of outgoing connections from the node at the given index.",
  params: [
    { id: "index", name: "Index", desc: "The zero-based index of the node.", type: "number" }
  ]
};

export const expose = true;

export default function (index) {
  return this.aceGetNodeAtIndexConnectionCount(index);
}
