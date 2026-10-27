// Content anchors, unique record keys and bounded LCS. No document bytes leave the browser.
const value=(s,ignore)=>ignore?String(s??'').replace(/\s+/g,''):String(s??'').replace(/\r\n/g,'\n');
const buckets=(rows,key)=>{const out=new Map();rows.forEach((r,i)=>{const k=key(r);if(k==='')return;if(!out.has(k))out.set(k,[]);out.get(k).push(i)});return out};

export function workbookRows(records,ignoreSpace=false){
  const map=new Map();for(const cell of records){let row=map.get(cell.meta.row);if(!row){row={number:cell.meta.row,cells:[],values:new Map()};map.set(row.number,row)}row.cells.push(cell);if(!cell.meta.emptyRow&&value(cell.text,ignoreSpace)!=='')row.values.set(cell.meta.col,value(cell.text,ignoreSpace))}
  return [...map.values()].sort((a,b)=>a.number-b.number).map(row=>{row.cells.sort((a,b)=>a.meta.col-b.meta.col);row.signature=JSON.stringify([...row.values].sort((a,b)=>a[0]-b[0]));row.blank=row.values.size===0;return row});
}

function increasing(pairs){
  const sorted=[...pairs].sort((a,b)=>a[0]-b[0]),tails=[],prev=new Int32Array(sorted.length).fill(-1),at=[];
  sorted.forEach((p,i)=>{let lo=0,hi=tails.length;while(lo<hi){let mid=(lo+hi)>>1;if(tails[mid]<p[1])lo=mid+1;else hi=mid}prev[i]=lo?at[lo-1]:-1;tails[lo]=p[1];at[lo]=i});let out=[],i=at[tails.length-1];while(i!=null&&i>=0){out.push(sorted[i]);i=prev[i]}return out.reverse();
}

function keyColumn(L,R,requested){
  if(requested!=null&&requested!=='auto'&&requested!=='none'){let col=Number(requested);if(!Number.isInteger(col)||col<1||col>16384)throw Error('식별자 열 번호가 올바르지 않습니다.');return col}
  if(requested==='none')return null;
  const named=/^(id|key|code|no\.?|번호|관리번호|식별자|고유번호|자산번호|장비번호|코드|사번|일련번호)$/i;
  const candidates=new Set([1]);for(const row of [L[0],R[0]])for(const [c,v] of row?.values||[])if(named.test(v.trim()))candidates.add(c);
  for(const col of candidates)if(named.test((L[0]?.values.get(col)||'').trim())&&named.test((R[0]?.values.get(col)||'').trim()))return col;
  let best=null,score=0;for(const col of candidates){let a=buckets(L,r=>r.values.get(col)||''),b=buckets(R,r=>r.values.get(col)||''),shared=[...a].filter(([k,v])=>v.length===1&&b.get(k)?.length===1).length,coverage=shared/Math.max(1,Math.min(L.filter(r=>!r.blank).length,R.filter(r=>!r.blank).length));let header=named.test((L[0]?.values.get(col)||'').trim())||named.test((R[0]?.values.get(col)||'').trim());if(shared>=2&&coverage>=.55&&(coverage+(header?2:0)>score)){best=col;score=coverage+(header?2:0)}}return best;
}

const similarity=(a,b)=>{const cols=new Set([...a.values.keys(),...b.values.keys()]);if(!cols.size)return 1;let same=0;for(const col of cols)if(a.values.get(col)===b.values.get(col))same++;return same/cols.size};

