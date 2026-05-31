import React, { useState, useEffect, useRef } from "react";

/* =========================================================================
   BLOCK BLAST — 关卡设计 / 难度曲线演示原型
   两条主线:
   (A) 难度曲线调控: ASS分层 -> 难度循环序列 -> (层级×难度)查表选L模板
       -> 展开DG序列 -> 按当前DG等级发牌(控制可解路径数)
   (B) 体验过山车: 真实Block Blast计分结构(保底分+多消递增+combo乘法+断条)
       + 局内手感反馈
   顶部可切换「难度调控视图 / 体验视图」给面试官演示。
   ========================================================================= */

const SIZE = 8;
const CELL = 38, GAP = 3, PAD = 10; // CELL 为桌面端最大格宽, 移动端按视口收缩
const COLORS = ["#ff5e7e","#ffa63d","#ffd23d","#5ee07a","#3dd6e0","#5e8bff","#b15eff","#ff5ed4"];

// 按视口宽度算出格宽: 保证整块棋盘(含内边距/间隙)能横向放下, 桌面端封顶 CELL, 小屏下探到 26
const computeCell = () => {
  if (typeof window === "undefined") return CELL;
  const avail = window.innerWidth - 40; // 减去 wrap(16×2)+boardZone(4×2) 的外边距
  return Math.max(26, Math.min(CELL, Math.floor((avail - 2 * PAD - 7 * GAP) / SIZE)));
};

// ============== 调度配置 (config_flow.yaml 占位实现) ==============
const DIFF_CYCLE = ["普通","困难","极难","普通","困难","困难","普通","普通","极难","普通"];
const RECORD_GROUP_LEN = 3;
const TIER_THRESHOLDS = { low: 400, high: 800 };

const TEMPLATE_TABLE = {
  "低阶|普通":"L1","低阶|破纪录1":"L1'","低阶|破纪录2":"L1''","低阶|破纪录3":"L2",
  "中阶|困难":"L2'","中阶|普通":"L2''","中阶|破纪录1":"L3","中阶|破纪录3":"L3''",
  "高阶|极难":"L4","高阶|困难":"L5",
};
const TEMPLATES = {
  "L1":  ["DG1","DG2","DG1","DG3","DG2","DG3","DG2","DG4","DG3","DG4","DG3","DG4","DG4","DG4","DG4","DG4"],
  "L1'": ["DG1","DG2","DG1","DG3","DG1","DG2","DG1","DG3","DG2","DG3","DG2","DG4","DG2","DG3","DG2","DG3"],
  "L1''":["DG1","DG2","DG1","DG3","DG1","DG2","DG1","DG3","DG1","DG2","DG1","DG3","DG2","DG3","DG2","DG2"],
  "L2":  ["DG1","DG2","DG3","DG2","DG4","DG3","DG4","DG3","DG5","DG4","DG3","DG5","DG4","DG5","DG5","DG5"],
  "L2'": ["DG1","DG2","DG3","DG2","DG4","DG2","DG3","DG2","DG4","DG3","DG4","DG3","DG4","DG3","DG4","DG4"],
  "L2''":["DG1","DG2","DG3","DG1","DG2","DG3","DG2","DG3","DG2","DG3","DG2","DG3","DG2","DG3","DG3","DG3"],
  "L3":  ["DG2","DG3","DG4","DG3","DG5","DG4","DG3","DG5","DG6","DG5","DG4","DG6","DG5","DG6","DG6","DG6"],
  "L3'": ["DG2","DG3","DG4","DG3","DG4","DG3","DG4","DG3","DG5","DG4","DG3","DG5","DG4","DG3","DG4","DG4"],
  "L3''":["DG2","DG3","DG2","DG3","DG2","DG3","DG2","DG3","DG2","DG3","DG2","DG3","DG2","DG3","DG3","DG3"],
  "L4":  ["DG3","DG4","DG5","DG4","DG6","DG5","DG4","DG6","DG5","DG6","DG5","DG6","DG6","DG5","DG6","DG6"],
  "L5":  ["DG3","DG5","DG6","DG4","DG5","DG6","DG5","DG6","DG6","DG5","DG6","DG6","DG6","DGS","DGS","DGS"],
};
// DG -> 发牌目标"可解路径数(合法放置位)"区间, DG越高越逼死(占位值)
const DG_PLACEMENT = {DG1:[28,64],DG2:[20,40],DG3:[14,28],DG4:[9,18],DG5:[5,12],DG6:[2,7],DGS:[0,4]};
const DG_ROUNDS = 2;

// DG难度从低到高的有序列表, 用于升/降级(DGS视作DG6之上一级)
const DG_ORDER = ["DG1","DG2","DG3","DG4","DG5","DG6","DGS"];
// 在原DG基础上偏移 delta 级, 升顶封DGS, 降底封DG1
const shiftDG = (dg, delta)=>{
  const i = DG_ORDER.indexOf(dg);
  if(i<0) return dg;
  return DG_ORDER[Math.max(0, Math.min(DG_ORDER.length-1, i+delta))];
};

// ============== 微观跳转规格 ==============
// 1~5号跳转: 都"从下一轮方块开始"生效。dur=作用组数, delta=每组DG偏移, special标记特殊行为
const MICRO_JUMP = {
  1: {dur:2, delta:-1, label:"1号·降1级×2组"},
  2: {dur:Infinity, delta:0, special:"DG6_DGS_LOOP", label:"2号·DG6/DGS收尾循环"},
  3: {dur:1, delta:-1, label:"3号·降1级×1组"},
  4: {dur:1, delta:+1, label:"4号·升1级×1组"},
  5: {dur:2, delta:+2, label:"5号·升2级×2组"},
};
// 各难度的触发阈值: 断杆(连续未消除)触发3号(降), 连击(combo)触发4号(升)
const MICRO_TRIGGERS = {
  普通:{breakN:4, comboN:25},
  困难:{breakN:5, comboN:20},
  极难:{breakN:6, comboN:15},
};
// ===== 破纪录节点局组专用微观跳转触发 (与常规局独立) =====
// 占用率达阈 -> 1号(降1级×2组, 助玩家喘息继续冲纪录)
// 分数稳赢纪录 -> 2号(DG6/DGS收尾循环, 增难压制破纪录幅度)
const RECORD_FILL_RATIO = 0.85;  // 棋盘占用率 >= 85% 触发1号(降难助攻)
const RECORD_LEAD_RATIO = 1.20;  // 本局分数 >= best*120% 触发2号(增难压制)

// ============== 计分配置 (真实BB结构, 缩小量级以贴合ASS阈值) ==============
// 真实BB: 落子每格+1, 消除每格+10, 多消大额倍率, combo ×(1+combo*0.5)
// 这里把"每格消除分"从10缩到3, 量级落在数百, 高手连击冲击800+高阶线
const SCORE = {
  perCellPlace: 1,        // 落子保底: 每格+1
  perCellClear: 3,        // 消除: 每格基础分(真实为10, 缩放)
  lineMult: {1:1, 2:1.5, 3:2, 4:3, 5:4},  // 同时消除N条线的递增倍率
  comboStep: 0.5,         // combo乘法步长: ×(1 + combo*0.5)
};
const STREAK_WINDOW = 3;  // 断条: 连续STREAK_WINDOW次落子未消除 -> combo归零

