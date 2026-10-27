import {renderPage,PAGE_WIDTH,PAGE_HEIGHT} from './readers.js';

const compact = s => String(s||'').trim().replace(/\s+/g,' ');
const norm = (s,ignoreSpace) => ignoreSpace?String(s||'').replace(/\s+/g,''):compact(s);
const esc = s => String(s||'').slice(0,180);
const overlap = (a,b) => !!a&&!!b&&a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;

export function parsePageRanges(s,total){
  if(!s.trim())return new Set(Array.from({length:total},(_,i)=>i));
  const out=new Set();
  for(const token of s.split(',')){
    const m=token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if(!m)throw new Error('페이지 범위는 1-3,5 형식으로 입력해 주세요.');
    const a=Number(m[1]),b=Number(m[2]||m[1]);
    if(a<1||b<a||b>total)throw new Error(`페이지는 1부터 ${total} 사이로 지정해 주세요.`);
    for(let x=a;x<=b;x++)out.add(x-1);
  }
  return out;
}

const matchesScope=(r,set,region)=>set.has(r.page)&&(!region||r.page!==region.page||overlap(r.rect,region.rect));
const isSame=(a,b,ignoreSpace)=>norm(a,ignoreSpace)===norm(b,ignoreSpace);
function styleChanges(a,b){
  if(!a||!b)return[];
  const out=[];
  for(const key of ['font','size','bold','italic','color','fill','numFmtId'])if(a[key]!=null&&b[key]!=null&&JSON.stringify(a[key])!==JSON.stringify(b[key]))out.push(key);
  if(a.border&&b.border)for(const side of ['left','right','top','bottom'])if(a.border[side]!==b.border[side])out.push(`${side} 테두리`);
  return out;
}
function tokenSimilarity(a,b){
  const x=compact(a),y=compact(b);if(!x||!y)return 0;if(x===y)return 1;
  const grams=s=>{const ar=Array.from(s);const out=new Set();if(ar.length<2)out.add(s);else for(let i=0;i<ar.length-1;i++)out.add(ar[i]+ar[i+1]);return out;};
  const A=grams(x),B=grams(y),n=[...A].filter(z=>B.has(z)).length;
  return (2*n)/(A.size+B.size);
}
const mk=(type,category,left,right,detail,confidence='certain')=>({id:'',type,category,left,right,oldText:left?.text||'',newText:right?.text||'',detail,confidence});

function comparePair(a,b,options){
  if(!isSame(a.text,b.text,options.ignoreSpace))return mk('changed','content',a,b,'내용이 변경되었습니다.');
  if(options.mode==='precision'&&a.style&&b.style&&a.role===b.role){
    const changed=styleChanges(a.style,b.style);if(changed.length)return mk('changed','format',a,b,`${changed.join(', ')} 서식 변경`);
  }
  if(a.meta?.formula!=null&&b.meta?.formula!=null&&options.mode!=='fast'&&a.meta.formula!==b.meta.formula)return mk('changed','formula',a,b,'계산 결과가 같더라도 수식 자체가 변경됐습니다.');
  return null;
}

function compareWorkbook(a,b,ra,rb,options){
  const out=[],sheets=new Set([...ra,...rb].map(r=>r.meta.sheet));
  for(const sheet of sheets){
    const L=ra.filter(r=>r.meta.sheet===sheet),R=rb.filter(r=>r.meta.sheet===sheet);
    const rowMap=rs=>{const rows=new Map();for(const r of rs){let row=rows.get(r.meta.row);if(!row){row=[];rows.set(r.meta.row,row);}row.push(r);}return rows;};
    const lr=rowMap(L),rr=rowMap(R);
    // Use column A as a record key only when it is unambiguous in BOTH sheets.
    const firstKeys=rows=>{const keys=new Map(),duplicates=new Set();for(const [row,rs] of rows){const first=rs.find(r=>r.meta.col===1),key=first?compact(first.text):'';if(!key||keys.has(key)){if(key)duplicates.add(key);continue;}keys.set(key,row);}return{keys,duplicates};};
    const lk=firstKeys(lr),rk=firstKeys(rr);
    const commonKeys=[...lk.keys.keys()].filter(k=>rk.keys.has(k)&&!lk.duplicates.has(k)&&!rk.duplicates.has(k));
    const keyed=commonKeys.length>=2&&commonKeys.length>=Math.min(lr.size,rr.size)*.55;
    const usedR=new Set(),aligned=[];
    for(const [row,rs] of lr){
      const key=rs.find(r=>r.meta.col===1)?.text;
      const target=keyed&&key&&!lk.duplicates.has(compact(key))&&!rk.duplicates.has(compact(key))?rk.keys.get(compact(key)):row;
      const candidates=rr.get(target);
      if(!candidates){for(const r of rs)out.push(mk('removed','content',r,null,'원본에만 있습니다.'));continue;}
      usedR.add(target);
      const byCol=new Map(candidates.map(r=>[r.meta.col,r]));
      for(const l of rs){const r=byCol.get(l.meta.col);if(r){const diff=comparePair(l,r,options);if(diff)out.push(diff);byCol.delete(l.meta.col);}else out.push(mk('removed','content',l,null,'원본에만 있습니다.'));}
      for(const r of byCol.values())out.push(mk('added','content',null,r,'수정본에만 있습니다.'));
      aligned.push([row,target]);
    }
    for(const [row,rs] of rr)if(!usedR.has(row))for(const r of rs)out.push(mk('added','content',null,r,'수정본에만 있습니다.'));
    if(!keyed&&lr.size!==rr.size&&Math.max(lr.size,rr.size)>5){out.push(mk('review','structure',L[0],R[0],'행이 삽입·삭제됐을 수 있습니다. 고유 키가 없어 위치 비교 결과를 확인해야 합니다.','uncertain'));}
  }
  return out;
}

