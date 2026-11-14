import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { userColor } from './chat.js';

export function createRoom(container, onFocus) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#101019');
  scene.fog = new THREE.FogExp2('#101019', .025);
  const camera = new THREE.PerspectiveCamera(43, 1, .1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
  container.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .06; controls.minDistance = 2; controls.maxDistance = 28;
  controls.maxPolarAngle = Math.PI / 2 - .035; controls.minPolarAngle = .12; controls.target.set(0, 1.1, 0);
  const materials = {
    floor: new THREE.MeshStandardMaterial({ color: '#25242d', roughness: .85 }),
    wall: new THREE.MeshStandardMaterial({ color: '#262530', roughness: .95 }),
    desk: new THREE.MeshStandardMaterial({ color: '#39333b', roughness: .65 }),
    metal: new THREE.MeshStandardMaterial({ color: '#15151c', roughness: .5, metalness: .5 }),
    black: new THREE.MeshStandardMaterial({ color: '#14141a', roughness: .75 }),
    chair: new THREE.MeshStandardMaterial({ color: '#25252f', roughness: .9 }),
    body: new THREE.MeshStandardMaterial({ color: '#8b7047', roughness: .72 }),
    thorax: new THREE.MeshStandardMaterial({ color: '#b59b6e', roughness: .8 }),
    eye: new THREE.MeshStandardMaterial({ color: '#bb242d', roughness: .28, metalness: .1 }),
    limb: new THREE.MeshStandardMaterial({ color: '#5e4731', roughness: .8 }),
    wing: new THREE.MeshPhysicalMaterial({ color: '#c4d3eb', transparent: true, opacity: .28, side: THREE.DoubleSide, roughness: .12, metalness: .15, depthWrite: false }),
    purple: new THREE.MeshStandardMaterial({ color: '#853aff', emissive: '#6e25df', emissiveIntensity: 2 }),
    green: new THREE.MeshStandardMaterial({ color: '#58e6b1', emissive: '#20bf82', emissiveIntensity: 1.8 }),
  };
  function box(parent, x, y, z, w, h, d, mat) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); mesh.position.set(x,y,z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; }
  function ball(parent, x,y,z, sx,sy,sz,mat) {const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18),mat);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;parent.add(mesh);return mesh;}
  function rod(parent, start, end, radius, mat) {const a=new THREE.Vector3(...start),b=new THREE.Vector3(...end), delta=b.clone().sub(a);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,delta.length(),7),mat);mesh.position.copy(a.add(b).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());parent.add(mesh);return mesh;}
  scene.add(new THREE.HemisphereLight('#b4b2e3', '#17121a', 1.1));
  const key = new THREE.DirectionalLight('#b6c9ff', 2.0);key.position.set(3,9,6);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-18,right:18,top:18,bottom:-18});key.shadow.bias=-.001;scene.add(key);
  const purpleLight=new THREE.PointLight('#7b3cff',18,16,2);purpleLight.position.set(-5,3,-4);scene.add(purpleLight);
  const blueLight=new THREE.PointLight('#338bce',14,15,2);blueLight.position.set(6,3,-3);scene.add(blueLight);
  box(scene,0,-.1,0,40,.2,40,materials.floor);
  const grid=new THREE.GridHelper(40,40,'#393642','#2c2934');grid.position.y=.005;scene.add(grid);
  box(scene,0,3,-8,36,6,.2,materials.wall);box(scene,-12,3,0,.2,6,16,materials.wall);
  box(scene,0,.2,-7.85,36,.2,.1,materials.black);
  for(let x=-10;x<=10;x+=4){box(scene,x,3.4,-7.84,.08,4.8,.08,materials.black);}
  box(scene,-3.8,2.7,-7.8,6,.035,.06,materials.purple);
  box(scene,5,2.7,-7.8,5,.035,.06,materials.purple);
  // Exposed ceiling fixtures and wall ventilation keep the room deliberately spare.
  for(let x=-7;x<=7;x+=7){box(scene,x,5.5,-3,2.4,.12,.45,materials.metal);box(scene,x,5.42,-3,2.1,.025,.25,new THREE.MeshStandardMaterial({color:'#aea5cd',emissive:'#a09bb8',emissiveIntensity:.8}));}
  box(scene,7,3.8,-7.75,1.5,1,.1,materials.metal);for(let y=3.45;y<4.2;y+=.12)box(scene,7,y,-7.67,1.3,.035,.04,materials.chair);
  let stations=[];let focusIndex=null;let targetCamera=null;let targetLook=null;
  function station(index,x,z){
    const group=new THREE.Group();group.position.set(x,0,z);group.userData.flyIndex=index;scene.add(group);
    const pose=['sitting','standing','flying'][index%3];
    const builds=[
      {size:1,width:.55,depth:.75}, {size:1,width:1.7,depth:1.35},
      {size:.72,width:.85,depth:.9}, {size:1.25,width:1.15,depth:1.1},
      {size:1.1,width:.6,depth:.8}, {size:.9,width:1.6,depth:1.3},
      {size:1,width:1,depth:1}, {size:1.2,width:1.4,depth:1.2},
    ];
    const build=builds[index%builds.length];
    const scale=new THREE.Vector3(1.485*build.size*build.width,1.485*build.size,1.485*build.size*build.depth);
    const baseHeight=pose==='standing'?1.6+(build.size-1)*.5:pose==='sitting'?.905+.21*scale.y:1.48;
    const deskLift=pose==='standing'?Math.max(.25,baseHeight+.22*scale.y-1.512):0;
    const desk=new THREE.Group();desk.position.y=deskLift;group.add(desk);
    box(desk,0,1.42,0,2.9,.12,1.5,materials.desk);
    for(const dx of [-1.25,1.25])for(const dz of [-.56,.56])box(group,dx,(1.4+deskLift)/2,dz,.09,1.4+deskLift,.09,materials.metal);
    box(group,0,.25,-.6,2.5,.07,.07,materials.metal);
    box(desk,-.2,1.53,-.38,.52,.04,.33,materials.black);box(desk,-.2,1.8,-.47,.08,.55,.08,materials.metal);
    box(desk,-.2,2.12,-.46,1.47,.96,.1,materials.black);
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=640;const ctx=canvas.getContext('2d');
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(1.36,.85),new THREE.MeshBasicMaterial({map:texture}));screen.position.set(-.2,2.12,-.402);desk.add(screen);
    box(desk,-.2,1.49,.25,.93,.035,.32,materials.black);
    for(let row=0;row<4;row++)for(let col=0;col<14;col++)box(desk,-.62+col*.064,1.512,.135+row*.065,.047,.009,.043,col%4===0?materials.purple:materials.chair);
    box(desk,.48,1.49,.27,.34,.012,.39,materials.black);ball(desk,.49,1.53,.28,.07,.035,.11,materials.metal);
    box(desk,1.04,1.79,-.23,.38,.61,.64,materials.black);box(desk,1.237,1.79,-.23,.012,.49,.5,materials.metal);
    for(let i=0;i<2;i++){const fan=new THREE.Mesh(new THREE.TorusGeometry(.095,.014,8,24),materials.purple);fan.position.set(1.04,1.66+i*.25,.098);desk.add(fan);}
    box(desk,1.04,2.104,-.18,.23,.008,.03,materials.purple);
    // Cup and coaster.
    const cup=new THREE.Mesh(new THREE.CylinderGeometry(.08,.065,.18,20),materials.chair);cup.position.set(-1.02,1.57,.2);desk.add(cup);
    if(pose==='sitting'){
      box(group,0,.83,1.05,Math.max(.9,.65*scale.x),.15,Math.max(.8,.6*scale.z),materials.chair);
      box(group,0,1.34,1.48,.82,.95,.13,materials.chair);
      for(const side of [-1,1])box(group,side*.36,1.33,1.555,.07,.65,.025,materials.purple);
      rod(group,[0,.1,1.05],[0,.77,1.05],.065,materials.metal);
      for(let i=0;i<5;i++){
        const angle=i*Math.PI*2/5;
        const x=Math.cos(angle)*.48,z=1.05+Math.sin(angle)*.48;
        rod(group,[0,.17,1.05],[x,.08,z],.035,materials.metal);
        ball(group,x,.07,z,.06,.06,.06,materials.black);
      }
    }
    const fly=new THREE.Group();fly.position.set(0,baseHeight,1.05);fly.scale.copy(scale);group.add(fly);
    const anatomy=new THREE.Group();anatomy.rotation.x=pose==='standing'?.45:0;fly.add(anatomy);
    const abdomen=ball(anatomy,0,.08,.18,.24,.29,.38,materials.body);abdomen.rotation.x=.35;
    for(let i=0;i<4;i++){const band=new THREE.Mesh(new THREE.TorusGeometry(.215-i*.018,.018,6,28),materials.limb);band.rotation.x=Math.PI/2;band.position.set(0,.08-i*.035,.08+i*.12);anatomy.add(band);}
    ball(anatomy,0,.33,-.08,.25,.28,.26,materials.thorax);ball(anatomy,0,.56,-.28,.25,.22,.2,materials.thorax);
    for(const side of [-1,1]){ball(anatomy,side*.18,.59,-.35,.13,.16,.135,materials.eye);
      rod(anatomy,[side*.08,.72,-.34],[side*.14,.84,-.51],.011,materials.limb);ball(anatomy,side*.14,.84,-.51,.022,.022,.022,materials.limb);
      for(let i=0;i<3;i++){
        const start=[side*.17,.3-i*.11,-.1+i*.13];
        let knee=[side*(.4+i*.05),.18-i*.1,-.3+i*.2];
        let end=[side*(i===0?.32:.43),i===0?.37:-.24,-.68+i*.55];
        if(pose!=='flying'){
          if(i===0){knee=[side*.38,.2,-.35];end=[side*.32,(1.512+deskLift-baseHeight)/scale.y,(.25-1.05)/scale.z];}
          else if(pose==='standing'){
            knee=[side*.36,-.3,-.25+(i-1)*.7];
            end=[side*.48,-baseHeight/scale.y,-.4+(i-1)*.95];
          }else{
            knee=[side*.36,-.2,-.28+(i-1)*.3];
            end=[side*.4,-baseHeight/scale.y,-.32+(i-1)*.35];
          }
        }
        if(pose==='standing'){
          const shoulder=new THREE.Vector3(...start).applyEuler(anatomy.rotation);start.splice(0,3,...shoulder.toArray());
        }
        rod(fly,start,knee,.019,materials.limb);rod(fly,knee,end,.014,materials.limb);
      }
    }
    const wings=[];
    for(const side of [-1,1]){const wing=new THREE.Group();wing.position.set(side*.12,.42,.02);wing.rotation.set(-.3,side*-.3,side*-.25);const membrane=ball(wing,side*.22,0,.25,.23,.025,.52,materials.wing);membrane.rotation.y=side*.35;
      rod(wing,[0,0,0],[side*.32,0,.65],.005,materials.wing);rod(wing,[side*.07,.005,.1],[side*.04,.005,.58],.004,materials.wing);anatomy.add(wing);wings.push(wing);}
    const glow=new THREE.PointLight('#adbcff',1.6,3,2);glow.position.set(-.2,2.05,-.1);desk.add(glow);
    // A cable from the monitor to the tower.
    const cableCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.2,1.8,-.53),new THREE.Vector3(.1,1.5,-.65),new THREE.Vector3(.65,1.51,-.6),new THREE.Vector3(1,1.7,-.56)]);desk.add(new THREE.Mesh(new THREE.TubeGeometry(cableCurve,16,.012,5,false),materials.black));
    const item={group,fly,wings,pose,canvas,ctx,texture,index,screen,deskLift,lastKey:''};drawScreen(item,[]);return item;
  }
  function drawScreen(item,messages){const c=item.ctx,w=1024,h=640;c.fillStyle='#18181b';c.fillRect(0,0,w,h);c.fillStyle='#9147ff';c.fillRect(0,0,w,6);c.fillStyle='#efeff1';c.font='bold 25px Arial';c.fillText(`STREAM CHAT`,28,49);c.fillStyle='#adadb8';c.font='20px Arial';c.textAlign='right';c.fillText(`Fly ${item.index+1}`,995,49);c.textAlign='left';c.fillStyle='#303036';c.fillRect(0,67,w,2);
    const lines=[];c.font='24px Arial';for(const m of messages.slice(-18)){const label=`${m.user}: `;const words=(label+m.text).split(' ');let line='';let first=true;for(const word of words){if(c.measureText(line+word).width>940&&line){lines.push({text:line,color:first?userColor(m.user):'#dedee3'});first=false;line='';}line+=word+' ';}if(line)lines.push({text:line,color:first?userColor(m.user):'#dedee3'});}
    lines.slice(-14).forEach((line,i)=>{c.fillStyle=line.color;c.fillText(line.text,28,106+i*33,960);});c.fillStyle='#26262c';c.fillRect(20,581,984,43);c.fillStyle='#777781';c.font='20px Arial';c.fillText('Send a message',35,609);item.texture.needsUpdate=true;}
  function setCount(count){for(const item of stations){scene.remove(item.group);item.group.traverse(o=>{o.geometry?.dispose();if(o.material&&!Object.values(materials).includes(o.material))o.material.dispose();});item.texture.dispose();}const cols=Math.min(count,4);const rows=Math.ceil(count/cols);stations=Array.from({length:count},(_,i)=>station(i,(i%cols-(cols-1)/2)*3.5,(Math.floor(i/cols)-(rows-1)/2)*3.5));focusIndex=null;reset();}
  function reset(){focusIndex=null;const count=stations.length;targetCamera=new THREE.Vector3(Math.min(8,3.4+count*.5),Math.min(12,4.5+count*.4),Math.min(19,6+count*.8));targetLook=new THREE.Vector3(0,1,0);onFocus(null);}
  function focus(index){const item=stations[index];if(!item)return;focusIndex=index;const p=item.group.position;targetCamera=new THREE.Vector3(p.x+.65,2.65+item.deskLift,p.z+3.1);targetLook=new THREE.Vector3(p.x-.2,1.95+item.deskLift,p.z-.1);onFocus(index);}
  controls.addEventListener('start',()=>{targetCamera=null;targetLook=null;});
  let pointerStart;renderer.domElement.addEventListener('pointerdown',e=>pointerStart={x:e.clientX,y:e.clientY});renderer.domElement.addEventListener('pointerup',e=>{if(!pointerStart||Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5||e.button!==0)return;const r=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=ray.intersectObjects(stations.map(s=>s.group),true)[0];if(hit){let obj=hit.object;while(obj&&obj.userData.flyIndex===undefined)obj=obj.parent;if(obj)focus(obj.userData.flyIndex);}});
  const observer=new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();if(!width||!height)return;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);});observer.observe(container);
  camera.position.set(3.9,4.9,6.8);setCount(1);
  renderer.setAnimationLoop(time=>{
    if(targetCamera){
      camera.position.lerp(targetCamera,.065);controls.target.lerp(targetLook,.065);
      if(camera.position.distanceTo(targetCamera)<.005){targetCamera=null;targetLook=null;}
    }
    controls.update();
    for(const item of stations){
      const phase=time*.0025+item.index*1.7;
      const flying=item.pose==='flying';
      if(flying){
        item.fly.position.set(Math.sin(phase*.7)*.055,1.48+Math.sin(phase)*.09,1.15+Math.cos(phase*.8)*.045);
        item.fly.rotation.set(-.1+Math.sin(phase)*.035,Math.sin(phase*.6)*.035,Math.cos(phase*.7)*.025);
      }else{
        item.fly.rotation.set(Math.sin(phase)*.008,Math.sin(phase*.6)*.012,0);
      }
      item.wings.forEach((wing,i)=>{
        const side=i===0?-1:1;
        wing.rotation.y=side*(flying?.7:.3);
        wing.rotation.z=side*(flying?.25+Math.sin(time*.12+item.index)*.95:.25+Math.sin(phase)*.015);
      });
    }
    renderer.render(scene,camera);
  });
  return { setCount, reset, focus, update(messages){for(const item of stations){const assigned=messages.filter(m=>m.index%stations.length===item.index);const key=JSON.stringify(assigned.slice(-18).map(m=>[m.index,m.user,m.text]));if(key!==item.lastKey){drawScreen(item,assigned);item.lastKey=key;}}}, get count(){return stations.length;},get focused(){return focusIndex;} };
}