// ============== 形状 (带权重: w越大越常出, 小方块权重很低=低频点缀) ==============
const SHAPE_DEFS = [
  // —— 小方块: 偶尔救急, 低权重 ——
  {w:0.6,  c:[[0,0]]},                                   // 单格
  {w:1.2,  c:[[0,0],[0,1]]},                             // 双格横
  {w:1.2,  c:[[0,0],[1,0]]},                             // 双格竖
  // —— 3格: 中等权重 ——
  {w:3,    c:[[0,0],[0,1],[0,2]]},                       // 3横
  {w:3,    c:[[0,0],[1,0],[2,0]]},                       // 3竖
  {w:4,    c:[[0,0],[1,0],[1,1]]},{w:4,c:[[0,1],[1,0],[1,1]]},
  {w:4,    c:[[0,0],[0,1],[1,0]]},{w:4,c:[[0,0],[0,1],[1,1]]},  // 小拐角
  // —— 4格: 主力 ——
  {w:6,    c:[[0,0],[0,1],[1,0],[1,1]]},                 // 田字
  {w:5,    c:[[0,0],[0,1],[0,2],[0,3]]},                 // 4横
  {w:5,    c:[[0,0],[1,0],[2,0],[3,0]]},                 // 4竖
  {w:6,    c:[[0,0],[0,1],[0,2],[1,0]]},{w:6,c:[[0,0],[0,1],[0,2],[1,2]]}, // L/J
  {w:6,    c:[[1,0],[1,1],[1,2],[0,0]]},{w:6,c:[[1,0],[1,1],[1,2],[0,2]]},
  {w:6,    c:[[0,0],[0,1],[0,2],[1,1]]},                 // T
  {w:5,    c:[[0,0],[1,0],[1,1],[2,1]]},{w:5,c:[[0,1],[1,0],[1,1],[2,0]]}, // S/Z
  // —— 5格: 偏少 ——
  {w:2,    c:[[0,0],[0,1],[0,2],[0,3],[0,4]]},           // 5横
  {w:2,    c:[[0,0],[1,0],[2,0],[3,0],[4,0]]},           // 5竖
  // —— 方正大块 (实心矩形, 新手爽感主力; 常规局低权重点缀) ——
  {w:1.5,  c:[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]]},               // 2×3
  {w:1.5,  c:[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]]},               // 3×2
  {w:1.0,  c:[[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3]]},   // 2×4
  {w:1.0,  c:[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1]]},   // 4×2
  // —— 大块 ——
  {w:2.5,  c:[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]]}, // 九宫
];
const SHAPES = SHAPE_DEFS.map(s=>s.c);
const SHAPE_W = SHAPE_DEFS.map(s=>s.w);
const TOTAL_W = SHAPE_W.reduce((a,b)=>a+b,0);
// 按权重随机抽一个形状索引
function weightedShapeIdx(){
  let r=Math.random()*TOTAL_W;
  for(let i=0;i<SHAPE_W.length;i++){r-=SHAPE_W[i];if(r<=0)return i;}
  return SHAPE_W.length-1;
}

const emptyGrid = () => Array.from({length:SIZE},()=>Array(SIZE).fill(null));
const shapeDims = (cells)=>{let mr=0,mc=0;cells.forEach(([r,c])=>{mr=Math.max(mr,r);mc=Math.max(mc,c);});return{rows:mr+1,cols:mc+1};};
const canPlace = (grid,cells,r0,c0)=>cells.every(([dr,dc])=>{const r=r0+dr,c=c0+dc;return r>=0&&r<SIZE&&c>=0&&c<SIZE&&!grid[r][c];});
const countPlacements = (grid,cells)=>{let n=0;for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++)if(canPlace(grid,cells,r,c))n++;return n;};
const anyPlacement = (grid,shape)=>countPlacements(grid,shape.cells)>0;

const RECENT_MAX=8; // 记住最近8个发过的形状用于回避
const mkShape=(si)=>({cells:SHAPES[si],shapeIdx:si,color:COLORS[Math.floor(Math.random()*COLORS.length)],id:Math.random().toString(36).slice(2)});

// 选一个形状索引: 满足DG区间, 避开 exclude(本轮已发) 与 recent(近期历史)
function pickIdxForDG(grid,dg,exclude,recent){
  const [lo,hi]=DG_PLACEMENT[dg]||[0,64]; const target=(lo+hi)/2;
  const cand=[];
  for(let i=0;i<40;i++){
    const si=weightedShapeIdx();
    if(exclude.has(si))continue;               // 本轮三块互不重复
    const p=countPlacements(grid,SHAPES[si]);
    let fit; if(p<lo)fit=(lo-p)*1.2; else if(p>hi)fit=(p-hi); else fit=Math.abs(p-target)*0.3;
    const rIdx=recent.indexOf(si);             // 近期出现过 -> 加惩罚, 促进轮换
    const recentPenalty=rIdx>=0?(recent.length-rIdx)*6:0;
    cand.push({si,score:fit+recentPenalty});
  }
  if(!cand.length)return weightedShapeIdx();
  cand.sort((a,b)=>a.score-b.score);
  const pool=Math.min(cand.length,6);          // 前6个合格候选里随机, 难度达标又不千篇一律
  return cand[Math.floor(Math.random()*pool)].si;
}

function pickShapeForDG(grid,dg,recentRef){
  const recent=recentRef?.current||[];
  const si=pickIdxForDG(grid,dg,new Set(),recent);
  if(recentRef)recentRef.current=[...recent,si].slice(-RECENT_MAX);
  return mkShape(si);
}
// 发一轮三块: 本轮内互不重复, 并写入近期历史
function dealTray(grid,dg,recentRef){
  const recent=recentRef?.current||[];
  const used=new Set(); const out=[];
  for(let k=0;k<3;k++){
    const si=pickIdxForDG(grid,dg,used,recent.concat([...used]));
    used.add(si); out.push(mkShape(si));
  }
  if(recentRef)recentRef.current=[...recent,...used].slice(-RECENT_MAX);
  return out;
}

// ============== 新手第一关·极致爽感发牌 ==============
// 完全方正(实心矩形)的形状索引: cells 数量 == 行×列 即为实心矩形(含 2×2/2×3/2×4/3×3 及直条), 面积>=2
const isSolidRect=(cells)=>{const {rows,cols}=shapeDims(cells);return cells.length===rows*cols;};
const ROOKIE_SOLID=SHAPES.map((c,i)=>i).filter(i=>isSolidRect(SHAPES[i])&&SHAPES[i].length>=2);

