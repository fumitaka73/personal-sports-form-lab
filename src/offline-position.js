// UI-only media-time coordination. No detector rules or persistent records change.
export function createOfflinePosition(video, duration) {
  let target = null;
  const ready = () => target === null && video.readyState >= 2 && !video.seeking;
  return {
    ready,
    pending: () => target !== null,
    displayTime: () => target ?? (video.currentTime || 0),
    reset: () => { target = null; },
    seek(time) {
      if (!Number.isFinite(time)) return;
      video.pause();
      const next = Math.max(0, Math.min(Math.max(0, duration() - .001), time));
      if (Math.abs(video.currentTime - next) < .001 && !video.seeking) {
        target = null;
        return;
      }
      // Set before touching currentTime: Safari can queue media events after this handler.
      target = next;
      try { video.currentTime = next; } catch (error) { target = null; throw error; }
    },
    settle() {
      // A seeked event for an older request must not unlock a newer seek.
      if (target !== null && !video.seeking &&
          Math.abs(video.currentTime - target) < .05) target = null;
      return ready();
    },
  };
}

// Nearby markers share a 44px target; tapping the group exposes individually labelled choices.
export function groupTimelineMarkers(entries, duration, width) {
  const groups = [], gap = 44 / Math.max(44, width) * duration;
  for (const entry of [...entries].sort((a,b) => a.time-b.time)) {
    const last = groups.at(-1);
    if (last && entry.time-last[0].time < gap) last.push(entry);
    else groups.push([entry]);
  }
  return groups;
}
