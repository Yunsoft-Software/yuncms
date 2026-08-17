const IMAGE_EXTENSIONS = new Set([
  'avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp',
]);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);

function fileExtension(file) {
  const name = file?.filename_download || '';
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function filePreviewKind(file) {
  const mimetype = String(file?.mimetype || '').toLowerCase();
  const extension = fileExtension(file);
  if (mimetype.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (mimetype === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mimetype.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (mimetype.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) return 'audio';
  return 'placeholder';
}

export function isPreviewableImage(file) {
  return filePreviewKind(file) === 'image';
}
