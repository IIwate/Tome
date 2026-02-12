const SOFT_COLORS = [
  "#fca5a5", "#fdba74", "#fcd34d", "#bef264", "#86efac",
  "#5eead4", "#67e8f9", "#93c5fd", "#a5b4fc", "#c4b5fd",
  "#d8b4fe", "#f0abfc", "#f9a8d4", "#fda4af",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function generateTxtCover(title: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 280;
  const ctx = canvas.getContext("2d")!;

  // 确定性选色
  const colorIndex = hashString(title) % SOFT_COLORS.length;
  ctx.fillStyle = SOFT_COLORS[colorIndex]!;
  ctx.fillRect(0, 0, 200, 280);

  // 书名首字
  const char = title[0] || "?";
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.font = "bold 80px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(char, 100, 125);

  // 底部书名（截断）
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "14px system-ui, sans-serif";
  const displayTitle = title.length > 10 ? title.slice(0, 10) + "…" : title;
  ctx.fillText(displayTitle, 100, 220);

  return canvas.toDataURL("image/png");
}
