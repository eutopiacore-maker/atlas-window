'use strict';
const os=require('os');
function snapshot(){return{platform:process.platform,arch:process.arch,node:process.version,cpuCount:os.cpus().length,ramBytes:os.totalmem(),time:new Date().toISOString()}}
if(process.argv.includes('--self-test')){const s=snapshot();if(!s.cpuCount||!s.ramBytes)process.exit(1);console.log(JSON.stringify(s));}
else console.log(JSON.stringify(snapshot(),null,2));
