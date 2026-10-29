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
  const vertical=(x,top,bottom)=>{let count=0;for(let y=top;y<=bottom;y++)if(ink(x,y))count++;return count/(bottom-top+1)>.88;};
  const cache=new Map();
  return rect=>{
    const cx=rect.x+rect.w/2,cy=rect.y+rect.h/2;
    const top=lines.filter(l=>l.y<cy-2&&l.x<cx&&l.right>cx).at(-1),bottom=lines.find(l=>l.y>cy+2&&l.x<cx&&l.right>cx);
    if(!top||!bottom||bottom.y-top.y<7||bottom.y-top.y>250)return null;
    const key=`${top.y}:${bottom.y}:${Math.round(cx)}`;if(cache.has(key))return cache.get(key);
    const min=Math.max(top.x,bottom.x),max=Math.min(top.right,bottom.right);let left,right;
    for(let x=Math.floor(cx);x>=min;x--)if(vertical(x,top.y,bottom.y)){left=x;break;}
    for(let x=Math.ceil(cx);x<=max;x++)if(vertical(x,top.y,bottom.y)){right=x;break;}
    const result=left!=null&&right!=null&&right-left>=7&&rect.x>=left-2&&rect.x+rect.w<=right+2?{x:left,y:top.y,w:right-left,h:bottom.y-top.y}:null;
    cache.set(key,result);return result;
  };
}

export function pdfBlocks(lines,locate){
  const blocks=new Map(),fallback=[];
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
