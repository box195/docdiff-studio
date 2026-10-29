// Conservative rectangular table recognition from the already rendered page.
// All four edges must be supported by ink. Open/no-border tables stay text blocks.
export function pdfCellLocator(image){
  const {data,width,height}=image,lines=[];
  const ink=(x,y)=>{const k=(y*width+x)*4;return data[k]<130&&data[k+1]<130&&data[k+2]<130;};
  for(let y=0;y<height;y++){
    let start=-1,gap=0;for(let x=0;x<=width;x++){
      if(x<width&&ink(x,y)){if(start<0)start=x;gap=0;}else if(start>=0&&++gap>1){const end=x-gap+1;if(end-start>=28)lines.push({y,x:start,right:end});start=-1;gap=0;}
    }
  }
  // Collapse stroke thickness before using edges as cell identities.
  const edges=[];for(const line of lines){const previous=edges.slice(-20).find(e=>line.y-e.bottom<=2&&line.y>=e.bottom&&Math.abs(line.x-e.x)<=2&&Math.abs(line.right-e.right)<=2);if(previous){previous.bottom=line.y;previous.y=(previous.top+line.y)/2;}else edges.push({...line,top:line.y,bottom:line.y});}
  edges.sort((a,b)=>a.y-b.y||a.x-b.x);
  const stride=height+1,prefix=new Uint32Array(width*stride);
  for(let x=0;x<width;x++)for(let y=0;y<height;y++)prefix[x*stride+y+1]=prefix[x*stride+y]+(ink(x,y)?1:0);
  const vertical=(x,top,bottom)=>{top=Math.max(0,Math.ceil(top));bottom=Math.min(height-1,Math.floor(bottom));return (prefix[x*stride+bottom+1]-prefix[x*stride+top])/(bottom-top+1)>.88;};
  const cells=[],seen=new Set();
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length&&edges[j].y-edges[i].y<=250;j++){
    const a=edges[i],b=edges[j];if(b.y-a.y<7)continue;const min=Math.max(a.x,b.x),max=Math.min(a.right,b.right);if(max-min<7)continue;
    const walls=[];let run=[];const flush=()=>{if(run.length){walls.push((run[0]+run.at(-1))/2);run=[];}};
    for(let x=min;x<=max;x++){if(x<width&&vertical(x,a.y,b.y))run.push(x);else flush();}flush();
    for(let k=1;k<walls.length;k++){const left=walls[k-1],right=walls[k];if(right-left<7)continue;
      if(edges.slice(i+1,j).some(e=>e.y>a.y+2&&e.y<b.y-2&&e.x<=left+2&&e.right>=right-2))continue;
      const rect={x:left,y:a.y,w:right-left,h:b.y-a.y},key=JSON.stringify(rect);if(!seen.has(key)){seen.add(key);cells.push(rect);}
    }
  }
  cells.sort((a,b)=>a.y-b.y||a.x-b.x);
  const cache=new Map();
  const locate=rect=>{
    const cx=rect.x+rect.w/2,cy=rect.y+rect.h/2;
    const enclosed=cells.filter(c=>cx>c.x&&cx<c.x+c.w&&cy>c.y&&cy<c.y+c.h&&rect.x>=c.x-2&&rect.x+rect.w<=c.x+c.w+2).sort((a,b)=>a.w*a.h-b.w*b.h)[0];if(enclosed)return enclosed;
    const top=lines.filter(l=>l.y<cy-2&&l.x<cx&&l.right>cx).at(-1),bottom=lines.find(l=>l.y>cy+2&&l.x<cx&&l.right>cx);
    if(!top||!bottom||bottom.y-top.y<7||bottom.y-top.y>250)return null;
    const key=`${top.y}:${bottom.y}:${Math.round(cx)}`;if(cache.has(key))return cache.get(key);
    const min=Math.max(top.x,bottom.x),max=Math.min(top.right,bottom.right);let left,right;
    for(let x=Math.floor(cx);x>=min;x--)if(vertical(x,top.y,bottom.y)){left=x;break;}
    for(let x=Math.ceil(cx);x<=max;x++)if(vertical(x,top.y,bottom.y)){right=x;break;}
    const result=left!=null&&right!=null&&right-left>=7&&rect.x>=left-2&&rect.x+rect.w<=right+2?{x:left,y:top.y,w:right-left,h:bottom.y-top.y}:null;
    cache.set(key,result);return result;
  };locate.cells=cells;return locate;
}

export function pdfBlocks(lines,locate,includeEmpty=false){
  const blocks=new Map(),fallback=[];
  if(includeEmpty)for(const cell of locate?.cells||[])blocks.set([cell.x,cell.y,cell.w,cell.h].join(':'),{tokens:[],cell});
  for(const line of lines){let pending=[];
    const flush=()=>{if(pending.length){fallback.push({tokens:pending,cell:null});pending=[];}};
    for(const token of line.tokens.sort((a,b)=>a.x-b.x)){
      const rect={x:token.x,y:token.y,w:token.w,h:token.h},cell=locate?.(rect);
      if(cell){flush();const key=[cell.x,cell.y,cell.w,cell.h].join(':');if(!blocks.has(key))blocks.set(key,{tokens:[],cell});blocks.get(key).tokens.push(token);}
      else {const prev=pending.at(-1);if(prev&&token.x-prev.x-prev.w>Math.max(14,token.h*1.6))flush();pending.push(token);}
    }flush();
  }
  return [...blocks.values(),...fallback].sort((a,b)=>(a.cell?.y??a.tokens[0].y)-(b.cell?.y??b.tokens[0].y)||(a.cell?.x??a.tokens[0].x)-(b.cell?.x??b.tokens[0].x));
}

export function pdfTableMetadata(cells,page){
  const parent=cells.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i])),join=(a,b)=>{parent[find(a)]=find(b);},maps=Array.from({length:4},()=>new Map());
  cells.forEach((c,i)=>[c.x,c.x+c.w,c.y,c.y+c.h].forEach((v,k)=>{const q=Math.round(v);if(!maps[k].has(q))maps[k].set(q,[]);maps[k].get(q).push(i);}));
  cells.forEach((c,i)=>{for(const [k,opposite,value] of [[0,1,c.x],[2,3,c.y]])for(let q=Math.round(value)-2;q<=Math.round(value)+2;q++)for(const j of maps[opposite].get(q)||[]){const b=cells[j],overlap=k===0?Math.min(c.y+c.h,b.y+b.h)-Math.max(c.y,b.y):Math.min(c.x+c.w,b.x+b.w)-Math.max(c.x,b.x);if(overlap>2)join(i,j);}});
  const groups=new Map();cells.forEach((c,i)=>{const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(c);});
  const metadata=new Map();let table=0;
  for(const members of groups.values()){
    const x=Math.min(...members.map(c=>c.x)),y=Math.min(...members.map(c=>c.y)),bounds={x,y,w:Math.max(...members.map(c=>c.x+c.w))-x,h:Math.max(...members.map(c=>c.y+c.h))-y};
    const rows=[...new Set(members.map(c=>c.y))].sort((a,b)=>a-b),cols=[...new Set(members.map(c=>c.x))].sort((a,b)=>a-b);
    for(const c of members)metadata.set(JSON.stringify(c),{pdfCell:true,pdfTableKey:`pdf-table:${page}:${table}`,pdfTableBounds:bounds,pdfRow:rows.indexOf(c.y)+1,pdfCol:cols.indexOf(c.x)+1});table++;
  }
  return metadata;
}
