import {readDocument,renderPage,demoDocuments} from './readers.js?v=20261029-9';
import {contentDifferences,visualDifferences,parsePageRanges,summarize,unexplainedVisualDifferences} from './diff.js?v=20261029-9';
import {groupChanges,navigationDirection,revealInList} from './review-navigation.js?v=20261029-9';
import {changePresentation,isFormatChange} from './change-presentation.js?v=20261029-9';
import {changeOverlays,paddedContext,changedSpans} from './text-locations.js?v=20261029-9';

const $=id=>document.getElementById(id);
const state={files:[null,null],docs:[null,null],pages:[0,0],regions:[null,null],rawDiffs:[],diffs:[],active:-1,filter:'all',busy:false,renderSeq:[0,0],selectionSeq:0,lastOptions:null};
let selectionTask=Promise.resolve();
const sideLetter=i=>i===0?'A':'B';
const ftext=(value,limit=130)=>String(value??'').length>limit?`${String(value).slice(0,limit)}…`:String(value??'');
const setStatus=(message,error=false)=>{$('status').textContent=message;$('status').style.color=error?'#c45a54':'#708b97';};
const mode=()=>document.querySelector('input[name="mode"]:checked').value;
const scope=()=>document.querySelector('input[name="scope"]:checked').value;
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function progress(percent,message){$('progressBox').classList.remove('hidden');$('progressText').textContent=message;$('progressBar').style.width=`${Math.round(percent*100)}%`;$('progressPercent').textContent=`${Math.round(percent*100)}%`;}

function updateSelectedFile(i,file){
  state.docs[i]?.dispose?.();
  state.files[i]=file;state.docs[i]=null;state.regions[i]=null;
  const side=sideLetter(i);
  $(`fileName${side}`).textContent=file?ftext(file.name,28):i===0?'원본 파일 선택':'수정 파일 선택';
  $(`fileMeta${side}`).textContent=file?`${(file.size/1024/1024).toFixed(2)}MB · ${file.name.split('.').pop().toUpperCase()}`:'클릭하거나 여기에 끌어놓기';
  state.rawDiffs=[];state.diffs=[];state.active=-1;state.selectionSeq++;renderResults();
}
function bindDrop(i){
  const side=sideLetter(i),input=$(`file${side}`),zone=$(`drop${side}`);
  input.addEventListener('change',()=>{if(input.files[0])updateSelectedFile(i,input.files[0]);});
  for(const ev of ['dragenter','dragover'])zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add('drag');});
  for(const ev of ['dragleave','drop'])zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove('drag');});
  zone.addEventListener('drop',e=>{const file=e.dataTransfer.files?.[0];if(file)updateSelectedFile(i,file);});
}
bindDrop(0);bindDrop(1);

$('swapBtn').addEventListener('click',()=>{
  [state.files[0],state.files[1]]=[state.files[1],state.files[0]];
  [state.docs[0],state.docs[1]]=[state.docs[1],state.docs[0]];
  [state.regions[0],state.regions[1]]=[state.regions[1],state.regions[0]];
  for(let i=0;i<2;i++){const file=state.files[i],side=sideLetter(i);$(`fileName${side}`).textContent=file?file.name:i?'수정 파일 선택':'원본 파일 선택';$(`fileMeta${side}`).textContent=file?`${(file.size/1024/1024).toFixed(2)}MB`:'파일을 선택하세요.';}
  state.rawDiffs=[];state.diffs=[];state.active=-1;state.selectionSeq++;renderResults();if(state.docs[0])showPage(0,0);if(state.docs[1])showPage(1,0);
});

function getOptions(){
  const s=scope(),a=state.docs[0],b=state.docs[1];if(!a||!b)throw new Error('두 문서가 모두 분석되어야 합니다.');
  const pagesA=s==='pages'?parsePageRanges($('rangeA').value,a.pages.length):new Set(a.pages.map((_,i)=>i));
  const pagesB=s==='pages'?parsePageRanges($('rangeB').value,b.pages.length):new Set(b.pages.map((_,i)=>i));
  if(s==='region'&&(!state.regions[0]||!state.regions[1]))throw new Error('좌우 문서에서 각각 비교할 영역을 드래그해 지정해 주세요.');
  return {mode:mode(),scope:s,ignoreSpace:$('ignoreSpace').checked,pagesA,pagesB,regionA:s==='region'?state.regions[0]:null,regionB:s==='region'?state.regions[1]:null,keyColumn:$('keyColumn').value};
}

