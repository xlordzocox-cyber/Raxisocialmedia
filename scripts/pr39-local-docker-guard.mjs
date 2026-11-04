// PR39: closed, read-only Docker daemon endpoint selection for local-only PG17.
// This verifies client endpoint locality, NOT the physical daemon's identity.
// Never permit TCP/SSH endpoints, custom Docker config or automatic fallbacks.
const STOP='PR39 STOP: local Docker daemon endpoint not proven';
const fail=()=>{throw Error(STOP);};
const ENV_KEYS=Object.freeze(['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG',
 'DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']);
export const PR39_ALLOWED_LOCAL_DOCKER_HOSTS=Object.freeze({
 win32:Object.freeze(['npipe:////./pipe/docker_engine',
  'npipe:////./pipe/dockerDesktopLinuxEngine']),
 linux:Object.freeze(['unix:///var/run/docker.sock']),
 darwin:Object.freeze([]) // Mac Desktop's user-specific socket is not reviewed.
});
export function selectPr39LocalDockerHost({platform,environment,contextName,inspection}){
 if(!['win32','linux','darwin'].includes(platform)||
    environment===null||typeof environment!=='object'||
    Array.isArray(environment)||!['default','desktop-linux'].includes(contextName))fail();
 for(const key of ENV_KEYS)if(Object.hasOwn(environment,key))fail();
 if(!Array.isArray(inspection)||inspection.length!==1)fail();
 const context=inspection[0];
 if(context===null||typeof context!=='object'||Array.isArray(context)||
    context.Name!==contextName||context.Endpoints===null||
    typeof context.Endpoints!=='object'||Array.isArray(context.Endpoints))fail();
 const endpoints=Object.keys(context.Endpoints);
 if(endpoints.length!==1||endpoints[0]!=='docker')fail();
 const target=context.Endpoints.docker;
 if(target===null||typeof target!=='object'||Array.isArray(target)||
    typeof target.Host!=='string'||
    target.SkipTLSVerify!==false)fail();
 const allowlist=PR39_ALLOWED_LOCAL_DOCKER_HOSTS[platform];
 if(!allowlist.includes(target.Host))fail();
 // Restrict Docker Desktop Linux context to its expected local pipe.
 if(contextName==='desktop-linux'&&
    !(platform==='win32'&&target.Host==='npipe:////./pipe/dockerDesktopLinuxEngine'))fail();
 if(context.TLSMaterial&&Object.keys(context.TLSMaterial).length)fail();
 return target.Host;
}
