// Downscale/re-encode a camera photo before uploading it for AI transcription.
//
// Phone photos are often 5–10 MB and rotated via EXIF. Sending the raw file is
// slow to upload and slow for the vision model to read. This decodes with the
// EXIF orientation applied, shrinks the long edge to `maxDim`, and re-encodes as
// JPEG. Any failure returns the original file rather than blocking the upload.

async function decodePhoto(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Older Safari / unsupported format — fall through to an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    // drawImage runs synchronously after load; release the URL on the next tick.
    setTimeout(() => {
      try { URL.revokeObjectURL?.(url); } catch { /* jsdom / unsupported */ }
    }, 0);
  }
}

export async function compressImage(file, { maxDim = 1600, quality = 0.82 } = {}) {
  if (!file || !/^image\//.test(file.type || '')) return file;
  try {
    const source = await decodePhoto(file);
    const srcW = source.width || source.naturalWidth || 0;
    const srcH = source.height || source.naturalHeight || 0;
    if (!srcW || !srcH) return file;

    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    // Already small and not oversized — leave it untouched.
    if (scale === 1 && file.size <= 1.2 * 1024 * 1024) return file;

    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff';           // flatten transparency
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    if (typeof source.close === 'function') source.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;

    const name = `${(file.name || 'photo').replace(/\.[^.]+$/, '')}.jpg`;
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;   // never block the upload because compression failed
  }
}