async function ensureDocuments(){
  for(let i=0;i<2;i++){
    if(state.docs[i])continue;
    if(!state.files[i])throw new Error('원본과 수정 파일 두 개를 선택하세요.');
    progress(i*.4,`${sideLetter(i)} 파일 읽는 중`);
    state.docs[i]=await readDocument(state.files[i],(p,message)=>progress(i*.4+p*.4,`${sideLetter(i)} · ${message}`));
    state.pages[i]=0;await showPage(i,0);
  }
}

function backgroundCompare(a,b,options){
 if(typeof Worker==='undefined')return Promise.resolve(contentDifferences(a,b,options));
 return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./compare-worker.js?v=20261029-9',import.meta.url),{type:'module'});const clean=d=>({type:d.type,preview:d.preview,name:d.name,sheets:d.sheets,pages:d.pages.map(p=>({width:p.width,height:p.height})),records:d.records});worker.onmessage=e=>{worker.terminate();e.data.error?reject(Error(e.data.error)):resolve(e.data.results)};worker.onerror=e=>{worker.terminate();reject(Error('비교 작업 오류: '+e.message))};worker.postMessage({left:clean(a),right:clean(b),options})});
}
async function compare(){
  if(state.busy)return;state.busy=true;$('compareBtn').disabled=true;
  try{
    await ensureDocuments();
    const opts=getOptions();state.lastOptions=opts;
    progress(.82,'텍스트와 구조 비교');
    const structuredOnly=state.docs.every(d=>d.type==='xlsx')||state.docs.some(d=>['hwp','hwpx'].includes(d.type)&&d.preview!=='hwp-layout');let diffs=opts.mode==='visual'&&!structuredOnly?[]:await backgroundCompare(state.docs[0],state.docs[1],{...opts,mode:opts.mode==='visual'?'precision':opts.mode});
    const visualRequested=!structuredOnly&&(opts.mode==='visual'||(opts.mode==='precision'&&$('visualExtra').checked&&state.docs.every(d=>d.type==='pdf'||d.preview==='hwp-layout')));
    if(visualRequested){
      const visual=await visualDifferences(state.docs[0],state.docs[1],{...opts,knownDifferences:opts.mode==='precision'?diffs:undefined},(p,m)=>progress(.82+p*.17,m));
      if(opts.mode==='precision'){
        diffs.push(...unexplainedVisualDifferences(visual,diffs));
      }else diffs=visual;
    }
    state.rawDiffs=diffs;state.diffs=$('groupCells').checked?groupChanges(diffs):diffs;state.active=state.diffs.length?0:-1;state.filter='all';document.querySelectorAll('.filter').forEach(btn=>btn.classList.toggle('active',btn.dataset.filter==='all'));
    progress(1,'비교 완료');renderResults();
    if(state.active>=0)await selectDiff(0);else setStatus('선택한 조건에서 차이가 발견되지 않았습니다. 검사 불가 항목도 함께 확인하세요.');
    const warnings=[...state.docs[0].warnings,...state.docs[1].warnings];
    if(opts.mode==='precision'&&state.docs.some(d=>d.type!=='pdf'&&d.preview!=='hwp-layout'))warnings.push('이 형식 조합은 서식·인쇄 좌표를 완전히 비교하지 못하며 화면 보조 검사가 생략될 수 있습니다.');
    if(warnings.length)setStatus(`${state.diffs.length}건 결과. 주의: ${[...new Set(warnings)].join(' / ')}`);
  }catch(e){setStatus(`비교 실패: ${e.message||e}`,true);console.error(e);}
  finally{state.busy=false;$('compareBtn').disabled=false;setTimeout(()=>$('progressBox').classList.add('hidden'),1800);}
}
$('compareBtn').addEventListener('click',compare);

$('demoBtn').addEventListener('click',async()=>{
  state.docs.forEach(d=>d?.dispose?.());state.files=[null,null];state.docs=demoDocuments();state.pages=[0,0];state.regions=[null,null];
  $('fileNameA').textContent='점검표_원본.xlsx (예제)';$('fileNameB').textContent='점검표_수정.hwpx (예제)';
  $('fileMetaA').textContent='가상 문서 · 로컬 시연';$('fileMetaB').textContent='가상 문서 · 로컬 시연';
  document.querySelector('input[name="mode"][value="precision"]').checked=true;
  document.querySelector('input[name="scope"][value="all"]').checked=true;setScopeVisibility();
  await showPage(0,0);await showPage(1,0);await compare();
  setStatus('예제 비교입니다. 실제 파일을 업로드하지 않았습니다.');
});

