export const config = {
  returnType: "number",
  description: "Get the total number of active hazards (circles and rectangles). Does not include tile hazards."
};

export const expose = true;

export default function () {
  return this.aceGetHazardCount();
}
