export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "--:--";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function streamUrl(videoId: number): string {
  return `/api/stream/${videoId}`;
}

// Deterministic, moody poster palette derived from the video id — the library
// has no thumbnails yet, so each title gets a signature duotone wash.
export function posterTone(seed: number): { from: string; to: string; ink: string } {
  const tones = [
    { from: "#3d2b1f", to: "#161009", ink: "#f2a33c" },
    { from: "#1f2e3d", to: "#0a1218", ink: "#7db6e8" },
    { from: "#2c2338", to: "#100b16", ink: "#b99df0" },
    { from: "#1d3328", to: "#0a140e", ink: "#7dd8a6" },
    { from: "#3d2020", to: "#160a0a", ink: "#f08a80" },
    { from: "#33301d", to: "#141208", ink: "#e8d37d" },
  ];
  return tones[Math.abs(seed) % tones.length];
}
