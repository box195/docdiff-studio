import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('실제 앱 다음/방향키 이동: 미리보기 포커스, 외부 스크롤 보존, 빠른 반복 처리',async()=>{
  const saved={document:globalThis.document,window:globalThis.window};
  class Element {
    constructor(id=''){this.id=id;this.children=[];this.style={};this.checked=true;this.scrollTop=0;this.clientHeight=200;this.clientWidth=500;this.clientTop=0;this.events={};this.classList={add(){},remove(){},toggle(){}};}
    addEventListener(name,fn){this.events[name]=fn;}
    replaceChildren(){this.children=[];}
    appendChild(el){this.children.push(el);}
    setAttribute(){}
    getBoundingClientRect(){return this.id==='previewWorkspace'?{top:150,bottom:625,width:800}:this.id==='changeNavigation'?{top:90}:this.id==='resultsList'?{top:650}:this.className?.includes('result ')?{top:900,bottom:950}:{top:0,width:800};}
    querySelector(selector){if(selector==='.result.current')return this.children.find(e=>e.className?.split(' ').includes('current'));return new Element();}
    focus(options){focused={id:this.id,options};}
    scrollIntoView(){throw Error('결과 카드로 외부 스크롤하면 안 됨');}
  }
  let focused=null,outerScrolls=0;
  const elements=new Map(),events={},get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  globalThis.document={getElementById:get,querySelectorAll:()=>[],createElement:()=>new Element(),addEventListener:(name,fn)=>events[name]=fn};
  globalThis.window={innerHeight:900,scrollBy:()=>outerScrolls++};
  try{
    let source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
    source=source.replace(/import \{readDocument,renderPage,demoDocuments\} from '.\/readers.js(?:\?[^']*)?';/,"const readDocument=()=>{},demoDocuments=()=>{},renderPage=async()=>{throw Error('같은 페이지를 불필요하게 다시 그림')};");
    source=source.replace(/'\.\/(diff|review-navigation|change-presentation|text-locations)\.js(?:\?[^']*)?'/g,(_,name)=>JSON.stringify(new URL(`../dist/${name}.js`,import.meta.url).href));
    const app=await import(`data:text/javascript;base64,${Buffer.from(source+'\nexport {state,selectDiff,step};').toString('base64')}`);
    const record=n=>({role:'cell',text:String(n),page:0,rect:{x:50,y:100+n*40,w:100,h:20},meta:{sheet:'S',row:n,col:1}});
    app.state.docs=[0,1].map(()=>({pages:[{width:800,height:1120}],records:[]}));
    app.state.diffs=app.state.rawDiffs=[1,2,3].map(n=>({id:String(n),type:'changed',category:'content',confidence:'certain',left:record(n),right:record(n),detail:'내용',oldText:'전',newText:'후'}));
    await app.selectDiff(0);
    assert.deepEqual(focused,{id:'previewWorkspace',options:{preventScroll:true}});assert.equal(outerScrolls,0);assert(get('resultsList').scrollTop>0);
    app.step(1);app.step(1);await app.selectDiff(app.state.active);
    assert.equal(app.state.active,2);assert.equal(outerScrolls,0);
    let prevented=false;events.keydown({key:'ArrowRight',target:{closest:()=>null},preventDefault(){prevented=true;}});
    await app.selectDiff(app.state.active);assert.equal(app.state.active,0);assert(prevented);
    events.keydown({key:'ArrowDown',target:{closest:()=>({tagName:'INPUT'})},preventDefault(){throw Error('입력 중 방향키를 가로채면 안 됨');}});
    assert.equal(app.state.active,0);assert.equal(outerScrolls,0);
    // Grouping changes only the navigation view, never the detected records.
    const pdfRecord=n=>({role:'cell',text:'값'+n,page:0,rect:{x:200,y:100+n*20,w:100,h:20},meta:{pdfTableKey:'T',pdfRow:n,pdfCol:1}});
    const raw=[1,2,3,4].map(n=>({id:'pdf-'+n,type:'changed',category:'content',confidence:'certain',left:pdfRecord(n),right:pdfRecord(n),oldText:'전'+n,newText:'후'+n,detail:'내용'}));
    for(const d of raw)for(const side of ['left','right']){const r=d[side];r.text=side==='left'?d.oldText:d.newText;r.textRuns=[{rect:{x:r.rect.x+3,y:r.rect.y+3,w:20,h:12},glyphs:[{start:0,end:1,x:r.rect.x+3,w:10},{start:1,end:2,x:r.rect.x+13,w:10}]}];}
    const snapshot=JSON.stringify(raw);app.state.rawDiffs=app.state.diffs=raw;app.state.active=0;
    get('groupCells').checked=true;get('groupCells').events.change();await app.selectDiff(0);
    assert.equal(app.state.diffs.length,1);assert.equal(app.state.diffs[0].members.length,4);assert.equal(JSON.stringify(app.state.rawDiffs),snapshot);
    assert.match(get('summaryChips').innerHTML,/수정 4/);assert.match(get('changeCounter').textContent,/검출 4건 · 이동 1곳/);
    for(const side of ['A','B']){const nodes=get('overlay'+side).children;assert.equal(nodes.filter(e=>e.className.includes('annotation-context')).length,1);assert.equal(nodes.filter(e=>e.className.includes('text-change-mark')).length,4);}
    get('groupCells').checked=false;get('groupCells').events.change();await app.selectDiff(0);
    assert.equal(app.state.diffs,raw);assert.equal(JSON.stringify(app.state.rawDiffs),snapshot);assert.equal(outerScrolls,0);
    get('focusOnly').checked=false;get('focusOnly').events.change();
    for(const side of ['A','B'])assert.equal(get('overlay'+side).children.filter(e=>e.className.includes('annotation-context')).length,4);
  } finally {globalThis.document=saved.document;globalThis.window=saved.window;}
});
