// UI-only media-time coordination. No detector rules or persistent records change.
export function createOfflinePosition(video, duration) {
  let target = null, lastSeekTarget = null;
  const ready = () => target === null && video.readyState >= 2 && !video.seeking;
  return {
    ready,
    snapshot: () => ({mediaTime:video.currentTime || 0,displayTime:target ?? (video.currentTime || 0),pendingTarget:target,lastSeekTarget,seeking:video.seeking,readyState:video.readyState}),
    pending: () => target !== null,
    displayTime: () => target ?? (video.currentTime || 0),
    reset: () => { target = null; lastSeekTarget = null; },
    seek(time) {
      if (!Number.isFinite(time)) return;
      video.pause();
      const next = Math.max(0, Math.min(Math.max(0, duration() - .001), time));
      lastSeekTarget = next;
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
export function groupTimelineMarkers(entries, duration, width, selectedKey = null) {
  const groups = [], gap = 44 / Math.max(44, width) * duration;
  for (const entry of [...entries].sort((a,b) => a.time-b.time)) {
    const last = groups.at(-1);
    if (last && entry.time-last[0].time < gap) last.push(entry);
    else groups.push([entry]);
  }
  if(selectedKey) {
    const index=groups.findIndex(group=>group.some(entry=>entry.key===selectedKey));
    if(index>=0) {
      const selected=groups[index].find(entry=>entry.key===selectedKey);
      // The selected circle sits at its real position; absorb neighbors its 44px target would cover.
      while(groups[index+1] && groups[index+1][0].time-selected.time<gap)
        groups[index].push(...groups.splice(index+1,1)[0]);
    }
  }
  return groups;
}
