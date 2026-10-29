const fills=d=>(d.formatChanges||d.members?.[0]?.formatChanges||[]).find(f=>f.property==='cellFill');
const color=value=>value?.fillColor||value?.color||'#ffffff';
const blankFill=value=>!value||value.type==='none'||value.fillType==='none'||['#ffffff','#ffffffff','white'].includes(color(value).toLowerCase());
const colorName=value=>blankFill(value)?'음영 없음':/^#([0-9a-f]{2})\1\1$/i.test(color(value))?'회색 음영':`배경색 ${color(value)}`;
export function changePresentation(d){
  if(d.category==='visual')return {kind:'review',label:'화면 차이 · 확인 필요',symbol:'?',before:'기존 화면의 비교 구간',after:'달라 보이는 화면 구간',left:{label:'기존 화면 · 원인 미확정',tone:'review'},right:{label:'화면 차이 · 원인 미확정',tone:'review'},explanation:'그림·선·배치 등 화면 차이입니다 · 내용 수정 여부나 정확한 원인은 직접 확인하세요'};
  if(d.type==='added')return {kind:'added',label:'추가',symbol:'＋',before:'기존 파일에 없음',after:d.newText||'(빈 항목)',left:{label:'기존에 없음',tone:'before'},right:{label:'＋ 추가된 부분',tone:'added'},explanation:'오른쪽 초록색 부분이 새로 추가됐습니다'};
  if(d.type==='removed')return {kind:'removed',label:'삭제',symbol:'−',before:d.oldText||'(빈 항목)',after:'변경 파일에서 삭제됨',left:{label:'− 삭제된 부분',tone:'removed'},right:{label:'삭제 후 없음',tone:'after'},explanation:'왼쪽 빨간색 부분이 변경 파일에서 삭제됐습니다'};
  if(d.type==='review')return {kind:'review',label:'확인 필요',symbol:'?',before:d.oldText||'(내용 없음)',after:d.newText||'(내용 없음)',left:{label:'? 확인할 위치',tone:'review'},right:{label:'? 확인할 위치',tone:'review'},explanation:'대응 위치나 화면 차이를 확정하지 못한 항목입니다'};
  const fill=fills(d),format=d.category==='format'||d.category==='page-format';
  if(format&&fill){const beforeBlank=blankFill(fill.before),afterBlank=blankFill(fill.after),label=beforeBlank&&!afterBlank?'음영 추가':!beforeBlank&&afterBlank?'음영 해제':'음영 변경';return {kind:'format',label,symbol:'▧',before:colorName(fill.before),after:colorName(fill.after),left:{label:beforeBlank?'기존 · 음영 없음':'기존 음영',tone:'before'},right:{label, tone:'format'},explanation:`내용은 같고 셀 배경 서식이 달라졌습니다 · ${d.members?.length||1}개 셀`};}
  if(format)return {kind:'format',label:'서식 변경',symbol:'▧',before:'기존 서식',after:'변경된 서식',left:{label:'변경 전 서식',tone:'before'},right:{label:'변경 후 서식',tone:'format'},explanation:d.detail};
  if(d.category==='row-move')return {kind:'changed',label:'위치 이동',symbol:'↔',before:d.oldText||'(빈 항목)',after:d.newText||'(빈 항목)',left:{label:'이동 전 위치',tone:'before'},right:{label:'이동 후 위치',tone:'after'},explanation:d.detail};
  return {kind:'changed',label:d.formatChanges?.length?'내용·서식 수정':'내용 수정',symbol:'⇄',before:d.oldText||'(빈 항목)',after:d.newText||'(빈 항목)',left:{label:'변경 전 내용',tone:'before'},right:{label:'변경 후 내용',tone:'after'},explanation:d.detail};
}
export const isFormatChange=d=>d.category==='format'||d.category==='page-format'||!!d.formatChanges?.length;
