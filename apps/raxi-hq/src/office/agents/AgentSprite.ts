import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import type { AgentSnapshot, AgentStatus } from '../../domain/agents';
import { getStatusVisual } from './agentVisualState';

const roles:Record<string,{coat:number;hair:number;skin:number;detail:string}>={
  orchestrator:{coat:0xb68cff,hair:0x332940,skin:0xecc5a2,detail:'tie'},
  research:{coat:0x70d6de,hair:0x273647,skin:0xc78c67,detail:'glasses'},
  strategy:{coat:0x7488df,hair:0x704a33,skin:0xf0c7a6,detail:'tablet'},
  creative:{coat:0xff91cd,hair:0x512f68,skin:0xdeaf86,detail:'headset'},
  'visual-qa':{coat:0x7ce3ae,hair:0x313348,skin:0xecc5a2,detail:'clipboard'},
  'editorial-qa':{coat:0xb4d8c8,hair:0x9a633e,skin:0xb77e5b,detail:'glasses'},
  publisher:{coat:0x8cb7ff,hair:0x392d43,skin:0xe6b594,detail:'headset'},
  performance:{coat:0xffc857,hair:0x47352b,skin:0xbd8966,detail:'tablet'},
};

/** Original chibi avatar; root is anchored at feet for stable motion/depth. */
export class AgentSprite extends Container {
  private puppet=new Container();
  private head=new Container();
  private leftArm=new Graphics();
  private rightArm=new Graphics();
  private leftLeg=new Graphics();
  private rightLeg=new Graphics();
  private eyes=new Graphics();
  private statusPip=new Graphics();
  private statusGlyph=new Graphics();
  private activityHalo=new Graphics();
  private selection=new Graphics();
  private nameLabel:Text;
  private bubble:Text;
  private selected=false;
  private hovered=false;
  private handoffUntil=0;
  private handoffShown=false;
  private lastAgent?:AgentSnapshot;
  private direction=1;

