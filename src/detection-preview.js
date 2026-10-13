export function previewSize(width,height,availableWidth,maxHeight){const ratio=width/height;const w=Math.max(1,Math.min(availableWidth,maxHeight*ratio));return {width:w,height:w/ratio};}