function compareRecords(ra,rb,options){
  const out=[],usedL=new Set(),usedR=new Set();
  // Table cells have a better anchor than their absolute page position:
  // the unique first-column label and the column index. This also works
  // across XLSX/HWPX when the table has been moved or repaginated.
  const rowKeys=rs=>{const map=new Map();rs.forEach((r,i)=>{const key=r.role==='cell'&&r.meta?.rowKey&&r.meta?.col?`${norm(r.meta.rowKey,options.ignoreSpace)}::${r.meta.col}`:null;if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(i);});return map;};
  const lkeys=rowKeys(ra),rkeys=rowKeys(rb);
  for(const [key,la] of lkeys){const rbs=rkeys.get(key);if(!rbs||la.length!==1||rbs.length!==1)continue;const i=la[0],j=rbs[0];usedL.add(i);usedR.add(j);const diff=comparePair(ra[i],rb[j],options);if(diff)out.push(diff);}
  const bBuckets=new Map();
  rb.forEach((r,j)=>{if(usedR.has(j))return;const key=norm(r.text,options.ignoreSpace);if(!bBuckets.has(key))bBuckets.set(key,[]);bBuckets.get(key).push(j);});
  // Exact matches first. Within duplicate text, preserve relative occurrence order.
  ra.forEach((r,i)=>{
    if(usedL.has(i))return;const bucket=bBuckets.get(norm(r.text,options.ignoreSpace));if(!bucket?.length)return;
    let j=bucket.shift();while(j!==undefined&&usedR.has(j))j=bucket.shift();if(j===undefined)return;
    usedL.add(i);usedR.add(j);const diff=comparePair(r,rb[j],options);if(diff)out.push(diff);
  });
  // Pair changed lines conservatively, considering similarity and relative location.
  for(let i=0;i<ra.length;i++){
    if(usedL.has(i))continue;
    const a=ra[i],candidates=[];
    const expected=Math.round((i+.5)*rb.length/Math.max(1,ra.length));
    for(let j=Math.max(0,expected-42);j<Math.min(rb.length,expected+43);j++){
      if(usedR.has(j))continue;
      const b=rb[j],score=tokenSimilarity(a.text,b.text),distance=Math.abs(i/Math.max(1,ra.length)-j/Math.max(1,rb.length));
      if(score>=.48)candidates.push({j,score:score-.12*distance});
    }
    candidates.sort((x,y)=>y.score-x.score);
    if(candidates.length&&candidates[0].score>=.53){
      const best=candidates[0],runner=candidates[1];
      if(runner&&Math.abs(best.score-runner.score)<.035){out.push(mk('review','alignment',a,null,'비슷한 항목이 여러 개 있어 자동 대응을 확정할 수 없습니다.','uncertain'));usedL.add(i);continue;}
      usedL.add(i);usedR.add(best.j);const r=rb[best.j];out.push(mk('changed','content',a,r,'비슷한 위치·내용을 가진 항목의 텍스트가 변경됐습니다.','probable'));
    }
  }
  ra.forEach((r,i)=>{if(!usedL.has(i))out.push(mk('removed','content',r,null,'원본에만 있습니다.'));});
  rb.forEach((r,i)=>{if(!usedR.has(i))out.push(mk('added','content',null,r,'수정본에만 있습니다.'));});
  return out;
}

