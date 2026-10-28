import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DOMParser as XMLParser} from '@xmldom/xmldom';
// Test-only DOM adapter; production uses the browser's native XML parser.
globalThis.DOMParser=class{parseFromString(source,mime){let doc=new XMLParser().parseFromString(source,mime);doc.querySelector=selector=>doc.getElementsByTagName(selector)[0]||null;let walk=node=>{Object.defineProperty(node,'children',{get:()=>Array.from(node.childNodes||[]).filter(n=>n.nodeType===1),configurable:true});for(let child of node.childNodes||[])walk(child)};walk(doc);return doc}};
if(!Uint8Array.prototype.toHex)Object.defineProperty(Uint8Array.prototype,'toHex',{value(){return Buffer.from(this).toString('hex')}});
globalThis.DOMMatrix=class{constructor(){this.a=this.d=1;this.b=this.c=this.e=this.f=0}};
await import('../dist/vendor/jszip.min.js');
const {readDocument}=await import('../dist/readers.js');
const {contentDifferences,visualDifferences}=await import('../dist/diff.js');
const xmlEscape=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function xlsx(rows){let zip=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" r:id="s1"/></sheets></workbook>`);zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>');zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetData>${rows.map((values,i)=>`<row r="${i+1}">${values.map((text,c)=>`<c r="${String.fromCharCode(65+c)}${i+1}" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`);return new File([await zip.generateAsync({type:'uint8array'})],'synthetic.xlsx')}
test('실제 XLSX ZIP/XML: 중간 행 삽입 1건, 아래 행 변경 없음',async()=>{let rows=Array.from({length:100},(_,i)=>['반복 분류',`항목${i}`,i]),before=await readDocument(await xlsx(rows)),after=await readDocument(await xlsx([...rows.slice(0,49),['신규','항목','0'],...rows.slice(49)])),diffs=contentDifferences(before,after,{mode:'precision'});assert.equal(diffs.length,1);assert.equal(diffs[0].type,'added');assert.equal(diffs[0].right.meta.row,50)});
test('실제 XLSX ZIP/XML: 빈 행을 보존하고 삽입 1건 검출',async()=>{let rows=[['반복','가'],['반복','나'],['반복','다']],a=await readDocument(await xlsx(rows)),b=await readDocument(await xlsx([rows[0],[],...rows.slice(1)])),diffs=contentDifferences(a,b,{mode:'precision'});assert(b.records.some(r=>r.meta.emptyRow));assert.equal(diffs.length,1);assert.equal(diffs[0].newText,'(빈 행)')});
test('실제 HWPX: 문단 안에 포함된 표 추출',async()=>{let zip=new JSZip();zip.file('Contents/section0.xml','<sec xmlns="http://www.hancom.co.kr/hwpml/2011/paragraph"><p><run><t>제목</t><tbl><tr><tc><p><run><t>장비</t></run></p></tc><tc><p><run><t>수량</t></run></p></tc></tr><tr><tc><p><run><t>광모듈</t></run></p></tc><tc><p><run><t>10</t></run></p></tc></tr></tbl></run></p></sec>');let doc=await readDocument(new File([await zip.generateAsync({type:'uint8array'})],'synthetic.hwpx'));assert.equal(doc.records.filter(r=>r.role==='cell').length,4);assert.equal(doc.records.filter(r=>r.role==='paragraph')[0].text,'제목')});
test('실제 PDF 파일 텍스트 파싱',async()=>{let bytes=await fs.readFile(new URL('../dist/fixtures/test.pdf',import.meta.url)),doc=await readDocument(new File([bytes],'sample.pdf'));assert.equal(doc.pages.length,1);assert(doc.records.some(r=>r.text.includes('Sample PDF')))});
test('실제 파일 파싱 후 XLSX↔PDF↔HWPX 교차 형식 내용 비교',async()=>{let bytes=await fs.readFile(new URL('../dist/fixtures/test.pdf',import.meta.url)),pdf=await readDocument(new File([bytes],'sample.pdf')),lines=pdf.records.map(r=>r.text),excel=await readDocument(await xlsx(lines.map(s=>[s]))),zip=new JSZip();zip.file('Contents/section0.xml',`<sec>${lines.map(s=>`<p><run><t>${xmlEscape(s)}</t></run></p>`).join('')}</sec>`);let hwp=await readDocument(new File([await zip.generateAsync({type:'uint8array'})],'sample.hwpx'));for(let [a,b] of [[excel,pdf],[hwp,pdf],[excel,hwp]])assert.deepEqual(contentDifferences(a,b,{mode:'precision'}),[])});
test('구형 HWP와 미지원 형식 안내',async()=>{await assert.rejects(()=>readDocument(new File(['x'],'old.hwp')),/HWPX 또는 PDF/);await assert.rejects(()=>readDocument(new File(['x'],'old.xls')),/PDF, XLSX, HWPX/)});

async function hwpxBody(source){const zip=new JSZip();zip.file('Contents/section0.xml',source);return readDocument(new File([await zip.generateAsync({type:'uint8array'})],'synthetic.hwpx'));}
function formXml(signature='미지정 (서명)',name='',comment='댓글 기존 내용'){
  const text=s=>`<p><run><t>${xmlEscape(s)}</t></run></p>`;
  const cell=(col,row,body,span=1)=>`<tc><cellAddr colAddr="${col}" rowAddr="${row}"/><cellSpan colSpan="${span}" rowSpan="1"/><subList>${body}</subList></tc>`;
  return `<sec><p><run><tbl id="form-table" rowCnt="2" colCnt="4"><tr>${cell(0,0,text('담당 구분'))}${cell(1,0,text('고정 병합 칸'),2)}${cell(3,0,text(signature))}</tr><tr>${cell(0,1,text('업무 담당자'))}${cell(1,1,`<p><run><ctrl><fieldBegin id="memo-id" type="MEMO"><subList>${text(comment)}</subList></fieldBegin></ctrl><t>${xmlEscape(name)}</t></run></p>`,3)}</tr></tbl></run></p></sec>`;
}
test('HWPX 댓글만 바뀌면 본문 차이 없음, 댓글이 빈 셀로 섞이지 않음',async()=>{
  const a=await hwpxBody(formXml()),b=await hwpxBody(formXml(undefined,'','댓글 수정 내용'));
  assert(!a.records.some(r=>r.text.includes('댓글 기존')));assert(!b.records.some(r=>r.text.includes('댓글 수정')));
  const blank=a.records.find(r=>r.meta.tableRow===2&&r.meta.col===2);assert.equal(blank.text,'');
  assert(a.warnings.some(w=>w.includes('댓글 1개')));assert.deepEqual(contentDifferences(a,b,{mode:'precision'}),[]);
});
test('HWPX 서명 변경과 빈 담당자 칸 입력은 본문 수정 두 건',async()=>{
  const a=await hwpxBody(formXml()),b=await hwpxBody(formXml('가 나 다 (서명)','라 마 바'));
  const diffs=contentDifferences(a,b,{mode:'precision'});assert.equal(diffs.length,2);assert(diffs.every(d=>d.type==='changed'));
  assert(diffs.some(d=>d.oldText===''&&d.newText==='라 마 바'));
  const signature=diffs.find(d=>d.newText==='가 나 다 (서명)');assert.equal(signature.left.meta.col,4);assert.match(signature.left.label,/1행 4열/);
  assert.equal(a.records.find(r=>r.meta.col===2&&r.meta.tableRow===1).rect.w,340);
});
test('HWPX 중첩 표와 댓글 속 표는 본문에 중복되지 않음',async()=>{
  const source='<sec><p><run><tbl id="outer" rowCnt="1" colCnt="1"><tr><tc><subList><p><run><t>바깥</t><tbl id="inner" rowCnt="1" colCnt="1"><tr><tc><subList><p><run><t>안쪽</t></run></p></subList></tc></tr></tbl><ctrl><fieldBegin type="MEMO"><subList><p><run><t>댓글내용</t><tbl><tr><tc><p><run><t>댓글표</t></run></p></tc></tr></tbl></run></p></subList></fieldBegin></ctrl></run></p></subList></tc></tr></tbl></run></p></sec>';
  const doc=await hwpxBody(source);assert.deepEqual(doc.records.map(r=>r.text),['바깥','안쪽']);assert.notEqual(doc.records[0].meta.tableId,doc.records[1].meta.tableId);
});
test('HWPX 화면 모드는 재구성 화면 픽셀 비교 대신 본문 비교',async()=>{
  const a=await hwpxBody(formXml()),b=await hwpxBody(formXml(undefined,'신규 담당자'));
  const diffs=await visualDifferences(a,b,{mode:'visual'});assert.equal(diffs.length,1);assert.match(diffs[0].detail,/원본 배치·픽셀 검사 제외/);
});
