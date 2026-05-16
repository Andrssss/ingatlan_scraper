import https from 'https';
function fetchRaw(url, cookies='') {
  return new Promise((res,rej)=>{
    const u=new URL(url);
    const r=https.request(u,{method:'GET',headers:{
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language':'hu-HU,hu;q=0.9,en;q=0.8',
      'Accept-Encoding':'identity',
      'Referer':'https://www.google.com/',
      'Upgrade-Insecure-Requests':'1',
      'Sec-Fetch-Dest':'document','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'cross-site','Sec-Fetch-User':'?1',
      ...(cookies?{Cookie:cookies}:{})
    }},resp=>{
      let d='';resp.on('data',c=>d+=c);resp.on('end',()=>res({status:resp.statusCode,headers:resp.headers,body:d}));
    });r.on('error',rej);r.end();
  });
}
const home=await fetchRaw('https://ingatlan.com/');
const setCookie=(home.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');
console.log('HOME status=',home.status,'len=',home.body.length,'cookies=',setCookie.substring(0,200));
console.log('HOME blocked=',home.body.includes('Csak egy gyors'));
const list=await fetchRaw('https://ingatlan.com/lista/elado+lakas+budapest',setCookie);
console.log('LIST status=',list.status,'len=',list.body.length);
console.log('LIST blocked=',list.body.includes('Csak egy gyors'),'has_price=',list.body.includes('Ft'));
console.log('LIST PREFIX:',list.body.substring(0,300));
