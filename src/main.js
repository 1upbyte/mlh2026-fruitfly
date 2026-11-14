import './style.css';
import './moderation.css';
import { createIcons, Ellipsis, Search, Volume2, VolumeX, Upload, PanelLeftClose, Film, MessagesSquare, FolderOpen, Mouse, RotateCcw, Play, Pause, SkipBack, Maximize, Plus, Minus, Users, History, PanelRightClose, PanelRightOpen, ListFilter, ArrowDown, Smile, Settings, Ban, MessageSquareOff, Timer, ShieldAlert, Gauge, Trophy, X } from 'lucide';
import { createRoom } from './room.js';
import { makeVideoDraggable } from './video-inset.js';
import { createModeration } from './moderation.js';
import { createFlyMod } from './fly-mod.js';
import { parseChat, assignedTo, visibleMessages, userColor } from './chat.js';

const $=id=>document.getElementById(id);
const icons={Ellipsis, Search, Volume2, VolumeX, Upload, PanelLeftClose, Film, MessagesSquare, FolderOpen, Mouse, RotateCcw, Play, Pause, SkipBack, Maximize, Plus, Minus, Users, History, PanelRightClose, PanelRightOpen, ListFilter, ArrowDown, Smile, Settings, Ban, MessageSquareOff, Timer, ShieldAlert, Gauge, Trophy, X};
const refreshIcons=()=>createIcons({icons,attrs:{'stroke-width':1.8}});
refreshIcons();
const video=$('video');video.src='/xqc1.mp4';video.volume=.6;
makeVideoDraggable($('video-inset'), $('player'), document.querySelector('.player-controls'));
let messages=[],manualMessages=[],count=1,offset=0,query='',lastChatKey='',autoScroll=true,videoObjectUrl=null;
let room;
const status=message=>$('status').textContent=message;
function icon(button,name){button.innerHTML=`<i data-lucide="${name}"></i>`;refreshIcons();}
try {room=createRoom($('scene'),index=>{const label=$('focus-label');label.hidden=index===null;label.textContent=index===null?'':`Fly ${index+1}`;});$('loading').hidden=true;}
catch(error){$('loading').textContent='3D rendering is unavailable. Enable WebGL and reload.';status(error.message);console.error(error);}
function format(seconds){if(!Number.isFinite(seconds))return '0:00';const s=Math.max(0,Math.floor(seconds));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
function currentMessages(){return [...visibleMessages(messages,video.currentTime,offset),...manualMessages.filter(m=>m.time<=video.currentTime)].sort((a,b)=>a.time-b.time||a.index-b.index);}
function renderChat(force=false){
  const visible=moderation.filter(currentMessages());room?.update(visible);fly.observe(visible);inputState();
  const filter=$('chat-filter').value;
  const filtered=visible.filter(m=>(filter==='all'||assignedTo(m.index,count)===+filter)&&(!query||`${m.user} ${m.text}`.toLowerCase().includes(query)));
  const notices=query?[]:fly.notices.filter(n=>n.time<=video.currentTime-(n.manual?0:offset)&&(filter==='all'||n.fly===+filter));
  const lines=[...filtered,...notices].sort((a,b)=>a.time-b.time||a.index-b.index);
  const key=lines.map(m=>m.index).join(',')+':'+filter+':'+query+':'+moderation.revision+':'+filtered.filter(m=>m.verdict).length;
  $('chat-count').textContent=filtered.length;
  if(!force&&lastChatKey===key)return;lastChatKey=key;
  const fragment=document.createDocumentFragment();
  for(const m of lines.slice(-500)){const line=document.createElement('div');line.className=m.notice?'chat-notice':'chat-message';line.dataset.index=m.index;
    if(m.notice){line.textContent=m.notice;fragment.append(line);continue;}
    line.title=fly.describe(m);
    const stamp=document.createElement('span');stamp.className='timestamp';stamp.textContent=format(m.time);line.append(stamp);
    const user=document.createElement('b');user.textContent=m.user;user.style.color=userColor(m.user);line.append(user,document.createTextNode(`: ${m.text}`));
    if(moderation.warned(m.user)){const badge=document.createElement('span');badge.className='warned-badge';badge.textContent='Warned';line.append(badge);}
    fragment.append(line);}
  const oldScroll=$('chat-messages').scrollTop;$('chat-messages').replaceChildren(fragment);$('chat-messages').scrollTop=autoScroll?$('chat-messages').scrollHeight:oldScroll;
}
function update(){const duration=video.duration||0;$('time').textContent=`${format(video.currentTime)} / ${format(duration)}`;$('elapsed').textContent=format(video.currentTime);$('timeline').max=duration||100;$('timeline').value=video.currentTime;renderChat();}
function playbackState(){icon($('play'),video.paused?'play':'pause');$('play').setAttribute('aria-label',video.paused?'Play':'Pause');$('live-badge').textContent=video.paused?'REPLAY':'PLAYING';}
async function play(){try{if(video.ended)video.currentTime=0;await video.play();}catch(error){status(`Unable to play this video: ${error.message}`);}}
$('play').onclick=()=>moderation.awardActive?moderation.dismissAndResume():video.paused?play():video.pause();
video.addEventListener('play',()=>{if(moderation.awardActive)video.pause();});
video.addEventListener('play',playbackState);video.addEventListener('pause',playbackState);video.addEventListener('ended',playbackState);
for(const event of ['timeupdate','seeked','loadedmetadata','durationchange'])video.addEventListener(event,update);
video.addEventListener('error',()=>status('Unable to load the video. Select a browser-compatible video file.'));
$('timeline').oninput=e=>{video.currentTime=+e.target.value;update();};
$('restart').onclick=()=>{video.currentTime=0;autoScroll=true;update();};
function mute(){video.muted=!video.muted;for(const id of ['mute','mute-top']){icon($(id),video.muted?'volume-x':'volume-2');$(id).setAttribute('aria-label',video.muted?'Unmute':'Mute');}}
$('mute').onclick=mute;$('mute-top').onclick=mute;
$('volume').oninput=e=>{video.volume=+e.target.value;if(video.muted&&video.volume>0)mute();};
$('speed').onchange=e=>video.playbackRate=+e.target.value;
$('reset-view').onclick=()=>room?.reset();
function setCount(next){count=Math.max(1,Math.min(20,next));room?.setCount(count);$('fly-count').textContent=`${count} ${count===1?'fly':'flies'}`;$('sidebar-count').textContent=count;$('remove-fly').disabled=count===1;$('add-fly').disabled=count===20;
  const previous=$('chat-filter').value;$('chat-filter').replaceChildren(new Option('All messages','all'),...Array.from({length:count},(_,i)=>new Option(`Fly ${i+1}`,i)));$('chat-filter').value=previous==='all'||+previous<count?previous:'all';renderChat(true);
}
$('add-fly').onclick=()=>setCount(count+1);$('remove-fly').onclick=()=>setCount(count-1);$('remove-fly').disabled=true;
$('chat-filter').onchange=()=>{autoScroll=true;renderChat(true);const value=$('chat-filter').value;if(value!=='all')room?.focus(+value);};
$('chat-users').onclick=()=>room?.focus(((room.focused??-1)+1)%count);
$('chat-messages').addEventListener('scroll',()=>{const el=$('chat-messages');autoScroll=el.scrollHeight-el.clientHeight-el.scrollTop<35;$('resume-chat').hidden=autoScroll;});
$('resume-chat').onclick=()=>{autoScroll=true;$('chat-messages').scrollTop=$('chat-messages').scrollHeight;$('resume-chat').hidden=true;};
$('search').oninput=e=>{query=e.target.value.toLowerCase().trim();renderChat(true);};$('search-button').onclick=()=>$('search').focus();
function inputState(){const me=moderation.user('you'),left=me?Math.ceil((me.timeoutUntil-Date.now())/1000):0;
  const blocked=me?.banned?'You are banned from this chat.':me?.muted?'You are muted in this chat.':left>0?`You are timed out for ${left}s.`:'';
  $('message-input').disabled=$('send-message').disabled=!!blocked;$('message-input').placeholder=blocked||'Send a message';}
setInterval(()=>inputState(),500);
function sendMessage(){const text=$('message-input').value.trim();if(!text||$('message-input').disabled)return;const sent={user:'you',text,time:video.currentTime,index:messages.length+manualMessages.length,stamp:''};manualMessages.push(sent);fly.load([sent]);$('message-input').value='';autoScroll=true;renderChat(true);}
$('send-message').onclick=sendMessage;$('message-input').onkeydown=e=>{if(e.key==='Enter')sendMessage();};$('emoji').onclick=()=>{$('message-input').value+='🙂';$('message-input').focus();};
function sidebar(){document.body.classList.toggle('sidebar-collapsed');}function toggleChat(){const hidden=document.body.classList.toggle('chat-collapsed');$('show-chat').hidden=!hidden;}
$('collapse-sidebar').onclick=sidebar;$('theater').onclick=()=>{document.body.classList.toggle('sidebar-collapsed');toggleChat();};
$('collapse-chat').onclick=toggleChat;$('show-chat').onclick=toggleChat;
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('player').requestFullscreen();}catch{status('Fullscreen is unavailable in this browser.');}};
$('offset').oninput=e=>{offset=Number(e.target.value)||0;renderChat(true);};
function openChat(){$('chat-file').click();}function openVideo(){$('video-file').click();}
$('load-chat').onclick=openChat;$('load-video').onclick=openVideo;
for(const id of ['upload-top','upload-sidebar','chat-settings'])$(id).onclick=()=>$('chat-file').closest('body').querySelector('.settings-card').scrollIntoView({behavior:'smooth',block:'center'});
$('following').onclick=()=>{document.body.classList.remove('sidebar-collapsed');$('following').classList.add('active');$('browse').classList.remove('active');};
$('browse').onclick=()=>{$('browse').classList.add('active');$('following').classList.remove('active');$('player').scrollIntoView({behavior:'smooth'});};
$('more').onclick=()=>document.querySelector('.settings-card').scrollIntoView({behavior:'smooth'});
$('channel').onclick=()=>$('player').scrollIntoView({behavior:'smooth'});
function loadChat(text,name){const parsed=parseChat(text);if(!parsed.length){status('No messages found in this file.');return;}messages=parsed;manualMessages=[];fly.clear();$('chat-filename').textContent=name;$('chat-status').textContent=name;$('message-total').textContent=`${messages.length.toLocaleString()} messages`;status('');autoScroll=true;renderChat(true);fly.load(messages);}
$('chat-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{loadChat(await file.text(),file.name);}catch{status('Unable to read this chat file.');}e.target.value='';};
$('video-file').onchange=e=>{const file=e.target.files[0];if(!file)return;video.pause();if(videoObjectUrl)URL.revokeObjectURL(videoObjectUrl);videoObjectUrl=URL.createObjectURL(file);video.src=videoObjectUrl;for(const id of ['video-filename','video-status','inset-label'])$(id).textContent=file.name;status('');e.target.value='';};
const moderation=createModeration({onChange:()=>renderChat(true),pause:()=>video.pause(),resume:play,refreshIcons});
const fly=createFlyMod({onChange:()=>renderChat(true),flyFor:m=>assignedTo(m.index,count),awardActive:()=>moderation.awardActive});
try{const response=await fetch('/xqc1.txt');if(!response.ok)throw new Error('Chat file not found');loadChat(await response.text(),'xqc1.txt');}catch(error){status(`Unable to load the example chat: ${error.message}`);}
update();
