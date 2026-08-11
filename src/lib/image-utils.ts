/**
 * image-utils — 移动端上传图片压缩与格式转换
 *
 * 解决痛点：
 *   - 手机相册原图（HEIC/大图）直传会触发 Vercel 4.5MB Body Size Limit（HTTP 413）；
 *   - 统一在客户端 Canvas 压缩后再发送给 /api/v1/meals/analyze-image。
 *
 * 规则（硬约束）：
 *   a. 最大边长 1024px（保持宽高比）；
 *   b. 统一导出 image/jpeg、质量 0.8；
 *   c. iPhone .heic / .heif 通过浏览器解码 + Canvas 兜底转换（无法解码时给出可读错误）；
 *   d. 压缩后 Payload 严格 ≤ 500KB（逐级降质量/降边长，超限抛 STILL_TOO_LARGE）。
 */

const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.8;
const MAX_BYTES = 500 * 1024; // 500KB

const HEIC_EXT_RE = /\.(heic|heif)$/i;
const HEIC_MIME_RE = /image\/heic|image\/heif/i;

export interface CompressResult {
  file: File;
  compressed: boolean;
  originalSize: number;
  finalSize: number;
  width: number;
  height: number;
  originalType: string;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("DECODE_FAILED"));
    };
    img.src = url;
  });
}

function drawToJpegBlob(
  img: HTMLImageElement,
  maxEdge: number,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("CANVAS_UNAVAILABLE"));
      return;
    }
    // JPEG 无透明通道：白底填充，避免透明 PNG 转出黑底
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("JPEG_EXPORT_FAILED"))),
      "image/jpeg",
      quality
    );
  });
}

/**
 * 压缩图片文件 → JPEG（≤500KB / 最长边 ≤1024px）。
 * 抛错码：DECODE_FAILED（一般解码失败）、HEIC_DECODE_FAILED（HEIC 浏览器不支持）、
 *        STILL_TOO_LARGE（极限压缩后仍超 500KB）、CANVAS_UNAVAILABLE / JPEG_EXPORT_FAILED。
 */
export async function compressImageFile(file: File): Promise<CompressResult> {
  const originalSize = file.size;
  const originalType = file.type || "application/octet-stream";
  const isHeic = HEIC_EXT_RE.test(file.name) || HEIC_MIME_RE.test(file.type);

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    throw new Error(isHeic ? "HEIC_DECODE_FAILED" : "DECODE_FAILED");
  }
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) throw new Error("DECODE_FAILED");

  // 逐级降质/降边长，直至 ≤ 500KB（硬约束）
  const steps: { edge: number; quality: number }[] = [];
  for (const edge of [MAX_EDGE, 896, 768, 640]) {
    for (const quality of [JPEG_QUALITY, 0.7, 0.6, 0.5]) {
      steps.push({ edge, quality });
    }
  }

  let blob: Blob | null = null;
  for (const s of steps) {
    blob = await drawToJpegBlob(img, s.edge, s.quality);
    if (blob.size <= MAX_BYTES) break;
  }
  if (!blob || blob.size > MAX_BYTES) {
    throw new Error("STILL_TOO_LARGE");
  }

  const baseName = file.name.replace(HEIC_EXT_RE, "").replace(/\.[^.]+$/, "");
  const out = new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  return {
    file: out,
    compressed: true,
    originalSize,
    finalSize: out.size,
    width,
    height,
    originalType,
  };
}