// 在 grid 上放置 cells 于 (r,c) 并清除满行满列, 返回 {g:新棋盘, lines:消除行列数}
function applyAndClear(grid,cells,r,c){
  const g=grid.map(row=>row.slice());
  cells.forEach(([dr,dc])=>{g[r+dr][c+dc]=1;});
  const fr=[],fc=[];
  for(let rr=0;rr<SIZE;rr++)if(g[rr].every(Boolean))fr.push(rr);
  for(let cc=0;cc<SIZE;cc++){let full=true;for(let rr=0;rr<SIZE;rr++)if(!g[rr][cc]){full=false;break;}if(full)fc.push(cc);}
  fr.forEach(rr=>{for(let cc=0;cc<SIZE;cc++)g[rr][cc]=null;});
  fc.forEach(cc=>{for(let rr=0;rr<SIZE;rr++)g[rr][cc]=null;});
  return {g,lines:fr.length+fc.length};
}
// 找到 cells 在 grid 上的最佳落点: 优先能消除整行整列, 其次让接近满的行列更满, 再次面积大
function bestPlacement(grid,cells){
  let best=null;
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
    if(!canPlace(grid,cells,r,c))continue;
    const g=grid.map(row=>row.slice());
    cells.forEach(([dr,dc])=>{g[r+dr][c+dc]=1;});
    let lines=0,near=0;
    for(let rr=0;rr<SIZE;rr++){const f=g[rr].filter(Boolean).length;if(f===SIZE)lines++;else if(f>=SIZE-2)near+=f;}
    for(let cc=0;cc<SIZE;cc++){let f=0;for(let rr=0;rr<SIZE;rr++)if(g[rr][cc])f++;if(f===SIZE)lines++;else if(f>=SIZE-2)near+=f;}
    const score=lines*1000+near*4+cells.length;
    if(!best||score>best.score)best={r,c,score,lines};
  }
  return best;
}
// 发一轮三块"方正大块": 顺序模拟最佳落子, 让三块互相成全(填满 -> 连消), 制造新手极致爽感
function dealRookieTray(grid){
  let sim=grid.map(row=>row.slice());
  const out=[],used=new Set();
  for(let k=0;k<3;k++){
    let cands=ROOKIE_SOLID.filter(i=>!used.has(i)).map(i=>{const bp=bestPlacement(sim,SHAPES[i]);return bp?{i,bp}:null;}).filter(Boolean);
    if(!cands.length)cands=SHAPES.map((_,i)=>i).filter(i=>!used.has(i)).map(i=>{const bp=bestPlacement(sim,SHAPES[i]);return bp?{i,bp}:null;}).filter(Boolean);
    if(!cands.length){out.push(mkShape(weightedShapeIdx()));continue;}
    // 先按"消除行列数"再按"面积"排序, 在前若干名里随机, 既爽又不死板
    cands.sort((a,b)=> b.bp.score-a.bp.score || SHAPES[b.i].length-SHAPES[a.i].length);
    const topK=cands.slice(0,Math.min(3,cands.length));
    const chosen=topK[Math.floor(Math.random()*topK.length)];
    used.add(chosen.i);
    out.push(mkShape(chosen.i));
    sim=applyAndClear(sim,SHAPES[chosen.i],chosen.bp.r,chosen.bp.c).g; // 推进模拟棋盘, 让下一块互补
  }
  return out;
}
// 是否新手第一关(第1轮第1局) -> 启用爽感发牌
const isRookieLevel=(sched)=>sched.round===1&&sched.gameNo===1;
// 按当前调度状态发牌: 新手第一关走爽感发牌, 否则走常规 DG 发牌
const dealForState=(grid,sched,dg,recentRef)=>isRookieLevel(sched)?dealRookieTray(grid):dealTray(grid,dg,recentRef);

const resolveSlot=(loopIndex,recordPhase)=>recordPhase>0?`破纪录${recordPhase}`:DIFF_CYCLE[loopIndex];
const tierName=(ass)=>ass<TIER_THRESHOLDS.low?"低阶":ass>TIER_THRESHOLDS.high?"高阶":"中阶";
function resolveTemplate(tier,slot){
  const d=TEMPLATE_TABLE[`${tier}|${slot}`]; if(d)return{tpl:d,fallback:false};
  const order=["普通","困难","极难","破纪录1","破纪录2","破纪录3"];
  for(const s of order){const t=TEMPLATE_TABLE[`${tier}|${s}`];if(t)return{tpl:t,fallback:true};}
  const def={低阶:"L1",中阶:"L2''",高阶:"L4"}[tier]||"L2"; return{tpl:def,fallback:true};
}

