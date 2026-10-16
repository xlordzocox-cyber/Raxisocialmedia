import { Application, Container, Graphics, Rectangle, type FederatedPointerEvent } from 'pixi.js';
import type { HQState } from '../domain/hq';
import { getOwnAgent } from '../domain/agents';
import { drawOfficeMap, createZoneLabels, createOfficeFurniture, createStationLights } from './map';
import { AgentSprite } from './agents/AgentSprite';
import { AgentMotion, stationLightKey, syncAgentMotions } from './agents/agentMotion';
import { applyAgentAnimation } from './agents/agentAnimations';
import { zones } from './zones';
import { HandoffEffect } from './effects/HandoffEffect';
import { MemoryArchiveEffect } from './effects/MemoryArchiveEffect';
import { PendingMemoryOrigins } from './effects/memoryOrigins';
import { advanceCameraFocus, clampCamera, zoomAt, type CameraBounds } from './camera';

/** Pixi receives domain snapshots and emits selection intent. No adapter imports. */
export class OfficeScene {
  private app: Application;
  private world = new Container();
  private depthLayer = new Container();
  private effectLayer = new Container();
  private zoneHighlight = new Graphics();
  private stationLights = createStationLights();
  private sprites = new Map<string, AgentSprite>();
  private motions = new Map<string, AgentMotion>();
  private hoveredAgentId?: string;
  private effects: (HandoffEffect | MemoryArchiveEffect)[] = [];
  private seen = new Set<string>();
  private memoryOrigins = new PendingMemoryOrigins();
  private state?: HQState;
  private elapsed = 0;
  private resizeObserver: ResizeObserver;
  private fitScale = 1;
  private drag?: { x: number; y: number };
  private canvas: HTMLCanvasElement;
  private focusTarget?: { x: number; y: number };
  private focusCriticalEvents = false;
  private highlightUntil = 0;

