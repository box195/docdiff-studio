import test from 'node:test';
import assert from 'node:assert/strict';
import {changedSpans,makeTextRun,textRectangles,paddedContext,changeOverlays} from '../dist/text-locations.js';
import {pdfCellLocator,pdfBlocks} from '../dist/pdf-cells.js';
import {contentDifferences} from '../dist/diff.js';
import {changePresentation} from '../dist/change-presentation.js';

test('긴 동일 문장 뒤 날짜는 변경된 숫자만 강조',()=>{
  const a='접수자 담당자 수리완료일시 2026-09-08 10:30',b=a.replace('09-08','09-07'),spans=changedSpans(a,b);
  assert.deepEqual(spans.left.map(s=>a.slice(s.start,s.end)),['8']);assert.deepEqual(spans.right.map(s=>b.slice(s.start,s.end)),['7']);
});
test('한 셀의 여러 글자 변경은 하나의 비교 항목 안에 여러 강조 구간',()=>{
  const a='가나다 ABC 2026-09-08',b='가X다 AYC 2026-09-07',spans=changedSpans(a,b);
  assert.deepEqual(spans.left.map(s=>a.slice(s.start,s.end)),['나','B','8']);assert.equal(spans.right.length,3);
  const record={text:a,rect:{x:10,y:10,w:200,h:20},textRuns:[makeTextRun(a,{x:15,y:13,w:180,h:15})]};
  const overlays=changeOverlays({type:'changed',category:'content',oldText:a,newText:b,left:record},'left');
  assert.equal(overlays.length,1);assert.equal(overlays[0].highlights.length,3);
});
test('문자 삽입·삭제, 공백 무시 및 유니코드 인덱스 보존',()=>{
  assert.deepEqual(changedSpans('AB','AXB'),{left:[],right:[{start:1,end:2}]});
  assert.deepEqual(changedSpans('AXB','AB'),{left:[{start:1,end:2}],right:[]});
  assert.deepEqual(changedSpans('가 나','가나',true),{left:[],right:[]});
  assert.deepEqual(changedSpans('😀A','😀B'),{left:[{start:2,end:3}],right:[{start:2,end:3}]});
});
test('위치 정보가 없는 문자는 임의로 좌표를 만들지 않음',()=>{
  assert.deepEqual(textRectangles({text:'AB',rect:{x:0,y:0,w:100,h:30}},[{start:1,end:2}]),[]);
});
test('주변 여백은 페이지 경계를 넘지 않으며 실제 강조는 별도',()=>{
  assert.deepEqual(paddedContext({x:2,y:3,w:95,h:96},{width:100,height:100}),{x:0,y:0,w:100,h:100});
});
test('연속 묶음을 사용해도 정상 셀을 가로지르는 큰 강조 상자 없음',()=>{
  const member=x=>({type:'changed',category:'format',left:{page:0,rect:{x,y:10,w:20,h:20}}});
  const boxes=changeOverlays({members:[member(10),member(100)]},'left');
  assert.equal(boxes.length,2);assert.deepEqual(boxes.map(b=>b.record.rect.x),[10,100]);
});
const grid=()=>{
  const width=320,height=180,data=new Uint8ClampedArray(width*height*4).fill(255);
  const ink=(x,y)=>{const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;};
  for(const y of [10,45,80,115,150])for(let x=10;x<=300;x++)ink(x,y);
  for(const x of [10,180,300])for(let y=10;y<=150;y++)ink(x,y);
  return {width,height,data};
};
test('PDF 표 선으로 네 줄 날짜를 각각 별도 셀로 분리',()=>{
  const locate=pdfCellLocator(grid()),lines=[0,1,2,3].map(i=>({tokens:[{str:'동일 제목',x:20,y:20+i*35,w:80,h:12},{str:'2026-09-08',x:195,y:20+i*35,w:90,h:12}]}));
  const blocks=pdfBlocks(lines,locate);assert.equal(blocks.length,8);assert(blocks.every(b=>b.cell));
  assert.equal(blocks.filter(b=>b.tokens[0].str.startsWith('2026')).length,4);
  assert(blocks.every(b=>b.tokens.length===1));
});
test('PDF 반복 날짜 네 개 모두 안정적으로 대응하고 네 항목으로 검출',()=>{
  const locate=pdfCellLocator(grid()),blocks=pdfBlocks([0,1,2,3].map(i=>({tokens:[{str:'2026-09-08',x:195,y:20+i*35,w:90,h:12}]})),locate);
  const doc=day=>({type:'pdf',pages:[{}],records:blocks.map(b=>({text:`2026-09-${day}`,role:'cell',page:0,rect:b.cell,meta:{sourceCellKey:'pdf:'+JSON.stringify(b.cell),tableShape:'same-grid'}}))});
  const changes=contentDifferences(doc('08'),doc('07'),{mode:'precision'});assert.equal(changes.length,4);assert(changes.every(d=>d.type==='changed'&&d.confidence==='certain'));
});
test('선이 없거나 사각형이 닫히지 않으면 PDF 셀로 단정하지 않음',()=>{
  const image=grid();for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if([10,180,300].includes(x)){const k=(y*image.width+x)*4;image.data[k]=image.data[k+1]=image.data[k+2]=255;}
  assert.equal(pdfCellLocator(image)({x:195,y:20,w:90,h:12}),null);
  const out=pdfBlocks([{tokens:[{str:'이름',x:10,y:10,w:30,h:12},{str:'날짜',x:100,y:10,w:40,h:12}]}],()=>null);assert.equal(out.length,2);assert(out.every(b=>!b.cell));
});
test('화면 차이는 내용 수정으로 표시하지 않고 원인 미확정 안내',()=>{
  const p=changePresentation({type:'changed',category:'visual'});assert.equal(p.kind,'review');assert.match(p.label,/화면 차이/);assert.match(p.explanation,/확정|직접 확인/);assert(!p.left.label.includes('내용'));
});