async function showPage(i,index){
  const doc=state.docs[i];if(!doc)return;
  index=Math.max(0,Math.min(doc.pages.length-1,index));state.pages[i]=index;
  const token=++state.renderSeq[i],side=sideLetter(i),canvas=$(`canvas${side}`),shell=$(`shell${side}`),viewport=$(`viewport${side}`);
  $(`empty${side}`).classList.add('hidden');shell.style.display='block';
  const targetWidth=Math.min(800,Math.max(260,viewport.clientWidth-36));
  await renderPage(doc,index,canvas,targetWidth);
  if(token!==state.renderSeq[i])return;
  shell.style.width=`${targetWidth}px`;canvas.style.width='100%';canvas.style.height='auto';
  $('paneTitle'+side).textContent=ftext(doc.name,24);$(`pageInfo${side}`).textContent=`${doc.type==='hwpx'&&doc.preview!=='hwp-layout'?'추출 ':''}${index+1} / ${doc.pages.length}`;
  const notice=$(`notice${side}`);notice.classList.toggle('hidden',!['hwp','hwpx'].includes(doc.type));notice.textContent=doc.preview==='hwp-layout'?'한글 페이지 보기 · 일부 글꼴·개체·페이지 나눔은 한컴과 다를 수 있음':doc.type==='hwpx'?'본문 추출 보기 · 원본 배치·쪽수와 다름 · 댓글 제외 · 원본 화면 비교는 PDF로 저장 후 이용':'';
  repaintOverlays(i);refreshSelection(i);
}

function pageRectStyle(rect,pg){return {left:`${100*rect.x/pg.width}%`,top:`${100*rect.y/pg.height}%`,width:`${100*rect.w/pg.width}%`,height:`${100*rect.h/pg.height}%`};}
function repaintOverlays(i){
  const side=sideLetter(i),doc=state.docs[i],overlay=$(`overlay${side}`);overlay.replaceChildren();if(!doc)return;
  const pg=doc.pages[state.pages[i]],visible=new Set(filterDiffs().map(d=>d.index));
  state.diffs.forEach((d,index)=>{const r=i===0?d.left:d.right;if(!visible.has(index)||!r?.rect||r.page!==state.pages[i])return;
    if($('focusOnly').checked&&index!==state.active)return;
    const presentation=changePresentation(d),mark=i===0?presentation.left:presentation.right,active=index===state.active;
    const parts=changeOverlays(d,i===0?'left':'right',state.lastOptions?.ignoreSpace);
    let tagged=false;
    for(const part of parts){if(part.record.page!==state.pages[i])continue;
      const el=document.createElement('div');el.className=`annotation annotation-context mark-${mark.tone} ${active?'active':''} ${part.format?'format-context':''}`;
      const box=paddedContext(part.record.rect,pg);Object.assign(el.style,pageRectStyle(box,pg));el.title=`#${index+1} ${mark.label}: ${d.detail}${part.record.label?' · '+part.record.label:''}`;
      if(active&&!tagged){const tag=document.createElement('span');tag.className='annotation-tag'+(box.y<30?' tag-inside':'');tag.textContent=`#${index+1} ${mark.label}`;el.appendChild(tag);tagged=true;}overlay.appendChild(el);
      for(const rect of part.highlights){const ink=document.createElement('div');ink.className=`text-change-mark mark-${mark.tone} ${active?'active':''}`;Object.assign(ink.style,pageRectStyle(rect,pg));ink.title=rect.approximate?'변경 글자 · 글꼴에 따라 강조 위치가 약간 다를 수 있음':'변경 글자';overlay.appendChild(ink);}
    }
  });
}

function refreshSelection(i){
  const region=state.regions[i],side=sideLetter(i),box=$(`selection${side}`),doc=state.docs[i];
  if(!region||!doc||region.page!==state.pages[i]){box.classList.add('hidden');return;}
  box.classList.remove('hidden');Object.assign(box.style,pageRectStyle(region.rect,doc.pages[region.page]));
}

