import { Application, Container, Graphics, Rectangle, type FederatedPointerEvent } from 'pixi.js';
import type { HQState } from '../domain/hq';
import { drawOfficeMap, createZoneLabels, createOfficeFurniture } from './map';
import { AgentSprite } from './agents/AgentSprite';
import { AgentMotion } from './agents/agentMotion';
import { applyAgentAnimation } from './agents/agentAnimations';
import { zones } from './zones';
import { HandoffEffect } from './effects/HandoffEffect';
import { MemoryArchiveEffect } from './effects/MemoryArchiveEffect';
import { clampCamera, zoomAt } from './camera';

/** Pixi receives domain snapshots and emits selection intent. No adapter imports. */
export class OfficeScene {
  private app: Application;
  private world = new Container();
  private depthLayer = new Container();
  private effectLayer = new Container();
  private sprites = new Map<string, AgentSprite>();
  private motions = new Map<string, AgentMotion>();
  private effects: (HandoffEffect | MemoryArchiveEffect)[] = [];
  private seen = new Set<string>();
  private state?: HQState;
  private elapsed = 0;
  private resizeObserver: ResizeObserver;
  private fitScale = 1;
  private drag?: { x: number; y: number };
  private canvas: HTMLCanvasElement;

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
    this.depthLayer.addChild(...createOfficeFurniture());
    this.world.addChild(this.depthLayer,this.effectLayer);
    this.app.stage.eventMode='static';
    this.app.stage.on('pointerdown',(event:FederatedPointerEvent)=>{ this.drag={x:event.global.x,y:event.global.y}; canvas.style.cursor='grabbing'; });
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

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.app.renderer.resize(width, height);
    this.app.stage.hitArea=new Rectangle(0,0,width,height);
    this.fitScale=Math.min(width/1040,height/700);
    this.resetCamera();
  }

  resetCamera():void {
    const {width,height}=this.app.screen;
    this.world.scale.set(this.fitScale);
    this.world.position.set((width-1040*this.fitScale)/2,(height-700*this.fitScale)/2+65*this.fitScale);
    this.onZoom(100);
  }
  zoom(factor:number,x=this.app.screen.width/2,y=this.app.screen.height/2):void {
    zoomAt(this.world,factor,x,y,this.fitScale*0.8,this.fitScale*2.8);
    this.constrainCamera(); this.onZoom(Math.round(this.world.scale.x/this.fitScale*100));
  }
  private handleWheel=(event:WheelEvent):void=>{
    event.preventDefault();
    const rect=this.canvas.getBoundingClientRect();
    this.zoom(Math.exp(-event.deltaY*0.001),event.clientX-rect.left,event.clientY-rect.top);
  };
  private constrainCamera():void {
    const s=this.world.scale.x,{width,height}=this.app.screen;
    // Keep at least a map edge visible; limit panning independently on each axis.
    const minX=Math.min(width-1040*s-40,40),maxX=Math.max(40,width-1040*s+40);
    const minY=Math.min(height-635*s-40,40),maxY=Math.max(65*s+40,height-635*s+40);
    clampCamera(this.world,{minX,maxX,minY,maxY});
  }

  update(state: HQState): void {
    if (state.events.length === 0 && this.state?.events.length) this.reset();
    this.state = state;
    const zoneSlots = new Map<string, number>();
    Object.values(state.agents).forEach((agent) => {
      const slot = zoneSlots.get(agent.zone) ?? 0;
      zoneSlots.set(agent.zone, slot + 1);
      let sprite = this.sprites.get(agent.id);
      if (!sprite) {
        sprite = new AgentSprite(agent.id, agent, zones[agent.zone].accent);
        sprite.on('pointertap', () => this.onSelect(agent.id));
        sprite.on('pointerover',()=>{ sprite!.setHovered(true); this.onHover(agent.id); });
        sprite.on('pointerout',()=>{ sprite!.setHovered(false); this.onHover(); });
        this.depthLayer.addChild(sprite);
        this.sprites.set(agent.id, sprite);
        this.motions.set(agent.id, new AgentMotion(agent, slot));
      }
      this.motions.get(agent.id)!.sync(agent);
      sprite.updateAgent(agent);
      sprite.setSelected(state.selectedAgentId === agent.id);
    });
    for (const event of [...state.events].reverse()) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      if (event.type === 'MEMORY_ARCHIVED' && event.verified) {
        this.addEffect(new MemoryArchiveEffect(zones.SUPERMEMORY_CORE.anchor));
      }
      if (['HANDOFF_SENT', 'ASSET_RECEIVED'].includes(event.type) && event.actorId && event.targetId) {
        const from = this.motions.get(event.actorId)?.position;
        const to = this.motions.get(event.targetId)?.position;
        if (from && to) {
          this.sprites.get(event.actorId)?.beginHandoff(this.elapsed);
          this.sprites.get(event.targetId)?.beginHandoff(this.elapsed);
          this.addEffect(new HandoffEffect({ ...from }, { ...to }, 'handoff'));
        }
      }
    }
  }

  private addEffect(effect: HandoffEffect | MemoryArchiveEffect): void {
    this.effects.push(effect);
    this.effectLayer.addChild(effect);
  }

  private tick(deltaMs: number): void {
    this.elapsed += deltaMs;
    for (const [id, motion] of this.motions) {
      const previousX=motion.position.x;
      motion.update(deltaMs);
      const sprite = this.sprites.get(id)!;
      sprite.position.set(motion.position.x, motion.position.y);
      sprite.zIndex=motion.position.y;
      sprite.faceMovement(motion.position.x-previousX);
      const agent = this.state?.agents[id];
      if (agent) applyAgentAnimation(sprite, motion.walking ? 'WALKING' : agent.status === 'WALKING' ? 'IDLE' : agent.status, this.elapsed);
    }
    this.depthLayer.sortChildren();
    this.effects = this.effects.filter((effect) => {
      if (!effect.update(deltaMs)) return true;
      effect.destroy({ children: true });
      return false;
    });
  }

  private reset(): void {
    this.onHover();
    for (const sprite of this.sprites.values()) sprite.destroy({ children: true });
    for (const effect of this.effects) effect.destroy({ children: true });
    this.sprites.clear(); this.motions.clear(); this.seen.clear(); this.effects = [];
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('wheel',this.handleWheel);
    this.app.destroy(true, { children: true });
  }
}