  constructor(public readonly agentId:string,agent:AgentSnapshot,accent:number) {
    super();
    this.scale.set(1.13);
    const look=roles[agentId]??{coat:accent,hair:0x354056,skin:0xecc5a2,detail:'tablet'};
    const shadow=new Graphics();
    for(let i=3;i>0;i--) shadow.beginFill(0x02050d,0.1).drawEllipse(0,0,10+i*2,4+i).endFill();
    this.selection.lineStyle(1.5,0x35e7ff,0.9).drawEllipse(0,1,16,7);
    this.leftLeg.beginFill(0x273149).drawRoundedRect(-4,0,7,9,2).endFill().beginFill(0x8999ae).drawRoundedRect(-5,6,9,4,2).endFill();
    this.rightLeg.beginFill(0x273149).drawRoundedRect(-3,0,7,9,2).endFill().beginFill(0x8999ae).drawRoundedRect(-3,6,9,4,2).endFill();
    this.leftLeg.position.set(-5,-10); this.rightLeg.position.set(4,-10);
    const torso=new Graphics();
    torso.beginFill(0x152238).drawRoundedRect(-11,-29,23,22,5).endFill();
    torso.beginFill(look.coat).drawRoundedRect(-10,-28,20,19,4).endFill();
    torso.beginFill(0xffffff,0.16).drawRect(-8,-26,5,14).endFill();
    torso.beginFill(0xeff3fc).drawRoundedRect(2,-24,5,5,1).endFill();
    if(look.detail==='tie') torso.beginFill(0x18283f).drawPolygon([0,-28,3,-21,0,-15,-3,-21]).endFill();
    for(const arm of [this.leftArm,this.rightArm]) {
      arm.beginFill(look.coat).drawRoundedRect(-3,0,7,12,3).endFill();
      arm.beginFill(look.skin).drawRoundedRect(-2,9,6,5,2).endFill();
    }
    this.leftArm.position.set(-12,-26); this.rightArm.position.set(11,-26);
    const face=new Graphics();
    face.beginFill(0x111b2b).drawRoundedRect(-14,-15,28,26,8).endFill();
    face.beginFill(look.skin).drawRoundedRect(-12,-13,24,23,7).endFill();
    face.beginFill(look.hair).drawRoundedRect(-13,-16,26,11,5).drawRect(-13,-10,5,9).drawRect(8,-12,5,7).endFill();
    face.beginFill(0xffffff,0.13).drawRoundedRect(-9,-14,15,3,1).endFill();
    face.lineStyle(1,0x976952,0.7).moveTo(-2,5).lineTo(2,5);
    const accessory=new Graphics();
    if(look.detail==='glasses') accessory.lineStyle(1,0x21324b).drawRoundedRect(-10,-3,8,6,2).drawRoundedRect(2,-3,8,6,2).moveTo(-2,0).lineTo(2,0);
    if(look.detail==='headset') accessory.lineStyle(2,look.coat).arc(0,-3,13,Math.PI,2*Math.PI).drawRect(-15,-6,4,9).drawRect(11,-6,4,9).moveTo(13,3).lineTo(6,7);
    this.head.position.set(0,-37); this.head.addChild(face,this.eyes,accessory);
    const held=new Graphics();
    if(['tablet','clipboard'].includes(look.detail)) {
      held.lineStyle(1,0x1a2639).beginFill(look.detail==='clipboard'?0xd2e6dc:0x24364f).drawRoundedRect(7,-24,10,13,2).endFill();
      held.lineStyle(1,look.coat).moveTo(9,-21).lineTo(14,-21).moveTo(9,-17).lineTo(13,-17);
    }
    this.puppet.addChild(this.leftLeg,this.rightLeg,torso,this.leftArm,this.rightArm,this.head,held);
    this.nameLabel=new Text(agent.displayName,new TextStyle({fill:0xe4efff,fontFamily:'Segoe UI, sans-serif',fontSize:10,fontWeight:'600',stroke:0x090d18,strokeThickness:3}));
    this.nameLabel.anchor.set(0.5,0); this.nameLabel.position.set(0,9);
    this.bubble=new Text('⇄',new TextStyle({fill:0x35e7ff,fontFamily:'Segoe UI, sans-serif',fontSize:16,fontWeight:'700',stroke:0x090d18,strokeThickness:4}));
    this.bubble.anchor.set(0.5); this.bubble.position.set(0,-68); this.bubble.visible=false;
    this.statusPip.position.set(17,-48);
    this.statusGlyph.position.set(17,-48);
    this.eventMode='static'; this.cursor='pointer'; this.hitArea=new Rectangle(-22,-62,44,72);
    this.on('pointerdown',event=>event.stopPropagation());
    this.addChild(shadow,this.activityHalo,this.selection,this.puppet,this.statusPip,this.statusGlyph,this.nameLabel,this.bubble);
    this.updateAgent(agent); this.setSelected(false);
  }

