// Don't evaluate into Chrome's initial document while its launch URL is still
// navigating: the execution context can disappear mid offline render.
export async function loadTestPage(ws,url) {
  function call(id,method,params={}) {
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{ws.removeEventListener('message',read);reject(Error(method+' timeout'));},10000);
      function read(e) { const m=JSON.parse(e.data);if(m.id!==id)return;clearTimeout(timer);ws.removeEventListener('message',read);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result); }
      ws.addEventListener('message',read);ws.send(JSON.stringify({id,method,params}));
    });
  }
  await call(97,'Page.stopLoading');await call(98,'Page.enable');
  const loaded=new Promise(resolve=>{
    function read(e){if(JSON.parse(e.data).method==='Page.loadEventFired'){ws.removeEventListener('message',read);resolve();}}
    ws.addEventListener('message',read);
  });
  await call(99,'Page.navigate',{url});await loaded;
}
