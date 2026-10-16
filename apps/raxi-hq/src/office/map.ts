import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { stationCapacity, zoneOrder, zones, type Zone } from './zones';

// Original procedural artwork. Dimensions use screen-space isometric projection.
function polygon(g: Graphics, points: number[], color: number, alpha = 1): void {
  g.lineStyle(0).beginFill(color, alpha).drawPolygon(points).endFill();
}
export function box(g: Graphics, x: number, y: number, w: number, d: number, h: number, top: number, side = 0x253345): void {
  polygon(g,[x-w/2,y,x,y+d/2,x,y+d/2-h,x-w/2,y-h],side);
  polygon(g,[x,y+d/2,x+w/2,y,x+w/2,y-h,x,y+d/2-h],0x192434);
  polygon(g,[x,y-d/2-h,x+w/2,y-h,x,y+d/2-h,x-w/2,y-h],top);
}
function shadow(g:Graphics,x:number,y:number,rx:number,ry:number):void {
  g.lineStyle(0);
  for(let i=3;i>0;i--) g.beginFill(0x02050d,0.06).drawEllipse(x,y,rx+i*3,ry+i*2).endFill();
}
function prop(x:number,y:number,draw:(g:Graphics)=>void):Container {
  const c=new Container(); c.position.set(x,y); c.zIndex=y;
  const g=new Graphics(); draw(g); c.addChild(g); return c;
}
function station(x:number,y:number,accent:number,kind:string):Container[] {
  // Exact v0.2 seat endpoint (x,y); a desk sits behind it, not in front of the room.
  const desk=prop(x,y-12,g=>{
    shadow(g,0,3,26,11); box(g,0,0,48,24,15,0x536477);
    g.lineStyle(2,0x899daf,0.4).moveTo(-22,-15).lineTo(0,-3).lineTo(22,-15);
    g.lineStyle(2,0x111b2b).beginFill(0x101927).drawRoundedRect(-15,-38,28,21,3).endFill();
    g.lineStyle(0).beginFill(accent,0.13).drawRect(-12,-35,22,15).endFill();
    g.lineStyle(1,accent,0.9);
    if(kind==='ARIA_LINK') g.drawRect(-9,-32,8,9).moveTo(1,-25).lineTo(7,-31).lineTo(9,-24);
    else if(kind==='PUBLISHING') {
      for(let i=0;i<3;i++) g.moveTo(-9+i*6,-32).lineTo(-9+i*6,-23);
      g.moveTo(-10,-28).lineTo(8,-28);
    } else for(let i=0;i<3;i++) g.moveTo(-9,-32+i*4).lineTo(6-i*3,-32+i*4);
    g.lineStyle(0).beginFill(0x93a5b7).drawRect(-3,-17,4,4).drawRect(-8,-14,14,2).endFill();
    polygon(g,[-12,-7,0,-1,10,-6,-1,-11],0x1b2639);
    g.beginFill(0xe8ddcf).drawRoundedRect(16,-18,6,8,2).endFill();
    g.lineStyle(1,0xe8ddcf).drawCircle(23,-14,2);
  });
  const chair=prop(x,y+2,g=>{
    shadow(g,0,0,11,5); box(g,0,-1,18,11,6,0x30455b);
    g.lineStyle(2,0x162132).beginFill(0x263950).drawRoundedRect(-7,-13,14,12,4).endFill();
    g.lineStyle(1,accent,0.45).moveTo(-5,-10).lineTo(5,-10);
  });
  return [desk,chair];
}
function plant(x:number,y:number):Container {
  return prop(x,y,g=>{
    shadow(g,0,0,9,4); box(g,0,0,14,10,12,0x8796ab);
    g.lineStyle(2,0x34664d).moveTo(0,-12).lineTo(0,-30);
    g.lineStyle(0).beginFill(0x55a384).drawEllipse(-5,-24,6,3).drawEllipse(5,-28,6,3).drawEllipse(-3,-33,4,5).endFill();
  });
}
function wallDisplay(z:Zone):Container {
  return prop(z.anchor.x-33,z.anchor.y-4,g=>{
    g.lineStyle(2,0x41526c).beginFill(0x0b1627).drawRoundedRect(-32,-44,64,31,3).endFill();
    g.lineStyle(1,z.accent,0.65);
    if(z.id==='WAR_ROOM') {
      for(let i=0;i<3;i++) g.drawRect(-25+i*17,-37,12,17).moveTo(-23+i*17,-33).lineTo(-17+i*17,-33);
    } else if(z.id==='RESEARCH_LAB') g.moveTo(-25,-21).lineTo(-16,-27).lineTo(-7,-24).lineTo(3,-35).lineTo(15,-29).lineTo(25,-37);
    else if(z.id==='QA_LAB') {
      for(let i=0;i<3;i++) g.moveTo(-23,-36+i*7).lineTo(-20,-33+i*7).lineTo(-16,-38+i*7).moveTo(-10,-35+i*7).lineTo(22,-35+i*7);
    } else g.drawRect(-24,-37,24,16).moveTo(6,-35).lineTo(23,-35).moveTo(6,-29).lineTo(18,-29).moveTo(6,-23).lineTo(21,-23);
  });
}
function rack(x:number,y:number,accent:number):Container {
  return prop(x,y,g=>{
    shadow(g,0,0,16,7); box(g,0,0,27,18,44,0x53617e);
    for(let i=0;i<4;i++) {
      g.lineStyle(1,0x59718e).beginFill(0x132137).drawRect(-10,-39+i*8,15,6).endFill();
      g.lineStyle(0).beginFill(accent,0.9).drawCircle(1,-36+i*8,1).endFill();
    }
  });
}
export function drawOfficeMap(g:Graphics):void {
  g.clear(); box(g,520,310,940,560,10,0x111c2b,0x080f1c);
  const paths=[['SUPERMEMORY_CORE','WAR_ROOM'],['RESEARCH_LAB','WAR_ROOM'],['WAR_ROOM','ARIA_LINK'],['RESEARCH_LAB','QA_LAB'],['WAR_ROOM','GITHUB_HUB'],['ARIA_LINK','PUBLISHING'],['QA_LAB','GITHUB_HUB'],['GITHUB_HUB','PUBLISHING']] as const;
  for(const [a,b] of paths) {
    const from=zones[a].entrances[0],to=zones[b].entrances[0];
    g.lineStyle(38,0x070d19,0.95).moveTo(from.x,from.y+5).lineTo(to.x,to.y+5);
    g.lineStyle(34,0x3c5067,0.95).moveTo(from.x,from.y).lineTo(to.x,to.y);
    g.lineStyle(28,0x24354b,1).moveTo(from.x,from.y).lineTo(to.x,to.y);
    const length=Math.hypot(to.x-from.x,to.y-from.y);
    for(let at=8;at<length-8;at+=18) {
      const p=at/length,px=from.x+(to.x-from.x)*p,py=from.y+(to.y-from.y)*p;
      g.lineStyle(2,0xb6c8db,0.24).moveTo(px-3,py-2).lineTo(px+3,py+2);
    }
    g.lineStyle(2,zones[a].accent,0.31).moveTo(from.x,from.y-11).lineTo(to.x,to.y-11);
  }
  for(const id of zoneOrder) {
    const z=zones[id],{x,y}=z.anchor; shadow(g,x,y+45,120,66);
    box(g,x,y+35,244,144,9,id==='SUPERMEMORY_CORE'?0x272542:0x293347);
    polygon(g,[x-122,y+35,x,y-37,x,y-93,x-122,y-21],0x34425a);
    polygon(g,[x,y-37,x+122,y+35,x+122,y-21,x,y-93],0x24334a);
    g.lineStyle(3,z.accent,0.55).moveTo(x-122,y-21).lineTo(x,y-93).lineTo(x+122,y-21);
    g.lineStyle(1,0x62728a,0.27);
    for(let i=1;i<5;i++) {
      const p=i/5;
      g.moveTo(x-122+p*122,y+35-p*72).lineTo(x+p*122,y+107-p*72);
      g.moveTo(x+p*122,y-37+p*72).lineTo(x-122+p*122,y+35+p*72);
    }
    g.lineStyle(2,z.accent,0.18).moveTo(x-116,y+34).lineTo(x,y+102).lineTo(x+116,y+34);
    polygon(g,[x-55,y+30,x,y,x+55,y+30,x,y+60],z.accent,0.06);
  }
}
export function createZoneLabels():Text[] {
  return zoneOrder.map(id=>{
    const z=zones[id]; const label=new Text(z.label.toUpperCase(),new TextStyle({fill:0xc7d9eb,fontFamily:'Segoe UI, sans-serif',fontSize:10,fontWeight:'700',letterSpacing:1.3}));
    label.anchor.set(0.5); label.position.set(z.anchor.x,z.anchor.y-65); return label;
  });
}
export function createOfficeFurniture():Container[] {
  const props:Container[]=[];
  for(const id of zoneOrder) {
    const z=zones[id],{x,y}=z.anchor; props.push(wallDisplay(z),plant(x+92,y+32));
    for(let slot=0;slot<stationCapacity(id);slot++) {
      const p=z.workPoints[slot%z.workPoints.length],row=Math.floor(slot/z.workPoints.length)%2;
      props.push(...station(p.x+row*26,p.y+row*32,z.accent,id));
    }
    if(id==='GITHUB_HUB') props.push(rack(x+66,y+15,z.accent),rack(x+89,y+5,0xb68cff));
    if(id==='RESEARCH_LAB') props.push(prop(x+50,y+13,g=>{
      box(g,0,0,45,20,24,0x65778b);
      for(let i=0;i<4;i++) g.beginFill([0x35e7ff,0xb68cff,0x8aaac2,0xffc857][i]).drawRect(-16+i*8,-22,5,15).endFill();
    }));
    if(id==='ARIA_LINK') props.push(prop(x+66,y+6,g=>{
      shadow(g,0,0,12,6); g.lineStyle(2,0x9bb0c6).moveTo(0,0).lineTo(0,-41).moveTo(-8,0).lineTo(0,-10).lineTo(8,0);
      g.lineStyle(4,0xffd7ee,0.9).drawCircle(0,-44,12); g.lineStyle(8,z.accent,0.08).drawCircle(0,-44,16);
    }));
    if(id==='QA_LAB') props.push(prop(x+60,y+13,g=>{
      box(g,0,0,35,18,20,0x66788b); g.lineStyle(2,0x5be39a).moveTo(-8,-26).lineTo(-2,-21).lineTo(8,-33);
    }));
    if(id==='PUBLISHING') props.push(prop(x+58,y+16,g=>{
      box(g,0,0,40,23,21,0x536b87); polygon(g,[-14,-27,0,-20,15,-27,0,-34],0xcee1f0);
      g.lineStyle(1,0x8cb7ff).moveTo(-7,-27).lineTo(1,-23).moveTo(-2,-29).lineTo(7,-25);
    }));
    if(id==='WAR_ROOM') props.push(prop(x+25,y+11,g=>{
      shadow(g,0,3,16,8); box(g,0,0,27,17,19,0xa18069); g.beginFill(0xd1b69a).drawCircle(0,-19,3).endFill();
    }));
    if(id==='SUPERMEMORY_CORE') {
      props.push(rack(x-62,y+5,0xb68cff),rack(x+64,y+5,0x35e7ff));
      props.push(prop(x,y+8,g=>{
        shadow(g,0,0,22,9); box(g,0,0,42,25,20,0x495279);
        polygon(g,[0,-58,15,-43,0,-27,-15,-43],0x9783e5,0.75); polygon(g,[0,-58,0,-27,-15,-43],0x35e7ff,0.55);
        g.lineStyle(1,0xd6c8ff,0.8).drawPolygon([0,-58,15,-43,0,-27,-15,-43]); g.lineStyle(2,0xb68cff,0.2).drawEllipse(0,-18,29,11);
      }));
    }
  }
  return props;
}

/** Lights are keyed by the same zone/slot coordinates as AgentMotion. */
export function createStationLights():Map<string,Graphics> {
  const lights=new Map<string,Graphics>();
  for(const id of zoneOrder) {
    const z=zones[id];
    for(let slot=0;slot<stationCapacity(id);slot++) {
      const p=z.workPoints[slot%z.workPoints.length],row=Math.floor(slot/z.workPoints.length)%2;
      const light=new Graphics();
      light.position.set(p.x+row*26,p.y+row*32-12);
      light.zIndex=light.y+0.5;
      light.beginFill(z.accent,0.42).drawRoundedRect(-12,-35,22,15,2).endFill();
      light.lineStyle(2,z.accent,0.55).drawRoundedRect(-13,-36,24,17,3);
      light.alpha=0;
      lights.set(`${id}:${slot}`,light);
    }
  }
  return lights;
}
