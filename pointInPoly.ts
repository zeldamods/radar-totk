import { Position, Polygon, Feature, FeatureCollection } from 'GeoJSON';

type PointXY = {
  x: number,
  y: number
};

// Check is a point (x,y,z) is contained within a polygon's bounding box
//   Bounding box is defined in properties (xmin, xmax, zmin, zmax)
function isPointInsideBoundingBox(poly: Feature, pt: Position): boolean {
  let prop = poly.properties;
  if (!prop) {
    return true;
  }
  /*
  console.log(pt[0], prop.xmin, prop.xmax);
  console.log(pt[2], prop.zmin, prop.zmax);
  console.log(((prop.xmin && pt[0] >= prop.xmin) ||
    (prop.zmin && pt[2] >= prop.zmin) ||
    (prop.xmax && pt[0] <= prop.xmax) ||
    (prop.zmax && pt[2] <= prop.zmax)))
    */
  return ((prop.xmin && pt[0] >= prop.xmin) ||
    (prop.zmin && pt[2] >= prop.zmin) ||
    (prop.xmax && pt[0] <= prop.xmax) ||
    (prop.zmax && pt[2] <= prop.zmax));
}

// Check is a point (x,y,z) is contained within a polygon
//   The bounding box is first checked then the polygon is checked
function isPointInsidePolygon(poly: Feature, pt: Position): boolean {
  const geom = poly.geometry as Polygon;
  return isPointInsideBoundingBox(poly, pt) && isPointInsidePolygonRCA(pt, geom.coordinates[0]);
}

// Check if a point is within a polygon (pts)
//  https://en.wikipedia.org/wiki/Point_in_polygon#Ray_casting_algorithm
function isPointInsidePolygonRCA(point: Position, pts: Position[]) {
  let n = pts.length;
  let xp = point[0];
  let yp = point[2];
  let xv: any = pts.map((p: any) => p[0]);
  let yv: any = pts.map((p: any) => p[1]);

  if (Math.abs(xv[0] - xv[n - 1]) < 1e-7 && Math.abs(yv[0] - yv[n - 1]) < 1e-7) {
    n -= 1;
  }
  let x2 = xv[n - 1]
  let y2 = yv[n - 1]
  let nleft = 0

  let x1 = x2;
  let y1 = y2;

  // Loop over line segments (assuming the polygon is closed)
  for (let i = 0; i < n; i++) {
    x1 = x2
    y1 = y2
    x2 = xv[i]
    y2 = yv[i]
    if (y1 >= yp && y2 >= yp) {
      continue;
    }
    if (y1 < yp && y2 < yp) {
      continue;
    }
    if (y1 == y2) {
      if (x1 >= xp && x2 >= xp) {
        continue;
      }
      if (x1 < xp && x2 < xp) {
        continue;
      }
      nleft += 1;
    } else {
      let xi = x1 + (yp - y1) * (x2 - x1) / (y2 - y1);
      if (xi == xp) {
        nleft = 1;
        break;
      }
      if (xi > xp) {
        nleft += 1;
      }
    }
  }
  let xin = nleft % 2;
  return xin == 1;
}

// Test all polygons (polys) if a point lies in any
//    polygons are assumed to be in GeoJSON format and have:
//      - a priority where overlapping polygons with higher priority are chosen
//    Returns all found polygons or [] in the case of no match
export function findPolygon(p: Position, polys: FeatureCollection) {
  let found = [];
  for (let j = 0; j < polys.features.length; j++) {
    const poly = polys.features[j];
    if (isPointInsidePolygon(poly, p)) {
      found.push(j);
    }
  }
  return found;
}

function vlen2(p: Position) {
  return p[0] * p[0] + p[1] * p[1]
}
function vlen(p: Position) {
  return Math.sqrt(vlen2(p))
}

function pointLineDist(p: Position, p1: Position, p2: Position) {
  const x1 = p1[0];
  const y1 = p1[1];
  const x2 = p2[0];
  const y2 = p2[1];
  const x0 = p[0];
  const y0 = p[2];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const numer = Math.abs(dx * (y1 - y0) - (x1 - x0) * dy);
  const denom = Math.sqrt(dx * dx + dy * dy);
  return numer / denom;
}

function sqr(x: number) { return x * x }
function dist2(v: PointXY, w: PointXY) { return sqr(v.x - w.x) + sqr(v.y - w.y) }
function distToSegmentSquared(p: PointXY, v: PointXY, w: PointXY) {
  var l2 = dist2(v, w);
  if (l2 == 0) return dist2(p, v);
  var t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, {
    x: v.x + t * (w.x - v.x),
    y: v.y + t * (w.y - v.y)
  });
}
function distToSegment(p: Position, v: Position, w: Position) {
  return Math.sqrt(distToSegmentSquared({ x: p[0], y: p[2] },
    { x: v[0], y: v[1] },
    { x: w[0], y: w[1] }));
}

function distToPolygon(p: Position, poly: Feature) {
  let minDist = 1e7;
  let geom: Polygon = poly.geometry as Polygon;
  const n = geom.coordinates[0].length;
  for (let i = 0; i < n; i++) {
    const p1 = geom.coordinates[0][i];
    const p2 = geom.coordinates[0][(i + 1) % n];
    const dist = distToSegment(p, p1, p2);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;

}

export function findPolygons(p: Position, polys: FeatureCollection, minDist: number) {
  let out = findPolygon(p, polys);
  console.log('find poly', p);
  if (out.length > 0) {
    return out;
  }
  for (let j = 0; j < polys.features.length; j++) {
    const poly = polys.features[j];
    const dist = distToPolygon(p, poly);
    if (dist < minDist) {
      out.push(j)
    }
  }
  return out;
}


