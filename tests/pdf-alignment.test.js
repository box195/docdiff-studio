import test from 'node:test';
import assert from 'node:assert/strict';
import {contentDifferences} from '../dist/diff.js';
import {pdfCellLocator,pdfBlocks,pdfTableMetadata} from '../dist/pdf-cells.js';
const options={mode:'precision'};
function table(rows,{x=20,y=20,page=0,prefix='T',shift=0}={}){
  const h=24,w=120,cells=rows.flatMap((row,r)=>row.map((_,c)=>({x:x+c*w,y:y+r*h+shift,w,h}))),metadata=pdfTableMetadata(cells,page);
  return cells.map((rect,i)=>({id:prefix+i,role:'cell',page,rect,style:null,source:'pdf',text:rows[Math.floor(i/rows[0].length)][i%rows[0].length],meta:{...metadata.get(JSON.stringify(rect)),pdfTableKey:prefix+':'+page}}));
}
const document=records=>({type:'pdf',pages:[{width:800,height:1120}],records,warnings:[]});
const compare=(a,b)=>contentDifferences(document(a),document(b),options);

test('PDF 다른 표의 빈칸/내용 삭제가 같은 위치의 완전 변경을 무효화하지 않음',()=>{
  const a=[...table([['설치장소','청계'],['기기명','기타설비'],['일시','2026-09-07']]),...table([['부품','금액'],['그래픽카드','150000']],{y:200,prefix:'parts'})];
  const b=[...table([['설치장소','성남'],['기기명','미디어게이트'],['일시','2026-09-09']]),...table([['부품','금액'],['','']],{y:200,prefix:'parts'})];
  const diffs=compare(a,b);assert.equal(diffs.filter(d=>d.type==='changed').length,3);assert.equal(diffs.filter(d=>d.type==='removed').length,2);assert(!diffs.some(d=>d.type==='added'||d.type==='review'));
  assert(diffs.some(d=>d.oldText==='기타설비'&&d.newText==='미디어게이트'&&d.type==='changed'));
});
test('PDF 반복 날짜 4개 모두 같은 행으로 대응, 중복 후보 검토/추가 없음',()=>{
  const rows=day=>['고장일시','접수일시','시작일시','완료일시'].map(s=>[s,`2026-09-${day} 09:30`]);
  const diffs=compare(table(rows('07')),table(rows('09')));assert.equal(diffs.length,4);assert(diffs.every(d=>d.type==='changed'&&d.left.rect.y===d.right.rect.y));
});
test('PDF 기존 셀 내용 비우기와 빈 셀 입력은 좌우 위치를 보존한 삭제/추가',()=>{
  const diffs=compare(table([['항목','값'],['담당','가나다'],['확인','']]),table([['항목','값'],['담당',''],['확인','마바사']]));
  assert.equal(diffs.length,2);assert.deepEqual(diffs.map(d=>d.type),['removed','added']);assert(diffs.every(d=>d.left&&d.right&&d.left.rect.x===d.right.rect.x));
});
test('PDF 같은 표의 중간 행 삽입: 아래 행의 다른 값을 수정으로 오인하지 않음',()=>{
  const a=table([['ID','수량'],['A','10'],['B','20'],['C','30']]),b=table([['ID','수량'],['A','10'],['신규','99'],['B','20'],['C','30']]);
  const diffs=compare(a,b);assert.equal(diffs.length,2);assert(diffs.every(d=>d.type==='added'));assert.deepEqual(diffs.map(d=>d.newText),['신규','99']);
});
test('PDF 중간 행 삭제 및 삭제 후 다른 행 수정 동시 처리',()=>{
  const a=table([['ID','수량'],['A','10'],['B','20'],['C','30']]),b=table([['ID','수량'],['A','10'],['C','35']]);
  const diffs=compare(a,b);assert.equal(diffs.filter(d=>d.type==='removed').length,2);assert.equal(diffs.filter(d=>d.type==='changed').length,1);assert(diffs.some(d=>d.oldText==='30'&&d.newText==='35'));
});
test('PDF 표 전체가 조금 움직여도 상대 셀 위치로 대응',()=>{
  const a=table([['항목','값'],['장비','기타']]),b=table([['항목','값'],['장비','전화기']],{shift:4});
  const diffs=compare(a,b);assert.equal(diffs.length,1);assert.equal(diffs[0].type,'changed');assert.equal(diffs[0].newText,'전화기');
});
test('PDF 행 순서가 바뀌면 같은 좌표를 강제로 수정으로 연결하지 않음',()=>{
  const diffs=compare(table([['ID','값'],['A','10'],['B','20']]),table([['ID','값'],['B','20'],['A','10']]));
  assert.equal(diffs.length,1);assert.equal(diffs[0].type,'review');assert.match(diffs[0].detail,/순서/);
});
test('PDF 중복 항목명과 불균등 행 구조는 미확정, 삭제/추가를 단정하지 않음',()=>{
  const diffs=compare(table([['반복','가'],['반복','나']]),table([['반복','다'],['반복','라'],['반복','마']]));
  assert.equal(diffs.length,1);assert.equal(diffs[0].type,'review');
});
test('PDF 표의 셀 병합/열 구조 변경을 무관한 셀 수정으로 연결하지 않음',()=>{
  const diffs=compare(table([['항목','값'],['장비','기타']]),table([['항목','값','비고'],['장비','전화기','변경']]));
  assert(diffs.every(d=>d.type==='review'));assert(diffs.length>0);
});
test('PDF 중복 항목명이라도 고유한 행 내용의 순서 역전은 강제 수정 금지',()=>{
  const diffs=compare(table([['항목','값'],['반복','10'],['반복','20']]),table([['항목','값'],['반복','20'],['반복','10']]));
  assert.equal(diffs.length,1);assert.equal(diffs[0].type,'review');
});
test('PDF 행 이동 때문에 위치가 같은 날짜를 무관한 행과 연결하지 않음',()=>{
  const diffs=compare(table([['항목','일시'],['A','09:30'],['B','09:30'],['C','10:30']]),table([['항목','일시'],['A','09:30'],['신규','08:00'],['B','09:30'],['C','10:30']]));
  assert.equal(diffs.length,2);assert(diffs.every(d=>d.type==='added'));
});
test('PDF 동일 문서의 글자 없는 셀까지 포함해 결과 0건',()=>{
  const a=table([['항목','값'],['A',''],['B','']]);assert.deepEqual(compare(a,structuredClone(a)),[]);
});
test('PDF 닫힌 표의 빈 셀은 글자가 없어도 보존하며 겹친 큰 셀을 만들지 않음',()=>{
  const width=280,height=120,data=new Uint8ClampedArray(width*height*4).fill(255),ink=(x,y)=>{const k=(y*width+x)*4;data[k]=data[k+1]=data[k+2]=0;};
  for(const y of [10,40,70,100])for(let x=10;x<=250;x++)ink(x,y);
  for(const x of [10,130,250])for(let y=10;y<=100;y++)ink(x,y);
  const locate=pdfCellLocator({width,height,data}),blocks=pdfBlocks([{tokens:[{str:'항목',x:20,y:20,w:40,h:12}]}],locate,true);
  assert.equal(blocks.length,6);assert.equal(blocks.filter(b=>!b.tokens.length).length,5);assert(blocks.every(b=>b.cell.h===30));
  assert.equal(new Set([...pdfTableMetadata(blocks.map(b=>b.cell),0).values()].map(m=>m.pdfTableKey)).size,1);
});
test('PDF 빈 셀 보존은 교차 형식에서 가짜 삭제 결과를 만들지 않음',()=>{
  const pdf=document(table([['본문'],['']])),other={type:'hwpx',pages:pdf.pages,records:[{role:'paragraph',page:0,text:'본문',rect:{x:20,y:20,w:120,h:24}}]};
  assert.deepEqual(contentDifferences(pdf,other,options),[]);
});