export function alignRows(L,R,options={}){
  const pairs=[],usedL=new Set(),usedR=new Set(),reviews=[],reviewedL=new Set(),reviewedR=new Set(),key=keyColumn(L,R,options.keyColumn),keyL=key?buckets(L,r=>r.values.get(key)||''):new Map(),keyR=key?buckets(R,r=>r.values.get(key)||''):new Map();
  const sigL=buckets(L,r=>r.signature),sigR=buckets(R,r=>r.signature);
  const pair=(i,j,reason)=>{if(usedL.has(i)||usedR.has(j))return;usedL.add(i);usedR.add(j);pairs.push({i,j,left:L[i],right:R[j],reason})};
  const uncertain=(li,rj,detail)=>{if(!li.length&&!rj.length)return;li.forEach(i=>reviewedL.add(i));rj.forEach(j=>reviewedR.add(j));reviews.push({left:li.map(i=>L[i]),right:rj.map(j=>R[j]),detail})};
  if(key)for(const [v,ls] of keyL){let rs=keyR.get(v);if(ls.length===1&&rs?.length===1)pair(ls[0],rs[0],'key')}
  // Exact unique rows also recover moved rows when no ID column exists.
  for(const [sig,ls] of sigL){let rs=sigR.get(sig);if(ls.length===1&&rs?.length===1)pair(ls[0],rs[0],'content')}
  const anchors=increasing(pairs.map(p=>[p.i,p.j]));
  function lcs(ai,bj){
    let n=ai.length,m=bj.length;if(!n||!m)return;
    // Strip matching edges before allocating an LCS grid, including long repeated runs.
    while(n&&m&&L[ai[0]].signature===R[bj[0]].signature){pair(ai.shift(),bj.shift(),'sequence');n--;m--}
    let tail=[];while(n&&m&&L[ai[n-1]].signature===R[bj[m-1]].signature){tail.push([ai.pop(),bj.pop()]);n--;m--}
    if(n*m>500000){uncertain(ai,bj,'대응 후보가 너무 많은 구간입니다. 식별자 열을 지정하거나 비교 범위를 줄여 확인하세요.');tail.reverse().forEach(([i,j])=>pair(i,j,'sequence'));return}
    const dp=Array.from({length:n+1},()=>new Uint16Array(m+1));for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=L[ai[i]].signature===R[bj[j]].signature?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
    let i=0,j=0;while(i<n&&j<m){if(L[ai[i]].signature===R[bj[j]].signature){pair(ai[i++],bj[j++],'sequence')}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++}tail.reverse().forEach(([i,j])=>pair(i,j,'sequence'));
  }
  let boundaries=[[-1,-1],...anchors, [L.length,R.length]];for(let k=1;k<boundaries.length;k++){let [li,rj]=boundaries[k-1],[le,re]=boundaries[k];lcs(Array.from({length:le-li-1},(_,i)=>li+1+i).filter(i=>!usedL.has(i)),Array.from({length:re-rj-1},(_,j)=>rj+1+j).filter(j=>!usedR.has(j)))}
  // Changed duplicate identifiers must never fall back to positional matching.
  if(key)for(const v of new Set([...keyL.keys(),...keyR.keys()])){let ls=keyL.get(v)||[],rs=keyR.get(v)||[];if(ls.length>1||rs.length>1){let a=ls.filter(i=>!usedL.has(i)),b=rs.filter(j=>!usedR.has(j));if(a.length||b.length)uncertain(a,b,`식별자 '${v.slice(0,60)}'가 중복되어 변경 행의 대응을 확정할 수 없습니다.`)}}
  // Repeated full rows with unequal occurrence counts are ambiguous even without IDs.
  for(const [sig,ls] of sigL){let rs=sigR.get(sig)||[];if(ls.length!==rs.length&&(ls.length>1||rs.length>1)){let a=ls.filter(i=>!usedL.has(i)&&!reviewedL.has(i)),b=rs.filter(j=>!usedR.has(j)&&!reviewedR.has(j));if(a.length||b.length)uncertain(a,b,'동일한 행이 반복되어 어느 행이 삽입·삭제됐는지 확인이 필요합니다.')}}
  // Compare edits only within stable sequence gaps. IDs that disagree are not paired.
  const stable=increasing(pairs.map(p=>[p.i,p.j]));boundaries=[[-1,-1],...stable,[L.length,R.length]];
  for(let k=1;k<boundaries.length;k++){
    let [li,rj]=boundaries[k-1],[le,re]=boundaries[k],aa=[],bb=[];for(let i=li+1;i<le;i++)if(!usedL.has(i)&&!reviewedL.has(i))aa.push(i);for(let j=rj+1;j<re;j++)if(!usedR.has(j)&&!reviewedR.has(j))bb.push(j);
    if(aa.length*bb.length>100000){uncertain(aa,bb,'변경 후보가 많은 구간의 대응을 확인해 주세요.');continue}
    for(const i of aa){let candidates=[];for(const j of bb){if(usedR.has(j)||reviewedR.has(j))continue;let a=L[i],b=R[j];if(a.blank!==b.blank)continue;if(key&&a.values.get(key)&&b.values.get(key)&&a.values.get(key)!==b.values.get(key))continue;let score=similarity(a,b);if(score>=.5)candidates.push({j,score})}candidates.sort((a,b)=>b.score-a.score);
      if(!candidates.length)continue;let [best,second]=candidates;if(second&&second.score>=best.score-.08){uncertain([i],candidates.filter(c=>c.score>=best.score-.08).map(c=>c.j),'비슷한 행이 여러 개 있어 자동 대응을 확정할 수 없습니다.');continue}
      // Mutual best match avoids assigning a target that fits another source equally well.
      let rivals=aa.filter(other=>other!==i&&!usedL.has(other)&&!reviewedL.has(other)&&similarity(L[other],R[best.j])>=best.score-.08);if(rivals.length){uncertain([i,...rivals],[best.j],'여러 원본 행이 같은 수정 행의 후보입니다.');continue}pair(i,best.j,'edited');
    }
  }
  const order=new Set(increasing(pairs.map(p=>[p.i,p.j])).map(([i])=>i));
  for(const p of pairs){p.moved=!order.has(p.i);p.ambiguous=(sigL.get(p.left.signature)?.length>1||sigR.get(p.right.signature)?.length>1)&&p.reason!=='key'}
  return {pairs,removed:L.filter((_,i)=>!usedL.has(i)&&!reviewedL.has(i)),added:R.filter((_,j)=>!usedR.has(j)&&!reviewedR.has(j)),reviews,keyColumn:key};
}
