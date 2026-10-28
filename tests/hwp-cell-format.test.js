import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import init,{HwpDocument} from '../dist/vendor/rhwp/rhwp.js';
globalThis.DOMMatrix=class{constructor(){this.a=this.d=1;this.b=this.c=this.e=this.f=0}};
await init({module_or_path:await fs.readFile(new URL('../dist/vendor/rhwp/rhwp_bg.wasm',import.meta.url))});
const {readDocument}=await import('../dist/readers.js');
const {contentDifferences,tileRegions,unexplainedVisualDifferences,maskKnownPixels}=await import('../dist/diff.js');
const {groupChanges}=await import('../dist/review-navigation.js');

export function tableFixture(){const n=HwpDocument.createEmpty();n.createTable(0,0,0,3,7);n.insertTextInCell(0,0,0,0,0,0,'가상 일정');n.applyCharFormatInCell(0,0,0,0,0,0,5,JSON.stringify({fontId:n.findOrCreateFontId('맑은 고딕'),fontSize:1000}));n.applyParaFormatInCell(0,0,0,0,0,JSON.stringify({alignment:'center'}));return n;}
const file=(n,ext)=>new File([ext==='hwpx'?n.exportHwpx():n.exportHwp()],`synthetic.${ext}`);
const props=(n,index,patch)=>n.setCellProperties(0,0,0,index,JSON.stringify({...JSON.parse(n.getCellProperties(0,0,0,index)),...patch}));
const has=(diffs,property)=>diffs.some(d=>d.formatChanges?.some(c=>c.property===property));
async function compareMutation(mutate,ext='hwp'){
  const native=tableFixture(),before=file(native,ext);mutate(native);const after=file(native,ext);native.free();const a=await readDocument(before),b=await readDocument(after);const changes=contentDifferences(a,b,{mode:'precision'});return {a,b,changes,dispose(){a.dispose();b.dispose();}};
}

for(const ext of ['hwp','hwpx']){
  test(`${ext}: 글자가 없는 셀의 회색 음영 직접 검출`,async()=>{const result=await compareMutation(n=>props(n,5,{fillType:'solid',fillColor:'#eeeeee'}),ext);assert(has(result.changes,'cellFill'));assert(result.changes.some(d=>d.oldText===''&&d.newText===''&&d.detail.includes('셀 배경색')));assert.deepEqual(contentDifferences(result.a,result.a,{mode:'precision'}),[]);result.dispose();});
  test(`${ext}: 주말 범위 음영은 유효 셀 속성으로 6셀 모두 검출·직사각형 묶기`,async()=>{
    const result=await compareMutation(n=>{const p=JSON.parse(n.getCellProperties(0,0,0,5));n.setCellZoneProperties(0,0,0,0,5,2,6,JSON.stringify({...p,fillType:'solid',fillColor:'#a6a6a6'}));},ext);
    const shaded=result.changes.filter(d=>d.formatChanges?.some(c=>c.property==='cellFill'));assert.equal(shaded.length,6);const snapshot=JSON.stringify(shaded),grouped=groupChanges(shaded);assert.equal(grouped.length,1);assert.equal(grouped[0].members.length,6);assert.match(grouped[0].detail,/1행 6열 ~ 3행 7열/);assert.equal(JSON.stringify(shaded),snapshot);assert.deepEqual(contentDifferences(result.a,result.b,{mode:'fast'}),[]);result.dispose();
  });
}
for(const [name,patch,property] of [
  ['테두리 굵기·색상',{borderRight:{type:1,width:6,color:'#ff0000'}},'cellBorders'],
  ['안쪽 여백',{paddingLeft:900,applyInnerMargin:true},'cellMargins'],
  ['세로 정렬·글자 방향',{verticalAlign:0,textDirection:1},'cellAlignment'],
  ['행 높이',{height:2200},'cellSize'],
  ['열 너비',{width:9000},'cellSize']
])test(`한글 ${name} 변경`,async()=>{const r=await compareMutation(n=>props(n,5,patch));assert(has(r.changes,property));r.dispose();});
test('내용과 음영이 동시에 바뀌어도 두 변경 이유 보존',async()=>{const r=await compareMutation(n=>{props(n,5,{fillType:'solid',fillColor:'#f5f5f5'});n.insertTextInCell(0,0,0,5,0,0,'입력');});assert(r.changes.some(d=>d.category==='content'&&d.newText==='입력'&&d.formatChanges?.some(c=>c.property==='cellFill')));r.dispose();});
test('문단 정렬·줄간격·여백 변경',async()=>{const r=await compareMutation(n=>n.applyParaFormatInCell(0,0,0,0,0,JSON.stringify({alignment:'right',lineSpacing:220,marginLeft:500})));assert(has(r.changes,'paragraphFormat'));r.dispose();});
test('일부 글자 색·밑줄 변경',async()=>{const r=await compareMutation(n=>n.applyCharFormatInCell(0,0,0,0,0,2,4,JSON.stringify({textColor:'#ff0000',underline:true})));assert(has(r.changes,'textStyles')||r.changes.some(d=>d.detail.includes('글자색')));r.dispose();});
for(const [name,patch,key] of [['글꼴',{fontFamily:'바탕'},'font'],['글자 크기',{fontSize:1500},'size'],['굵게',{bold:true},'bold'],['기울임',{italic:true},'italic'],['취소선',{strikethrough:true},'strike']])test(`한글 ${name} 실제 속성 검출`,async()=>{const r=await compareMutation(n=>n.applyCharFormatInCell(0,0,0,0,0,0,5,JSON.stringify(patch.fontFamily?{fontId:n.findOrCreateFontId(patch.fontFamily)}:patch)));assert(has(r.changes,key)||has(r.changes,'textStyles'));r.dispose();});
test('페이지 여백 변경',async()=>{const r=await compareMutation(n=>n.setPageDef(0,JSON.stringify({...JSON.parse(n.getPageDef(0)),marginLeft:7000})));assert(has(r.changes,'pageFormat'));r.dispose();});
test('표 셀 병합·구조 변경',async()=>{const r=await compareMutation(n=>n.mergeTableCells(0,0,0,0,5,0,6));assert(has(r.changes,'tableFormat')||has(r.changes,'cellSpan'));r.dispose();});
test('서식 참조 ID만 바뀌고 보이는 속성이 같으면 0건',async()=>{const r=await compareMutation(n=>props(n,5,{}));assert.deepEqual(r.changes,[]);r.dispose();});

