'use strict';
const path=require('path');
const script=process.env.ATLAS_SCRIPT;
if(!script)throw new Error('ATLAS_SCRIPT is required');
const RealDate=Date;
const fixedMs=new RealDate(process.env.ATLAS_VIRTUAL_NOW||RealDate.now()).getTime();
if(!Number.isFinite(fixedMs))throw new Error('invalid ATLAS_VIRTUAL_NOW');
class AtlasDate extends RealDate{constructor(...args){super(...(args.length?args:[fixedMs]))}static now(){return fixedMs}}
global.Date=AtlasDate;
require(path.resolve(script));
