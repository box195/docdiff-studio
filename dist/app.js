import {readDocument,renderPage,demoDocuments} from './readers.js';
import {contentDifferences,visualDifferences,parsePageRanges,summarize} from './diff.js';

const $=id=>document.getElementById(id);
const state={files:[null,null],docs:[null,null],pages:[0,0],regions:[null,null],diffs:[],active:-1,filter:'all',busy:false,renderSeq:[0,0],lastOptions:null};
const sideLetter=i=>i===0?'A':'B';
const ftext=(value,limit=130)=>String(value??'').length>limit?`${String(value).slice(0,limit)}…`:String(value??'');
const setStatus=(message,error=false)=>{$('status').textContent=message;$('status').style.color=error?'#c45a54':'#708b97';};
const mode=()=>document.querySelector('input[name="mode"]:checked').value;
const scope=()=>document.querySelector('input[name="scope"]:checked').value;
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function progress(percent,message){$('progressBox').classList.remove('hidden');$('progressText').textContent=message;$('progressBar').style.width=`${Math.round(percent*100)}%`;$('progressPercent').textContent=`${Math.round(percent*100)}%`;}

function updateSelectedFile(i,file){
  state.files[i]=file;state.docs[i]=null;state.regions[i]=null;
  const side=sideLetter(i);
  $(`fileName${side}`).textContent=file?ftext(file.name,28):i===0?'원본 파일 선택':'수정 파일 선택';
  $(`fileMeta${side}`).textContent=file?`${(file.size/1024/1024).toFixed(2)}MB · ${file.name.split('.').pop().toUpperCase()}`:'클릭하거나 여기에 끌어놓기';
  state.diffs=[];state.active=-1;renderResults();
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
  state.diffs=[];state.active=-1;renderResults();if(state.docs[0])showPage(0,0);if(state.docs[1])showPage(1,0);
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
 return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./compare-worker.js',import.meta.url),{type:'module'});const clean=d=>({type:d.type,name:d.name,sheets:d.sheets,pages:d.pages.map(p=>({width:p.width,height:p.height})),records:d.records});worker.onmessage=e=>{worker.terminate();e.data.error?reject(Error(e.data.error)):resolve(e.data.results)};worker.onerror=e=>{worker.terminate();reject(Error('비교 작업 오류: '+e.message))};worker.postMessage({left:clean(a),right:clean(b),options})});
}
async function compare(){
  if(state.busy)return;state.busy=true;$('compareBtn').disabled=true;
  try{
    await ensureDocuments();
    const opts=getOptions();state.lastOptions=opts;
    progress(.82,'텍스트와 구조 비교');
    const bothWorkbooks=state.docs.every(d=>d.type==='xlsx');let diffs=opts.mode==='visual'&&!bothWorkbooks?[]:await backgroundCompare(state.docs[0],state.docs[1],{...opts,mode:opts.mode==='visual'?'precision':opts.mode});
    const visualRequested=!bothWorkbooks&&(opts.mode==='visual'||(opts.mode==='precision'&&$('visualExtra').checked&&state.docs.every(d=>d.type==='pdf')));
    if(visualRequested){
      const visual=await visualDifferences(state.docs[0],state.docs[1],opts,(p,m)=>progress(.82+p*.17,m));
      if(opts.mode==='precision'){
        // A visual region already explained by a text diff is not reported twice.
        const overlaps=(a,b)=>a&&b&&a.page===b.page&&a.rect&&b.rect&&a.rect.x<b.rect.x+b.rect.w&&b.rect.x<a.rect.x+a.rect.w&&a.rect.y<b.rect.y+b.rect.h&&b.rect.y<a.rect.y+a.rect.h;
        diffs.push(...visual.filter(v=>!diffs.some(d=>overlaps(v.left,d.left)||overlaps(v.right,d.right))));
      }else diffs=visual;
    }
    state.diffs=diffs;state.active=diffs.length?0:-1;state.filter='all';document.querySelectorAll('.filter').forEach(btn=>btn.classList.toggle('active',btn.dataset.filter==='all'));
    progress(1,'비교 완료');renderResults();
    if(state.active>=0)await selectDiff(0);else setStatus('선택한 조건에서 차이가 발견되지 않았습니다. 검사 불가 항목도 함께 확인하세요.');
    const warnings=[...state.docs[0].warnings,...state.docs[1].warnings];
    if(opts.mode==='precision'&&state.docs.some(d=>d.type!=='pdf'))warnings.push('이 형식 조합은 서식·인쇄 좌표를 완전히 비교하지 못하며 화면 보조 검사가 생략될 수 있습니다.');
    if(warnings.length)setStatus(`${diffs.length}건 결과. 주의: ${[...new Set(warnings)].join(' / ')}`);
  }catch(e){setStatus(`비교 실패: ${e.message||e}`,true);console.error(e);}
  finally{state.busy=false;$('compareBtn').disabled=false;setTimeout(()=>$('progressBox').classList.add('hidden'),1800);}
}
$('compareBtn').addEventListener('click',compare);

