const range=r=>({row:r.meta.tableRow,col:r.meta.col,lastRow:r.meta.tableRow+(r.meta.rowSpan||1)-1,lastCol:r.meta.col+(r.meta.colSpan||1)-1});
const together=(a,b,horizontal)=>['left','right'].every(side=>{const x=range(a.last[side]),y=range(b.first[side]);return horizontal?x.row===y.row&&x.lastRow===y.lastRow&&x.lastCol+1===y.col:x.col===y.col&&x.lastCol===y.lastCol&&x.lastRow+1===y.row;});
const record=(members,side)=>{const records=members.map(d=>d[side]),first=records[0],x=Math.min(...records.map(r=>r.rect.x)),y=Math.min(...records.map(r=>r.rect.y));return {...first,rect:{x,y,w:Math.max(...records.map(r=>r.rect.x+r.rect.w))-x,h:Math.max(...records.map(r=>r.rect.y+r.rect.h))-y},text:records.map(r=>`${r.meta.tableRow}행 ${r.meta.col}열: ${r.text||'(빈 셀)'}`).join(' | ')};};

// Group matching HWP formatting into solid row runs, then identical vertical
// runs. This avoids drawing one large box across unchanged holes or pages.
export function groupHwpFormats(diffs){
  const buckets=new Map(),output=[];
  diffs.forEach((d,index)=>{
    if(d.type!=='changed'||d.category!=='format'||d.confidence!=='certain'||!d.formatChanges?.length||![d.left,d.right].every(r=>r?.role==='cell'&&r.rect&&r.meta?.sourceTableKey&&r.meta.tableRow&&r.meta.col)){output.push({index,diff:d});return;}
    const key=JSON.stringify([d.detail,d.formatChanges,...[d.left,d.right].map(r=>[r.meta.sourceTableKey,r.page])]);
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({members:[d],first:d,last:d,index});
  });
  for(const items of buckets.values()){
    items.sort((a,b)=>a.first.right.meta.tableRow-b.first.right.meta.tableRow||a.first.right.meta.col-b.first.right.meta.col);
    const rows=[];
    for(const item of items){const prev=rows.at(-1);if(prev&&together(prev,item,true)){prev.members.push(...item.members);prev.last=item.last;prev.index=Math.min(prev.index,item.index);}else rows.push({...item,members:[...item.members]});}
    const columns=new Map();
    for(const row of rows){const key=JSON.stringify(['left','right'].map(side=>[row.first[side].meta.col,range(row.last[side]).lastCol]));if(!columns.has(key))columns.set(key,[]);columns.get(key).push(row);}
    for(const blocks of columns.values()){
      let current;
      const flush=()=>{if(!current)return;const {members,index}=current;if(members.length===1){output.push({index,diff:members[0]});return;}const left=record(members,'left'),right=record(members,'right'),start=range(current.first.right),end=range(current.last.right);output.push({index,diff:{...members[0],id:`hwp-group-${members[0].id}`,left,right,oldText:left.text,newText:right.text,members,detail:`표 ${start.row}행 ${start.col}열 ~ ${end.lastRow}행 ${end.lastCol}열 · ${members.length}셀 · ${members[0].detail}`}});};
      for(const block of blocks){if(current){const a={first:{},last:{}},b={first:{...block.first},last:block.last};for(const side of ['left','right'])a.last[side]={...current.last[side],meta:{...current.last[side].meta,col:current.first[side].meta.col,colSpan:range(current.last[side]).lastCol-current.first[side].meta.col+1}};for(const side of ['left','right'])b.first[side]={...block.first[side],meta:{...block.first[side].meta,colSpan:range(block.last[side]).lastCol-block.first[side].meta.col+1}};
          if(together(a,b,false)){current.members.push(...block.members);current.last=block.last;current.index=Math.min(current.index,block.index);continue;}flush();}
        current={...block,members:[...block.members]};
      }flush();
    }
  }
  return output.sort((a,b)=>a.index-b.index).map(x=>x.diff);
}