for(let i=0;i<2;i++){
  const side=sideLetter(i);
  $(`pagePrev${side}`).addEventListener('click',()=>showPage(i,state.pages[i]-1));
  $(`pageNext${side}`).addEventListener('click',()=>showPage(i,state.pages[i]+1));
  const shell=$(`shell${side}`);let start=null;
  shell.addEventListener('pointerdown',e=>{
    if(scope()!=='region'||!state.docs[i])return;
    e.preventDefault();shell.setPointerCapture(e.pointerId);
    const box=shell.getBoundingClientRect();start={x:Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y:Math.max(0,Math.min(1,(e.clientY-box.top)/box.height))};
  });
  shell.addEventListener('pointermove',e=>{
    if(!start)return;
    const box=shell.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y=Math.max(0,Math.min(1,(e.clientY-box.top)/box.height));
    const pg=state.docs[i].pages[state.pages[i]],left=Math.min(start.x,x),top=Math.min(start.y,y);
    state.regions[i]={page:state.pages[i],rect:{x:left*pg.width,y:top*pg.height,w:Math.abs(x-start.x)*pg.width,h:Math.abs(y-start.y)*pg.height}};
    refreshSelection(i);
  });
  shell.addEventListener('pointerup',()=>{if(start){start=null;setStatus('비교 영역을 선택했습니다. 양쪽 모두 지정한 뒤 비교 시작을 누르세요.');}});
}

function setScopeVisibility(){const s=scope();$('rangeInputs').classList.toggle('hidden',s!=='pages');$('scopeHint').classList.toggle('hidden',s!=='region');}
document.querySelectorAll('input[name="scope"]').forEach(r=>r.addEventListener('change',setScopeVisibility));
const hints={fast:'글자·숫자 중심 비교. 서식·화면 차이는 검사하지 않습니다.',precision:'셀 배경색·음영·테두리·글자·문단 서식을 비교하고 페이지 화면도 보조 검사합니다. 한글 댓글은 제외합니다.',visual:'PDF·한글 페이지의 화면 차이를 검사합니다. 한글과 PDF 등 서로 다른 렌더러의 차이는 확인 필요로 표시합니다. Excel끼리는 행 정렬 후 내용·가용 서식을 검사합니다.'};
document.querySelectorAll('input[name="mode"]').forEach(r=>r.addEventListener('change',()=>{$('modeHint').textContent=hints[mode()];}));

