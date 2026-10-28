// Pinned MIT-licensed RHWP 0.8.7. Document bytes never leave this browser.
import {styleReader,textStyleRanges} from './hwp-styles.js?v=20261028-6';
let enginePromise;
async function engine(){
  if(!enginePromise)enginePromise=(async()=>{
    const api=await import('./vendor/rhwp/rhwp.js');
    if(typeof document!=='undefined'){
      const ctx=document.createElement('canvas').getContext('2d');
      globalThis.measureTextWidth=(font,text)=>{ctx.font=font;return ctx.measureText(text).width;};
      await document.fonts?.ready;
    }
    await api.default({module_or_path:new URL('./vendor/rhwp/rhwp_bg.wasm',import.meta.url)});
    return api;
  })().catch(error=>{enginePromise=null;throw error;});
  return enginePromise;
}
const parse=(value,fallback={})=>{try{return JSON.parse(value)}catch{return fallback}};
const union=rects=>{const r={x:Math.min(...rects.map(r=>r.x)),y:Math.min(...rects.map(r=>r.y)),w:0,h:0};r.w=Math.max(...rects.map(r=>r.x+r.w))-r.x;r.h=Math.max(...rects.map(r=>r.y+r.h))-r.y;return r;};
const pathKey=path=>path.map(p=>`${p.controlIndex}:${p.cellIndex}`).join('/');
const normalized=s=>String(s??'').replace(/\r\n?/g,'\n');

export function layoutRecords(native,pageIndex,info,layout,inspection={reader:styleReader(native),seen:new Set()}){
  const scale=800/info.width,groups=new Map(),tables=new Map();
  const tableFor=run=>{
    const key=`${run.secIdx}:${run.parentParaIdx}:${run.controlIdx}`;
    if(!tables.has(key)){
      const bounds=parse(native.getTableCellBboxes(run.secIdx,run.parentParaIdx,run.controlIdx,pageIndex),[]);
      const dimensions=parse(native.getTableDimensions(run.secIdx,run.parentParaIdx,run.controlIdx));
      tables.set(key,{key,bounds,shape:JSON.stringify(dimensions)});
    }
    return tables.get(key);
  };
  for(const run of layout.runs||[]){
    if(!Number.isFinite(run.x)||!Number.isFinite(run.y))continue;
    const inCell=Array.isArray(run.cellPath)&&run.cellPath.length>0;
    const source=inCell?`${run.secIdx}:${run.parentParaIdx}:${pathKey(run.cellPath)}`:`p:${run.secIdx}:${run.paraIdx}:${run.context||''}`;
    if(!groups.has(source))groups.set(source,{source,runs:[],inCell,table:inCell?tableFor(run):null});
    groups.get(source).runs.push(run);
  }
  // Even an empty cell needs a real page rectangle so an insertion can be
  // matched and highlighted on the original side, without borrowing a comment.
  for(const table of tables.values())for(const box of table.bounds){
    if(box.pageIndex!==pageIndex)continue;
    const [sec,parent,control]=table.key.split(':').map(Number),source=`${sec}:${parent}:${control}:${box.cellIdx}`;
    if(!groups.has(source))groups.set(source,{source,runs:[],inCell:true,table,emptyBox:box});
  }
  const output=[];
  for(const group of groups.values()){
    const runs=group.runs.sort((a,b)=>(a.cellParaIdx??a.paraIdx)-(b.cellParaIdx??b.paraIdx)||a.charStart-b.charStart||a.y-b.y||a.x-b.x);
    const first=runs[0],nested=first?.cellPath?.length>1;
    let box=group.emptyBox;
    if(group.inCell&&first&&!nested)box=group.table.bounds.find(b=>b.cellIdx===first.cellIdx&&b.pageIndex===pageIndex);
    const textParts=new Map();
    for(const r of runs){const key=r.cellParaIdx??r.paraIdx;if(!textParts.has(key))textParts.set(key,[]);textParts.get(key).push(normalized(r.text));}
    const text=[...textParts.values()].map(parts=>parts.join('')).join('\n').trim();
    if(!text&&!group.inCell)continue;
    const rawRect=box?{x:box.x,y:box.y,w:box.w,h:box.h}:union(runs.map(r=>({x:r.x,y:r.y,w:Math.max(2,r.w),h:Math.max(2,r.h)})));
    const rect=Object.fromEntries(Object.entries(rawRect).map(([k,v])=>[k,v*scale]));
    let cellInfo=box;
    if(group.inCell&&!cellInfo&&first)cellInfo=parse(native.getCellInfoByPath(first.secIdx,first.parentParaIdx,JSON.stringify(first.cellPath)));
    const col=(cellInfo?.col??0)+1,row=(cellInfo?.row??0)+1;
    const ranges=textStyleRanges(runs,inspection.reader),primary=ranges[0]?.style;
    const style={...(primary||{}),textStyles:ranges,paragraphFormat:inspection.reader.paragraphs(runs,group.inCell)};
    if(group.inCell&&!ranges.length&&first)style.emptyTextFormat=inspection.reader.characters(first);
    if(group.inCell){const [sec,parent,control]=group.table.key.split(':').map(Number),index=first?.cellIdx??box?.cellIdx;Object.assign(style,inspection.reader.cell(sec,parent,control,index,first?.cellPath,cellInfo));}
    const meta=group.inCell?{sourceCellKey:group.source,tableShape:group.table.shape,sourceTableKey:group.table.key,tableRow:row,col,colSpan:cellInfo?.colSpan||1,rowSpan:cellInfo?.rowSpan||1,rowKey:''}:{};
    output.push({id:`hwp-${pageIndex}-${output.length}`,role:group.inCell?'cell':'paragraph',text,page:pageIndex,rect,style,source:'hwp-layout',meta,label:group.inCell?`표 · ${row}행 ${col}열`:`${pageIndex+1}페이지 본문`});
  }
  const rowKeys=new Map();for(const r of output.filter(r=>r.role==='cell').sort((a,b)=>a.meta.col-b.meta.col)){const key=`${r.meta.sourceTableKey}:${r.meta.tableRow}`;if(!rowKeys.has(key))rowKeys.set(key,r.text);}
  for(const r of output)if(r.role==='cell')r.meta.rowKey=rowKeys.get(`${r.meta.sourceTableKey}:${r.meta.tableRow}`)||'';
  for(const table of tables.values()){
    if(inspection.seen.has(table.key))continue;inspection.seen.add(table.key);
    const [sec,parent,control]=table.key.split(':').map(Number),properties=inspection.reader.table(sec,parent,control),bounds=table.bounds.filter(b=>b.pageIndex===pageIndex);
    if(properties&&bounds.length)output.push({id:`hwp-table-${table.key}`,role:'table-format',text:'표 설정',page:pageIndex,rect:Object.fromEntries(Object.entries(union(bounds)).map(([k,v])=>[k,v*scale])),style:{tableFormat:{...properties,dimensions:parse(table.shape)}},meta:{sourceObjectKey:`table:${table.key}`},source:'hwp-layout',label:'표 전체 설정'});
  }
  return output.sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x);
}

