export interface Point { x: number; y: number }

function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
function same(a: Point, b: Point) { return a.x === b.x && a.y === b.y; }

function bezierPoint(points: Point[], t: number): Point {
  const work = points.map(point => ({ ...point }));
  for (let count = work.length - 1; count > 0; count--) {
    for (let i = 0; i < count; i++) {
      work[i].x += (work[i + 1].x - work[i].x) * t;
      work[i].y += (work[i + 1].y - work[i].y) * t;
    }
  }
  return work[0];
}

function bezier(points: Point[]) {
  const result: Point[] = [];
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    if (i === points.length || same(points[i], points[i - 1])) {
      const segment = points.slice(start, i);
      const steps = Math.max(12, Math.min(120, segment.length * 18));
      for (let step = 0; step <= steps; step++) result.push(bezierPoint(segment, step / steps));
      start = i;
    }
  }
  return result;
}

function circularArc(points: Point[]): Point[] | null {
  if (points.length !== 3) return null;
  const [a, b, c] = points;
  const determinant = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(determinant) < 0.001) return null;
  const asq = a.x * a.x + a.y * a.y;
  const bsq = b.x * b.x + b.y * b.y;
  const csq = c.x * c.x + c.y * c.y;
  const cx = (asq * (b.y - c.y) + bsq * (c.y - a.y) + csq * (a.y - b.y)) / determinant;
  const cy = (asq * (c.x - b.x) + bsq * (a.x - c.x) + csq * (b.x - a.x)) / determinant;
  const start = Math.atan2(a.y - cy, a.x - cx);
  const middle = Math.atan2(b.y - cy, b.x - cx);
  const end = Math.atan2(c.y - cy, c.x - cx);
  const positive = ((middle - start + Math.PI * 2) % (Math.PI * 2)) < ((end - start + Math.PI * 2) % (Math.PI * 2));
  const sweep = positive ? (end - start + Math.PI * 2) % (Math.PI * 2) : -((start - end + Math.PI * 2) % (Math.PI * 2));
  const radius = distance(a, { x: cx, y: cy });
  const steps = Math.max(12, Math.min(180, Math.ceil(Math.abs(sweep) * radius / 3)));
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: cx + radius * Math.cos(start + sweep * i / steps),
    y: cy + radius * Math.sin(start + sweep * i / steps),
  }));
}

function catmull(points: Point[]) {
  const result: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let step = 0; step <= 24; step++) {
      const t = step / 24, t2 = t * t, t3 = t2 * t;
      const axis = (v0: number, v1: number, v2: number, v3: number) =>
        0.5 * ((2 * v1) + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
      result.push({ x: axis(p0.x, p1.x, p2.x, p3.x), y: axis(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return result;
}

export function sliderPath(kind: string, anchors: Point[], pixelLength: number): Point[] {
  if (anchors.length < 2 || !Number.isFinite(pixelLength) || pixelLength <= 0) return anchors;
  const raw = kind === 'L' ? anchors
    : kind === 'P' ? circularArc(anchors) ?? bezier(anchors)
    : kind === 'C' ? catmull(anchors)
    : bezier(anchors);
  const result = [raw[0]];
  let length = 0;
  for (const point of raw.slice(1)) {
    const previous = result[result.length - 1];
    const segment = distance(previous, point);
    if (segment < 0.001) continue;
    if (length + segment >= pixelLength) {
      const fraction = (pixelLength - length) / segment;
      result.push({ x: previous.x + (point.x - previous.x) * fraction, y: previous.y + (point.y - previous.y) * fraction });
      return result;
    }
    result.push(point);
    length += segment;
  }
  if (result.length >= 2 && length < pixelLength) {
    const end = result[result.length - 1], before = result[result.length - 2];
    const segment = distance(before, end);
    if (segment > 0) result.push({ x: end.x + (end.x - before.x) * (pixelLength - length) / segment, y: end.y + (end.y - before.y) * (pixelLength - length) / segment });
  }
  return result;
}

export function pointOnPath(path: Point[], progress: number): Point {
  if (!path.length) return { x: 0, y: 0 };
  if (path.length === 1 || progress <= 0) return path[0];
  if (progress >= 1) return path[path.length - 1];
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distance(path[i - 1], path[i]);
  let target = total * progress;
  for (let i = 1; i < path.length; i++) {
    const segment = distance(path[i - 1], path[i]);
    if (target <= segment) {
      const fraction = segment ? target / segment : 0;
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * fraction, y: path[i - 1].y + (path[i].y - path[i - 1].y) * fraction };
    }
    target -= segment;
  }
  return path[path.length - 1];
}