// =====================================================================
export default function BlockBlast(){
  const [grid,setGrid]=useState(emptyGrid);
  const [tray,setTray]=useState(()=>dealRookieTray(emptyGrid())); // 进入游戏即新手第一关 -> 爽感发牌
  const [score,setScore]=useState(0);
  const [best,setBest]=useState(0);
  const [combo,setCombo]=useState(0);
  const [streakLeft,setStreakLeft]=useState(STREAK_WINDOW); // 还剩几步必须消除
  const [gameOver,setGameOver]=useState(false);
  const [clearing,setClearing]=useState(new Set());
  const [floats,setFloats]=useState([]);
  const [shake,setShake]=useState(false);
  const [drag,setDrag]=useState(null);
  const [hoverOrigin,setHoverOrigin]=useState(null);
  const [tool,setTool]=useState(null);
  const [powers,setPowers]=useState({undo:3,bomb:2,rowcol:2});
  const [canUndo,setCanUndo]=useState(false); // 是否有可撤销的上一步
  const undoSnapRef=useRef(null);              // 上一步放置前的完整快照
  const preGameBestRef=useRef(0);              // 本局开始前的历史最高分(用于破纪录判定)
  const [view,setView]=useState("play"); // "play" | "design"  演示视图切换
  const [cell,setCell]=useState(computeCell); // 响应式格宽, 随视口变化
  useEffect(()=>{
    const onResize=()=>setCell(computeCell());
    window.addEventListener("resize",onResize);
    window.addEventListener("orientationchange",onResize);
    return()=>{window.removeEventListener("resize",onResize);window.removeEventListener("orientationchange",onResize);};
  },[]);

  const [sched,setSched]=useState(()=>({
    round:1,loopIndex:0,recordPhase:0,gameNo:1,tier:"中阶",ass:0,
    recentScores:{普通:null,困难:null,极难:null},firstTiered:false,
    history:[], // 局间分数曲线 {gameNo,difficulty,tier,score}
  }));
  const [dgState,setDgState]=useState(()=>({tpl:"L2''",seq:TEMPLATES["L2''"],dgIdx:0,roundInDg:0}));

  // ===== 微观跳转运行时状态 =====
  // breakStreak: 连续未消除落子数(断杆)
  // jump: 当前激活的跳转 {code, dur(剩余作用组数), delta, special} 或 null
  // capped: 是否已进入2号DG6/DGS收尾循环
  // lastDgIdx: 用于检测"进入新一组(DG槽)"以递减dur
  const [microInfo,setMicroInfo]=useState({code:null,remain:0,delta:0,label:"未触发"});
  const microRef=useRef({breakStreak:0, jump:null, capped:false, lastDgIdx:0});

  const boardRef=useRef(null);
  const recentShapesRef=useRef([]); // 近期发过的形状索引, 用于发牌回避
  const trayRef=useRef(tray),gridRef=useRef(grid),comboRef=useRef(combo),streakRef=useRef(streakLeft);
  const dgRef=useRef(dgState),schedRef=useRef(sched),scoreRef=useRef(score);
  useEffect(()=>{trayRef.current=tray;},[tray]);
  useEffect(()=>{gridRef.current=grid;},[grid]);
  useEffect(()=>{comboRef.current=combo;},[combo]);
  useEffect(()=>{streakRef.current=streakLeft;},[streakLeft]);
  useEffect(()=>{dgRef.current=dgState;},[dgState]);
  useEffect(()=>{schedRef.current=sched;},[sched]);
  useEffect(()=>{scoreRef.current=score;},[score]);

  const curDG=dgState.seq[Math.min(dgState.dgIdx,dgState.seq.length-1)]; // 原定DG(宏观序列)
  // ===== 微观跳转: 在原定DG上施加当前激活跳转的偏移, 得到实际生效DG =====
  const applyJump=(baseDG)=>{
    const j=microRef.current.jump;
    if(!j) return baseDG;
    if(j.special==="DG6_DGS_LOOP"){
      // 2号: 原策略组走完后强制DG6/DGS交替循环到底(按DG槽位奇偶切换)
      return (dgRef.current.dgIdx % 2 === 0) ? "DG6" : "DGS";
    }
    return shiftDG(baseDG, j.delta);
  };
  const effectiveDG = applyJump(curDG);
  const curSlot=resolveSlot(sched.loopIndex,sched.recordPhase);
  const curDifficulty=sched.recordPhase>0?`破纪录${sched.recordPhase}`:DIFF_CYCLE[sched.loopIndex];

  const placeFloat=(text,color,big)=>{const id=Math.random().toString(36).slice(2);setFloats(f=>[...f,{id,text,color,big}]);setTimeout(()=>setFloats(f=>f.filter(x=>x.id!==id)),900);};
  const triggerShake=(big)=>{setShake(big?"big":true);setTimeout(()=>setShake(false),big?420:300);};

  // 触发一个微观跳转(从下一组生效, 不覆盖更重的2号封顶)
  const fireJump=(code)=>{
    const m=microRef.current;
    if(m.capped) return;                       // 已进入2号收尾循环, 不再被其它跳转打断
    const spec=MICRO_JUMP[code];
    if(code===2){ m.capped=true; }
    m.jump={code, dur:spec.dur, delta:spec.delta, special:spec.special, startSlot:dgRef.current.dgIdx};
    setMicroInfo({code, remain:spec.dur, delta:spec.delta, label:spec.label});
    placeFloat(spec.label, code>=4?"#ff7a3d":code===2?"#ff3d6b":"#3dd6e0");
  };
  // 跨入新DG槽时递减当前跳转的剩余组数, 归零则回归原路径
  const onEnterNewSlot=()=>{
    const m=microRef.current;
    if(!m.jump || m.jump.special==="DG6_DGS_LOOP") return; // 2号无限循环, 不递减
    m.jump.dur-=1;
    if(m.jump.dur<=0){ m.jump=null; setMicroInfo({code:null,remain:0,delta:0,label:"未触发"}); }
    else setMicroInfo(mi=>({...mi,remain:m.jump.dur}));
  };

  const advanceDG=()=>{setDgState(d=>{
    let ri=d.roundInDg+1,di=d.dgIdx;
    if(ri>=DG_ROUNDS){ri=0;di=d.dgIdx+1; onEnterNewSlot();} // 进入新一组DG槽 -> 递减跳转
    return{...d,roundInDg:ri,dgIdx:di};
  });};

  // ====== 放置 + 真实计分 + 微观跳转触发 ======
  const place=(idx,r0,c0)=>{
    const curTray=trayRef.current,curGrid=gridRef.current;
    const shape=curTray[idx];
    if(!shape||!canPlace(curGrid,shape.cells,r0,c0))return false;

    // —— 捕获放置前的完整快照, 供Undo回滚 ——
    undoSnapRef.current={
      grid:curGrid.map(row=>row.slice()),
      tray:curTray.map(s=>s?{...s}:null),
      score:scoreRef.current, combo:comboRef.current, streakLeft:streakRef.current,
      dgState:{...dgRef.current},
      recent:[...recentShapesRef.current],
      micro:{breakStreak:microRef.current.breakStreak, jump:microRef.current.jump?{...microRef.current.jump}:null, capped:microRef.current.capped, lastDgIdx:microRef.current.lastDgIdx},
      microInfo:{...microInfo},
    };
    setCanUndo(true);

    const g=curGrid.map(row=>row.slice());
    shape.cells.forEach(([dr,dc])=>{g[r0+dr][c0+dc]=shape.color;});

    // 落子保底分: 每格+1
    const placeGain=shape.cells.length*SCORE.perCellPlace;

    // 找满行满列
    const fullRows=[],fullCols=[];
    for(let r=0;r<SIZE;r++)if(g[r].every(c=>c))fullRows.push(r);
    for(let c=0;c<SIZE;c++)if(g.every(row=>row[c]))fullCols.push(c);
    const lines=fullRows.length+fullCols.length;

    // ---- 微观跳转触发检测(在推进DG/发牌之前) ----
    const m=microRef.current;
    const inRecordGroup = sched.recordPhase>0; // 是否在破纪录节点局组内
    // 本步消除后的棋盘(用于占用率与全清判定)
    const afterGrid = g.map(row=>row.slice());
    const keysTmp=new Set();
    fullRows.forEach(r=>{for(let c=0;c<SIZE;c++)keysTmp.add(`${r}-${c}`);});
    fullCols.forEach(c=>{for(let r=0;r<SIZE;r++)keysTmp.add(`${r}-${c}`);});
    keysTmp.forEach(k=>{const[r,c]=k.split("-").map(Number);afterGrid[r][c]=null;});

    if(inRecordGroup){
      // === 破纪录局组专用触发器(独立, 不用断杆/连击) ===
      const occupied = afterGrid.flat().filter(Boolean).length;
      const fillRatio = occupied / (SIZE*SIZE);
      const projScore = scoreRef.current + placeGain;
      // 占用率 >= 85% -> 1号 降难助攻(让玩家别这么早死, 继续冲纪录)
      if(fillRatio >= RECORD_FILL_RATIO) fireJump(1);
      // 分数 >= best*120% -> 2号 增难压制(稳赢纪录时压制破纪录幅度)
      if(best>0 && !m.capped && projScore >= best*RECORD_LEAD_RATIO) fireJump(2);
      // 断杆计数仍维护(供面板显示), 但不触发常规跳转
      m.breakStreak = lines===0 ? m.breakStreak+1 : 0;
    } else {
      // === 常规局触发器: 断杆/连击/全清 ===
      const trig = MICRO_TRIGGERS[curDifficulty] || MICRO_TRIGGERS.普通;
      if(lines===0){
        m.breakStreak += 1;
        if(m.breakStreak >= trig.breakN) fireJump(3); // 断杆 -> 3号(降1级×1组)
      } else {
        m.breakStreak = 0;
        const newComboVal = comboRef.current + 1;
        if(newComboVal >= trig.comboN) fireJump(4);    // 连击 -> 4号(升1级×1组)
        if(afterGrid.every(row=>row.every(c=>!c))) fireJump(5); // 全清 -> 5号(升2级×2组)
      }
    }

    advanceDG();
    const baseDGForDeal=dgRef.current.seq[Math.min(dgRef.current.dgIdx,dgRef.current.seq.length-1)];
    const dgForDeal=applyJump(baseDGForDeal); // 跳转后的实际生效DG
    const newTrayArr=curTray.slice(); newTrayArr[idx]=null;
    let finalTray=newTrayArr;
    if(newTrayArr.every(s=>s===null))finalTray=dealForState(g,schedRef.current,dgForDeal,recentShapesRef);
    setTray(finalTray);

    if(lines===0){
      // 没消除: 推进断条
      setScore(s=>s+placeGain);
      const left=streakRef.current-1;
      if(left<=0){ if(comboRef.current>0)placeFloat("连击中断",("#8892a6"));setCombo(0);setStreakLeft(STREAK_WINDOW);}
      else setStreakLeft(left);
      setGrid(g);
      setTimeout(()=>{const rem=finalTray.filter(Boolean);if(rem.length&&!rem.some(s=>anyPlacement(g,s)))endGame();},0);
      return true;
    }

    // 有消除: 计分
    const cellsCleared=fullRows.length*SIZE+fullCols.length*SIZE-(fullRows.length*fullCols.length);
    const baseClear=cellsCleared*SCORE.perCellClear;
    const lineMult=SCORE.lineMult[Math.min(lines,5)]||SCORE.lineMult[5];
    const newCombo=comboRef.current+1;
    const comboMult=1+newCombo*SCORE.comboStep;
    const gain=Math.round((placeGain+baseClear*lineMult)*comboMult);

    setCombo(newCombo); setStreakLeft(STREAK_WINDOW);

    const keys=new Set();
    fullRows.forEach(r=>{for(let c=0;c<SIZE;c++)keys.add(`${r}-${c}`);});
    fullCols.forEach(c=>{for(let r=0;r<SIZE;r++)keys.add(`${r}-${c}`);});
    setClearing(keys);

    const big=lines>=2;
    triggerShake(big);

    const label=`+${gain}`+(lines>=2?`  ${lines}连消!`:"")+(newCombo>1?`  ×${comboMult.toFixed(1)} COMBO`:"");
    placeFloat(label, lines>=4?"#ffd23d":lines>=2?"#ffa63d":"#5ee07a", big);

    setTimeout(()=>{
      const cleared=g.map(row=>row.slice());
      keys.forEach(k=>{const[r,c]=k.split("-").map(Number);cleared[r][c]=null;});
      setClearing(new Set()); setScore(s=>s+gain); setGrid(cleared);
      const rem=finalTray.filter(Boolean);
      if(rem.length&&!rem.some(s=>anyPlacement(cleared,s)))endGame();
    }, big?320:280);
    return true;
  };

  const endGame=()=>setGameOver(true);

  const nextGame=(finalScore)=>{
    const brokeRecord = finalScore > preGameBestRef.current && preGameBestRef.current >= 0;
    setSched(prev=>{
      const s={...prev,recentScores:{...prev.recentScores},history:[...prev.history]};
      const diff=prev.recordPhase>0?"普通":DIFF_CYCLE[prev.loopIndex];
      if(["普通","困难","极难"].includes(diff))s.recentScores[diff]=finalScore;
      s.history.push({gameNo:prev.gameNo,difficulty:prev.recordPhase>0?`破纪录${prev.recordPhase}`:diff,tier:prev.tier,score:finalScore,broke:prev.recordPhase>0&&brokeRecord});

      if(!s.firstTiered&&prev.gameNo>=3){
        const {普通,困难,极难}=s.recentScores;
        if(普通!=null&&困难!=null&&极难!=null){s.ass=Math.round((普通+困难+极难)/3);s.tier=tierName(s.ass);s.firstTiered=true;}
      }
      s.gameNo=prev.gameNo+1;
      if(prev.recordPhase>0){
        // 在破纪录节点局组内: 破纪录 或 走完第3局 -> 结束局组, 复评, 开新一轮
        const groupEnds = brokeRecord || prev.recordPhase>=RECORD_GROUP_LEN;
        if(groupEnds){
          const {普通,困难,极难}=s.recentScores;
          if(普通!=null&&困难!=null&&极难!=null){s.ass=Math.round((普通+困难+极难)/3);s.tier=tierName(s.ass);}
          s.round=prev.round+1;s.loopIndex=0;s.recordPhase=0;
          s.lastGroupEndReason = brokeRecord ? "破纪录提前结束" : "走满3局结束";
        } else s.recordPhase=prev.recordPhase+1;
      } else {
        if(prev.loopIndex>=DIFF_CYCLE.length-1)s.recordPhase=1;
        else s.loopIndex=prev.loopIndex+1;
      }
      return s;
    });
  };

  const startKey=`${sched.round}-${sched.gameNo}`;
  const startKeyRef=useRef(null);
  useEffect(()=>{
    if(startKeyRef.current===startKey)return;
    startKeyRef.current=startKey;
    preGameBestRef.current=Math.max(best,0); // 记录本局开始前的历史最高分
    const slot=resolveSlot(sched.loopIndex,sched.recordPhase);
    const {tpl}=resolveTemplate(sched.tier,slot);
    const seq=TEMPLATES[tpl]||TEMPLATES["L2''"];
    const fresh=emptyGrid();
    setGrid(fresh);setDgState({tpl,seq,dgIdx:0,roundInDg:0});recentShapesRef.current=[];
    microRef.current={breakStreak:0,jump:null,capped:false,lastDgIdx:0};
    setMicroInfo({code:null,remain:0,delta:0,label:"未触发"});
    setTray(dealForState(fresh,sched,seq[0],recentShapesRef));
    setScore(0);setCombo(0);setStreakLeft(STREAK_WINDOW);setGameOver(false);setTool(null);
    setPowers({undo:3,bomb:2,rowcol:2});setDrag(null);setHoverOrigin(null);setCanUndo(false);undoSnapRef.current=null;
  },[startKey]); // eslint-disable-line

  // ====== 拖拽 ======
  const computeOrigin=(cx,cy,aR,aC)=>{const b=boardRef.current;if(!b)return null;const rect=b.getBoundingClientRect();const px=cx-rect.left-PAD,py=cy-rect.top-PAD;return{r:Math.floor(py/(cell+GAP))-aR,c:Math.floor(px/(cell+GAP))-aC};};
  const onPiecePointerDown=(e,idx)=>{
    if(tool)return;const shape=tray[idx];if(!shape)return;
    e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);
    const prect=e.currentTarget.getBoundingClientRect();const {rows,cols}=shapeDims(shape.cells);const u=19;
    let aC=Math.floor((e.clientX-prect.left-(prect.width-cols*u)/2)/u);
    let aR=Math.floor((e.clientY-prect.top-(prect.height-rows*u)/2)/u);
    aR=Math.max(0,Math.min(rows-1,aR));aC=Math.max(0,Math.min(cols-1,aC));
    setDrag({idx,shape,x:e.clientX,y:e.clientY,anchorR:aR,anchorC:aC});
  };
  useEffect(()=>{
    if(!drag)return;
    const move=e=>{const x=e.clientX,y=e.clientY;setDrag(d=>d?{...d,x,y}:d);setHoverOrigin(computeOrigin(x,y,drag.anchorR,drag.anchorC));};
    const up=e=>{const o=computeOrigin(e.clientX,e.clientY,drag.anchorR,drag.anchorC);if(o&&canPlace(gridRef.current,drag.shape.cells,o.r,o.c))place(drag.idx,o.r,o.c);setDrag(null);setHoverOrigin(null);};
    window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);window.addEventListener("pointercancel",up);
    return()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);window.removeEventListener("pointercancel",up);};
  },[drag]);

  // ====== 道具 ======
  const useToolOnCell=(r,c)=>{
    if(tool==="bomb"){if(powers.bomb<=0)return;const g=grid.map(row=>row.slice());let rm=0;
      for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<SIZE&&nc>=0&&nc<SIZE&&g[nr][nc]){g[nr][nc]=null;rm++;}}
      if(rm){triggerShake();placeFloat(`💣 -${rm}`,"#ff5e7e");setScore(s=>s+rm*2);}
      setGrid(g);setPowers(p=>({...p,bomb:p.bomb-1}));setTool(null);setCanUndo(false);undoSnapRef.current=null;revive(g);
    }else if(tool==="rowcol"){if(powers.rowcol<=0)return;const g=grid.map(row=>row.slice());let rm=0;
      for(let cc=0;cc<SIZE;cc++)if(g[r][cc]){g[r][cc]=null;rm++;}for(let rr=0;rr<SIZE;rr++)if(g[rr][c]){g[rr][c]=null;rm++;}
      if(rm){triggerShake();placeFloat(`✚ -${rm}`,"#3dd6e0");setScore(s=>s+rm*2);}
      setGrid(g);setPowers(p=>({...p,rowcol:p.rowcol-1}));setTool(null);setCanUndo(false);undoSnapRef.current=null;revive(g);
    }
  };
  // 撤销上一步: 从快照完整回滚棋盘/托盘/分数/连击/DG进度/跳转状态
  const doUndo=()=>{
    if(powers.undo<=0) return;
    const snap=undoSnapRef.current;
    if(!snap){ placeFloat("无可撤销步骤","#8892a6"); return; }
    setGrid(snap.grid.map(row=>row.slice()));
    setTray(snap.tray.map(s=>s?{...s}:null));
    setScore(snap.score); setCombo(snap.combo); setStreakLeft(snap.streakLeft);
    setDgState({...snap.dgState});
    recentShapesRef.current=[...snap.recent];
    microRef.current={breakStreak:snap.micro.breakStreak, jump:snap.micro.jump?{...snap.micro.jump}:null, capped:snap.micro.capped, lastDgIdx:snap.micro.lastDgIdx};
    setMicroInfo({...snap.microInfo});
    setGameOver(false);
    setPowers(p=>({...p,undo:p.undo-1}));
    setCanUndo(false); undoSnapRef.current=null;
    setTool(null);
    placeFloat("↩ 撤销","#5e8bff");
  };
  const revive=(g)=>{const rem=trayRef.current.filter(Boolean);if(gameOver&&rem.some(s=>anyPlacement(g,s)))setGameOver(false);};

  useEffect(()=>{setBest(b=>Math.max(b,score));},[score]);

  const previewKeys=(()=>{if(!drag||!hoverOrigin)return null;const ok=canPlace(grid,drag.shape.cells,hoverOrigin.r,hoverOrigin.c);const keys=new Set();if(ok)drag.shape.cells.forEach(([dr,dc])=>keys.add(`${hoverOrigin.r+dr}-${hoverOrigin.c+dc}`));return{ok,keys,color:drag.shape.color};})();
  const {tpl}=resolveTemplate(sched.tier,curSlot);

  return (
    <div style={S.wrap}>
      <style>{css}</style>

      <div style={S.header}>
        <div style={S.title}>BLOCK <span style={{color:"#ffd23d"}}>BLAST</span></div>
        <div style={S.viewToggle}>
          <button className={`vt ${view==="play"?"on":""}`} onClick={()=>setView("play")}>体验视图</button>
          <button className={`vt ${view==="design"?"on":""}`} onClick={()=>setView("design")}>难度调控</button>
        </div>
      </div>

      <div style={S.scoreStrip}>
        <div style={S.scoreBox}><div style={S.scoreLabel}>SCORE</div><div style={S.scoreVal}>{score}</div></div>
        <div style={S.scoreBox}><div style={S.scoreLabel}>BEST</div><div style={{...S.scoreVal,color:"#ffa63d"}}>{Math.max(best,score)}</div></div>
        <div style={S.comboLive}>
          <div style={S.scoreLabel}>COMBO</div>
          <div style={{...S.scoreVal,color:combo>0?"#5ee07a":"#445"}}>×{(1+combo*SCORE.comboStep).toFixed(1)}</div>
          <div style={S.streakDots}>
            {Array.from({length:STREAK_WINDOW}).map((_,i)=><span key={i} className="sdot" style={{background:i<streakLeft?"#5ee07a":"#3a3a55"}}/>)}
          </div>
        </div>
      </div>

      {/* 调度状态条 */}
      <div style={S.statusBar}>
        <span style={S.tag}>第{sched.round}轮·第{sched.gameNo}局</span>
        <span style={{...S.tag,background:diffColor(curDifficulty)}}>{curDifficulty}</span>
        <span style={{...S.tag,background:tierColor(sched.tier)}}>{sched.tier}</span>
        {isRookieLevel(sched)&&<span style={{...S.tag,background:"linear-gradient(135deg,#ff5ed4,#ffa63d)",color:"#1a0f2e"}}>🌟 新手爽局</span>}
        {view==="design"&&<><span style={{...S.tag,background:"#3a2f66"}}>{tpl}</span><span style={{...S.tag,background:"#5e3d8b"}}>{curDG}</span></>}
      </div>

      {combo>1&&!gameOver&&<div style={S.comboBanner}>🔥 连击 ×{combo} · 倍率 ×{(1+combo*SCORE.comboStep).toFixed(1)}</div>}

      <div style={S.boardZone}>
        <div ref={boardRef} className={shake?`board shake${shake==="big"?" big":""}`:"board"} style={{...S.board,gridTemplateColumns:`repeat(${SIZE},${cell}px)`,gridTemplateRows:`repeat(${SIZE},${cell}px)`,"--cell":`${cell}px`,cursor:tool?"crosshair":"default",touchAction:"none"}}>
          {grid.map((row,r)=>row.map((cell,c)=>{const key=`${r}-${c}`;const isC=clearing.has(key);const inP=previewKeys?.keys.has(key);let cls="cell";if(cell)cls+=" filled";if(isC)cls+=" clearing";if(inP&&previewKeys.ok)cls+=" preview";return <div key={key} className={cls} style={{background:cell||undefined,"--cc":inP?previewKeys.color:cell}} onClick={()=>tool&&useToolOnCell(r,c)} />;}))}
          {floats.map(f=><div key={f.id} className={f.big?"floatScore big":"floatScore"} style={{color:f.color}}>{f.text}</div>)}
        </div>
      </div>

      <div style={S.powerRow}>
        <button className="power" onClick={doUndo} disabled={powers.undo<=0||!canUndo}><span className="picon">↩</span><span className="plabel">Undo</span><span className="pcount">{powers.undo}</span></button>
        <button className={`power ${tool==="bomb"?"active":""}`} onClick={()=>setTool(tool==="bomb"?null:"bomb")} disabled={powers.bomb<=0}><span className="picon">💣</span><span className="plabel">Bomb</span><span className="pcount">{powers.bomb}</span></button>
        <button className={`power ${tool==="rowcol"?"active":""}`} onClick={()=>setTool(tool==="rowcol"?null:"rowcol")} disabled={powers.rowcol<=0}><span className="picon">✚</span><span className="plabel">Line</span><span className="pcount">{powers.rowcol}</span></button>
      </div>
      {tool&&<div style={S.toolHint}>{tool==="bomb"?"点格子炸 3×3":"点格子清整行整列"} · <span style={{textDecoration:"underline",cursor:"pointer"}} onClick={()=>setTool(null)}>取消</span></div>}

      <div style={S.tray}>
        {tray.map((shape,i)=><TrayPiece key={i} shape={shape} dragging={drag?.idx===i} onPointerDown={e=>onPiecePointerDown(e,i)} />)}
      </div>
      <div style={S.howto}>拖动方块到棋盘放置 · 填满整行/列消除 · {STREAK_WINDOW}步内不消除则断连击</div>

      {/* 难度调控视图: 调试面板 + 曲线 */}
      {view==="design"&&(
        <div style={S.debugWrap}>
          <div style={S.debugHead}>⚙ 难度调控 · 实时调度状态</div>
          <div style={S.debugBody}>
            <Row k="当前轮次" v={`第 ${sched.round} 轮`} />
            <Row k="循环位置" v={sched.recordPhase>0?`破纪录节点局组 ${sched.recordPhase}/${RECORD_GROUP_LEN}`:`序列 ${sched.loopIndex+1}/10`} />
            <Row k="本局难度 / slot" v={`${curDifficulty} / ${curSlot}`} />
            <Row k="玩家层级 / ASS" v={`${sched.tier}${sched.firstTiered?"":"(默认)"} · ASS ${sched.ass}`} hi />
            <Row k="最近三难度分" v={`普${fmt(sched.recentScores.普通)}/难${fmt(sched.recentScores.困难)}/极${fmt(sched.recentScores.极难)}`} />
            <Row k="选中模板" v={tpl} hi />
            <Row k="DG序列" v={dgState.seq.map((d,i)=>i===Math.min(dgState.dgIdx,dgState.seq.length-1)?`[${d}]`:d).join(" ")} />
            <Row k="当前DG(原定)" v={`${curDG} (第${dgState.roundInDg+1}/${DG_ROUNDS}轮)`} hi />
            <Row k="微观跳转后(实际)" v={effectiveDG===curDG?`${effectiveDG} · 未跳转`:`${curDG} → ${effectiveDG}`} hi />
            <Row k="发牌可解路径区间" v={DG_PLACEMENT[effectiveDG]?`${DG_PLACEMENT[effectiveDG][0]} ~ ${DG_PLACEMENT[effectiveDG][1]}`:"—"} />
            <Row k="激活的微观跳转" v={microInfo.code?`${microInfo.label}${microInfo.remain!==Infinity?` · 余${microInfo.remain}组`:" · 至局末"}`:"未触发"} hi />
            {sched.recordPhase>0 ? (
              <>
                <Row k="破纪录组触发器" v={`占用≥85%→1号降难 · 分数≥best×1.2→2号增难`} />
                <Row k="当前占用率" v={`${Math.round(grid.flat().filter(Boolean).length/(SIZE*SIZE)*100)}%`} hi />
                <Row k="本局分 / 纪录线" v={`${score} / ${preGameBestRef.current}  (破纪录线 ${preGameBestRef.current+1})`} hi />
              </>
            ) : (
              <>
                <Row k="本局触发阈值" v={`断杆≥${(MICRO_TRIGGERS[curDifficulty]||MICRO_TRIGGERS.普通).breakN} 连击≥${(MICRO_TRIGGERS[curDifficulty]||MICRO_TRIGGERS.普通).comboN}`} />
                <Row k="当前断杆 / 连击" v={`${microRef.current.breakStreak} / ${combo}`} />
              </>
            )}
            <div style={{marginTop:8,display:"flex",gap:8,flexWrap:"wrap"}}>
              <button style={S.dbgBtn} onClick={()=>setSched(s=>({...s,ass:200,tier:"低阶",firstTiered:true}))}>低阶(200)</button>
              <button style={S.dbgBtn} onClick={()=>setSched(s=>({...s,ass:600,tier:"中阶",firstTiered:true}))}>中阶(600)</button>
              <button style={S.dbgBtn} onClick={()=>setSched(s=>({...s,ass:1000,tier:"高阶",firstTiered:true}))}>高阶(1000)</button>
            </div>
            <ScoreCurve history={sched.history} />
          </div>
        </div>
      )}

      {drag&&<DragGhost drag={drag} cell={cell} />}

      {gameOver&&(()=>{
        const broke = score>preGameBestRef.current;
        const inGroup = sched.recordPhase>0;
        return (
        <div style={S.overlay}><div style={S.modal}>
          <div style={{...S.goTitle,color:broke?"#ffd23d":"#ff5e7e"}}>{broke?"🏆 打破纪录!":"本局结束"}</div>
          <div style={S.goScore}>{score}</div>
          <div style={S.goLabel}>
            {curDifficulty}局 · 第{sched.gameNo}局
            {inGroup && <><br/>{broke?"破纪录 → 局组提前结束, 开启新一轮":(sched.recordPhase>=RECORD_GROUP_LEN?"破纪录组走满3局, 开启新一轮":"未破纪录 → 进入组内下一局")}</>}
          </div>
          <button style={S.playBtn} onClick={()=>nextGame(score)}>{inGroup&&(broke||sched.recordPhase>=RECORD_GROUP_LEN)?"新一轮 ▶":"下一局 ▶"}</button>
        </div></div>
        );
      })()}
    </div>
  );
}

