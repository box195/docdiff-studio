/* The user-selected bytes stay in this tab. No uploads, eval, or document macros. */
import * as pdfjs from './vendor/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
export const PAGE_WIDTH = 800;
export const PAGE_HEIGHT = 1120;

const descendants = (node, name) => Array.from(node.getElementsByTagName('*')).filter(n => n.localName === name);
const children = (node, name) => Array.from(node?.children || []).filter(n => n.localName === name);
const firstChild = (node, name) => children(node, name)[0];
const attr = (node, name, fallback='') => node?.getAttribute(name) ?? fallback;
const xml = s => { const doc = new DOMParser().parseFromString(s, 'application/xml'); if (doc.querySelector('parsererror')) throw new Error('문서 XML 형식을 읽을 수 없습니다.'); return doc; };
const exactText = el => descendants(el,'t').map(n=>n.textContent||'').join('');
const trimFileName = name => name.split(/[\\/]/).pop();
const colNumber = s => { let n=0; for(const c of s.toUpperCase())n=n*26+c.charCodeAt(0)-64;return n;};
const colName = n => { let s='';while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;};
const cellAddress = (row,col) => `${colName(col)}${row}`;
const normalizePath = (base, target) => { if(target.startsWith('/'))return target.slice(1);const a=base.split('/').slice(0,-1).concat(target.split('/'));const out=[];for(const c of a){if(c==='..')out.pop();else if(c!=='.'&&c)out.push(c)}return out.join('/');};
const page = (title,kind='generated') => ({title,kind,width:PAGE_WIDTH,height:PAGE_HEIGHT,elements:[]});
const point = (r,x,y,w,h) => {r.pageRect={x,y,w,h};return r;};
const guardZip = zip => { const arr=Object.values(zip.files);if(arr.length>6000)throw new Error('압축 내부 파일 수가 지나치게 많습니다.');let total=0;for(const f of arr){total+=(f._data?.uncompressedSize||0);if(total>180*1024*1024)throw new Error('압축 해제 크기가 안전 제한을 초과했습니다.');} };

export async function readDocument(file,onProgress=()=>{}){
  if(!file)throw new Error('문서를 먼저 선택하세요.');
  if(file.size>80*1024*1024)throw new Error('첫 버전은 파일당 80MB까지 지원합니다.');
  const ext=file.name.split('.').pop().toLowerCase();
  if(ext==='hwp')throw new Error('구형 HWP는 이 웹앱에서 직접 해석할 수 없습니다. 한글에서 HWPX 또는 PDF로 저장한 뒤 선택해 주세요.');
  if(ext==='pdf')return readPdf(file,onProgress);
  if(!['xlsx','hwpx'].includes(ext))throw new Error('PDF, XLSX, HWPX 파일을 선택해 주세요.');
  if(!globalThis.JSZip)throw new Error('압축 문서 읽기 구성 요소가 로드되지 않았습니다.');
  const zip=await globalThis.JSZip.loadAsync(await file.arrayBuffer());guardZip(zip);
  return ext==='xlsx'?readXlsx(file,zip,onProgress):readHwpx(file,zip,onProgress);
}

