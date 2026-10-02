// Synthetic PostgreSQL + actual workerd + verified TLS. No production target.
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import postgres from 'postgres';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel} from 'miniflare';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output')throw Error('Usage: --output <report.json>');
const target=process.env.DATABASE_URL_POSTGRES;
const local='postgresql://waia_validate:waia_synthetic_test@127.0.0.1:54338/waia_hsv2_it_dee1213_scheduled_deadline_v1';
const ci='postgresql://waia_it:waia_it@127.0.0.1:5432/waia_dee1205';
if(target!==local && !(process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'&&target===ci))
  throw Error('DEE1213_EXACT_SYNTHETIC_DATABASE_REQUIRED');
const upstream=new URL(target);
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=path.join(repo,'lib/trader/paper/scheduled-owned-postgres-pool-v1.ts');
const transport=path.join(repo,'lib/trader/paper/scheduled-owned-postgres-transport-v1.ts');
const hashes=async()=>Object.fromEntries(await Promise.all([source,transport].map(async p=>[
  path.relative(repo,p),createHash('sha256').update(await fs.readFile(p)).digest('hex')])));
const before=await hashes();
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'dee1213-worker-pool-'));
const witness=postgres(target,{max:1,prepare:false,connect_timeout:5});
const results=[];
async function bounded(promise,ms,label){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}
  finally{clearTimeout(timer);}
}
try{
  const identity=await witness`SELECT current_database() AS db,current_setting('server_version_num')::int AS version`;
  if(identity[0]?.db!==upstream.pathname.slice(1)||Math.floor(identity[0]?.version/10000)!==16)
    throw Error('DEE1213_SYNTHETIC_IDENTITY_REFUSED');
  const stem=path.join(tmp,'localhost');
  await fs.writeFile(stem+'.cnf','[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',stem+'.cnf','-keyout',stem+'.key','-out',stem+'.crt'],{stdio:'ignore'});
  const cert=await fs.readFile(stem+'.crt','utf8');
  const context=tls.createSecureContext({key:await fs.readFile(stem+'.key'),cert});
  for(const mode of ['abort-in-flight','ack-before-cleanup']){
    const sockets=new Set();
    let connections=0,handshakes=0,server,mf;
    try{
      server=net.createServer(raw=>{
        connections++;sockets.add(raw);raw.on('close',()=>sockets.delete(raw));raw.on('error',()=>raw.destroy());
        let header=Buffer.alloc(0);
        const startup=data=>{
          header=Buffer.concat([header,data]);if(header.length<8)return;
          raw.removeListener('data',startup);
          if(header.length!==8||header.readInt32BE(0)!==8||header.readInt32BE(4)!==80877103){raw.destroy();return;}
          raw.write('S');
          const secure=new tls.TLSSocket(raw,{isServer:true,secureContext:context});
          const pg=net.connect({host:'127.0.0.1',port:Number(upstream.port)});
          for(const s of [secure,pg]){sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{secure.destroy();pg.destroy();});}
          // Propagate both TLS and raw EOF. Wrapping an existing net.Socket
          // does not guarantee its FIN is re-emitted as TLSSocket.close.
          for(const stream of [raw,secure]){
            stream.on('end',()=>pg.destroy());stream.on('close',()=>pg.destroy());
          }
          pg.on('close',()=>secure.destroy());
          secure.once('secure',()=>handshakes++);secure.pipe(pg);pg.pipe(secure);
        };
        raw.on('data',startup);
      });
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      const endpoint=new URL(target);endpoint.hostname='localhost';endpoint.port=String(server.address().port);endpoint.searchParams.set('sslmode','verify-full');
      const worker=`
import {withScheduledOwnedPostgresPoolV1} from ${JSON.stringify(source)};
export default {async fetch(){
  const controller=new AbortController();let pid=0,timer,result,error;
  const started=Date.now();
  try { result=await withScheduledOwnedPostgresPoolV1(${JSON.stringify(endpoint.toString())},controller.signal,async client=>{
    const ack=await client.begin(async tx=>{
      pid=Number((await tx\`SELECT pg_backend_pid() AS pid\`)[0].pid);
      if(${JSON.stringify(mode)}==='abort-in-flight'){
        timer=setTimeout(()=>controller.abort(new Error('SYNTHETIC_CANCEL')),100);
        await tx\`SELECT pg_sleep(1)\`;
      }
      return 'ACKNOWLEDGED';
    });
    controller.abort(new Error('SYNTHETIC_AFTER_ACK'));return ack;
  });}catch(e){error=e.message;}finally{clearTimeout(timer);}
  return Response.json({pid,result,error,elapsedMs:Date.now()-started});
}};`;
      const bundle=await build({stdin:{contents:worker,resolveDir:repo,sourcefile:'worker-pool.mjs'},bundle:true,write:false,metafile:true,format:'esm',platform:'neutral',conditions:['workerd'],external:['cloudflare:*','node:*']});
      const inputs=Object.keys(bundle.metafile.inputs);
      if(!inputs.some(p=>p.includes('postgres/cf/src/index.js'))||!inputs.some(p=>p.endsWith('scheduled-owned-postgres-pool-v1.ts')))
        throw Error('DEE1213_WRONG_BUNDLED_PROFILE');
      mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2025-12-01',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],outboundService:{network:{allow:['local'],tlsOptions:{trustBrowserCas:false,trustedCertificates:[cert]}}},log:new Log(LogLevel.ERROR)});
      const response=await bounded(mf.dispatchFetch('http://synthetic.invalid'),10000,'WORKER_POOL_WATCHDOG');
      const result=await response.json();
      const remaining=await witness`SELECT pid FROM pg_stat_activity WHERE pid=${result.pid}`;
      const opensAtReturn=connections;
      await new Promise(resolve=>setTimeout(resolve,100));
      const pass=result.pid>0&&remaining.length===0&&connections===opensAtReturn&&connections===2&&handshakes===2&&
        (mode==='abort-in-flight'?typeof result.error==='string'&&result.error!=='SCHEDULED_POSTGRES_CLEANUP_UNCONFIRMED'&&result.elapsedMs>=900:result.result==='ACKNOWLEDGED'&&!result.error);
      results.push({mode,pass,result,backendAbsentAtReturn:remaining.length===0,connections,handshakes,noLateOpen:connections===opensAtReturn,bundleSha256:createHash('sha256').update(bundle.outputFiles[0].text).digest('hex')});
    }catch(error){
      const active=await witness`SELECT pid,state,left(query,120) AS query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`;
      results.push({mode,pass:false,error:String(error),connections,handshakes,active});
    }
    finally{
      for(const s of sockets)s.destroy();
      if(mf)await bounded(mf.dispose(),3000,'MINIFLARE_DISPOSE_TIMEOUT');
      if(server)await bounded(new Promise(resolve=>server.close(resolve)),3000,'PROXY_CLOSE_TIMEOUT');
    }
  }
}finally{
  await witness.end({timeout:1});
  await fs.rm(tmp,{recursive:true,force:true});
}
const after=await hashes();
const report={schema:'dee1213-worker-pool/v1',at:new Date().toISOString(),sourceBefore:before,sourceAfter:after,results,
  pass:JSON.stringify(before)===JSON.stringify(after)&&results.length===2&&results.every(r=>r.pass)};
await fs.mkdir(path.dirname(path.resolve(args[1])),{recursive:true});
await fs.writeFile(args[1],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,results}));
if(!report.pass)process.exitCode=1;