const fmt=(v)=>v==null?"—":v;
const Row=({k,v,hi})=>(<div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"3px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}><span style={{opacity:0.6,fontSize:11,whiteSpace:"nowrap"}}>{k}</span><span style={{fontSize:11,fontWeight:700,textAlign:"right",color:hi?"#ffd23d":"#fff",fontFamily:"monospace"}}>{v}</span></div>);
const diffColor=(d)=>d==="普通"?"#3d7a4a":d==="困难"?"#9b6b1f":d==="极难"?"#9b2f3d":"#5e3d8b";
const tierColor=(t)=>t==="低阶"?"#2f6b8b":t==="中阶"?"#6b5e1f":"#8b3d6b";

// 局间分数曲线 (展示"局外过山车")
function ScoreCurve({history}){
  if(!history.length)return <div style={{fontSize:11,opacity:0.5,marginTop:10}}>完成一局后这里出现局间分数曲线</div>;
  const W=380,H=90,pad=18;
  const max=Math.max(...history.map(h=>h.score),100);
  const stepX=history.length>1?(W-pad*2)/(history.length-1):0;
  const pts=history.map((h,i)=>[pad+i*stepX, H-pad-(h.score/max)*(H-pad*2)]);
  const path=pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
  return (
    <div style={{marginTop:12}}>
      <div style={{fontSize:11,opacity:0.6,marginBottom:4}}>局间分数曲线 (过山车体验)</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
        <line x1={pad} y1={H-pad} x2={W-pad} y2={H-pad} stroke="rgba(255,255,255,0.15)" />
        <path d={path} fill="none" stroke="#ffd23d" strokeWidth="2" />
        {pts.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill={diffColor(history[i].difficulty)} stroke="#fff" strokeWidth="1" />)}
      </svg>
      <div style={{display:"flex",gap:10,fontSize:9,opacity:0.6,flexWrap:"wrap",marginTop:2}}>
        <Legend c="#3d7a4a" t="普通"/><Legend c="#9b6b1f" t="困难"/><Legend c="#9b2f3d" t="极难"/><Legend c="#5e3d8b" t="破纪录"/>
      </div>
    </div>
  );
}
const Legend=({c,t})=>(<span style={{display:"inline-flex",alignItems:"center",gap:3}}><span style={{width:8,height:8,borderRadius:"50%",background:c,display:"inline-block"}}/>{t}</span>);