$('demoBtn').addEventListener('click',async()=>{
  state.files=[null,null];state.docs=demoDocuments();state.pages=[0,0];state.regions=[null,null];
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
  $('paneTitle'+side).textContent=ftext(doc.name,24);$(`pageInfo${side}`).textContent=`${index+1} / ${doc.pages.length}`;
  repaintOverlays(i);refreshSelection(i);
}

function pageRectStyle(rect,pg){return {left:`${100*rect.x/pg.width}%`,top:`${100*rect.y/pg.height}%`,width:`${100*rect.w/pg.width}%`,height:`${100*rect.h/pg.height}%`};}
function repaintOverlays(i){
  const side=sideLetter(i),doc=state.docs[i],overlay=$(`overlay${side}`);overlay.replaceChildren();if(!doc)return;
  const pg=doc.pages[state.pages[i]];
  state.diffs.forEach((d,index)=>{const r=i===0?d.left:d.right;if(!r?.rect||r.page!==state.pages[i])return;
    const el=document.createElement('div');el.className=`annotation ${index===state.active?'active':''} ${d.type==='added'?'added':''} ${d.type==='review'?'review':''}`;
    Object.assign(el.style,pageRectStyle(r.rect,pg));el.title=`차이 #${index+1}: ${d.detail}`;overlay.appendChild(el);
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
const hints={fast:'글자·숫자 중심 비교. 서식·화면 차이는 검사하지 않습니다.',precision:'내용과 가용 서식을 비교합니다. PDF끼리는 화면도 보조 검사합니다.',visual:'PDF 등은 화면 차이를 보조 검사합니다. Excel끼리는 행 정렬 후 내용·가용 서식을 검사해 삽입에 따른 위치 오탐을 줄입니다.'};
document.querySelectorAll('input[name="mode"]').forEach(r=>r.addEventListener('change',()=>{$('modeHint').textContent=hints[mode()];}));

const filterDiffs=()=>state.diffs.map((d,i)=>({...d,index:i})).filter(d=>state.filter==='all'||d.type===state.filter).filter(d=>$('showReview').checked||d.type!=='review');
function renderResults(){
  const visible=filterDiffs(),counts=summarize(state.diffs);
  $('resultCount').textContent=visible.length;$('changeCounter').textContent=state.diffs.length?`전체 ${state.diffs.length}건 · 선택 ${state.active+1}/${state.diffs.length}`:'차이점 없음';
  $('summaryChips').innerHTML=`<span>수정 ${counts.changed||0}</span><span>추가 ${counts.added||0}</span><span>삭제 ${counts.removed||0}</span><span>확인 ${counts.review||0}</span>`;
  $('prevBtn').disabled=$('nextBtn').disabled=!visible.length;$('exportBtn').disabled=!state.diffs.length;
  const list=$('resultsList');list.replaceChildren();
  if(!visible.length){list.innerHTML='<div class="result-empty">표시할 차이점이 없습니다.</div>';return;}
  for(const d of visible){
    const card=document.createElement('div');card.className=`result ${d.index===state.active?'current':''}`;card.tabIndex=0;card.setAttribute('role','button');
    const symbol={changed:'≠',added:'+',removed:'−',review:'?'}[d.type],labels={changed:'수정',added:'추가',removed:'삭제',review:'확인 필요'};
    const a=d.left?.page!=null?`원본 ${d.left.page+1}쪽`:'원본 없음',b=d.right?.page!=null?`수정본 ${d.right.page+1}쪽`:'수정본 없음';
    card.innerHTML=`<span class="result-icon ${d.type}">${symbol}</span><div class="result-content"><strong>#${d.index+1} ${labels[d.type]} · ${escapeHtml(d.detail)}</strong><p>${escapeHtml(ftext(d.oldText,110))} <b>→</b> ${escapeHtml(ftext(d.newText,110))}</p><span class="result-meta">${a} / ${b} · ${escapeHtml(d.category)}${d.confidence!=='certain'?' · 추정':''}</span></div>`;
    card.addEventListener('click',()=>selectDiff(d.index));card.addEventListener('keydown',e=>{if(e.key==='Enter')selectDiff(d.index);});list.appendChild(card);
  }
  repaintOverlays(0);repaintOverlays(1);
}

async function selectDiff(index){
  if(index<0||index>=state.diffs.length)return;
  state.active=index;const d=state.diffs[index];
  for(let i=0;i<2;i++){const r=i===0?d.left:d.right;if(r?.page!=null)await showPage(i,r.page);}
  renderResults();
  const cards=$('resultsList').querySelectorAll('.result.current');if(cards[0])cards[0].scrollIntoView({block:'nearest'});
  for(let i=0;i<2;i++){const doc=state.docs[i],r=i===0?d.left:d.right;if(!r?.rect||!doc)continue;const side=sideLetter(i),vp=$(`viewport${side}`),pg=doc.pages[r.page],shell=$(`shell${side}`);const factor=shell.getBoundingClientRect().width/pg.width;vp.scrollTop=Math.max(0,(r.rect.y+r.rect.h/2)*factor-vp.clientHeight/2);}
}
function step(direction){const visible=filterDiffs().map(d=>d.index);if(!visible.length)return;const i=visible.indexOf(state.active);const next=visible[(i+direction+visible.length)%visible.length];selectDiff(next);}
$('prevBtn').addEventListener('click',()=>step(-1));$('nextBtn').addEventListener('click',()=>step(1));
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));renderResults();}));
$('showReview').addEventListener('change',renderResults);

