// A view over existing differences only. Never compares or edits documents.
const sides=['left','right'];
const members=d=>d.members||[d];
const table=r=>r?.meta?.pdfTableKey?`pdf:${r.meta.pdfTableKey}`:r?.meta?.sourceTableKey?`hwp:${r.meta.sourceTableKey}`:r?.meta?.sheet?`xlsx:${r.meta.sheet}`:null;
const row=r=>r.meta?.pdfRow??r.meta?.tableRow??r.meta?.row;
const col=r=>r.meta?.pdfCol??r.meta?.col;
function key(d){
  if(d.confidence!=='certain'||d.type==='review'||!['content','format'].includes(d.category))return null;
  if(!sides.some(s=>d[s]))return null;
  if(sides.some(s=>d[s]&&(d[s].role!=='cell'||!d[s].rect||!table(d[s]))))return null;
  // Existing HWP format groups already have semantic, solid-region grouping.
  if(d.category==='format'&&sides.some(s=>d[s]?.meta?.sourceTableKey))return null;
  return JSON.stringify([d.type,d.category,d.category==='format'?d.detail:null,d.formatChanges||null,...sides.map(s=>d[s]?[table(d[s]),d[s].page]:null)]);
}
function union(records){const x=Math.min(...records.map(r=>r.rect.x)),y=Math.min(...records.map(r=>r.rect.y));return {x,y,w:Math.max(...records.map(r=>r.rect.x+r.rect.w))-x,h:Math.max(...records.map(r=>r.rect.y+r.rect.h))-y};}
const location=r=>r?.meta?.sheet?`${r.meta.sheet} · ${row(r)}행 ${col(r)}열`:`${row(r)||'?'}행 ${col(r)||'?'}열`;
function record(list,side){const rs=list.map(d=>d[side]).filter(Boolean);if(!rs.length)return null;return {...rs[0],rect:union(rs),text:rs.map(r=>`${location(r)}: ${r.text||'(빈 셀)'}`).join(' | ')};}
function area(items){const list=items.flatMap(x=>members(x.d));return {items,list,left:record(list,'left'),right:record(list,'right')};}
function joins(a,b,horizontal){return sides.every(side=>{
  const x=a[side],y=b[side];if(!x&&!y)return true;if(!x||!y)return false;const p=x.rect,q=y.rect;
  const near=(u,v)=>Math.abs(u-v)<=2,gap=horizontal?q.x-p.x-p.w:q.y-p.y-p.h;
  if(gap<-.5||gap>2)return false;
  if(horizontal){if(!near(p.y,q.y)||!near(p.h,q.h))return false;
    const aa=a.list.map(d=>d[side]).filter(Boolean),bb=b.list.map(d=>d[side]).filter(Boolean);
    const end=Math.max(...aa.map(r=>col(r)+(r.meta?.colSpan||1)-1)),next=Math.min(...bb.map(col));
    return aa.every(r=>row(r)===row(aa[0]))&&bb.every(r=>row(r)===row(aa[0]))&&(aa[0].meta?.pdfTableKey?next>end:next===end+1);
  }
  if(!near(p.x,q.x)||!near(p.w,q.w))return false;
  const aa=a.list.map(d=>d[side]).filter(Boolean),bb=b.list.map(d=>d[side]).filter(Boolean);
  const end=Math.max(...aa.map(r=>row(r)+(r.meta?.rowSpan||1)-1)),next=Math.min(...bb.map(row));
  return aa[0].meta?.pdfTableKey?next>end:next===end+1;
});}
export function groupNavigationAreas(diffs){
  const buckets=new Map(),out=[];
  diffs.forEach((d,index)=>{const k=key(d);if(k===null){out.push({index,d});return;}if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push({d,index});});
  for(const bucket of buckets.values()){
    bucket.sort((a,b)=>{const p=(a.d.left||a.d.right).rect,q=(b.d.left||b.d.right).rect;return p.y-q.y||p.x-q.x;});
    const rows=[];
    for(const item of bucket){const next=area([item]),last=rows.at(-1);if(last&&joins(last,next,true))rows[rows.length-1]=area([...last.items,item]);else rows.push(next);}
    const blocks=[];
    for(const run of rows){const candidates=blocks.map((b,i)=>joins(b,run,false)?i:-1).filter(i=>i>=0);if(candidates.length===1){const i=candidates[0];blocks[i]=area([...blocks[i].items,...run.items]);}else blocks.push(run);}
    for(const block of blocks){const index=Math.min(...block.items.map(x=>x.index));if(block.items.length===1){out.push({index,d:block.items[0].d});continue;}
      const first=block.list[0],label={changed:'수정',added:'추가',removed:'삭제'}[first.type];
      out.push({index,d:{...first,id:`nav-group-${first.id}`,left:block.left,right:block.right,oldText:block.left?.text||'',newText:block.right?.text||'',members:block.list,detail:`넘기기 묶음 · 연속 ${block.list.length}개 셀 ${label} · 개별 검출 결과 유지${first.category==='format'?' · '+first.detail:''}`}});
    }
  }
  return out.sort((a,b)=>a.index-b.index).map(x=>x.d);
}
