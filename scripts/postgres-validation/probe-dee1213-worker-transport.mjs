// Loopback-only synthetic Worker probes for the scheduled-owned transport.
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const dir=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(dir,'../..');
const source=path.join(repo,'lib/trader/paper/scheduled-owned-postgres-transport-v1.ts');
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output'||!args[1])throw new Error('Usage: node scripts/postgres-validation/probe-dee1213-worker-transport.mjs --output <report.json>');
const outputPath=path.resolve(process.cwd(),args[1]);
const sourceHashBefore=createHash('sha256').update(await fs.readFile(source)).digest('hex');
const require=createRequire(path.join(repo,'package.json'));
const {Miniflare,Log,LogLevel}=require('miniflare');
const {build}=require('esbuild');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'waia-dee1213-prod-transport-'));
const cases=['clear-eof','clear-silent','tls-upgrade-silent','tls-before-upgrade-eof','tls-trusted','tls-untrusted','tls-hostname-mismatch'];
const results=[];
async function boundedCleanup(promise,label,ms=1500){
  let timer;
  try{return await Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label}_CLEANUP_TIMEOUT`)),ms)})])}
  finally{clearTimeout(timer)}
}

async function makeCert(name, sans) {
  const stem=path.join(temporary,name);
  await fs.writeFile(`${stem}.cnf`,`[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${name}\n[ext]\nsubjectAltName=${sans}\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n`);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',`${stem}.cnf`,'-keyout',`${stem}.key`,'-out',`${stem}.crt`],{stdio:'ignore'});
  return {key:await fs.readFile(`${stem}.key`),cert:await fs.readFile(`${stem}.crt`,'utf8')};
}
try {
const localhostCert=await makeCert('localhost','DNS:localhost,IP:127.0.0.1');
const wrongHostCert=await makeCert('wrong-host','DNS:wrong.invalid');

for(const mode of cases){
  let server,mf,watchdog,forcedEnd;
  const cleanupErrors=[];
  const sockets=new Set();
  const counts={connections:0,sslRequests:0,tlsHandshakes:0,startups:0,sni:[]};
  const context=tls.createSecureContext(mode==='tls-hostname-mismatch'?wrongHostCert:localhostCert);
  try{
    server=net.createServer(raw=>{
      counts.connections++;sockets.add(raw);raw.on('error',()=>{});raw.on('close',()=>sockets.delete(raw));
      let bytes=Buffer.alloc(0),seen=false;
      const onBytes=chunk=>{
        if(seen)return;bytes=Buffer.concat([bytes,chunk]);if(bytes.length<8)return;
        const size=bytes.readUInt32BE(0);if(size<8||size>65536){raw.destroy();return;}if(bytes.length<size)return;
        const code=bytes.readUInt32BE(4);
        if(code===80877103){
          seen=true;raw.removeListener('data',onBytes);counts.sslRequests++;
          if(mode==='tls-before-upgrade-eof'){raw.end();return;}
          raw.write('S');
          if(mode==='tls-upgrade-silent')return;
          const secure=new tls.TLSSocket(raw,{isServer:true,secureContext:context,SNICallback:(name,cb)=>{counts.sni.push(name);cb(null,context);}});
          sockets.add(secure);secure.on('error',()=>secure.destroy());secure.on('close',()=>sockets.delete(secure));
          secure.once('secure',()=>counts.tlsHandshakes++);
          let pg=Buffer.alloc(0),startupSeen=false;
          secure.on('data',data=>{
            if(startupSeen)return;pg=Buffer.concat([pg,data]);if(pg.length<8)return;
            const pgSize=pg.readUInt32BE(0);if(pgSize<8||pgSize>65536){secure.destroy();return;}if(pg.length<pgSize)return;
            if(pg.readUInt32BE(4)!==196608){secure.destroy();return;}
            startupSeen=true;counts.startups++;
            const body=Buffer.from('SFATAL\0C28000\0MSYNTHETIC_TLS_REFUSAL\0\0');const frame=Buffer.alloc(5);frame[0]=69;frame.writeUInt32BE(body.length+4,1);secure.end(Buffer.concat([frame,body]));
          });
          return;
        }
        if(code===196608){
          seen=true;counts.startups++;
          if(mode==='clear-eof')raw.end();
          // clear-silent deliberately withholds a PostgreSQL response until worker abort.
          return;
        }
        raw.destroy();
      };
      raw.on('data',onBytes);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const port=server.address().port,tlsMode=mode.startsWith('tls');
    const worker=`
import postgres from 'postgres';
import {createScheduledPostgresTransportV1} from '${source}';
export default {async fetch(){
  const controller=new AbortController();
  const transport=await createScheduledPostgresTransportV1({host:'localhost',port:${port},tls:${tlsMode}},controller.signal);
  const sql=postgres('postgres://synthetic@localhost:${port}/synthetic?sslmode=${tlsMode?'verify-full':'disable'}',{max:1,prepare:false,connect_timeout:2,socket:transport.socket});
  let forcedEnd;
  const forced=[];
  const onAbort=()=>{transport.seal();forcedEnd=sql.end({timeout:0});forced.push(forcedEnd)};
  controller.signal.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>controller.abort(new Error('PROBE_ABORT')),300);
  let result;
  try{await sql.unsafe('select 1');result={unexpectedSuccess:true}}
  catch(error){result={code:error.code,message:error.message}}
  finally{clearTimeout(timer);await transport.close();await(forcedEnd??sql.end({timeout:0}));controller.signal.removeEventListener('abort',onAbort)}
  let lateFactory;try{await transport.socket();lateFactory='unexpected-open'}catch(error){lateFactory=error.message}
  await new Promise(resolve=>setTimeout(resolve,100));
  return Response.json({...result,aborted:controller.signal.aborted,lateFactory,closeCompleted:true,forcedPoolEnd:forced.length>0});
}};`;
    const bundle=await build({stdin:{contents:worker,resolveDir:repo,sourcefile:`scheduled-transport-${mode}.mjs`},bundle:true,write:false,metafile:true,format:'esm',platform:'neutral',conditions:['workerd'],external:['cloudflare:*','node:*']});
    const inputs=Object.keys(bundle.metafile.inputs);
    if(!inputs.some(x=>x.includes('postgres/cf/src/index.js')))throw Error('WRONG_POSTGRES_DRIVER_EXPORT');
    if(!inputs.some(x=>x.endsWith('scheduled-owned-postgres-transport-v1.ts')))throw Error('TRANSPORT_SOURCE_NOT_BUNDLED');
    const cert=mode==='tls-trusted'?localhostCert.cert:mode==='tls-hostname-mismatch'?wrongHostCert.cert:undefined;
    mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2025-12-01',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],outboundService:{network:{allow:['local'],tlsOptions:{trustBrowserCas:false,trustedCertificates:cert?[cert]:[]}}},log:new Log(LogLevel.ERROR)});
    const before={...counts};
    try{
      const response=await Promise.race([mf.dispatchFetch('http://synthetic.invalid'),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error('EXTERNAL_3S_WATCHDOG')),3000)})]);
      const body=await response.text();let result;try{result=JSON.parse(body)}catch{result={workerError:body.slice(0,800)}};
      results.push({mode,result,before,after:{...counts,hostActiveSockets:sockets.size},bundleSha256:createHash('sha256').update(bundle.outputFiles[0].text).digest('hex')});
    }catch(error){results.push({mode,error:String(error),before,after:{...counts,hostActiveSockets:sockets.size}})}
  }catch(error){results.push({mode,setupError:String(error),after:{...counts,hostActiveSockets:sockets.size}})}
  finally{
    clearTimeout(watchdog);
    for(const socket of sockets)socket.destroy();
    if(mf)try{await boundedCleanup(mf.dispose(),'MINIFLARE')}catch(error){cleanupErrors.push(String(error))}
    mf=undefined;
    if(server)try{await boundedCleanup(new Promise(resolve=>server.close(resolve)),'SERVER')}catch(error){cleanupErrors.push(String(error))}
    if(cleanupErrors.length&&results.length)results.at(-1).cleanupErrors=cleanupErrors;
    forcedEnd=undefined;
  }
}

let deferredOpen;
{
  let mf,watchdog;
  const fixture=`
let resolveOpened,connectedResolve,openedSettled=false,closeCalls=0,cancelCalls=0,abortCalls=0,connectCalls=0;
const connected=new Promise(resolve=>{connectedResolve=resolve});
export function connect(){
  connectCalls++;
  const opened=new Promise(resolve=>{resolveOpened=()=>{openedSettled=true;resolve()}});
  let resolveClosed;const closed=new Promise(resolve=>{resolveClosed=resolve});
  let readableController,isClosed=false;
  const readable=new ReadableStream({start(controller){readableController=controller},cancel(){cancelCalls++}});
  const writable=new WritableStream({write(){},abort(){abortCalls++}});
  const raw={opened,closed,readable,writable,close(){closeCalls++;if(!isClosed){isClosed=true;try{readableController.close()}catch{};resolveClosed()}},startTls(){throw new Error('TLS_NOT_EXPECTED')}};
  connectedResolve();return raw;
}
export async function waitForConnect(){await connected}
export function releaseOpened(){resolveOpened()}
export function stats(){return {openedSettled,closeCalls,cancelCalls,abortCalls,connectCalls}}
`;
  const worker=`
import postgres from 'postgres';
import {createScheduledPostgresTransportV1} from '${source}';
import {waitForConnect,releaseOpened,stats} from 'deferred-socket-fixture';
export default {async fetch(){
  const controller=new AbortController();
  const transport=await createScheduledPostgresTransportV1({host:'localhost',port:54321,tls:false},controller.signal);
  const sql=postgres('postgres://synthetic@localhost:54321/synthetic?sslmode=disable',{max:1,prepare:false,connect_timeout:2,socket:transport.socket});
  let forcedEnd;const query=sql.unsafe('select 1').then(()=>'unexpected-query-success',error=>error.code??error.message);
  await waitForConnect();
  const pendingAtAbort=stats().openedSettled===false;
  controller.abort(new Error('DETERMINISTIC_ABORT_DURING_RAW_OPENED'));
  await new Promise(resolve=>setTimeout(resolve,25));
  const stillPendingAfterAbort=stats().openedSettled===false;
  forcedEnd=sql.end({timeout:0}).then(()=>'ended',error=>error.message);
  const closing=transport.close().then(()=>'closed',error=>error.message);
  const allSettled=Promise.all([query,forcedEnd,closing]);
  let settleTimer;
  const beforeLateOpen=await Promise.race([allSettled.then(values=>({settled:true,values})),new Promise(resolve=>{settleTimer=setTimeout(()=>resolve({settled:false}),750)})]);
  clearTimeout(settleTimer);
  const openedStillPendingBeforeRelease=stats().openedSettled===false;
  releaseOpened();
  const afterLateOpen=beforeLateOpen.settled?beforeLateOpen.values:await allSettled;
  const [queryOutcome,poolOutcome,closeOutcome]=afterLateOpen;
  let lateFactory;try{await transport.socket();lateFactory='unexpected-open'}catch(error){lateFactory=error.message}
  await new Promise(resolve=>setTimeout(resolve,50));
  return Response.json({pendingAtAbort,stillPendingAfterAbort,openedStillPendingBeforeRelease,settledBeforeLateOpen:beforeLateOpen.settled,queryOutcome,poolOutcome,closeOutcome,lateFactory,fixture:stats(),aborted:controller.signal.aborted});
}};`;
  try{
    const bundle=await build({stdin:{contents:worker,resolveDir:repo,sourcefile:'scheduled-transport-deferred-open.mjs'},bundle:true,write:false,metafile:true,format:'esm',platform:'neutral',conditions:['workerd'],external:['node:*'],plugins:[{
      name:'deferred-connect-fixture',setup(build){
        build.onResolve({filter:/^cloudflare:sockets$/},()=>({path:'deferred-socket-fixture',namespace:'fixture'}));
        build.onResolve({filter:/^deferred-socket-fixture$/},()=>({path:'deferred-socket-fixture',namespace:'fixture'}));
        build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js'}));
      }
    }]});
    if(!Object.keys(bundle.metafile.inputs).some(x=>x.includes('postgres/cf/src/index.js')))throw Error('DEFERRED_WRONG_POSTGRES_DRIVER_EXPORT');
    mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2025-12-01',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],log:new Log(LogLevel.ERROR)});
    const response=await Promise.race([mf.dispatchFetch('http://synthetic.invalid'),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error('DEFERRED_OPEN_3S_WATCHDOG')),3000)})]);
    const body=await response.text();let result;try{result=JSON.parse(body)}catch{result={workerError:body.slice(0,800)}};
    const accepted=result.pendingAtAbort===true&&result.stillPendingAfterAbort===true&&result.openedStillPendingBeforeRelease===true&&result.settledBeforeLateOpen===true&&result.queryOutcome==='SCHEDULED_POSTGRES_SCOPE_CLOSED'&&result.poolOutcome==='ended'&&result.closeOutcome==='closed'&&result.lateFactory==='SCHEDULED_POSTGRES_SCOPE_CLOSED'&&result.fixture.openedSettled===true&&result.fixture.closeCalls===1&&result.fixture.cancelCalls===1&&result.fixture.abortCalls===1&&result.fixture.connectCalls===1;
    deferredOpen={accepted,result,bundleSha256:createHash('sha256').update(bundle.outputFiles[0].text).digest('hex'),importResolution:'The test-only resolver maps the literal cloudflare:sockets import to a deterministic in-memory fixture; application source is not modified. This is not native TCP.'};
  }catch(error){deferredOpen={accepted:false,error:String(error)}}
  finally{clearTimeout(watchdog);if(mf)try{await boundedCleanup(mf.dispose(),'DEFERRED_MINIFLARE')}catch(error){deferredOpen={...deferredOpen,accepted:false,cleanupError:String(error)}}}
}

const accepted=results.length===cases.length&&results.every(r=>{
  const opens=r.after.connections-r.before.connections;
  const refused=r.mode==='tls-trusted'?r.result?.message==='SYNTHETIC_TLS_REFUSAL':!r.result?.unexpectedSuccess&&r.result?.message!=='SYNTHETIC_TLS_REFUSAL';
  const expectedStartup=r.mode==='clear-eof'||r.mode==='clear-silent'?r.after.startups-r.before.startups>0:r.mode==='tls-trusted'?r.after.startups-r.before.startups===1:r.after.startups-r.before.startups===0;
  const expectedSni=r.mode.startsWith('tls')&&r.mode!=='tls-before-upgrade-eof'?r.after.sni.every(name=>name==='localhost'):true;
  return !r.error&&!r.setupError&&!r.result?.workerError&&!r.cleanupErrors?.length&&refused&&expectedStartup&&expectedSni&&opens<=3&&r.after.hostActiveSockets===0&&r.result.lateFactory==='SCHEDULED_POSTGRES_SCOPE_CLOSED'&&r.result.closeCompleted===true;
});
const sourceHashAfter=createHash('sha256').update(await fs.readFile(source)).digest('hex');
const combinedAccepted=accepted&&deferredOpen?.accepted===true&&sourceHashBefore===sourceHashAfter;
const receipt={at:new Date().toISOString(),accepted:combinedAccepted,transportPath:path.relative(repo,source),transportSha256Before:sourceHashBefore,transportSha256After:sourceHashAfter,driverExport:'postgres workerd',cases,results,deferredOpen,limits:'Loopback-only synthetic PostgreSQL/TLS fixtures. Deferred-open case uses a test-only deterministic socket fixture and module resolver; it is not pending native TCP. No application DB, credentials, venue, or external service. This probe checks transport behavior, not scheduled-owner SQL/COMMIT/recovery semantics.'};
await fs.mkdir(path.dirname(outputPath),{recursive:true});
await fs.writeFile(outputPath,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({accepted:combinedAccepted,report:outputPath,sourceSha256Before:sourceHashBefore,sourceSha256After:sourceHashAfter,deferredOpen:deferredOpen&&{accepted:deferredOpen.accepted,error:deferredOpen.error,pendingAtAbort:deferredOpen.result?.pendingAtAbort,openedStillPendingBeforeRelease:deferredOpen.result?.openedStillPendingBeforeRelease,settledBeforeLateOpen:deferredOpen.result?.settledBeforeLateOpen,queryOutcome:deferredOpen.result?.queryOutcome,poolOutcome:deferredOpen.result?.poolOutcome,closeOutcome:deferredOpen.result?.closeOutcome,lateFactory:deferredOpen.result?.lateFactory},results:results.map(r=>({mode:r.mode,error:r.error??r.setupError??r.result?.workerError,message:r.result?.message,code:r.result?.code,aborted:r.result?.aborted,lateFactory:r.result?.lateFactory,opens:r.after.connections-r.before.connections,handshakes:r.after.tlsHandshakes-r.before.tlsHandshakes,startups:r.after.startups-r.before.startups,active:r.after.hostActiveSockets}))}));
if(!combinedAccepted)process.exitCode=1;
} catch(error) {
  const sourceHashAfter=await fs.readFile(source).then(bytes=>createHash('sha256').update(bytes).digest('hex')).catch(()=>null);
  const receipt={at:new Date().toISOString(),accepted:false,transportPath:path.relative(repo,source),transportSha256Before:sourceHashBefore,transportSha256After:sourceHashAfter,error:String(error),partialResults:results,limits:'Synthetic test harness failed; no application database or external endpoint was used.'};
  await fs.mkdir(path.dirname(outputPath),{recursive:true});
  await fs.writeFile(outputPath,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({accepted:false,report:outputPath,error:String(error),sourceSha256Before:sourceHashBefore,sourceSha256After}));
  process.exitCode=1;
} finally {
  await fs.rm(temporary,{recursive:true,force:true});
}
