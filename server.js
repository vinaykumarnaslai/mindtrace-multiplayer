const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const path=require("path");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});
app.use(express.static(path.join(__dirname,"public")));

const PORT=process.env.PORT||3000;
const rooms=new Map();
const SYMBOLS=["circle","triangle","star","square"];
const LABELS={circle:"Circle",triangle:"Triangle",star:"Star",square:"Square"};
const MAX_PLAYERS=8, MIN_PLAYERS=2, ROUND_SECONDS=45, DEDUCE_SECONDS=25, MAX_ROUNDS=5;

function makeCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c;
  do c=Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
  while(rooms.has(c));
  return c;
}
function getRoom(s){return rooms.get(s.data.roomCode)}
function players(room){
  return [...room.players.values()].map(p=>({
    id:p.id,name:p.name,score:p.score,connected:p.connected,
    isHost:p.id===room.hostId,isDetective:p.id===room.detectiveId
  }));
}
function emitState(room){
  io.to(room.code).emit("room:update",{
    code:room.code,phase:room.phase,round:room.round,maxRounds:MAX_ROUNDS,
    players:players(room),hostId:room.hostId,detectiveId:room.detectiveId,
    targetId:room.phase==="reveal"?room.targetId:null,secondsLeft:room.secondsLeft
  });
}
function clearRoomTimer(room){if(room.timer){clearInterval(room.timer);room.timer=null}}

function startRound(room){
  if(room.players.size<MIN_PLAYERS)return;
  room.round++;
  room.phase="choose";
  room.choices=new Map();
  const ids=[...room.players.keys()];
  room.detectiveId=ids[Math.floor(Math.random()*ids.length)];
  const others=ids.filter(id=>id!==room.detectiveId);
  room.targetId=others[Math.floor(Math.random()*others.length)];
  room.secondsLeft=ROUND_SECONDS;
  clearRoomTimer(room);

  for(const p of room.players.values()){
    io.to(p.id).emit("round:started",{
      round:room.round,maxRounds:MAX_ROUNDS,
      role:p.id===room.detectiveId?"detective":"player",
      isTarget:p.id===room.targetId,
      prompt:"Pick the symbol you think the room will least expect.",
      symbols:SYMBOLS.map(id=>({id,label:LABELS[id]}))
    });
  }
  emitState(room);
  room.timer=setInterval(()=>{
    room.secondsLeft--;
    io.to(room.code).emit("round:timer",room.secondsLeft);
    if(room.secondsLeft<=0)finishChoices(room);
  },1000);
}

function finishChoices(room){
  if(room.phase!=="choose")return;
  clearRoomTimer(room);
  for(const id of room.players.keys()){
    if(!room.choices.has(id))room.choices.set(id,SYMBOLS[Math.floor(Math.random()*SYMBOLS.length)]);
  }
  const targetChoice=room.choices.get(room.targetId);
  const counts=Object.fromEntries(SYMBOLS.map(s=>[s,0]));
  for(const c of room.choices.values())counts[c]++;
  const max=Math.max(...Object.values(counts));
  const popular=SYMBOLS.filter(s=>counts[s]===max);
  const popularChoice=popular[Math.floor(Math.random()*popular.length)];
  const notTarget=SYMBOLS.filter(s=>s!==targetChoice);
  const forbidden=notTarget[Math.floor(Math.random()*notTarget.length)];
  const uncommon=SYMBOLS.filter(s=>counts[s]<=1&&s!==targetChoice);
  const uncommonChoice=(uncommon[0]||notTarget[0]);

  room.clues=[
    `The Target did not choose ${LABELS[forbidden]}.`,
    `${LABELS[popularChoice]} was among the most common choices.`,
    `${LABELS[uncommonChoice]} was chosen by no more than one player.`
  ];
  room.phase="deduce";
  room.secondsLeft=DEDUCE_SECONDS;

  for(const p of room.players.values()){
    io.to(p.id).emit("round:deduce",{
      role:p.id===room.detectiveId?"detective":"spectator",
      clues:room.clues,
      choices:[...room.choices.entries()].map(([id,c])=>({
        id,name:room.players.get(id).name,choice:c
      }))
    });
  }
  emitState(room);
  room.timer=setInterval(()=>{
    room.secondsLeft--;
    io.to(room.code).emit("round:timer",room.secondsLeft);
    if(room.secondsLeft<=0)reveal(room,null);
  },1000);
}