$('exportBtn').addEventListener('click',()=>{
  const output={app:'문서 비교실 v0.2',createdAt:new Date().toISOString(),files:state.docs.map(d=>({name:d.name,type:d.type,pages:d.pages.length,warnings:d.warnings})),options:{mode:state.lastOptions?.mode,scope:state.lastOptions?.scope,ignoreSpace:state.lastOptions?.ignoreSpace},summary:summarize(state.diffs),changes:state.diffs.map(d=>({number:state.diffs.indexOf(d)+1,type:d.type,category:d.category,confidence:d.confidence,description:d.detail,before:d.oldText,after:d.newText,originalPage:d.left?.page!=null?d.left.page+1:null,modifiedPage:d.right?.page!=null?d.right.page+1:null}))};
  const blob=new Blob([JSON.stringify(output,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`document-diff-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

$('clearBtn').addEventListener('click',()=>{
  state.files=[null,null];state.docs=[null,null];state.diffs=[];state.active=-1;state.pages=[0,0];state.regions=[null,null];
  for(const side of ['A','B']){$(`file${side}`).value='';$(`fileName${side}`).textContent=side==='A'?'원본 파일 선택':'수정 파일 선택';$(`fileMeta${side}`).textContent='클릭하거나 끌어놓기';$(`shell${side}`).style.display='none';$(`empty${side}`).classList.remove('hidden');$(`paneTitle${side}`).textContent=side==='A'?'원본 문서':'수정 문서';$(`pageInfo${side}`).textContent='— / —';}
  $('exportBtn').disabled=true;setStatus('초기화했습니다. 파일을 선택하세요.');renderResults();
});

$('helpBtn').addEventListener('click',()=>$('helpDialog').showModal());$('closeHelp').addEventListener('click',()=>$('helpDialog').close());
document.addEventListener('keydown',e=>{if(e.key==='F3'){e.preventDefault();step(e.shiftKey?-1:1);}if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();compare();}});

renderResults();
