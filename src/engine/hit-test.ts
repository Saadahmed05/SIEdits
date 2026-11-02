/** Hit testing for drawn elements. Boxes rotate around the element's anchor, not their centre. */
import type { ElementBox } from './types';

/** Whether a point in project pixels is inside the box, allowing for its rotation. */
export function boxContains(box: ElementBox, x: number, y: number): boolean {
  const angle = (-box.rotation * Math.PI) / 180;
  const dx = x - box.anchorX;
  const dy = y - box.anchorY;
  const px = box.anchorX + dx * Math.cos(angle) - dy * Math.sin(angle);
  const py = box.anchorY + dx * Math.sin(angle) + dy * Math.cos(angle);
  return px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height;
}

/** The element under a point. Prefers the smallest box, so small elements win over full-frame ones. */
export function pickElement(boxes: readonly ElementBox[], x: number, y: number): ElementBox | undefined {
  return boxes.filter((b) => boxContains(b, x, y)).sort((a, b) => a.width * a.height - b.width * b.height)[0];
}