function reveal(room,guess){
  if(room.phase!=="deduce")return;
  clearRoomTimer(room);
  room.phase="reveal";
  const correct=Boolean(guess&&guess===room.targetId);
  const detective=room.players.get(room.detectiveId);
  if(detective&&correct)detective.score+=3;
  for(const id of room.choices.keys()){
    const p=room.players.get(id);
    if(p)p.score+=1;
  }
  if(!correct&&room.players.get(room.targetId))room.players.get(room.targetId).score+=2;

  io.to(room.code).emit("round:reveal",{
    correct,
    targetName:room.players.get(room.targetId)?.name||"Unknown",
    targetChoice:room.choices.get(room.targetId),
    choices:[...room.choices.entries()].map(([id,c])=>({
      id,name:room.players.get(id).name,choice:c
    }))
  });
  emitState(room);

  setTimeout(()=>{
    if(!rooms.has(room.code))return;
    if(room.round>=MAX_ROUNDS){
      room.phase="finished";
      io.to(room.code).emit("game:finished",{players:players(room)});
      emitState(room);
    }else startRound(room);
  },6500);
}

io.on("connection",socket=>{
  socket.on("room:create",({name})=>{
    const n=String(name||"").trim().slice(0,20);
    if(!n)return socket.emit("error:msg","Enter a display name.");
    const c=makeCode();
    const room={code:c,hostId:socket.id,players:new Map(),phase:"lobby",round:0,
      detectiveId:null,targetId:null,choices:new Map(),timer:null,secondsLeft:0,clues:[]};
    room.players.set(socket.id,{id:socket.id,name:n,score:0,connected:true});
    rooms.set(c,room);
    socket.join(c);socket.data.roomCode=c;
    socket.emit("room:joined",{code:c});emitState(room);
  });

  socket.on("room:join",({name,code})=>{
    const n=String(name||"").trim().slice(0,20), c=String(code||"").trim().toUpperCase();
    const room=rooms.get(c);
    if(!n)return socket.emit("error:msg","Enter a display name.");
    if(!room)return socket.emit("error:msg","Room not found.");
    if(room.players.size>=MAX_PLAYERS)return socket.emit("error:msg","Room is full.");
    if(room.phase!=="lobby")return socket.emit("error:msg","That game is already in progress.");
    room.players.set(socket.id,{id:socket.id,name:n,score:0,connected:true});
    socket.join(c);socket.data.roomCode=c;
    socket.emit("room:joined",{code:c});emitState(room);
  });

  socket.on("game:start",()=>{
    const room=getRoom(socket);
    if(!room||socket.id!==room.hostId)return;
    if(room.players.size<MIN_PLAYERS)return socket.emit("error:msg","Need at least 2 players.");
    startRound(room);
  });

  socket.on("choice:submit",({choice})=>{
    const room=getRoom(socket);
    if(!room||room.phase!=="choose"||!SYMBOLS.includes(choice)||room.choices.has(socket.id))return;
    room.choices.set(socket.id,choice);
    socket.emit("choice:locked");
    if(room.choices.size===room.players.size)finishChoices(room);
  });

  socket.on("detective:guess",({playerId})=>{
    const room=getRoom(socket);
    if(!room||room.phase!=="deduce"||socket.id!==room.detectiveId)return;
    reveal(room,playerId);
  });

  socket.on("game:restart",()=>{
    const room=getRoom(socket);
    if(!room||socket.id!==room.hostId||room.phase!=="finished")return;
    for(const p of room.players.values())p.score=0;
    room.round=0;room.phase="lobby";room.detectiveId=null;room.targetId=null;
    emitState(room);
  });

  socket.on("disconnect",()=>{
    const room=getRoom(socket);
    if(!room)return;
    const p=room.players.get(socket.id);
    if(p)p.connected=false;
    emitState(room);
    setTimeout(()=>{
      const r=rooms.get(room.code), pp=r?.players.get(socket.id);
      if(!r||!pp||pp.connected)return;
      r.players.delete(socket.id);
      if(r.hostId===socket.id)r.hostId=[...r.players.keys()][0]||null;
      if(r.players.size===0){clearRoomTimer(r);rooms.delete(r.code)}
      else emitState(r);
    },20000);
  });
});

app.get("/health",(req,res)=>res.json({ok:true,rooms:rooms.size}));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,()=>console.log(`MindTrace running on ${PORT}`));
