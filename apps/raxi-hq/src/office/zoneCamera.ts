import type { ZoneId } from '../domain/agents';
import { zoneOrder, zones, type Point } from './zones';

// Exact outer silhouette of the isometric rooms drawn in map.ts.
// This is a camera hit target only; it never selects or starts an agent.
function roomPolygon(center: Point): Point[] {
  const {x,y}=center;
  return [
    {x,y:y-93},{x:x+122,y:y-21},{x:x+122,y:y+35},
    {x,y:y+107},{x:x-122,y:y+35},{x:x-122,y:y-21},
  ];
}

function inPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    // Include a tap directly on a wall or floor edge.
    const cross=(point.y-a.y)*(b.x-a.x)-(point.x-a.x)*(b.y-a.y);
    if(Math.abs(cross)<0.0001 &&
       point.x>=Math.min(a.x,b.x) && point.x<=Math.max(a.x,b.x) &&
       point.y>=Math.min(a.y,b.y) && point.y<=Math.max(a.y,b.y))return true;
    if((a.y>point.y)!==(b.y>point.y) &&
       point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}

/** A user-selected zone is a visual camera target, never an execution source. */
export function officeZoneAtPoint(point: Point): ZoneId | undefined {
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return undefined;
  let best:ZoneId|undefined;
  let distance=Infinity;
  for(const id of zoneOrder){
    const anchor=zones[id].anchor;
    if(!inPolygon(point,roomPolygon(anchor)))continue;
    const score=((point.x-anchor.x)/122)**2+((point.y-anchor.y)/105)**2;
    if(score<distance){best=id;distance=score;}
  }
  return best;
}

/** Relative zoom is deliberately capped by the same camera limits as manual zoom. */
export function officeZoneZoomFactor(viewportWidth:number):number {
  return Number.isFinite(viewportWidth)&&viewportWidth<=600?2.4:1.85;
}
