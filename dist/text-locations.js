// Character edits are display details, never separate navigation items.
export function changedSpans(before,after,ignoreSpace=false){
  const chars=s=>{let offset=0;return Array.from(String(s||'')).flatMap(c=>{const item={c,start:offset,end:offset+c.length};offset+=c.length;return ignoreSpace&&/\s/u.test(c)?[]:[item];});};
  const a=chars(before),b=chars(after);let head=0,tail=0;
  while(head<a.length&&head<b.length&&a[head].c===b[head].c)head++;
  while(tail<a.length-head&&tail<b.length-head&&a[a.length-1-tail].c===b[b.length-1-tail].c)tail++;
  const A=a.slice(head,a.length-tail),B=b.slice(head,b.length-tail),left=[],right=[];
  if((A.length+1)*(B.length+1)<=250000){
    const width=B.length+1,dp=new Uint32Array((A.length+1)*width);
    for(let i=A.length-1;i>=0;i--)for(let j=B.length-1;j>=0;j--)dp[i*width+j]=A[i].c===B[j].c?dp[(i+1)*width+j+1]+1:Math.max(dp[(i+1)*width+j],dp[i*width+j+1]);
    let i=0,j=0;while(i<A.length||j<B.length){if(i<A.length&&j<B.length&&A[i].c===B[j].c){i++;j++;}else if(i<A.length&&(j===B.length||dp[(i+1)*width+j]>=dp[i*width+j+1]))left.push(A[i++]);else right.push(B[j++]);}
  }else{for(const c of A)left.push(c);for(const c of B)right.push(c);}
  const merge=items=>{const out=[];for(const item of items){const last=out.at(-1);if(last&&last.end===item.start)last.end=item.end;else out.push({start:item.start,end:item.end});}return out;};
  return {left:merge(left),right:merge(right)};
}

let measure;
export function makeTextRun(text,rect,font='12px Arial',start=0){
  if(!measure&&typeof document!=='undefined')measure=document.createElement('canvas').getContext('2d');
  const chars=Array.from(text),weights=chars.map(c=>measure?(measure.font=font,measure.measureText(c).width):/[\u1100-\uffff]/u.test(c)?1:.55),total=weights.reduce((a,b)=>a+b,0)||1;
  let x=0,offset=start;const glyphs=chars.map((c,i)=>{const width=weights[i]/total*rect.w,g={start:offset,end:offset+c.length,x:rect.x+x,w:width};x+=width;offset+=c.length;return g;});
  return {start,end:start+text.length,rect,glyphs,approximate:chars.length>1};
}

export function textRectangles(record,spans){
  const out=[];
  for(const run of record?.textRuns||[]){
    for(const span of spans){
      const glyphs=run.glyphs.filter(g=>g.end>span.start&&g.start<span.end);if(!glyphs.length)continue;
      const x=glyphs[0].x,right=glyphs.at(-1).x+glyphs.at(-1).w;
      out.push({x,y:run.rect.y,w:Math.max(2,right-x),h:run.rect.h,approximate:run.approximate});
    }
  }
  return out;
}

export function paddedContext(rect,page,padding=5){
  const x=Math.max(0,rect.x-padding),y=Math.max(0,rect.y-padding);
  return {x,y,w:Math.min(page.width,rect.x+rect.w+padding)-x,h:Math.min(page.height,rect.y+rect.h+padding)-y};
}

export function changeOverlays(diff,side,ignoreSpace=false){
  const members=diff.members||[diff],out=[];
  for(const d of members){const r=d[side];if(!r?.rect)continue;let highlights=[];
    if(d.type!=='review'&&d.category==='content'){
      const spans=d.type==='added'||d.type==='removed'?[{start:0,end:r.text.length}]:changedSpans(d.oldText,d.newText,ignoreSpace)[side];
      highlights=textRectangles(r,spans);
      // No fabricated glyph coordinates when a reader cannot locate text.
    }
    out.push({record:r,highlights,format:d.category==='format'||d.category==='page-format'||!!d.formatChanges?.length});
  }
  return out;
}
