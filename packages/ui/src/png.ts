/**
 * A PNG of an SVG: the markup drawn by the browser onto a canvas of the given size, so the PNG
 * shows exactly what the SVG does, transparent where it is. Shared by the apps that export both.
 */
export async function renderPng(svg: string, width: number, height: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The drawing could not be rendered."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot draw the picture.");
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("The PNG could not be made."))),
        "image/png"
      )
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
