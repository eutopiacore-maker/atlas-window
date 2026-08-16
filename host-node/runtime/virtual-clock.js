'use strict';
const Module=require('module');
const RealDate=global.Date;
const virtual=process.env.ATLAS_VIRTUAL_NOW;
if(virtual){
  const ts=RealDate.parse(virtual);
  if(Number.isFinite(ts)){
    class AtlasDate extends RealDate{
      constructor(...args){super(...(args.length?args:[ts]));}
      static now(){return ts;}
      static parse(v){return RealDate.parse(v);}
      static UTC(...args){return RealDate.UTC(...args);}
    }
    global.Date=AtlasDate;
  }
}
if(process.env.ATLAS_OFFLINE==='1'){
  const originalLoad=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==='./geodata-node' || request.endsWith('/geodata-node')) return {enrich:async s=>s};
    return originalLoad.call(this,request,parent,isMain);
  };
  global.fetch=async function(){throw new Error('ATLAS_OFFLINE: external fetch disabled');};
}