export async function readHwpPages(file,onProgress=()=>{}){
  onProgress(0,'한글 페이지 엔진 불러오는 중 · 첫 실행 약 12MB');
  const {HwpDocument}=await engine();await new Promise(resolve=>setTimeout(resolve,0));
  let native;
  try{
    native=new HwpDocument(new Uint8Array(await file.arrayBuffer()));
    const count=native.pageCount();if(!count||count>300)throw Error('한글 문서는 1~300페이지까지 지원합니다.');
    const doc={name:file.name.split(/[\\/]/).pop(),type:file.name.toLowerCase().endsWith('.hwpx')?'hwpx':'hwp',preview:'hwp-layout',pages:[],records:[],warnings:['한글 페이지 엔진으로 표·글꼴·여백을 재현합니다. 한컴 자체 엔진이 아니므로 미설치 글꼴·일부 개체·페이지 나눔은 다를 수 있습니다. 댓글은 본문 비교에서 제외합니다.'],hwp:native,svgCache:new Map()};
    const inspection={reader:styleReader(native),seen:new Set()},sections=new Set();
    for(let i=0;i<count;i++){
      const info=parse(native.getPageInfo(i)),layout=parse(native.getPageTextLayout(i));if(!info.width||!info.height)throw Error('한글 페이지 크기를 읽지 못했습니다.');
      doc.pages.push({title:`한글 ${i+1}페이지`,kind:'hwp-layout',width:800,height:800*info.height/info.width,sourceWidth:info.width,sourceHeight:info.height});
      doc.records.push(...layoutRecords(native,i,info,layout,inspection));
      if(!sections.has(info.sectionIndex)){sections.add(info.sectionIndex);const properties=inspection.reader.page(info.sectionIndex);if(properties)doc.records.push({id:`hwp-section-${info.sectionIndex}`,role:'page-format',text:'페이지 설정',page:i,rect:{x:20,y:20,w:760,h:30},style:{pageFormat:properties},meta:{sourceObjectKey:`section:${info.sectionIndex}`},source:'hwp-layout',label:`구역 ${info.sectionIndex+1} 용지·여백`});}
      onProgress((i+1)/count*.85,`${i+1}/${count}페이지 · 본문·셀 색상·테두리·서식 분석`);
      if(i%3===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(inspection.reader.missing.size)doc.warnings.push('일부 개체의 서식을 읽지 못했습니다. 중첩 표·특수 개체는 화면과 함께 확인하세요.');
    doc.dispose=()=>{if(doc.hwp){doc.hwp.free();doc.hwp=null;doc.svgCache.clear();}};
    return doc;
  }catch(error){native?.free();throw Error(`한글 페이지를 열지 못했습니다: ${error.message||error} 암호·손상·미지원 문서는 한글에서 PDF로 저장해 비교하세요.`);}
}

export async function renderHwpPage(doc,index,canvas,width){
  let svg=doc.svgCache.get(index);if(!svg){svg=doc.hwp.renderPageSvg(index);doc.svgCache.set(index,svg);}
  // SVG is loaded as an image, never injected as active HTML. Browsers block
  // script and external resources in SVG image mode.
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  try{
    const image=new Image();image.src=url;await image.decode();
    canvas.width=Math.round(width);canvas.height=Math.round(width*doc.pages[index].height/doc.pages[index].width);
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  }finally{URL.revokeObjectURL(url);}
}
