export const config = {
  returnType: "number",
  description: "Get the tile size in pixels. Returns 0 if no map exists."
};

export const expose = true;

export default function () {
  return this.aceGetGridTileSize();
}
