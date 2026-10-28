import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import init,{HwpDocument} from '../dist/vendor/rhwp/rhwp.js';
globalThis.DOMMatrix=class{constructor(){this.a=this.d=1;this.b=this.c=this.e=this.f=0}};
// The same pinned WASM used by the browser, initialized from bytes in Node.
await init({module_or_path:await fs.readFile(new URL('../dist/vendor/rhwp/rhwp_bg.wasm',import.meta.url))});
const {readDocument}=await import('../dist/readers.js');
const {contentDifferences}=await import('../dist/diff.js');
const {layoutRecords}=await import('../dist/hwp-renderer.js');
function sample(text,ext){const native=HwpDocument.createEmpty();native.insertText(0,0,0,text);const bytes=ext==='hwp'?native.exportHwp():native.exportHwpx();native.free();return new File([bytes],`synthetic.${ext}`);}

test('실제 HWP 바이너리 및 HWPX: 페이지 엔진으로 본문/쪽수/좌표 읽기',async()=>{
  for(const ext of ['hwp','hwpx']){const d=await readDocument(sample('가상 문서의 본문입니다',ext));assert.equal(d.type,ext);assert.equal(d.preview,'hwp-layout');assert.equal(d.pages.length,1);assert(d.records.some(r=>r.text==='가상 문서의 본문입니다'));assert(d.records.every(r=>Number.isFinite(r.rect.x)&&r.rect.w>0));assert.match(d.hwp.renderPageSvg(0),/<svg/);d.dispose();assert.equal(d.hwp,null);}
});
test('HWP 동일 파일 0건, 문장 변경 1건',async()=>{
  const a=await readDocument(sample('가상 양식의 본문 항목 100', 'hwp')),b=await readDocument(sample('가상 양식의 본문 항목 200','hwp'));
  assert.deepEqual(contentDifferences(a,a,{mode:'precision'}),[]);const changes=contentDifferences(a,b,{mode:'precision'});assert.equal(changes.length,1);assert.equal(changes[0].type,'changed');a.dispose();b.dispose();
});
test('HWP와 HWPX 같은 본문은 교차 형식 내용 차이 없음',async()=>{
  const a=await readDocument(sample('동일한 가상 서식의 내용','hwp')),b=await readDocument(sample('동일한 가상 서식의 내용','hwpx'));assert.deepEqual(contentDifferences(a,b,{mode:'precision'}),[]);a.dispose();b.dispose();
});
test('손상 HWP는 허위 페이지 대신 오류 표시',async()=>{await assert.rejects(()=>readDocument(new File(['not a document'],'broken.hwp')),/한글 페이지를 열지 못했습니다/);});
test('페이지 레이아웃의 빈 셀도 실제 좌표로 보존, 글자 조각을 같은 셀로 결합',()=>{
  const native={getTableCellBboxes:()=>JSON.stringify([{cellIdx:0,row:0,col:0,pageIndex:0,x:10,y:20,w:80,h:30},{cellIdx:1,row:0,col:1,pageIndex:0,x:90,y:20,w:100,h:30}]),getTableDimensions:()=>'{"rowCount":1,"colCount":2,"cellCount":2}'};
  const base={secIdx:0,parentParaIdx:1,controlIdx:0,cellIdx:0,cellParaIdx:0,paraIdx:0,cellPath:[{controlIndex:0,cellIndex:0,cellParaIndex:0}],x:15,y:25,w:20,h:10,fontFamily:'맑은 고딕',fontSize:12,textColor:'#000000'};
  const records=layoutRecords(native,0,{width:800},{runs:[{...base,charStart:0,text:'서명 '},{...base,charStart:3,text:'가나다'}]});
  assert.equal(records.length,2);assert.equal(records[0].text,'서명 가나다');assert.equal(records[1].text,'');assert.deepEqual(records[1].rect,{x:90,y:20,w:100,h:30});assert.equal(records[1].meta.col,2);
});