async function readPdf(file,onProgress){
  const bytes=new Uint8Array(await file.arrayBuffer());
  const loading=pdfjs.getDocument({data:bytes,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href});
  const pdf=await loading.promise;
  if(pdf.numPages>300)throw new Error('첫 버전은 PDF 300페이지까지 지원합니다. 문서를 나누어 비교해 주세요.');
  const doc={name:trimFileName(file.name),type:'pdf',pages:[],records:[],warnings:[],pdf};
  let textCount=0;
  for(let p=1;p<=pdf.numPages;p++){
    const pg=await pdf.getPage(p),vp=pg.getViewport({scale:1}),scale=PAGE_WIDTH/vp.width;
    const info=await pg.getTextContent();
    const lines=[];
    for(const item of info.items){
      if(!item.str?.trim())continue;
      const tx=pdfjs.Util.transform([scale,0,0,-scale,0,vp.height*scale],item.transform);
      const size=Math.max(8,Math.abs(item.height*scale)||Math.abs(tx[3]));
      const x=Math.max(0,tx[4]),y=Math.max(0,tx[5]-size),w=Math.max(2,item.width*scale),h=size*1.25;
      const existing=lines.find(l=>Math.abs(l.y-y)<Math.max(5,size*.38) && x>=l.minX-7);
      if(existing){existing.tokens.push({str:item.str,x,w});existing.minX=Math.min(existing.minX,x);existing.maxX=Math.max(existing.maxX,x+w);existing.h=Math.max(existing.h,h)}
      else lines.push({y,minX:x,maxX:x+w,h,tokens:[{str:item.str,x,w}]});
    }
    lines.sort((a,b)=>a.y-b.y||a.minX-b.minX);
    const output=page(`PDF ${p}페이지`,'pdf');output.height=Math.round(vp.height*scale);
    for(const line of lines){
      line.tokens.sort((a,b)=>a.x-b.x);
      let text='';let right=-Infinity;
      for(const t of line.tokens){if(text&&t.x-right>3)text+=' ';text+=t.str;right=Math.max(right,t.x+t.w);}
      if(!text.trim())continue;
      const r={id:`pdf-${p}-${doc.records.length}`,role:'paragraph',text:text.trim(),label:`${p}페이지`,page:p-1,rect:{x:line.minX,y:line.y,w:Math.max(8,line.maxX-line.minX),h:line.h},style:null,source:'pdf'};
      doc.records.push(r);textCount++;output.elements.push({kind:'text',text:r.text,...r.rect});
    }
    doc.pages.push(output);onProgress(p/pdf.numPages*.85,`${p}/${pdf.numPages}페이지 텍스트 분석`);
    if(p%5===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(!textCount)doc.warnings.push('이 PDF에서 선택 가능한 텍스트를 찾지 못했습니다. 스캔 문서라면 화면 비교만 가능합니다(OCR 미지원).');
  return doc;
}

function parseExcelStyles(styleXml){
  if(!styleXml)return[];
  const root=xml(styleXml),fontRoot=descendants(root,'fonts')[0],borderRoot=descendants(root,'borders')[0],fillRoot=descendants(root,'fills')[0],cellXfs=descendants(root,'cellXfs')[0];
  const color=node=>node?(attr(node,'rgb')||(node.hasAttribute('theme')?'theme:'+attr(node,'theme')+':'+attr(node,'tint','0'):'')||(node.hasAttribute('indexed')?'indexed:'+attr(node,'indexed'):'')||'auto'):'';
  const enabled=node=>!!node&&!['0','false'].includes(attr(node,'val','1'));
  const fonts=children(fontRoot,'font').map(f=>({font:attr(firstChild(f,'name'),'val',''),size:Number(attr(firstChild(f,'sz'),'val',11)),bold:enabled(firstChild(f,'b')),italic:enabled(firstChild(f,'i')),underline:firstChild(f,'u')?attr(firstChild(f,'u'),'val','single'):'none',strike:enabled(firstChild(f,'strike')),color:color(firstChild(f,'color'))}));
  const borders=children(borderRoot,'border').map(b=>Object.fromEntries(['left','right','top','bottom'].map(side=>[side,attr(firstChild(b,side),'style','none')])));
  const borderColors=children(borderRoot,'border').map(b=>Object.fromEntries(['left','right','top','bottom'].map(side=>[side,color(firstChild(firstChild(b,side),'color'))])));
  const fills=children(fillRoot,'fill').map(f=>color(firstChild(firstChild(f,'patternFill'),'fgColor')));
  const numberFormats=new Map(descendants(root,'numFmt').map(n=>[attr(n,'numFmtId'),attr(n,'formatCode')]));
  return children(cellXfs,'xf').map(x=>({...fonts[Number(attr(x,'fontId','0'))],border:borders[Number(attr(x,'borderId','0'))]||{},borderColor:borderColors[Number(attr(x,'borderId','0'))]||{},alignment:Object.fromEntries(Array.from(firstChild(x,'alignment')?.attributes||[]).map(a=>[a.name,a.value])),numberFormat:numberFormats.get(attr(x,'numFmtId','0'))||'',fill:fills[Number(attr(x,'fillId','0'))]||'',numFmtId:attr(x,'numFmtId','0')}));
}

async function readXlsx(file,zip,onProgress){
  const workbookFile=zip.file('xl/workbook.xml');if(!workbookFile)throw new Error('유효한 XLSX 통합문서가 아닙니다.');
  const wb=xml(await workbookFile.async('string'));
  const relFile=zip.file('xl/_rels/workbook.xml.rels');const rel=relFile?xml(await relFile.async('string')):null;
  const relationships=new Map(rel?descendants(rel,'Relationship').map(r=>[attr(r,'Id'),attr(r,'Target')]):[]);
  const sfile=zip.file('xl/sharedStrings.xml');const shared=sfile?descendants(xml(await sfile.async('string')),'si').map(exactText):[];
  const styleFile=zip.file('xl/styles.xml');const styles=parseExcelStyles(styleFile?await styleFile.async('string'):null);
  const names=descendants(wb,'sheet');const doc={name:trimFileName(file.name),type:'xlsx',pages:[],records:[],warnings:['엑셀 미리보기는 셀 구조 기반이며 실제 Excel 인쇄 페이지와 다를 수 있습니다.'],sheets:[]};
  for(let si=0;si<names.length;si++){
    const sh=names[si],name=attr(sh,'name',`Sheet ${si+1}`),rid=attr(sh,'r:id')||sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
    const target=relationships.get(rid)||`worksheets/sheet${si+1}.xml`;
    const path=normalizePath('xl/workbook.xml',target),entry=zip.file(path);
    if(!entry){doc.warnings.push(`${name} 시트 내용을 읽지 못했습니다.`);continue;}
    const sheetXml=xml(await entry.async('string'));
    const cells=descendants(sheetXml,'c'),rows=new Map(),sheetRecords=[],declaredRows=descendants(sheetXml,'row'),rowNodes=new Map(declaredRows.map(r=>[Number(attr(r,'r')),r]));
    for(const c of cells){
      const addr=attr(c,'r'),m=addr.match(/^([A-Z]+)(\d+)$/i);if(!m)continue;
      const col=colNumber(m[1]),row=Number(m[2]);if(row>100000||col>16384)continue;
      const t=attr(c,'t'),v=firstChild(c,'v')?.textContent||'',formula=firstChild(c,'f')?.textContent||'';
      let value=t==='s'?shared[Number(v)]??v:t==='inlineStr'?exactText(c):t==='b'?(v==='1'?'TRUE':'FALSE'):v;
      if(formula&&!value)value=`=${formula}`;
      const baseStyle=styles[Number(attr(c,'s','0'))]||null;const rowNode=rowNodes.get(row);const style=baseStyle?{...baseStyle,rowHeight:attr(rowNode,'ht',null)}:null;
      if(!String(value).trim()&&!formula&&!style)continue;
      const r={id:`xlsx-${name}-${addr}`,role:'cell',text:String(value),label:`${name}!${addr}`,page:-1,rect:null,style,meta:{sheet:name,row,col,address:addr,formula,raw:v,type:t}};
      sheetRecords.push(r);if(!rows.has(row))rows.set(row,[]);rows.get(row).push(r);
    }
    const declaredLast=declaredRows.reduce((m,r)=>{let n=Number(attr(r,'r','0'));return n<=100000?Math.max(m,n):m},0);
    let lastRow=declaredLast;for(const r of sheetRecords)lastRow=Math.max(lastRow,r.meta.row);
    if(lastRow>8000)throw new Error('시트 표시 페이지가 200장을 초과합니다. 비교 범위를 줄여 주세요.');
    for(let row=1;row<=lastRow;row++)if(!rows.has(row)){const r={id:`xlsx-${name}-blank-${row}`,role:'row',text:'',label:`${name}!${row}행 (빈 행)`,page:-1,rect:null,style:null,meta:{sheet:name,row,col:1,address:`A${row}`,formula:'',emptyRow:true}};rows.set(row,[r]);sheetRecords.push(r)}
    for(const rs of rows.values()){
      const key=rs.find(r=>r.meta.col===1)?.text||'';
      for(const r of rs)r.meta.rowKey=key;
    }
    let maxRow=1,maxCol=1;
    for(const row of rows.keys())maxRow=Math.max(maxRow,row);
    for(const record of sheetRecords)maxCol=Math.max(maxCol,record.meta.col);
    const maxRowPages=Math.ceil(maxRow/40),maxColPages=Math.ceil(maxCol/9);
    if(maxRowPages*maxColPages>200)throw new Error('시트 표시 페이지가 200장을 초과합니다. 비교 범위를 줄여 주세요.');
    for(let cg=0;cg<maxColPages;cg++)for(let rg=0;rg<maxRowPages;rg++){
      const startRow=rg*40+1,endRow=Math.min(maxRow,(rg+1)*40),startCol=cg*9+1,endCol=Math.min(maxCol,(cg+1)*9),pg=page(`${name} ${startRow}-${endRow}행 / ${colName(startCol)}-${colName(endCol)}열`);
      pg.elements.push({kind:'title',text:name,x:45,y:30,w:700,h:38});
      const w=720/(endCol-startCol+1),h=24;
      for(let col=startCol;col<=endCol;col++)pg.elements.push({kind:'header',text:colName(col),x:44+(col-startCol)*w,y:83,w,h:25});
      for(let row=startRow;row<=endRow;row++){
        const list=rows.get(row)||[];
        for(const r of list){const col=r.meta.col;if(col<startCol||col>endCol)continue;
          r.page=doc.pages.length;r.rect={x:44+(col-startCol)*w,y:110+(row-startRow)*h,w,h};
          pg.elements.push({kind:'cell',text:r.text,...r.rect,style:r.style,label:r.label});
        }
      }
      pg.grid={startRow,endRow,startCol,endCol,x:44,y:110,w,h,cols:endCol-startCol+1,rows:endRow-startRow+1};
      doc.pages.push(pg);
    }
    const printLayout={};for(const tag of ['pageMargins','pageSetup','printOptions']){const node=descendants(sheetXml,tag)[0];if(node)printLayout[tag]=Object.fromEntries(Array.from(node.attributes).map(a=>[a.name,a.value]))}doc.sheets.push({name,rows:[...rows.keys()].length,cells:sheetRecords.length,printLayout});doc.records.push(...sheetRecords);
    onProgress((si+1)/names.length*.85,`${name} 시트 분석`);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(!doc.pages.length)doc.pages.push(page('빈 통합문서'));
  return doc;
}

async function readHwpx(file,zip,onProgress){
  const sectionFiles=Object.keys(zip.files).filter(p=>/^Contents\/section\d+\.xml$/i.test(p)).sort((a,b)=>Number(a.match(/\d+/)?.[0]||0)-Number(b.match(/\d+/)?.[0]||0));
  if(!sectionFiles.length)throw new Error('HWPX의 본문 XML을 찾지 못했습니다.');
  const doc={name:trimFileName(file.name),type:'hwpx',pages:[],records:[],warnings:['HWPX 미리보기는 구조 기반이며 한글 프로그램의 실제 페이지 나눔·글꼴·표 위치와 다를 수 있습니다.']};
  let current=page('한글 문서 1페이지'),y=45;
  const newPage=()=>{doc.pages.push(current);current=page(`한글 문서 ${doc.pages.length+1}페이지`);y=45;};
  const add=(text,role='paragraph',label='',style=null)=>{
    if(!text?.trim())return;
    const length=role==='cell'?65:60,lines=Math.max(1,Math.ceil(text.length/length)),height=Math.min(164,Math.max(28,lines*22+7));
    if(y+height>1060)newPage();
    const r={id:`hwpx-${doc.records.length}`,role,text,label:label||`문단 ${doc.records.length+1}`,page:doc.pages.length,rect:{x:58,y,w:680,h:height},style};
    doc.records.push(r);current.elements.push({kind:role==='cell'?'tablecell':'paragraph',text,x:58,y,w:680,h:height});y+=height+8;
  };
  const addTableRow=(values,section,row)=>{
    if(!values.length)return;
    const height=46;if(y+height>1060)newPage();
    const width=680/values.length,rowKey=values[0]||'';
    values.forEach((text,col)=>{
      const x=58+col*width,rect={x,y,w:width,h:height};
      const r={id:`hwpx-${doc.records.length}`,role:'cell',text,label:`표 ${section+1} / ${row+1}행 ${col+1}열`,page:doc.pages.length,rect,style:null,meta:{rowKey,col:col+1,tableSection:section,tableRow:row+1}};
      doc.records.push(r);current.elements.push({kind:'tablecell',text,...rect});
    });
    y+=height+7;
  };
  for(let si=0;si<sectionFiles.length;si++){
    const root=xml(await zip.file(sectionFiles[si]).async('string'));
    const walk=(node,inTable=false)=>{
      if(node.localName==='tbl'){
        const tableRows=descendants(node,'tr');
        tableRows.forEach((tr,row)=>{const cells=children(tr,'tc');const vals=cells.map(tc=>exactText(tc).trim().replace(/\s+/g,' '));addTableRow(vals,si,row);});
        return;
      }
      if(node.localName==='p'&&!inTable){const tables=descendants(node,'tbl');if(tables.length){const ownText=descendants(node,'t').filter(t=>{let p=t.parentNode;while(p&&p!==node){if(p.localName==='tbl')return false;p=p.parentNode}return true}).map(t=>t.textContent||'').join('');add(ownText,'paragraph',`본문 ${si+1}`);for(const table of tables.filter(t=>{let p=t.parentNode;while(p&&p!==node){if(p.localName==='tbl')return false;p=p.parentNode}return true}))walk(table,true)}else add(exactText(node),'paragraph',`본문 ${si+1}`);return;}
      for(const ch of Array.from(node.children||[]))walk(ch,inTable);
    };
    walk(root.documentElement);onProgress((si+1)/sectionFiles.length*.85,`한글 문서 ${si+1}/${sectionFiles.length}구역`);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  doc.pages.push(current);
  if(!doc.records.length)doc.warnings.push('본문 텍스트를 찾지 못했습니다. 지원되지 않는 HWPX 개체가 포함됐을 수 있습니다.');
  return doc;
}

export async function renderPage(doc,index,canvas,width=800){
  const pg=doc.pages[index];if(!pg)return;
  if(doc.type==='pdf'){
    const pdfpage=await doc.pdf.getPage(index+1),base=pdfpage.getViewport({scale:1}),scale=width/base.width;
    const vp=pdfpage.getViewport({scale});canvas.width=Math.round(vp.width);canvas.height=Math.round(vp.height);
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    await pdfpage.render({canvasContext:ctx,viewport:vp}).promise;
  }else{
    canvas.width=PAGE_WIDTH;canvas.height=PAGE_HEIGHT;const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(doc.type==='xlsx')drawSheet(ctx,pg);else drawHwpx(ctx,pg);
  }
}

function ellipsis(ctx,text,width){let str=String(text||'');if(ctx.measureText(str).width<=width)return str;while(str.length>1&&ctx.measureText(`${str}…`).width>width)str=str.slice(0,-1);return `${str}…`;}
function drawSheet(ctx,pg){
  ctx.fillStyle='#1b3e4b';ctx.font='bold 24px Arial';ctx.fillText(pg.elements[0]?.text||'시트',44,55);
  const g=pg.grid;if(!g)return;
  ctx.font='12px Arial';
  for(let c=0;c<g.cols;c++){const x=g.x+c*g.w;ctx.fillStyle='#edf3f5';ctx.fillRect(x,83,g.w,27);ctx.strokeStyle='#bccdd3';ctx.lineWidth=1;ctx.strokeRect(x,83,g.w,27);ctx.fillStyle='#59717d';ctx.fillText(colName(g.startCol+c),x+8,101);}
  for(let r=0;r<g.rows;r++)for(let c=0;c<g.cols;c++){const x=g.x+c*g.w,y=g.y+r*g.h;ctx.fillStyle=r%2?'#fcfdfd':'#fff';ctx.fillRect(x,y,g.w,g.h);ctx.strokeStyle='#d9e3e7';ctx.lineWidth=.65;ctx.strokeRect(x,y,g.w,g.h);}
  for(const e of pg.elements.filter(x=>x.kind==='cell')){
    if(e.style?.fill?.length===8){ctx.fillStyle=`#${e.style.fill.slice(2)}`;ctx.fillRect(e.x,e.y,e.w,e.h);}
    const b=e.style?.border||{};ctx.strokeStyle='#50636d';ctx.lineWidth=1;
    for(const side of ['top','bottom','left','right'])if(b[side]&&b[side]!=='none'){
      ctx.lineWidth=['medium','thick','double'].includes(b[side])?2.5:1;
      ctx.beginPath();if(side==='top'){ctx.moveTo(e.x,e.y);ctx.lineTo(e.x+e.w,e.y)}if(side==='bottom'){ctx.moveTo(e.x,e.y+e.h);ctx.lineTo(e.x+e.w,e.y+e.h)}if(side==='left'){ctx.moveTo(e.x,e.y);ctx.lineTo(e.x,e.y+e.h)}if(side==='right'){ctx.moveTo(e.x+e.w,e.y);ctx.lineTo(e.x+e.w,e.y+e.h)}ctx.stroke();
    }
    ctx.fillStyle='#293d47';ctx.font=`${e.style?.bold?'bold ':''}${Math.min(14,Math.max(10,e.style?.size||12))}px Arial`;
    ctx.fillText(ellipsis(ctx,e.text,e.w-10),e.x+5,e.y+16);
  }
  ctx.font='11px Arial';ctx.fillStyle='#8b9fa9';ctx.fillText(pg.title,45,1091);
}
function drawHwpx(ctx,pg){
  ctx.fillStyle='#8a9fab';ctx.fillRect(57,32,25,3);ctx.font='13px Arial';ctx.fillText(pg.title,90,39);
  for(const e of pg.elements){
    if(e.kind==='tablecell'){ctx.fillStyle='#f5f9fa';ctx.fillRect(e.x,e.y,e.w,e.h);ctx.strokeStyle='#b7cbd1';ctx.strokeRect(e.x,e.y,e.w,e.h);}
    ctx.fillStyle='#233d49';ctx.font='16px "Malgun Gothic",Arial';
    const chars=Array.from(String(e.text));let line='',yy=e.y+21;
    for(const c of chars){if(ctx.measureText(line+c).width>e.w-20){ctx.fillText(line,e.x+10,yy);line=c;yy+=22;if(yy>e.y+e.h-4)break;}else line+=c;}
    if(line&&yy<=e.y+e.h+10)ctx.fillText(line,e.x+10,yy);
  }
}

export function demoDocuments(){
  const make=(name,data)=>{const d={name,type:'demo',pages:[page('예제 문서')],records:[],warnings:[]};let y=100;
    d.pages[0].elements.push({kind:'title',text:'장비 점검 보고서',x:65,y:40,w:650,h:40});
    data.forEach(([label,text,style])=>{const r={id:`demo-${d.records.length}`,role:'paragraph',text,label,page:0,rect:{x:70,y,w:660,h:35},style:style||{font:'맑은 고딕',size:12}};d.records.push(r);d.pages[0].elements.push({kind:'paragraph',text,x:70,y,w:660,h:35});y+=58;});return d;};
  return [make('점검표_원본.xlsx',[['제목','장비 점검 보고서'],['A2','광스위치 수량 3대'],['A3','광모듈 수량 10개'],['A4','점검 결과 정상'],['A5','비고 이상 없음']]),make('점검표_수정.hwpx',[['제목','장비 점검 보고서'],['문단 2','광스위치 수량 4대'],['문단 3','광모듈 수량 10개'],['문단 4','점검 결과 정상'],['문단 5','추가 확인 완료']])];
}
