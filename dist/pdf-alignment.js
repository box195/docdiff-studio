// PDF cell identity is local to a table. Text occupancy elsewhere on the page
// must never invalidate an otherwise stable correspondence.
const clean=s=>String(s||'').replace(/\s+/g,'');
const near=(a,b,t=2.5)=>Math.abs(a-b)<=t;
const bounds=records=>{const x=Math.min(...records.map(r=>r.rect.x)),y=Math.min(...records.map(r=>r.rect.y));return {x,y,w:Math.max(...records.map(r=>r.rect.x+r.rect.w))-x,h:Math.max(...records.map(r=>r.rect.y+r.rect.h))-y};};
const unique=items=>{const m=new Map();for(const [key,value] of items){if(!key)continue;if(!m.has(key))m.set(key,[]);m.get(key).push(value);}return new Map([...m].filter(([,v])=>v.length===1).map(([k,v])=>[k,v[0]]));};

export function alignPdfCells(left,right){
  const out={pairs:[],added:[],removed:[],reviews:[],consumedLeft:new Set(),consumedRight:new Set()};
  const tables=records=>{
    const groups=new Map();
    records.forEach((r,i)=>{if(!r.meta?.pdfCell||!r.meta.pdfTableKey||!r.rect)return;const key=r.meta.pdfTableKey;if(!groups.has(key))groups.set(key,{indices:[],page:r.page});groups.get(key).indices.push(i);});
    return [...groups.values()].map(t=>{
      const indices=t.indices.sort((i,j)=>records[i].rect.y-records[j].rect.y||records[i].rect.x-records[j].rect.x);
      const box=bounds(indices.map(i=>records[i])),tokens=[],positions=new Map();
      for(const i of indices){const r=records[i],word=clean(r.text);if(!word)continue;tokens.push(word);if(!positions.has(word))positions.set(word,[]);positions.get(word).push((r.rect.x-box.x)/box.w);}
      return {...t,bounds:box,words:new Set(tokens),positions,signature:JSON.stringify(tokens)};
    });
  };
  const L=tables(left),R=tables(right),candidates=[];
  // PDF border detection can split one logical table into several small tables.
  // After a row is deleted, every later table moves vertically. Match unique
  // content anchors before reusing page coordinates, which now refer to other rows.
  const counts=tables=>{const words=new Map(),signatures=new Map();for(const t of tables){for(const word of t.words)words.set(word,(words.get(word)||0)+1);if(t.signature!=='[]')signatures.set(t.signature,(signatures.get(t.signature)||0)+1);}return {words,signatures};};
  const countL=counts(L),countR=counts(R);
  const similarity=(a,b)=>{
    if(a.page!==b.page)return null;const shared=[...a.words].filter(s=>b.words.has(s)).length;
    const uniqueShared=[...a.words].filter(s=>b.words.has(s)&&countL.words.get(s)===1&&countR.words.get(s)===1&&a.positions.get(s).length===1&&b.positions.get(s).length===1&&near(a.positions.get(s)[0],b.positions.get(s)[0],.01)).length;
    const exact=a.signature!=='[]'&&a.signature===b.signature&&countL.signatures.get(a.signature)===1&&countR.signatures.get(b.signature)===1;
    const size=near(a.bounds.x,b.bounds.x,4)&&near(a.bounds.w,b.bounds.w,5),position=near(a.bounds.y,b.bounds.y,6);
    if((!size&&!(shared>=2&&position&&near(a.bounds.x,b.bounds.x,4)))||(!position&&!exact&&!uniqueShared))return null;
    return {shared,score:(exact?200:0)+(uniqueShared?100+Math.min(3,uniqueShared)*20:0)+(position?40:0)+(size?10:0)+Math.min(10,shared)*10+(near(a.bounds.h,b.bounds.h,3)?10:0)};
  };
  L.forEach((a,i)=>R.forEach((b,j)=>{const score=similarity(a,b);if(score)candidates.push({i,j,...score});}));
  const pairedL=new Set(),pairedR=new Set();
  const consume=(ls,rs)=>{ls.forEach(i=>out.consumedLeft.add(i));rs.forEach(j=>out.consumedRight.add(j));};
  const review=(ls,rs,detail)=>{consume(ls,rs);out.reviews.push({left:ls,right:rs,detail});};
  const alignTable=(a,b)=>{
    consume(a.indices,b.indices);
    const rows=(table,records)=>{const by=new Map();for(const i of table.indices){const r=records[i],key=r.meta.pdfRow;if(!by.has(key))by.set(key,{indices:[],number:key});by.get(key).indices.push(i);}return [...by.values()].sort((x,y)=>x.number-y.number).map(row=>{row.indices.sort((i,j)=>records[i].rect.x-records[j].rect.x);return {...row,label:clean(records[row.indices[0]].text)};});};
    const ar=rows(a,left),br=rows(b,right),ua=unique(ar.map((r,i)=>[r.label,i])),ub=unique(br.map((r,i)=>[r.label,i]));
    const anchors=[...ua].filter(([s])=>ub.has(s)).map(([s,i])=>({i,j:ub.get(s)}));
    const rowSignature=(row,records)=>row.indices.map(i=>clean(records[i].text)).join('\u241f');
    const sa=unique(ar.map((r,i)=>[r.indices.some(n=>clean(left[n].text))?rowSignature(r,left):'',i])),sb=unique(br.map((r,i)=>[r.indices.some(n=>clean(right[n].text))?rowSignature(r,right):'',i]));
    for(const [s,i] of sa){const j=sb.get(s);if(j!=null&&!anchors.some(p=>p.i===i||p.j===j))anchors.push({i,j});}anchors.sort((x,y)=>x.i-y.i);
    const inverted=anchors.some((p,k)=>k&&p.j<=anchors[k-1].j);
    const cellPairs=(x,y)=>{
      const used=new Set(),pairs=[];
      for(const i of x.indices){const r=left[i],dx=(r.rect.x-a.bounds.x)/a.bounds.w,dw=r.rect.w/a.bounds.w;
        const matches=y.indices.filter(j=>!used.has(j)&&near(dx,(right[j].rect.x-b.bounds.x)/b.bounds.w,.005)&&near(dw,right[j].rect.w/b.bounds.w,.006));
        if(matches.length!==1){review(x.indices,y.indices,'표의 셀 병합·열 구조가 달라 대응을 확정하지 못했습니다.');return;}
        used.add(matches[0]);pairs.push({i,j:matches[0]});
      }
      if(used.size!==y.indices.length){review(x.indices,y.indices,'표의 열 수가 달라 대응을 확정하지 못했습니다.');return;}
      out.pairs.push(...pairs);
    };
    // Conflicting row labels must not be forced into their old coordinates.
    if(inverted){review(a.indices,b.indices,'행의 순서가 바뀌었거나 항목명이 중복되어 표 대응을 확인해야 합니다.');return;}
    const stable=ar.length===br.length&&anchors.every(p=>p.i===p.j)&&ar.every((r,k)=>{
      const q=br[k];return near(left[r.indices[0]].rect.y-a.bounds.y,right[q.indices[0]].rect.y-b.bounds.y,3);
    });
    if(stable){ar.forEach((r,k)=>cellPairs(r,br[k]));return;}
    if(!anchors.length){review(a.indices,b.indices,'표의 행 구조가 달라졌고 공통 항목명을 찾지 못해 자동 대응을 보류했습니다.');return;}
    const stops=[{i:-1,j:-1},...anchors,{i:ar.length,j:br.length}];
    for(let k=1;k<stops.length;k++){
      const before=stops[k-1],after=stops[k],aa=ar.slice(before.i+1,after.i),bb=br.slice(before.j+1,after.j);
      if(aa.length===bb.length)aa.forEach((r,n)=>cellPairs(r,bb[n]));
      else if(!aa.length)out.added.push(...bb.flatMap(r=>r.indices));
      else if(!bb.length)out.removed.push(...aa.flatMap(r=>r.indices));
      else review(aa.flatMap(r=>r.indices),bb.flatMap(r=>r.indices),'항목명 사이의 행 수가 달라 삽입·삭제와 수정을 구분하려면 확인이 필요합니다.');
      if(after.i<ar.length)cellPairs(ar[after.i],br[after.j]);
    }
  };
  for(const c of candidates.sort((a,b)=>b.score-a.score)){
    if(pairedL.has(c.i)||pairedR.has(c.j))continue;
    const otherL=candidates.filter(x=>x.i===c.i&&x.j!==c.j&&!pairedR.has(x.j)),otherR=candidates.filter(x=>x.j===c.j&&x.i!==c.i&&!pairedL.has(x.i));
    if([...otherL,...otherR].some(x=>c.score-x.score<15))continue;
    pairedL.add(c.i);pairedR.add(c.j);alignTable(L[c.i],R[c.j]);
  }
  // Unpaired tables with plausible counterparts are ambiguous, not additions.
  L.forEach((t,i)=>{if(pairedL.has(i))return;const possible=candidates.filter(c=>c.i===i&&!pairedR.has(c.j));if(possible.length){const js=[...new Set(possible.map(c=>c.j))];pairedL.add(i);js.forEach(j=>pairedR.add(j));review(t.indices,js.flatMap(j=>R[j].indices),'비슷한 표가 여러 개 있어 대응할 표를 확정하지 못했습니다.');}else{consume(t.indices,[]);out.removed.push(...t.indices);}});
  R.forEach((t,j)=>{if(!pairedR.has(j)){consume([],t.indices);out.added.push(...t.indices);}});
  return out;
}

export function pdfReviewRecord(records,indices){
  if(!indices.length)return null;const rs=indices.map(i=>records[i]),first=rs[0];
  return {...first,role:'table-review',rect:bounds(rs),text:rs.map(r=>r.text).filter(Boolean).join(' | '),textRuns:[],label:'표 대응 확인'};
}