function TrayPiece({shape,dragging,onPointerDown}){
  if(!shape)return <div style={S.traySlot}/>;
  const {rows,cols}=shapeDims(shape.cells);const set=new Set(shape.cells.map(([r,c])=>`${r}-${c}`));const u=17;
  return <div className="trayPiece" style={{...S.trayPiece,opacity:dragging?0.25:1,touchAction:"none"}} onPointerDown={onPointerDown}><div style={{display:"grid",gridTemplateColumns:`repeat(${cols},${u}px)`,gridTemplateRows:`repeat(${rows},${u}px)`,gap:2}}>{Array.from({length:rows*cols}).map((_,idx)=>{const r=Math.floor(idx/cols),c=idx%cols;const on=set.has(`${r}-${c}`);return <div key={idx} style={{width:u,height:u,borderRadius:4,background:on?shape.color:"transparent",boxShadow:on?"inset 0 -3px 0 rgba(0,0,0,0.25),inset 0 2px 0 rgba(255,255,255,0.3)":"none"}}/>;})}</div></div>;
}
function DragGhost({drag,cell=CELL}){
  const {shape}=drag;const {rows,cols}=shapeDims(shape.cells);const set=new Set(shape.cells.map(([r,c])=>`${r}-${c}`));
  const left=drag.x-(drag.anchorC+0.5)*(cell+GAP),top=drag.y-(drag.anchorR+0.5)*(cell+GAP);
  return <div style={{position:"fixed",left,top,pointerEvents:"none",zIndex:200,display:"grid",gridTemplateColumns:`repeat(${cols},${cell}px)`,gridTemplateRows:`repeat(${rows},${cell}px)`,gap:GAP,filter:"drop-shadow(0 8px 16px rgba(0,0,0,0.5))"}}>{Array.from({length:rows*cols}).map((_,idx)=>{const r=Math.floor(idx/cols),c=idx%cols;const on=set.has(`${r}-${c}`);return <div key={idx} style={{width:cell,height:cell,borderRadius:7,background:on?shape.color:"transparent",boxShadow:on?"inset 0 -4px 0 rgba(0,0,0,0.28),inset 0 3px 0 rgba(255,255,255,0.35)":"none"}}/>;})}</div>;
}

