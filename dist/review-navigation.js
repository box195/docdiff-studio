// Group only adjacent, confidently matched spreadsheet cells; retain every member.
import {groupHwpFormats} from './hwp-grouping.js?v=20261029-8';
const cell = r => r?.role === 'cell' && r.meta?.sheet && Number.isInteger(r.meta.row) && Number.isInteger(r.meta.col);
function groupKey(d) {
  if (d.confidence !== 'certain' || !['content','format'].includes(d.category) || d.type === 'review') return null;
  if ((!d.left && !cell(d.right)) || (!d.right && !cell(d.left))) return null;
  if ((d.left && !cell(d.left)) || (d.right && !cell(d.right))) return null;
  return JSON.stringify([d.type,d.category,d.detail,...[d.left,d.right].map(r=>r?[r.meta.sheet,r.meta.row,r.page]:null)]);
}
function adjacent(a,b) {
  return ['left','right'].every(side => !a[side] && !b[side] || a[side] && b[side] && b[side].meta.col === a[side].meta.col+1);
}
function column(n) { let s='';for(;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s; }
function mergeRecord(members,side) {
  const records=members.map(d=>d[side]).filter(Boolean);if(!records.length)return null;
  const first=records[0],rects=records.map(r=>r.rect).filter(Boolean);
  const rect=rects.length?{x:Math.min(...rects.map(r=>r.x)),y:Math.min(...rects.map(r=>r.y)),w:0,h:0}:null;
  if(rect){rect.w=Math.max(...rects.map(r=>r.x+r.w))-rect.x;rect.h=Math.max(...rects.map(r=>r.y+r.h))-rect.y;}
  return {...first,rect,text:records.map(r=>`${column(r.meta.col)}${r.meta.row}: ${r.text}`).join(' | ')};
}
export function groupChanges(diffs) {
  diffs=groupHwpFormats(diffs);
  const buckets=new Map(),groups=[];
  diffs.forEach((d,index)=>{const key=groupKey(d);if(key===null){groups.push({index,diff:d});return;}if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({d,index});});
  for(const bucket of buckets.values()){
    bucket.sort((a,b)=>(a.d.left||a.d.right).meta.col-(b.d.left||b.d.right).meta.col);
    let run=[];
    const flush=()=>{if(!run.length)return;const members=run.map(x=>x.d),first=members[0];let diff=first;
      if(members.length>1){const left=mergeRecord(members,'left'),right=mergeRecord(members,'right'),r=right||left,last=(members.at(-1).right||members.at(-1).left);diff={...first,id:`group-${first.id}`,left,right,oldText:left?.text||'',newText:right?.text||'',members,detail:`${r.meta.sheet} · ${column(r.meta.col)}${r.meta.row}:${column(last.meta.col)}${last.meta.row} · 연속 ${members.length}셀 ${first.category==='format'?'서식 변경':'내용 변경'} (${first.detail})`};}groups.push({index:Math.min(...run.map(x=>x.index)),diff});run=[];};
    for(const item of bucket){if(run.length&&!adjacent(run.at(-1).d,item.d))flush();run.push(item);}flush();
  }
  return groups.sort((a,b)=>a.index-b.index).map(x=>x.diff);
}

export function navigationDirection(event) {
  if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.isComposing)return 0;
  const target=event.target;
  if(target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),dialog[open],summary'))return 0;
  return {ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key]||0;
}

// Do not use scrollIntoView on result cards: that also scrolls the outer page.
export function revealInList(list,card) {
  if(!card)return;
  const outer=list.getBoundingClientRect(),inner=card.getBoundingClientRect(),top=outer.top+(list.clientTop||0),bottom=top+list.clientHeight;
  if(inner.top<top)list.scrollTop+=inner.top-top;
  else if(inner.bottom>bottom)list.scrollTop+=Math.min(inner.bottom-bottom,inner.top-top);
}