const filterDiffs=()=>state.diffs.map((d,i)=>({...d,index:i})).filter(d=>state.filter==='all'||(state.filter==='format'?isFormatChange(d):d.type===state.filter)).filter(d=>$('showReview').checked||d.type!=='review');
function renderActiveChange(){
  const d=state.diffs[state.active],panel=$('activeChangePanel');panel.classList.toggle('hidden',!d);if(!d){for(const side of ['A','B']){$('sideState'+side).textContent=side==='A'?'이전 내용 · 삭제된 부분':'새 내용 · 추가된 부분';$('sideState'+side).className='side-state';}return;}
  const p=changePresentation(d);for(const side of ['A','B']){const mark=side==='A'?p.left:p.right;$('sideState'+side).textContent=mark.label;$('sideState'+side).className='side-state tone-'+mark.tone;}panel.className=`active-change kind-${p.kind}`;
  const marked=(value,side)=>{if(d.category!=='content'||d.type==='review'||d.members||value.length>140)return escapeHtml(ftext(value,140));const spans=changedSpans(d.oldText,d.newText,state.lastOptions?.ignoreSpace)[side];let start=0,html='';for(const span of spans){html+=escapeHtml(value.slice(start,span.start))+`<mark>${escapeHtml(value.slice(span.start,span.end))}</mark>`;start=span.end;}return html+escapeHtml(value.slice(start));};
  const hint=d.category==='content'?`${(d.left||d.right)?.role==='cell'?'셀 단위 이동':'문장 단위 이동 · 셀 경계 미확인'} · 연한 테두리: 주변 구간 / 진한 강조: 변경 글자`:'';
  panel.innerHTML=`<div class="active-change-title"><b>#${state.active+1} ${escapeHtml(p.label)}</b><span>${escapeHtml(p.explanation)}</span></div><div class="before-after"><div><small>왼쪽 A · ${escapeHtml(p.left.label)}</small><strong>${marked(p.before,'left')}</strong></div><div><small>오른쪽 B · ${escapeHtml(p.right.label)}</small><strong>${marked(p.after,'right')}</strong></div></div>${hint?`<div class="highlight-hint">${hint}</div>`:''}`;
}
function renderResults(){
  const visible=filterDiffs(),counts=summarize(state.diffs);
  $('resultCount').textContent=visible.length;$('changeCounter').textContent=state.diffs.length?`전체 ${state.diffs.length}건 · 선택 ${Math.max(0,visible.findIndex(d=>d.index===state.active)+1)}/${visible.length}${state.rawDiffs.length>state.diffs.length?` · 세부 ${state.rawDiffs.length}건`:''}`:'차이점 없음';
  $('summaryChips').innerHTML=`<span>수정 ${counts.changed||0}</span><span>추가 ${counts.added||0}</span><span>삭제 ${counts.removed||0}</span><span>확인 ${counts.review||0}</span>`;renderActiveChange();
  $('prevBtn').disabled=$('nextBtn').disabled=!visible.length;$('exportBtn').disabled=!state.diffs.length;
  const list=$('resultsList');list.replaceChildren();
  if(!visible.length){list.innerHTML='<div class="result-empty">표시할 차이점이 없습니다.</div>';repaintOverlays(0);repaintOverlays(1);return;}
  for(const d of visible){
    const p=changePresentation(d),card=document.createElement('div');card.className=`result kind-${p.kind} ${d.index===state.active?'current':''}`;card.tabIndex=0;card.setAttribute('role','button');
    const location=(r,i)=>r?.page!=null?`${i?'수정본':'원본'} ${state.docs[i]?.type==='hwpx'&&state.docs[i]?.preview!=='hwp-layout'?`추출 ${r.page+1}구간 · ${r.label||''}`:`${r.page+1}쪽`}`:`${i?'수정본':'원본'} 없음`;
    const a=location(d.left,0),b=location(d.right,1);
    card.innerHTML=`<span class="result-icon ${p.kind}">${p.symbol}</span><div class="result-content"><strong>#${d.index+1} <span class="change-badge">${escapeHtml(p.label)}</span>${d.members?` · ${d.members.length}개 셀`:''}</strong><p class="result-description">${escapeHtml(d.detail)}</p><div class="before-after"><div><small>A 기존</small><span>${escapeHtml(ftext(p.before,110))}</span></div><div><small>B 변경</small><span>${escapeHtml(ftext(p.after,110))}</span></div></div><span class="result-meta">${a} / ${b}${d.confidence!=='certain'?' · 직접 확인 필요':''}</span></div>`;
    if(d.members){const details=document.createElement('details');details.className='cell-details';details.innerHTML=`<summary>셀별 상세 ${d.members.length}개</summary>${d.members.map(m=>{const r=m.right||m.left;return `<p><b>${escapeHtml(r.meta.sheet||'표')} · ${r.meta.row||r.meta.tableRow}행 ${r.meta.col}열</b><br>${escapeHtml(m.oldText)} → ${escapeHtml(m.newText)}<br>${escapeHtml(m.detail)}</p>`;}).join('')}`;details.addEventListener('click',e=>e.stopPropagation());card.querySelector('.result-content').appendChild(details);}
    card.addEventListener('click',()=>selectDiff(d.index));card.addEventListener('keydown',e=>{if(e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectDiff(d.index);}});list.appendChild(card);
  }
  repaintOverlays(0);repaintOverlays(1);
}