const css=`
@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@700;800;900&display=swap');
*{box-sizing:border-box;}
.board{position:relative;}
.cell{width:var(--cell,38px);height:var(--cell,38px);border-radius:7px;background:rgba(255,255,255,0.04);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.04);transition:transform .08s,background .1s;}
.cell.filled{box-shadow:inset 0 -4px 0 rgba(0,0,0,0.28),inset 0 3px 0 rgba(255,255,255,0.35);}
.cell.preview{background:var(--cc)!important;opacity:.55;}
.cell.clearing{animation:pop .3s ease forwards;}
@keyframes pop{0%{transform:scale(1);}40%{transform:scale(1.3);filter:brightness(2);}100%{transform:scale(0);opacity:0;}}
.board.shake{animation:shk .3s;}
.board.shake.big{animation:shkBig .42s;}
@keyframes shk{0%,100%{transform:translateX(0);}20%{transform:translateX(-5px);}40%{transform:translateX(5px);}60%{transform:translateX(-3px);}80%{transform:translateX(3px);}}
@keyframes shkBig{0%,100%{transform:translate(0,0) scale(1);}15%{transform:translate(-8px,3px) scale(1.01);}30%{transform:translate(8px,-3px);}45%{transform:translate(-6px,2px);}60%{transform:translate(6px,-2px) scale(1.01);}80%{transform:translate(-3px,1px);}}
.floatScore{position:absolute;top:42%;left:50%;transform:translateX(-50%);font-family:'Nunito',sans-serif;font-weight:900;font-size:22px;text-shadow:0 2px 8px rgba(0,0,0,0.6);pointer-events:none;white-space:nowrap;animation:floatUp .9s ease-out forwards;z-index:10;}
.floatScore.big{font-size:30px;animation:floatBig 1s ease-out forwards;}
@keyframes floatUp{0%{opacity:0;transform:translate(-50%,10px) scale(0.7);}25%{opacity:1;transform:translate(-50%,-4px) scale(1.1);}100%{opacity:0;transform:translate(-50%,-50px) scale(1);}}
@keyframes floatBig{0%{opacity:0;transform:translate(-50%,14px) scale(0.5);}20%{opacity:1;transform:translate(-50%,-8px) scale(1.35);}45%{transform:translate(-50%,-12px) scale(1.1);}100%{opacity:0;transform:translate(-50%,-64px) scale(1);}}
.trayPiece{cursor:grab;padding:8px;border-radius:12px;transition:transform .12s,background .12s;}
.trayPiece:hover{background:rgba(255,255,255,0.05);transform:translateY(-2px);}
.trayPiece:active{cursor:grabbing;}
.power{display:flex;flex-direction:column;align-items:center;gap:1px;position:relative;border:none;cursor:pointer;background:rgba(255,255,255,0.06);border-radius:14px;padding:9px 16px;color:#fff;font-family:'Baloo 2',sans-serif;font-weight:700;transition:transform .1s,background .1s;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);}
.power:hover:not(:disabled){background:rgba(255,255,255,0.12);transform:translateY(-2px);}
.power:disabled{opacity:.35;cursor:not-allowed;}
.power.active{background:rgba(255,210,61,0.2);box-shadow:0 0 0 2px #ffd23d,0 0 16px rgba(255,210,61,0.5);}
.picon{font-size:22px;line-height:1;}.plabel{font-size:11px;opacity:.85;letter-spacing:.5px;}
.pcount{position:absolute;top:-6px;right:-4px;background:#ff5e7e;color:#fff;font-size:11px;font-weight:800;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.3);}
.vt{border:none;cursor:pointer;background:rgba(255,255,255,0.06);color:#aaa;font-family:'Baloo 2',sans-serif;font-weight:700;font-size:12px;padding:6px 12px;border-radius:9px;transition:all .12s;}
.vt.on{background:#ffd23d;color:#15102e;}
.sdot{width:7px;height:7px;border-radius:50%;display:inline-block;transition:background .2s;}
`;