  updateAgent(agent:AgentSnapshot):void {
    this.lastAgent=agent;
    this.nameLabel.text=agent.displayName;
    const visual=getStatusVisual(agent.status);
    this.statusPip.clear().lineStyle(2,0x0b1423).beginFill(visual.color).drawCircle(0,0,7).endFill();
    this.statusGlyph.clear().lineStyle(1.5,0x0b1423,1);
    switch(visual.animation) {
      case 'walk': this.statusGlyph.moveTo(-3,0).lineTo(3,0).moveTo(0,-3).lineTo(3,0).lineTo(0,3); break;
      case 'work': case 'research': this.statusGlyph.drawRect(-3,-2,6,4).moveTo(-2,3).lineTo(2,3); break;
      case 'review': this.statusGlyph.drawRect(-3,-4,6,8).moveTo(-2,0).lineTo(-1,2).lineTo(3,-2); break;
      case 'waiting': this.statusGlyph.drawCircle(0,0,3).moveTo(0,0).lineTo(0,-2).moveTo(0,0).lineTo(2,1); break;
      case 'blocked': this.statusGlyph.moveTo(0,-3).lineTo(0,1).moveTo(0,3).lineTo(0,4); break;
      case 'complete': this.statusGlyph.moveTo(-3,0).lineTo(-1,3).lineTo(4,-3); break;
      default: this.statusGlyph.drawCircle(0,0,1); break;
    }
  }
  setSelected(selected:boolean):void { this.selected=selected; this.updateLabel(); }
  setHovered(hovered:boolean):void { this.hovered=hovered; this.updateLabel(); }
  private updateLabel():void {
    this.selection.visible=this.selected||this.hovered;
    this.nameLabel.visible=this.selected||this.hovered;
  }
  beginHandoff(elapsed:number):void { this.handoffUntil=elapsed+1800; }
  /** Clear only handoff presentation when its evidence/context is withdrawn. */
  cancelHandoff():void { this.handoffUntil=0; this.bubble.visible=false; }
  faceMovement(dx:number):void { if(Math.abs(dx)>0.1) this.direction=dx<0?-1:1; }

  animate(status:AgentStatus,elapsed:number):void {
    const t=elapsed/1000,visual=getStatusVisual(status);
    const walking=visual.animation==='walk';
    const working=['work','research','review'].includes(visual.animation);
    const reviewing=visual.animation==='review'||this.agentId.includes('qa')&&working;
    const handing=elapsed<this.handoffUntil;
    if(handing) {
      this.statusPip.tint=0x35e7ff;
      this.statusGlyph.clear().lineStyle(1.5,0x09131f).drawRoundedRect(-3,-2,6,4,1).moveTo(-2,-3).lineTo(0,-4).lineTo(2,-3);
      this.handoffShown=true;
    } else if(this.handoffShown) {
      this.handoffShown=false;
      if(this.lastAgent) this.updateAgent(this.lastAgent);
      this.statusPip.tint=0xffffff;
    }
    this.puppet.position.y=walking?Math.abs(Math.sin(t*10))*-2:working?-2+Math.sin(t*8)*0.3:visual.animation==='blocked'?2:Math.sin(t*2)*0.35;
    this.puppet.scale.set(this.direction,1);
    this.leftLeg.rotation=walking?Math.sin(t*10)*0.32:0;
    this.rightLeg.rotation=walking?-Math.sin(t*10)*0.32:0;
    this.leftArm.rotation=walking?-Math.sin(t*10)*0.4:working?-0.65+Math.sin(t*8)*0.12:visual.animation==='blocked'?0.8:visual.animation==='waiting'?-0.35:0.05;
    this.rightArm.rotation=handing?-1.2+Math.sin(t*12)*0.3:reviewing?-0.95+Math.sin(t*3)*0.12:working?0.65+Math.sin(t*8)*0.12:visual.animation==='waiting'?0.35:visual.animation==='complete'?-0.8:visual.animation==='blocked'?-0.8:0;
    this.head.rotation=reviewing?Math.sin(t*2)*0.045:0;
    this.eyes.clear().beginFill(0x20283a);
    const blink=t%4>3.88;
    this.eyes.drawRect(-6,0,2,blink?1:3).drawRect(4,0,2,blink?1:3).endFill();
    this.statusPip.alpha=visual.animation==='waiting'?0.5+Math.sin(t*3)*0.25:1;
    this.statusGlyph.alpha=this.statusPip.alpha;
    this.activityHalo.clear();
    if(working) this.activityHalo.lineStyle(1.5,visual.color,0.23+Math.sin(t*5)*0.08).drawEllipse(0,0,19,8);
    if(visual.animation==='blocked') this.activityHalo.lineStyle(2,0xff5f7a,0.48).drawEllipse(0,0,17,7);
    if(visual.animation==='complete') this.activityHalo.lineStyle(2,0x5be39a,0.35).drawEllipse(0,0,18,7);
    this.bubble.visible=handing;
  }
}