function selectDiff(index){
  if(index<0||index>=state.diffs.length)return;
  state.active=index;const d=state.diffs[index],token=++state.selectionSeq;renderResults();
  const preview=$('previewWorkspace');preview.focus({preventScroll:true});const box=preview.getBoundingClientRect();if(box.top<0||box.top>window.innerHeight-120){const navigation=$('changeNavigation');window.scrollBy({top:navigation.getBoundingClientRect().top-12,behavior:'instant'});}
  revealInList($('resultsList'),$('resultsList').querySelector('.result.current'));
  // Serialize page renders and skip superseded selections when arrows repeat quickly.
  selectionTask=selectionTask.catch(()=>{}).then(async()=>{
    if(token!==state.selectionSeq)return;
    for(let i=0;i<2;i++){const r=i===0?d.left:d.right;if(r?.page!=null&&state.pages[i]!==r.page)await showPage(i,r.page);if(token!==state.selectionSeq)return;}
    for(let i=0;i<2;i++){repaintOverlays(i);const doc=state.docs[i],r=i===0?d.left:d.right;if(!r?.rect||!doc)continue;const side=sideLetter(i),vp=$(`viewport${side}`),pg=doc.pages[r.page],shell=$(`shell${side}`);const factor=shell.getBoundingClientRect().width/pg.width;vp.scrollTop=Math.max(0,(r.rect.y+r.rect.h/2)*factor-vp.clientHeight/2);}
  }).catch(e=>setStatus(`미리보기 이동 실패: ${e.message||e}`,true));
  return selectionTask;
}
function step(direction){if(state.busy)return;const visible=filterDiffs().map(d=>d.index);if(!visible.length)return false;const i=visible.indexOf(state.active);const next=visible[i<0?(direction>0?0:visible.length-1):(i+direction+visible.length)%visible.length];selectDiff(next);return true;}
$('prevBtn').addEventListener('click',()=>step(-1));$('nextBtn').addEventListener('click',()=>step(1));
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));const visible=filterDiffs(),next=visible.find(d=>d.index===state.active)||visible[0];if(next)selectDiff(next.index);else{state.active=-1;renderResults();}}));
$('showReview').addEventListener('change',()=>{const visible=filterDiffs(),next=visible.find(d=>d.index===state.active)||visible[0];if(next)selectDiff(next.index);else{state.active=-1;renderResults();}});
$('focusOnly').addEventListener('change',()=>{repaintOverlays(0);repaintOverlays(1);});
$('groupCells').addEventListener('change',()=>{const current=state.diffs[state.active],id=current?.members?.[0]?.id||current?.id;state.diffs=$('groupCells').checked?groupChanges(state.rawDiffs):state.rawDiffs;const index=state.diffs.findIndex(d=>d.id===id||d.members?.some(m=>m.id===id));state.active=index;renderResults();if(index>=0)selectDiff(index);});

$('exportBtn').addEventListener('click',()=>{
  const output={app:'문서 비교실 v0.9',createdAt:new Date().toISOString(),files:state.docs.map(d=>({name:d.name,type:d.type,pages:d.pages.length,warnings:d.warnings})),options:{mode:state.lastOptions?.mode,scope:state.lastOptions?.scope,ignoreSpace:state.lastOptions?.ignoreSpace},groupConsecutiveCells:$('groupCells').checked,individualChangeCount:state.rawDiffs.length,individualChanges:state.rawDiffs,summary:summarize(state.diffs),changes:state.diffs.map(d=>({number:state.diffs.indexOf(d)+1,type:d.type,category:d.category,confidence:d.confidence,description:d.detail,before:d.oldText,after:d.newText,originalPage:d.left?.page!=null?d.left.page+1:null,modifiedPage:d.right?.page!=null?d.right.page+1:null}))};
  const blob=new Blob([JSON.stringify(output,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`document-diff-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

$('clearBtn').addEventListener('click',()=>{
  state.docs.forEach(d=>d?.dispose?.());state.files=[null,null];state.docs=[null,null];state.rawDiffs=[];state.diffs=[];state.active=-1;state.selectionSeq++;state.pages=[0,0];state.regions=[null,null];
  for(const side of ['A','B']){$(`file${side}`).value='';$(`fileName${side}`).textContent=side==='A'?'원본 파일 선택':'수정 파일 선택';$(`fileMeta${side}`).textContent='클릭하거나 끌어놓기';$(`shell${side}`).style.display='none';$(`empty${side}`).classList.remove('hidden');$(`paneTitle${side}`).textContent=side==='A'?'원본 문서':'수정 문서';$(`pageInfo${side}`).textContent='— / —';}
  for(const side of ['A','B'])$(`notice${side}`).classList.add('hidden');
  $('exportBtn').disabled=true;setStatus('초기화했습니다. 파일을 선택하세요.');renderResults();
});

$('helpBtn').addEventListener('click',()=>$('helpDialog').showModal());$('closeHelp').addEventListener('click',()=>$('helpDialog').close());
document.addEventListener('keydown',e=>{if($('helpDialog').open)return;const direction=navigationDirection(e);if(direction&&step(direction))e.preventDefault();if(e.key==='F3'){e.preventDefault();step(e.shiftKey?-1:1);}if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();compare();}});

renderResults();
