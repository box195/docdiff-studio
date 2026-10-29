import test from 'node:test';
import assert from 'node:assert/strict';
import {changePresentation,isFormatChange} from '../dist/change-presentation.js';
test('추가는 오른쪽 초록, 삭제는 왼쪽 빨강 및 없는 쪽 설명',()=>{
  const added=changePresentation({type:'added',newText:'추가 항목'}),removed=changePresentation({type:'removed',oldText:'삭제 항목'});
  assert.equal(added.right.tone,'added');assert.match(added.before,/없음/);assert.equal(added.after,'추가 항목');
  assert.equal(removed.left.tone,'removed');assert.match(removed.after,/삭제/);assert.equal(removed.before,'삭제 항목');
});
test('내용 수정은 파란 변경 전과 주황 변경 후로 구분',()=>{const p=changePresentation({type:'changed',category:'content',oldText:'전',newText:'후'});assert.equal(p.left.tone,'before');assert.equal(p.right.tone,'after');assert.equal(p.before,'전');assert.equal(p.after,'후');});
test('음영 추가·해제는 본문 추가·삭제와 별도로 설명',()=>{
  const base={type:'changed',category:'format'},clear={fillType:'solid',fillColor:'#ffffff'},gray={fillType:'solid',fillColor:'#a6a6a6'};
  for(const [before,after,label] of [[clear,gray,'음영 추가'],[gray,clear,'음영 해제']]){const p=changePresentation({...base,formatChanges:[{property:'cellFill',before,after}]});assert.equal(p.kind,'format');assert.equal(p.label,label);assert.equal(p.right.tone,'format');assert.match(p.explanation,/내용은 같고/);}
});
test('음영 묶음은 수십 개 빈 셀 대신 전후 색상과 개수 표시',()=>{const d={type:'changed',category:'format',members:[0,1,2].map(()=>({formatChanges:[{property:'cellFill',before:{type:'none'},after:{fillColor:'#a6a6a6'}}]}))};const p=changePresentation(d);assert.equal(p.before,'음영 없음');assert.equal(p.after,'회색 음영');assert.match(p.explanation,/3개 셀/);});
test('서식 필터에는 서식과 내용이 함께 바뀐 항목도 포함',()=>{assert(isFormatChange({category:'content',formatChanges:[{property:'cellFill'}]}));assert(!isFormatChange({category:'content'}));assert(isFormatChange({category:'page-format'}));});
test('확인 필요 항목은 확정된 추가·삭제로 표시하지 않음',()=>{const p=changePresentation({type:'review',category:'alignment'});assert.equal(p.left.tone,'review');assert.equal(p.right.tone,'review');assert.match(p.explanation,/확정하지 못한/);});
test('기존 셀에 내용 입력/비우기는 셀 자체 추가/삭제와 구별',()=>{
  const r={role:'cell'},a=changePresentation({type:'added',left:r,right:r,newText:'입력'}),b=changePresentation({type:'removed',left:r,right:r,oldText:'삭제'});
  assert.equal(a.label,'내용 추가');assert.equal(a.before,'빈 셀');assert.equal(b.label,'내용 삭제');assert.equal(b.after,'빈 셀');assert.match(b.explanation,/셀은 그대로/);
});