export function contentDifferences(a,b,options){
  const pagesA=options.pagesA||new Set(a.pages.map((_,i)=>i)),pagesB=options.pagesB||new Set(b.pages.map((_,i)=>i));
  const ra=a.records.filter(r=>matchesScope(r,pagesA,options.regionA));
  const rb=b.records.filter(r=>matchesScope(r,pagesB,options.regionB));
  const diffs=a.type==='xlsx'&&b.type==='xlsx'?compareWorkbook(a,b,ra,rb,options):compareRecords(ra,rb,options);
  return diffs.slice(0,1800).map((d,i)=>({...d,id:`text-${i}`}));
}

function newCanvas(){return document.createElement('canvas');}
async function pixels(doc,index){
  const source=newCanvas();await renderPage(doc,index,source,550);
  const canvas=newCanvas();canvas.width=420;canvas.height=570;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,420,570);
  const s=Math.min(420/source.width,570/source.height),w=source.width*s,h=source.height*s;
  ctx.drawImage(source,(420-w)/2,0,w,h);
  return ctx.getImageData(0,0,420,570).data;
}
function tileRegions(A,B){
  const tile=30,cols=14,rows=19,active=[];
  for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){
    let count=0,total=0;
    for(let y=cy*tile;y<(cy+1)*tile;y+=2)for(let x=cx*tile;x<(cx+1)*tile;x+=2){const k=(y*420+x)*4;const delta=(Math.abs(A[k]-B[k])+Math.abs(A[k+1]-B[k+1])+Math.abs(A[k+2]-B[k+2]))/3;total++;if(delta>38)count++;}
    if(count/total>.035)active.push([cx,cy]);
  }
  const set=new Set(active.map(p=>p.join(','))),regions=[];
  while(set.size){const seed=set.values().next().value;set.delete(seed);const todo=[seed.split(',').map(Number)],group=[];
    while(todo.length){const [x,y]=todo.pop();group.push([x,y]);for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){const key=`${nx},${ny}`;if(set.delete(key))todo.push([nx,ny]);}}
    const xs=group.map(p=>p[0]),ys=group.map(p=>p[1]);regions.push({x:Math.min(...xs)*tile,y:Math.min(...ys)*tile,w:(Math.max(...xs)-Math.min(...xs)+1)*tile,h:(Math.max(...ys)-Math.min(...ys)+1)*tile,tiles:group.length});
  }
  return regions.sort((a,b)=>b.tiles-a.tiles).slice(0,10);
}

export async function visualDifferences(a,b,options,onProgress=()=>{}){
  const n=Math.min(a.pages.length,b.pages.length),out=[];
  const scopeA=options.pagesA||new Set(a.pages.map((_,i)=>i)),scopeB=options.pagesB||new Set(b.pages.map((_,i)=>i));
  for(let i=0;i<n;i++){
    if(!scopeA.has(i)||!scopeB.has(i))continue;
    const pa=await pixels(a,i),pb=await pixels(b,i),regions=tileRegions(pa,pb);
    for(const region of regions){
      const left={page:i,rect:{x:region.x/420*a.pages[i].width,y:region.y/570*a.pages[i].height,w:region.w/420*a.pages[i].width,h:region.h/570*a.pages[i].height},text:`${i+1}페이지 화면 영역`};
      const right={page:i,rect:{x:region.x/420*b.pages[i].width,y:region.y/570*b.pages[i].height,w:region.w/420*b.pages[i].width,h:region.h/570*b.pages[i].height},text:`${i+1}페이지 화면 영역`};
      const intersectsA=!options.regionA||options.regionA.page!==i||overlap(left.rect,options.regionA.rect);
      const intersectsB=!options.regionB||options.regionB.page!==i||overlap(right.rect,options.regionB.rect);
      if(intersectsA&&intersectsB)out.push({...mk(a.type===b.type?'changed':'review','visual',left,right,`렌더링 영역 ${region.tiles}칸에서 차이가 발견됐습니다. ${a.type!==b.type?'서로 다른 형식의 배치 차이일 수 있습니다.':''}`,a.type===b.type?'probable':'uncertain'),id:`visual-${out.length}`});
    }
    onProgress((i+1)/Math.max(1,n),`${i+1}/${n}페이지 화면 비교`);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  return out;
}

export function summarize(diffs){const counts={changed:0,added:0,removed:0,review:0};for(const d of diffs)counts[d.type]=(counts[d.type]||0)+1;return counts;}