const S={
  wrap:{minHeight:"100vh",width:"100%",background:"radial-gradient(circle at 30% 8%, #2a2350 0%, #15102e 50%, #0b0820 100%)",fontFamily:"'Baloo 2',sans-serif",color:"#fff",display:"flex",flexDirection:"column",alignItems:"center",padding:"18px 16px 40px",userSelect:"none",position:"relative",overflow:"hidden"},
  header:{width:"100%",maxWidth:420,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10},
  title:{fontFamily:"'Nunito',sans-serif",fontWeight:900,fontSize:26,letterSpacing:1,textShadow:"0 3px 0 rgba(0,0,0,0.3)"},
  viewToggle:{display:"flex",gap:5},
  scoreStrip:{width:"100%",maxWidth:420,display:"flex",gap:8,marginBottom:8,alignItems:"stretch"},
  scoreBox:{flex:1,background:"rgba(255,255,255,0.07)",borderRadius:12,padding:"6px 10px",textAlign:"center"},
  scoreLabel:{fontSize:10,opacity:.6,letterSpacing:1},
  scoreVal:{fontFamily:"'Nunito',sans-serif",fontWeight:900,fontSize:20,color:"#ffd23d"},
  comboLive:{flex:1,background:"rgba(255,255,255,0.07)",borderRadius:12,padding:"6px 10px",textAlign:"center",position:"relative"},
  streakDots:{display:"flex",gap:4,justifyContent:"center",marginTop:3},
  statusBar:{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"center",marginBottom:8,maxWidth:420},
  tag:{fontSize:11,fontWeight:700,padding:"3px 9px",borderRadius:8,background:"#2a2350",letterSpacing:.5},
  comboBanner:{fontFamily:"'Nunito',sans-serif",fontWeight:900,fontSize:15,color:"#ffa63d",marginBottom:4},
  boardZone:{padding:4,marginBottom:12},
  board:{display:"grid",gridTemplateColumns:`repeat(${SIZE},${CELL}px)`,gridTemplateRows:`repeat(${SIZE},${CELL}px)`,gap:GAP,padding:PAD,borderRadius:16,background:"rgba(0,0,0,0.28)",boxShadow:"0 12px 40px rgba(0,0,0,0.4),inset 0 0 0 1px rgba(255,255,255,0.06)"},
  powerRow:{display:"flex",gap:12,marginBottom:6},
  toolHint:{fontSize:12,opacity:.8,marginBottom:8,textAlign:"center"},
  tray:{display:"flex",justifyContent:"center",alignItems:"center",gap:6,marginTop:6,minHeight:92,width:"100%",maxWidth:420},
  traySlot:{width:90,height:90},
  trayPiece:{display:"flex",alignItems:"center",justifyContent:"center",minWidth:90,minHeight:90},
  howto:{fontSize:11,opacity:.5,marginTop:8,textAlign:"center"},
  debugWrap:{width:"100%",maxWidth:420,marginTop:14,background:"rgba(0,0,0,0.3)",borderRadius:12,overflow:"hidden",boxShadow:"inset 0 0 0 1px rgba(255,255,255,0.08)"},
  debugHead:{padding:"8px 14px",fontWeight:700,fontSize:13,background:"rgba(255,255,255,0.05)"},
  debugBody:{padding:"8px 14px 14px"},
  dbgBtn:{border:"none",cursor:"pointer",background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:11,fontWeight:700,padding:"5px 10px",borderRadius:8,fontFamily:"'Baloo 2',sans-serif"},
  overlay:{position:"fixed",inset:0,background:"rgba(8,6,20,0.82)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,backdropFilter:"blur(4px)"},
  modal:{background:"linear-gradient(160deg,#2a2350,#15102e)",borderRadius:24,padding:"32px 44px",textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,0.6),inset 0 0 0 1px rgba(255,255,255,0.1)"},
  goTitle:{fontFamily:"'Nunito',sans-serif",fontWeight:900,fontSize:24,color:"#ff5e7e",letterSpacing:1},
  goScore:{fontFamily:"'Nunito',sans-serif",fontWeight:900,fontSize:52,color:"#ffd23d",marginTop:8,textShadow:"0 4px 0 rgba(0,0,0,0.3)"},
  goLabel:{fontSize:13,opacity:.6,marginBottom:20},
  playBtn:{border:"none",cursor:"pointer",fontFamily:"'Nunito',sans-serif",fontWeight:900,fontSize:16,color:"#15102e",background:"linear-gradient(135deg,#ffd23d,#ffa63d)",padding:"12px 36px",borderRadius:14,letterSpacing:1,boxShadow:"0 6px 0 #c77f1f"},
};
