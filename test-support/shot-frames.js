export function frames() {
  return Array.from({ length: 25 }, (_, index) => {
    const time = index / 12;
    const extension = Math.min(1, time);
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
    for (const [s,e,w,h,k,a] of [[11,13,15,23,25,27],[12,14,16,24,26,28]]) {
      landmarks[s] = { x: 0.5, y: 0.35, visibility: 0.99 };
      landmarks[e] = { x: 0.58, y: 0.35 - 0.12 * extension, visibility: 0.99 };
      landmarks[w] = { x: 0.62 - 0.03 * extension, y: 0.44 - 0.38 * extension, visibility: 0.99 };
      landmarks[h] = { x: 0.5, y: 0.6 - 0.04 * extension, visibility: 0.99 };
      landmarks[k] = { x: 0.63 - 0.12 * extension, y: 0.75, visibility: 0.99 };
      landmarks[a] = { x: 0.5, y: 0.95, visibility: 0.99 };
    }
    return { time, landmarks };
  });
}

