import {fetch} from 'undici';
try {
const r=await fetch('https://ingatlan.com/lista/elado+lakas+budapest',{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36','Accept':'text/html','Accept-Language':'hu','Referer':'https://www.google.com/'}});
const t=await r.text();
console.log('STATUS',r.status,'LEN',t.length,'blocked=',t.includes('Csak egy gyors'));
console.log(t.substring(0,300));
} catch (e) {
  console.log('ERROR', e.message);
}
