import test from 'node:test';
import assert from 'node:assert/strict';
import {groupChanges} from '../dist/review-navigation.js';
import {changeOverlays,makeTextRun} from '../dist/text-locations.js';
import {summarize} from '../dist/diff.js';
const record=(r,c,text,extra={})=>({role:'cell',page:0,rect:{x:c*40,y:r*24,w:40,h:24},text,source:'pdf',meta:{pdfCell:true,pdfTableKey:'T',pdfRow:r,pdfCol:c},...extra});
function diff(r,c,type='changed',extra={}){const left=record(r,c,'2026-09-07'),right=record(r,c,type==='removed'?'':'2026-09-09');if(type==='added')left.text='';return {id:`${type}-${r}-${c}`,type,category:'content',confidence:'certain',left,right,oldText:left.text,newText:right.text,detail:'내용 변경',...extra};}
const flat=groups=>groups.flatMap(d=>d.members||[d]);

test('PDF 같은 행 연속 수정 셀과 다음 행의 완전한 변경을 한 이동으로 묶기',()=>{
  const raw=[1,2].flatMap(r=>[1,2,3].map(c=>diff(r,c))),before=JSON.stringify(raw),groups=groupChanges(raw);
  assert.equal(groups.length,1);assert.equal(groups[0].members.length,6);assert.equal(JSON.stringify(raw),before);
  assert.deepEqual(flat(groups).map(d=>d.id).sort(),raw.map(d=>d.id).sort());assert(flat(groups).every(d=>raw.includes(d)));
});
test('PDF 연속 날짜 수정 네 셀은 한 번에 넘김',()=>{
  const raw=[1,2,3,4].map(r=>diff(r,6)),groups=groupChanges(raw);assert.equal(groups.length,1);assert.equal(groups[0].members.length,4);
});
test('PDF 내용 삭제와 내용 추가도 동일한 연속 셀 규칙 적용',()=>{
  for(const type of ['removed','added']){const raw=[1,2,3,4,5].map(c=>diff(1,c,type)),groups=groupChanges(raw);assert.equal(groups.length,1);assert.equal(groups[0].members.length,5);assert(flat(groups).every(d=>d.type===type));}
});
test('새 셀/행 추가와 삭제처럼 한쪽 좌표만 있어도 그쪽에서 연속이면 묶기',()=>{
  for(const type of ['added','removed']){const raw=[1,2,3].map(c=>diff(1,c,type,{[type==='added'?'left':'right']:null})),groups=groupChanges(raw);assert.equal(groups.length,1);assert.equal(groups[0].members.length,3);}
});
test('정상 셀이나 정상 행을 가로질러 묶지 않음',()=>{
  assert.equal(groupChanges([diff(1,1),diff(1,3)]).length,2);
  assert.equal(groupChanges([diff(1,1),diff(3,1)]).length,2);
  const raw=[1,2,3].flatMap(r=>[1,2,3].filter(c=>r!==2||c!==2).map(c=>diff(r,c))),groups=groupChanges(raw);
  assert.equal(flat(groups).length,8);assert(groups.length>1);assert(!flat(groups).some(d=>d.left.meta.pdfRow===2&&d.left.meta.pdfCol===2));
});
test('L 모양 변경은 정상 영역을 포함하는 사각형으로 합치지 않음',()=>{
  const groups=groupChanges([diff(1,1),diff(1,2),diff(2,1)]);assert.equal(groups.length,2);assert.equal(flat(groups).length,3);
});
test('수정/삭제/추가, 내용/서식 및 셀 자체 추가/빈칸 입력은 분리',()=>{
  for(const second of [diff(1,2,'removed'),diff(1,2,'added'),diff(1,2,'changed',{category:'format',detail:'서식'})])assert.equal(groupChanges([diff(1,1),second]).length,2);
  assert.equal(groupChanges([diff(1,1,'added'),diff(1,2,'added',{left:null})]).length,2);
});
test('다른 표·다른 페이지·불확실한 결과는 합치지 않음',()=>{
  for(const edit of [r=>({...r,page:1}),r=>({...r,meta:{...r.meta,pdfTableKey:'다른표'}})]){const a=diff(1,1),b=diff(1,2);b.right=edit(b.right);assert.equal(groupChanges([a,b]).length,2);}
  for(const extra of [{confidence:'probable'},{type:'review',confidence:'uncertain'}])assert.equal(groupChanges([diff(1,1,'changed',extra),diff(1,2,'changed',extra)]).length,2);
});
test('한쪽에서는 인접하지만 반대쪽에 간격/정상 셀이 있으면 분리',()=>{
  const a=diff(1,1),b=diff(1,2);b.right={...b.right,rect:{...b.right.rect,x:b.right.rect.x+40}};assert.equal(groupChanges([a,b]).length,2);
});
test('묶음의 강조는 각 셀/변경 글자에 유지, 큰 합성 강조를 만들지 않음',()=>{
  const raw=[1,2,3,4].map(r=>diff(r,1));for(const d of raw)for(const side of ['left','right'])d[side].textRuns=[makeTextRun(d[side].text,{...d[side].rect,x:d[side].rect.x+2,w:35,h:12})];
  const grouped=groupChanges(raw),boxes=changeOverlays(grouped[0],'left');assert.equal(boxes.length,4);assert(boxes.every(b=>b.highlights.length===1));
  assert.deepEqual(boxes.map(b=>b.record),raw.map(d=>d.left));assert.deepEqual(summarize(flat(grouped)),summarize(raw));
});
test('XLSX 연속 두 행도 묶고 기존 셀별 상세는 평탄하게 보존',()=>{
  const raw=[1,2].flatMap(r=>[1,2].map(c=>{const d=diff(r,c);for(const s of ['left','right'])d[s].meta={sheet:'S',row:r,col:c};return d;}));
  const groups=groupChanges(raw);assert.equal(groups.length,1);assert.equal(groups[0].members.length,4);assert(groups[0].members.every(d=>!d.members));
});
test('HWP 내용 수정도 같은 표 안에서 행과 다음 행을 연속 묶기',()=>{
  const raw=[1,2].flatMap(r=>[1,2].map(c=>{const d=diff(r,c);for(const s of ['left','right'])d[s].meta={sourceTableKey:'H',tableRow:r,col:c};return d;}));
  assert.equal(groupChanges(raw).length,1);assert.equal(groupChanges(raw)[0].members.length,4);
});
