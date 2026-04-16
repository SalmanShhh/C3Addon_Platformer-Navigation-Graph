export const config = {
  returnType: "number",
  description: "Get the world Y position of the path target. Pass 'original' for raw input or 'corrected' for ground-snapped position.",
  params: [
    { id: "type", name: "Type", desc: "'original' or 'corrected'", type: "string" }
  ]
};

export const expose = true;

export default function (type) {
  return this.aceGetPathTargetY(type);
}