const image=()=>{const a=new Uint8ClampedArray(420*570*4);a.fill(255);return a;};
const paint=(a,x,y,w,h,value)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const k=(yy*420+xx)*4;for(let c=0;c<3;c++)a[k+c]=value;}};
test('픽셀 비교: 연한 회색 넓은 음영도 검출',()=>{const a=image(),b=image();paint(b,60,90,60,90,245);const regions=tileRegions(a,b);assert.equal(regions.length,1);assert.deepEqual(regions[0],{x:60,y:90,w:60,h:90,tiles:6});});
test('픽셀 비교: 동일·미세 잡음은 음영으로 오인하지 않음',()=>{const a=image(),b=image();paint(b,60,90,60,90,252);assert.deepEqual(tileRegions(a,a),[]);assert.deepEqual(tileRegions(a,b),[]);});
test('확정된 셀만 픽셀에서 제외하고 인접 미설명 음영은 보존',()=>{
  const a=image(),b=image();paint(b,60,90,60,90,245);const docs=[0,1].map(()=>({pages:[{width:420,height:570}]})),frames=[0,1].map(()=>({x:0,y:0,w:420,h:570}));const change={confidence:'certain',left:{role:'cell',page:0,rect:{x:60,y:90,w:30,h:90}}};
  const partial=maskKnownPixels(a,b,[change],0,docs,frames);assert.equal(tileRegions(a,partial).length,1);assert.equal(tileRegions(a,partial)[0].x,90);
  change.left.rect.w=60;assert.deepEqual(tileRegions(a,maskKnownPixels(a,b,[change],0,docs,frames)),[]);
  change.left.role='table-format';assert.equal(tileRegions(a,maskKnownPixels(a,b,[change],0,docs,frames)).length,1);
});
test('내용 위치와 일부 겹쳐도 넓은 미설명 음영은 지우지 않음',()=>{
  const record=rect=>({page:0,rect}),visual=[{left:record({x:0,y:0,w:100,h:100})}],structure=[{left:record({x:0,y:0,w:20,h:20})}];assert.equal(unexplainedVisualDifferences(visual,structure).length,1);assert.equal(unexplainedVisualDifferences(visual,[{left:record({x:0,y:0,w:100,h:100})}]).length,0);
});
test('한글 묶음은 정상 셀 구멍이나 페이지 경계를 가로지르지 않음',()=>{
  const change=(row,col,page=0)=>{const r={role:'cell',page,text:'',rect:{x:col*20,y:row*20,w:20,h:20},meta:{sourceTableKey:'t',tableRow:row,col,rowSpan:1,colSpan:1}};return {id:`${row}:${col}:${page}`,type:'changed',category:'format',confidence:'certain',detail:'셀 배경색 변경',oldText:'',newText:'',left:r,right:r,formatChanges:[{property:'cellFill',before:{type:'none'},after:{fillColor:'#a6a6a6'}}]};};
  const raw=[change(1,1),change(1,2),change(2,1),change(3,1,1)],grouped=groupChanges(raw);assert.equal(grouped.length,3);assert.equal(grouped.reduce((sum,d)=>sum+(d.members?.length||1),0),4);
});
