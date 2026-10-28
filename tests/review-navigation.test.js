import test from 'node:test';
import assert from 'node:assert/strict';
import {groupChanges,navigationDirection,revealInList} from '../dist/review-navigation.js';

function diff(col,extra={}) {
  const record={role:'cell',page:0,rect:{x:col*30,y:40,w:30,h:20},text:`값${col}`,meta:{sheet:'Sheet1',row:5,col}};
  return {id:`cell-${col}`,type:'changed',category:'content',confidence:'certain',detail:'내용이 변경되었습니다.',left:record,right:{...record,text:`신규${col}`},oldText:record.text,newText:`신규${col}`,...extra};
}
test('같은 행 연속 셀은 한 묶음, 상세·원본 데이터 유지',()=>{
  const raw=[diff(1),diff(2),diff(3)],before=JSON.stringify(raw),out=groupChanges(raw);
  assert.equal(out.length,1);assert.equal(out[0].members.length,3);assert.deepEqual(out[0].left.rect,{x:30,y:40,w:90,h:20});
  assert.match(out[0].detail,/A5:C5/);assert.match(out[0].oldText,/C5: 값3/);assert.equal(JSON.stringify(raw),before);
});
test('정상 셀로 떨어진 변경과 서로 다른 이유는 분리',()=>{
  assert.equal(groupChanges([diff(1),diff(3)]).length,2);
  assert.equal(groupChanges([diff(1),diff(2,{category:'format',detail:'size 서식 변경'})]).length,2);
  assert.equal(groupChanges([diff(1,{category:'format',detail:'size 서식 변경'}),diff(2,{category:'format',detail:'fill 서식 변경'})]).length,2);
});
test('페이지·시트·행·대응 열이 다르거나 불확실하면 분리',()=>{
  for(const change of [r=>({...r,page:1}),r=>({...r,meta:{...r.meta,sheet:'다른시트'}}),r=>({...r,meta:{...r.meta,row:6}}),r=>({...r,meta:{...r.meta,col:4}})]){
    const second=diff(2);second.right=change(second.right);assert.equal(groupChanges([diff(1),second]).length,2);
  }
  assert.equal(groupChanges([diff(1,{confidence:'probable'}),diff(2,{confidence:'probable'})]).length,2);
  assert.equal(groupChanges([diff(1,{type:'review'}),diff(2,{type:'review'})]).length,2);
});
test('연속 추가 셀도 묶고, 행 삽입 결과는 그대로 유지',()=>{
  const out=groupChanges([diff(1,{type:'added',left:null}),diff(2,{type:'added',left:null}),diff(3,{category:'row'})]);
  assert.equal(out.length,2);assert.equal(out[0].members.length,2);assert.equal(out[0].left,null);assert.equal(out[1].category,'row');
});
test('서식과 내용 변경이 번갈아 나열돼도 연속 범위별 묶음 유지',()=>{
  const raw=[diff(1),diff(1,{id:'f1',category:'format'}),diff(2),diff(2,{id:'f2',category:'format'})];
  const out=groupChanges(raw);assert.equal(out.length,2);assert.equal(out[0].category,'content');assert.equal(out[1].category,'format');
});
test('방향키 4개 이전·다음, 입력/단축키/조합 중에는 가로채지 않음',()=>{
  const target={closest:()=>null};
  for(const [key,n] of [['ArrowLeft',-1],['ArrowUp',-1],['ArrowRight',1],['ArrowDown',1]])assert.equal(navigationDirection({key,target}),n);
  for(const extra of [{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},{isComposing:true},{defaultPrevented:true},{target:{isContentEditable:true}},{target:{closest:()=>({})}}])assert.equal(navigationDirection({key:'ArrowRight',target,...extra}),0);
});
test('변경내역 이동은 목록만 스크롤하고 외부 페이지 이동 없음',()=>{
  const list={clientTop:0,clientHeight:200,scrollTop:0,getBoundingClientRect:()=>({top:500})};
  revealInList(list,{getBoundingClientRect:()=>({top:730,bottom:770})});assert.equal(list.scrollTop,70);
  revealInList(list,{getBoundingClientRect:()=>({top:450,bottom:490})});assert.equal(list.scrollTop,20);
  revealInList(list,{getBoundingClientRect:()=>({top:550,bottom:590})});assert.equal(list.scrollTop,20);
  revealInList(list,{getBoundingClientRect:()=>({top:510,bottom:1000})});assert.equal(list.scrollTop,30);
});
