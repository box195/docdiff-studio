const decode=value=>{try{return JSON.parse(value)}catch{return undefined}};
const pick=(object,keys)=>Object.fromEntries(keys.filter(k=>object?.[k]!==undefined).map(k=>[k,object[k]]));
// IDs are storage references, not visible formatting. Renumbering them must not
// create changes. Resolve effective cell properties (including table zones).
const semantic=value=>Array.isArray(value)?value.map(semantic):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!/(?:Id|ID|IdRef|IDRef)$/.test(k)).map(([k,v])=>[k,semantic(v)])):typeof value==='string'&&/^#[0-9a-f]{6,8}$/i.test(value)?value.toLowerCase():value;
export function styleReader(native){
  const cache=new Map(),missing=new Set();
  const call=(method,args)=>{const key=method+JSON.stringify(args);if(cache.has(key))return cache.get(key);let result;try{if(typeof native[method]!=='function')return undefined;result=decode(native[method](...args));}catch{missing.add(method);}cache.set(key,result);return result;};
  const borderFill=props=>{
    if(!props)return {};
    const fill=props.fillType==='none'?{type:'none'}:pick(props,['fillType','fillColor','patternColor','patternType','gradientType','gradientColors','gradientAngle','imageId','imageMode','alpha']);
    const borders=pick(props,['borderLeft','borderRight','borderTop','borderBottom','diagonalLine','diagonalSlash','diagonalBackSlash','diagonalWidth','diagonalColor','centerLine']);
    return {fill:semantic(fill),borders:semantic(borders)};
  };
  return {
    missing,
    cell(sec,parent,control,index,path,info){
      const nested=path?.length>1;
      // ByPath takes the path to the parent cell plus the final child index.
      const props=nested?call('getCellPropertiesByPath',[sec,parent,JSON.stringify(path.slice(0,-1)),path.at(-1).cellIndex]):call('getCellProperties',[sec,parent,control,index]);
      if(!props){missing.add('cell');return {cellSpan:pick(info,['rowSpan','colSpan'])};}
      const {fill,borders}=borderFill(props);
      return {cellFill:fill,cellBorders:borders,cellSize:pick(props,['width','height']),cellMargins:pick(props,['paddingLeft','paddingRight','paddingTop','paddingBottom','applyInnerMargin']),cellAlignment:pick(props,['verticalAlign','textDirection']),cellSpan:pick(info,['rowSpan','colSpan']),cellOptions:pick(props,['isHeader','cellProtect','editableInForm'])};
    },
    paragraphs(runs,inCell){
      const values=new Map();
      for(const r of runs){const index=inCell?r.cellParaIdx:r.paraIdx;if(values.has(index))continue;
        // The core exposes paragraph properties for top-level table cells;
        // retain renderer attributes for nested paragraphs without guessing.
        const p=inCell?(r.cellPath?.length===1?call('getCellParaPropertiesAt',[r.secIdx,r.parentParaIdx,r.controlIdx,r.cellIdx,index]):undefined):call('getParaPropertiesAt',[r.secIdx,index]);
        if(p){const props=semantic(p);if(!runs.some(x=>(inCell?x.cellParaIdx:x.paraIdx)===index&&x.text?.includes('\t')))for(const key of ['defaultTabSpacing','tabStops','tabAutoLeft','tabAutoRight'])delete props[key];values.set(index,props);}
      }
      return [...values.values()];
    },
    characters(run){
      const inCell=run.cellPath?.length>0;
      const props=inCell?call('getCellCharPropertiesAtByPath',[run.secIdx,run.parentParaIdx,JSON.stringify(run.cellPath),run.charStart||0]):call('getCharPropertiesAt',[run.secIdx,run.paraIdx,run.charStart||0]);
      return props?semantic(props):undefined;
    },
    table(sec,parent,control){
      const p=call('getTableProperties',[sec,parent,control]);if(!p)return undefined;
      const {fill,borders}=borderFill(p);return {fill,borders,...pick(p,['cellSpacing','paddingLeft','paddingRight','paddingTop','paddingBottom','pageBreak','repeatHeader','tableWidth','tableHeight','outerLeft','outerRight','outerTop','outerBottom','hasCaption','treatAsChar','textWrap','vertRelTo','vertAlign','horzRelTo','horzAlign','vertOffset','horzOffset','restrictInPage','allowOverlap','keepWithAnchor'])};
    },
    page(section){return semantic(call('getPageDef',[section]));}
  };
}

// Preserve where a style applies, while ignoring incidental splitting of a
// same-style text run by the renderer (digits, spaces or line wrapping).
export function textStyleRanges(runs,reader){
  const ranges=[];
  for(const r of runs){if(!r.text?.length)continue;
    const style={font:r.fontFamily,size:r.fontSize,bold:r.bold,italic:r.italic,underline:r.underline,strike:r.strikethrough,color:r.textColor,ratio:r.ratio,letterSpacing:r.letterSpacing,effects:reader?.characters(r)};
    const paragraph=r.cellParaIdx??r.paraIdx,from=r.charStart||0,to=from+Array.from(r.text).length,last=ranges.at(-1);
    if(last&&last.paragraph===paragraph&&last.to===from&&JSON.stringify(last.style)===JSON.stringify(style))last.to=to;
    else ranges.push({paragraph,from,to,style});
  }
  return ranges;
}
