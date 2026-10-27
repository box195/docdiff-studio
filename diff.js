import {workbookRows,alignRows} from './row-alignment.js';

const compact = s => String(s||'').trim().replace(/\s+/g,' ');
const norm = (s,ignoreSpace) => ignoreSpace?String(s??'').replace(/\s+/g,''):String(s??'').replace(/\r\n/g,'\n');
const esc = s => String(s||'').slice(0,180);
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
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

const matchesScope=(r,set,region)=>set.has(r.page)&&(!region||r.page===region.page&&overlap(r.rect,region.rect));
const isSame=(a,b,ignoreSpace)=>norm(a,ignoreSpace)===norm(b,ignoreSpace);
function styleChanges(a,b){
  if(!a||!b)return[];
  const out=[];
  for(const key of ['font','size','bold','italic','color','fill','numFmtId','rowHeight','underline','strike','alignment','numberFormat','borderColor'])if(a[key]!=null&&b[key]!=null&&stable(a[key])!==stable(b[key]))out.push(key);
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

function mappedFormula(formula,rowMap){
 if(!rowMap||String(formula).includes('!'))return formula;
 return String(formula).split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/).map((part,i)=>i%2?part:part.replace(/(?<![A-Za-z0-9_!])(\$?[A-Za-z]{1,3})(\$?)([1-9]\d*)\b(?!\s*\()/g,(match,col,dollar,row)=>col+dollar+(rowMap.get(Number(row))??row))).join('');
}
function comparePair(a,b,options){
  if(!isSame(a.text,b.text,options.ignoreSpace))return mk('changed','content',a,b,'내용이 변경되었습니다.');
  if(options.mode==='precision'&&a.style&&b.style&&a.role===b.role){
    const changed=styleChanges(a.style,b.style);if(changed.length)return mk('changed','format',a,b,`${changed.join(', ')} 서식 변경`);
  }
  if(a.meta?.formula!=null&&b.meta?.formula!=null&&options.mode!=='fast'&&mappedFormula(a.meta.formula,options.rowMap)!==b.meta.formula)return mk(a.meta.formula.includes('!')||b.meta.formula.includes('!')?'review':'changed','formula',{...a,text:a.meta.formula?'='+a.meta.formula:a.text},{...b,text:b.meta.formula?'='+b.meta.formula:b.text},a.meta.formula.includes('!')||b.meta.formula.includes('!')?'다른 시트 참조를 포함하는 수식 변경입니다. 자동 참조 조정 여부를 확인하세요.':'행 이동을 반영해도 수식 자체가 변경됐습니다.',a.meta.formula.includes('!')||b.meta.formula.includes('!')?'uncertain':'certain');
  return null;
}

function rowRecord(row){if(!row)return null;let base=row.cells[0],same=row.cells.filter(c=>c.page===base.page&&c.rect),rect=same.length?{x:Math.min(...same.map(c=>c.rect.x)),y:Math.min(...same.map(c=>c.rect.y)),w:0,h:0}:base.rect;if(rect&&same.length){rect.w=Math.max(...same.map(c=>c.rect.x+c.rect.w))-rect.x;rect.h=Math.max(...same.map(c=>c.rect.y+c.rect.h))-rect.y}return {...base,text:row.blank?'(빈 행)':row.cells.filter(c=>!c.meta.emptyRow).map(c=>c.text).join(' | '),rect,label:`${base.meta.sheet}!${row.number}행`}}
function compareWorkbook(a,b,ra,rb,options){
 const out=[],ls=new Map(),rs=new Map();for(const r of ra){let key=r.meta.sheet;if(!ls.has(key))ls.set(key,[]);ls.get(key).push(r)}for(const r of rb){let key=r.meta.sheet;if(!rs.has(key))rs.set(key,[]);rs.get(key).push(r)}
 for(const sheet of new Set([...ls.keys(),...rs.keys()])){
  if(options.mode==='precision'){const x=a.sheets?.find(s=>s.name===sheet)?.printLayout,y=b.sheets?.find(s=>s.name===sheet)?.printLayout;if(x&&y&&stable(x)!==stable(y))out.push(mk('changed','page-format',(ls.get(sheet)||[])[0],(rs.get(sheet)||[])[0],`${sheet}: 용지·페이지 여백·인쇄 설정이 변경되었습니다.`));}
  const L=workbookRows(ls.get(sheet)||[],options.ignoreSpace),R=workbookRows(rs.get(sheet)||[],options.ignoreSpace),alignment=alignRows(L,R,options),pairOptions={...options,rowMap:new Map(alignment.pairs.map(p=>[p.left.number,p.right.number]))};
  for(const pair of alignment.pairs){
   const left=rowRecord(pair.left),right=rowRecord(pair.right);
   if(pair.moved)out.push(mk(pair.ambiguous?'review':'changed','row-move',left,right,`${sheet}: ${pair.left.number}행 → ${pair.right.number}행으로 순서 이동`,pair.ambiguous?'uncertain':'probable'));
   const lc=new Map(pair.left.cells.filter(c=>!c.meta.emptyRow).map(c=>[c.meta.col,c])),rc=new Map(pair.right.cells.filter(c=>!c.meta.emptyRow).map(c=>[c.meta.col,c]));
   for(const col of new Set([...lc.keys(),...rc.keys()])){const l=lc.get(col),r=rc.get(col);let diff;if(l&&r)diff=comparePair(l,r,pairOptions);else if(l&&(l.text!==''||l.meta.formula||options.mode==='precision'&&l.style))diff=mk('removed','content',l,null,'대응 행에서 셀이 삭제되었습니다.');else if(r&&(r.text!==''||r.meta.formula||options.mode==='precision'&&r.style))diff=mk('added','content',null,r,'대응 행에 셀이 추가되었습니다.');if(diff){if(pair.ambiguous){diff.type='review';diff.confidence='uncertain';diff.detail='중복 행의 대응 순서에 따라 결과가 달라질 수 있습니다. '+diff.detail}out.push(diff)}}
  }
  for(const row of alignment.removed)out.push(mk('removed','row',rowRecord(row),null,`${sheet}: 원본 ${row.number}행이 삭제되었습니다.`));
  for(const row of alignment.added)out.push(mk('added','row',null,rowRecord(row),`${sheet}: 수정본 ${row.number}행이 삽입되었습니다.`));
  for(const review of alignment.reviews)out.push(mk('review','alignment',rowRecord(review.left[0]),rowRecord(review.right[0]),review.detail+' 원본 '+review.left.map(r=>r.number).join(',')+'행 / 수정본 '+review.right.map(r=>r.number).join(',')+'행','uncertain'));
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
  if(diffs.length>1800)diffs.splice(1799,diffs.length-1799,mk('review','limit',null,null,'차이가 1,800건을 초과하여 일부만 표시합니다. 비교 범위를 나누어 주세요.','uncertain'));
  return diffs.map((d,i)=>({...d,id:`text-${i}`}));
}

function newCanvas(){return document.createElement('canvas');}
async function pixels(doc,index){
  const {renderPage}=await import('./readers.js');
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
  if(a.type==='xlsx'&&b.type==='xlsx'){onProgress(0,'행 대응을 맞춘 뒤 내용·서식 검사');await new Promise(resolve=>setTimeout(resolve,0));const out=contentDifferences(a,b,{...options,mode:'precision'});onProgress(1,'엑셀 행 정렬 후 검사 완료');return out.map(d=>({...d,detail:d.detail+' (행 정렬 적용; 엑셀 화면은 구조 기반 미리보기)'}));}
  const n=Math.min(a.pages.length,b.pages.length),out=[];
  const scopeA=options.pagesA||new Set(a.pages.map((_,i)=>i)),scopeB=options.pagesB||new Set(b.pages.map((_,i)=>i));
  for(let i=0;i<n;i++){
    if(!scopeA.has(i)||!scopeB.has(i))continue;
    const pa=await pixels(a,i),pb=await pixels(b,i),regions=tileRegions(pa,pb);
    for(const region of regions){
      const left={page:i,rect:{x:region.x/420*a.pages[i].width,y:region.y/570*a.pages[i].height,w:region.w/420*a.pages[i].width,h:region.h/570*a.pages[i].height},text:`${i+1}페이지 화면 영역`};
      const right={page:i,rect:{x:region.x/420*b.pages[i].width,y:region.y/570*b.pages[i].height,w:region.w/420*b.pages[i].width,h:region.h/570*b.pages[i].height},text:`${i+1}페이지 화면 영역`};
      const intersectsA=!options.regionA||options.regionA.page===i&&overlap(left.rect,options.regionA.rect);
      const intersectsB=!options.regionB||options.regionB.page===i&&overlap(right.rect,options.regionB.rect);
      if(intersectsA&&intersectsB)out.push({...mk(a.type===b.type?'changed':'review','visual',left,right,`렌더링 영역 ${region.tiles}칸에서 차이가 발견됐습니다. ${a.type!==b.type?'서로 다른 형식의 배치 차이일 수 있습니다.':''}`,a.type===b.type?'probable':'uncertain'),id:`visual-${out.length}`});
    }
    onProgress((i+1)/Math.max(1,n),`${i+1}/${n}페이지 화면 비교`);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  return out;
}

export function summarize(diffs){const counts={changed:0,added:0,removed:0,review:0};for(const d of diffs)counts[d.type]=(counts[d.type]||0)+1;return counts;}