  constructor(private host: HTMLElement, onSelect: (id: string) => void, private onHover: (id?: string) => void = () => {}, private onZoom: (percent: number) => void = () => {}) {
    this.app = new Application({ backgroundColor: 0x090d18, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
    const canvas = this.app.view as HTMLCanvasElement;
    this.canvas=canvas;
    canvas.setAttribute('aria-label', 'Raxi HQ Office — selecciona un agente');
    this.host.appendChild(canvas);
    this.app.stage.addChild(this.world);
    const floor = new Graphics();
    drawOfficeMap(floor);
    this.world.addChild(floor, ...createZoneLabels());
    this.depthLayer.sortableChildren=true;
    this.depthLayer.addChild(...createOfficeFurniture(),...this.stationLights.values());
    this.world.addChild(this.depthLayer,this.zoneHighlight,this.effectLayer);
    this.app.stage.eventMode='static';
    this.app.stage.on('pointerdown',(event:FederatedPointerEvent)=>{ this.focusTarget=undefined; this.drag={x:event.global.x,y:event.global.y}; canvas.style.cursor='grabbing'; });
    this.app.stage.on('pointermove',(event:FederatedPointerEvent)=>{
      if(!this.drag) return;
      this.world.x+=event.global.x-this.drag.x; this.world.y+=event.global.y-this.drag.y;
      this.drag={x:event.global.x,y:event.global.y}; this.constrainCamera();
    });
    const endDrag=()=>{ this.drag=undefined; canvas.style.cursor='grab'; };
    this.app.stage.on('pointerup',endDrag).on('pointerupoutside',endDrag);
    canvas.style.cursor='grab'; canvas.style.touchAction='none';
    canvas.addEventListener('wheel',this.handleWheel,{passive:false});
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.app.ticker.add(() => this.tick(this.app.ticker.deltaMS));
    this.onSelect = onSelect;
  }

  private onSelect: (id: string) => void;

  private bindAgentEvents(sprite: AgentSprite, id: string): void {
    sprite.on('pointertap', () => this.onSelect(id));
    sprite.on('pointerover',()=>{ sprite.setHovered(true); this.hoveredAgentId=id; this.onHover(id); });
    sprite.on('pointerout',()=>{ sprite.setHovered(false); if (this.hoveredAgentId === id) { this.hoveredAgentId=undefined; this.onHover(); } });
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.app.renderer.resize(width, height);
    this.app.stage.hitArea=new Rectangle(0,0,width,height);
    this.fitScale=Math.min(width/1040,height/700);
    this.resetCamera();
  }

  resetCamera():void {
    this.focusTarget=undefined;
    const {width,height}=this.app.screen;
    const scale=this.fitScale*1.05;
    this.world.scale.set(scale);
    this.world.position.set((width-1040*scale)/2,(height-700*scale)/2+65*scale);
    this.constrainCamera();
    this.onZoom(105);
  }
  setCriticalEventFocus(enabled:boolean):void { this.focusCriticalEvents=enabled; if(!enabled) this.focusTarget=undefined; }
  zoom(factor:number,x=this.app.screen.width/2,y=this.app.screen.height/2):void {
    this.focusTarget=undefined;
    zoomAt(this.world,factor,x,y,this.fitScale*0.8,this.fitScale*2.8);
    this.constrainCamera(); this.onZoom(Math.round(this.world.scale.x/this.fitScale*100));
  }
  private handleWheel=(event:WheelEvent):void=>{
    event.preventDefault();
    const rect=this.canvas.getBoundingClientRect();
    this.zoom(Math.exp(-event.deltaY*0.001),event.clientX-rect.left,event.clientY-rect.top);
  };
  private cameraBounds():CameraBounds {
    const s=this.world.scale.x,{width,height}=this.app.screen;
    // Keep at least a map edge visible; limit panning independently on each axis.
    const minX=Math.min(width-1040*s-40,40),maxX=Math.max(40,width-1040*s+40);
    const minY=Math.min(height-635*s-40,40),maxY=Math.max(65*s+40,height-635*s+40);
    return {minX,maxX,minY,maxY};
  }
  private constrainCamera():void {
    clampCamera(this.world,this.cameraBounds());
  }

  update(state: HQState): void {
    if ((this.state && state.mode !== this.state.mode) ||
        (state.mode === 'MOCK' && state.events.length === 0 && this.state?.events.length)) this.reset();
    this.state = state;
    for (const [id,sprite] of this.sprites) {
      if (getOwnAgent(state.agents,id)) continue;
      if (this.hoveredAgentId === id) { this.hoveredAgentId = undefined; this.onHover(); }
      sprite.destroy({ children: true });
      this.sprites.delete(id);
      this.motions.delete(id);
    }
    const orderedAgents = syncAgentMotions(Object.values(state.agents), this.motions, state.mode === 'LIVE_READ_ONLY');
    orderedAgents.forEach((agent) => {
      let sprite = this.sprites.get(agent.id);
      if (!sprite) {
        sprite = new AgentSprite(agent.id, agent, zones[agent.zone].accent);
        this.bindAgentEvents(sprite,agent.id);
        this.depthLayer.addChild(sprite);
        this.sprites.set(agent.id, sprite);
      }
      sprite.updateAgent(agent);
      sprite.setSelected(state.selectedAgentId === agent.id);
    });
    for (const event of [...state.events].reverse()) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      if (event.type === 'MEMORY_SAVE_REQUESTED') {
        const origin=this.motions.get(event.actorId ?? '')?.position ?? zones[getOwnAgent(state.agents,event.actorId)?.zone ?? 'WAR_ROOM'].anchor;
        this.memoryOrigins.remember(event,origin);
      }
      if (event.type === 'MEMORY_ARCHIVED') {
        const fallback=this.motions.get(event.actorId ?? '')?.position ?? zones[getOwnAgent(state.agents,event.actorId)?.zone ?? 'WAR_ROOM'].anchor;
        const from=this.memoryOrigins.consume(event,fallback);
        if (event.verified) {
          this.addEffect(new MemoryArchiveEffect(from,zones.SUPERMEMORY_CORE.anchor));
          this.highlight('SUPERMEMORY_CORE',true);
        }
      }
      if (['HANDOFF_SENT', 'ASSET_RECEIVED'].includes(event.type) && event.actorId && event.targetId) {
        const from = this.motions.get(event.actorId)?.position;
        const to = this.motions.get(event.targetId)?.position;
        if (from && to) {
          this.sprites.get(event.actorId)?.beginHandoff(this.elapsed);
          this.sprites.get(event.targetId)?.beginHandoff(this.elapsed);
          this.addEffect(new HandoffEffect(event.actorId, event.targetId, { ...from }, { ...to }));
          this.highlight(getOwnAgent(state.agents,event.targetId)?.zone ?? 'WAR_ROOM',false);
        }
      }
      if(event.type==='AGENT_BLOCKED') this.highlight(getOwnAgent(state.agents,event.actorId)?.zone ?? 'WAR_ROOM',true);
    }
  }

  private highlight(zoneId: keyof typeof zones, critical:boolean):void {
    const zone=zones[zoneId];
    this.zoneHighlight.clear().lineStyle(3,zone.accent,0.75).drawPolygon([
      zone.anchor.x-117,zone.anchor.y+34,zone.anchor.x,zone.anchor.y-34,
      zone.anchor.x+117,zone.anchor.y+34,zone.anchor.x,zone.anchor.y+101,
    ]);
    this.highlightUntil=this.elapsed+1600;
    if(critical && this.focusCriticalEvents && !this.drag) {
      this.focusTarget={x:this.app.screen.width/2-zone.anchor.x*this.world.scale.x,y:this.app.screen.height/2-zone.anchor.y*this.world.scale.y};
    }
  }

  private addEffect(effect: HandoffEffect | MemoryArchiveEffect): void {
    this.effects.push(effect);
    this.effectLayer.addChild(effect);
  }

  private tick(deltaMs: number): void {
    this.elapsed += deltaMs;
    if(this.focusTarget) {
      if(!advanceCameraFocus(this.world,this.focusTarget,this.cameraBounds(),deltaMs)) this.focusTarget=undefined;
    }
    this.zoneHighlight.alpha=Math.max(0,Math.min(1,(this.highlightUntil-this.elapsed)/500));
    for(const light of this.stationLights.values()) light.alpha=0;
    for (const [id, motion] of this.motions) {
      const previousX=motion.position.x;
      motion.update(deltaMs);
      const sprite = this.sprites.get(id)!;
      const handoff=this.effects.find((effect):effect is HandoffEffect=>effect instanceof HandoffEffect && (effect.senderId===id || effect.receiverId===id));
      const offset=handoff ? (handoff.senderId===id ? handoff.frame.senderOffset : handoff.frame.receiverOffset) : {x:0,y:0};
      sprite.position.set(motion.position.x+offset.x,motion.position.y+offset.y);
      sprite.zIndex=sprite.y;
      sprite.faceMovement(motion.position.x-previousX);
      const agent = this.state ? getOwnAgent(this.state.agents,id) : undefined;
      if (agent) {
        applyAgentAnimation(sprite, motion.walking ? 'WALKING' : agent.status === 'WALKING' ? 'IDLE' : agent.status, this.elapsed);
        if(['RUNNING','WORKING','RESEARCHING','QA'].includes(agent.status)) {
          const key=stationLightKey(agent,motion,this.state?.mode === 'LIVE_READ_ONLY');
          const light=key ? this.stationLights.get(key) : undefined;
          if(light) light.alpha=0.52+Math.sin(this.elapsed*0.006)*0.12;
        }
      }
    }
    this.depthLayer.sortChildren();
    this.effects = this.effects.filter((effect) => {
      if (!effect.update(deltaMs)) return true;
      effect.destroy({ children: true });
      return false;
    });
  }

  private reset(): void {
    this.hoveredAgentId=undefined;
    this.onHover();
    for (const sprite of this.sprites.values()) sprite.destroy({ children: true });
    for (const effect of this.effects) effect.destroy({ children: true });
    this.sprites.clear(); this.motions.clear(); this.seen.clear(); this.memoryOrigins.clear(); this.effects = [];
    this.zoneHighlight.clear(); this.highlightUntil=0; this.focusTarget=undefined;
    for(const light of this.stationLights.values()) light.alpha=0;
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('wheel',this.handleWheel);
    this.app.destroy(true, { children: true });
  }
}
